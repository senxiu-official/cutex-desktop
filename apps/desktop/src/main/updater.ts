// Self-update for portable installs (<base>/releases/<release>/cutex[.exe], <base>/current link):
// periodically `git fetch` the source checkout the running release was built from; on request pull,
// pnpm install, build, package a new release next to the running one, repoint `current` and relaunch.
// Any failure leaves the running release and `current` untouched.
//
// A package copied to another machine (no source checkout there, git missing, or an update remote it
// cannot reach) reports state "unsupported" with a code instead of failing: no sidebar button, a quiet
// line in Settings → 更新与诊断, no noisy retries (an unreachable network remote backs off; a missing
// path remote is not checked again). `CUTEX_DESKTOP_UPDATE_REMOTE` / prefs `updateRemotes[channel]` /
// `updateRemote` fetch from another remote than the checkout's origin (resolveUpdateRemote).
// A CI release package records its `releasePage` (package-portable.mjs --release-page). Installed in the
// releases layout on the `release` channel (Linux / Windows / macOS), without a source checkout, it updates
// itself from the GitHub release of that page's repository (binary self-update, binaryUpdate.ts): the
// check asks GitHub's API for the latest release (at most hourly in the background, ETag-cached), the
// update downloads the platform package, verifies its minisign signature with the embedded release keys
// (minisign.ts) and its sha256 against the signed SHA256SUMS, unpacks it into <base>/releases/<version>
// and switches `current` like a source update (same relaunch, rollback and old-release housekeeping).
// macOS too: the release dir holds the ad-hoc signed Cutex.app (unpacked with ditto, quarantine mark
// stripped, `codesign --verify --deep --strict` required) and the launcher clone finds its release
// through a sidecar file (shared/releases.ts LAUNCHER_INSTALL_FILE) since the sealed bundle records none.
// Anywhere else (outside the releases layout, e.g. Cutex.app copied to /Applications by hand, or another
// channel) it reports code `releasePackage` and Settings links to that page (downloaded by hand).
//
// Channel: the branch an install follows — `main` (开发版, the owner's installs, default) or `release`
// (正式版) — from `<base>/channel`, else the packaged `channel`, else main (shared/update.ts
// resolveChannel). Settings switches it (setChannel writes `<base>/channel`). Ahead / offMain compare
// against that branch only; a channel whose branch does not exist on the remote yet is the quiet
// unsupported code `channelMissing`. After a switch to a channel whose head is older than the running
// build, that head is offered behind the update button (never installed by itself).
//
// macOS: the release dir holds `Cutex.app`; the layout's launcher is `Cutex.app/Contents/MacOS/Cutex`.
// New macOS release dirs are named `<hash>.noindex` (hidden from Spotlight); the visible app is the
// launcher clone `~/Applications/Cutex.app` (shared/releases.ts syncMacLauncher), refreshed before each
// relaunch so the Dock pin and the Apps picker entry keep one path.
//
// Old releases (releaseMaintenance.ts): once a release has rendered, everything but current's target and
// the previous release moves to <base>/old-releases; archived ones are deleted 30 days after the move
// or from Settings → 更新与诊断 (deleteOldReleases).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { cleanBinaryLeftovers, installBinaryRelease, LatestReleaseClient, ReleaseCheckError, type BinarySource } from "./binaryUpdate";
import { parsePublicKey, releaseKeyring } from "./minisign";
import { createUpdateNet, type UpdateNet } from "./updateNet";
import { envHasProxy, gitProxyArgs, proxyEnv, type Transport } from "./updateTransport";
import { BINARY_MIN_CHECK_MINUTES, GITHUB_API, GITHUB_WEB, githubRepoOf, isNewerVersion, parseVersion, releasePlatform, updateAssets, type LatestRelease } from "../shared/binaryUpdate";
import type { UpdateStatus, UpdateStep } from "../shared/ipc";
import { ReleaseMaintenance } from "./releaseMaintenance";
import { bundlePackageJson, LAUNCHER_INSTALL_FILE, launcherSidecarRelease, MAC_BUNDLE, OLD_RELEASE_MAX_AGE_DAYS, MAC_RELEASE_SUFFIX } from "../shared/releases";
import { backoffMinutes, buildSteps, builtChannel, CHANNEL_FILE, channelFileContent, checkoutPlan, corepackEntryIn, displayRemote, fetchArgs, fetchFailure, isKnownChannel, resolveInstallLayout, isOwnClone, isPathRemote, parseReleaseInfo, pathRemotePath, releaseName, resolveChannel, resolveSourceDir, sourceDirtyCheck, spawnPlan, tail, updateOffer, updateRef, type InstallLayout, type ReleaseInfo } from "../shared/update";

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const FIRST_CHECK_DELAY_MS = 30_000;
/** Old-release housekeeping waits this long after the first frame (startup work goes first). */
const MAINTENANCE_DELAY_MS = 15_000;
/** A freshly switched-to release must render its UI within this long, or it is rolled back. */
const READY_TIMEOUT_MS = 25_000;

/** Written before the relaunch into a new release; cleared once that release has rendered. */
interface PendingUpdate {
  from: string;
  to: string;
  at: string;
}

export class Updater {
  private status: UpdateStatus;
  private info: (ReleaseInfo & { sourceDir: string }) | null = null;
  private layout: InstallLayout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readyTimer: NodeJS.Timeout | null = null;
  private minutes = 0;
  /** Unreachable-remote checks in a row (backs the background check off). */
  private failures = 0;
  /** The branch this install follows (resolveChannel). */
  private channel = "main";
  /** Old-release housekeeping (null: not a portable install). */
  private maintenance: ReleaseMaintenance | null = null;
  /** The housekeeping run in flight (one at a time). */
  private maintaining: Promise<void> | null = null;
  private maintenanceScheduled = false;

  /** Release-package install updating from GitHub releases (null: source updates or none). */
  private binary: { source: BinarySource; client: LatestReleaseClient; version: string; release: LatestRelease | null } | null = null;

  /** The update remote for a channel (null = the checkout's origin); read at every check / update. */
  private readonly remoteFor: (channel: string) => string | null;

  /** Chromium-side network access (proxy resolution, transport); created on first use. */
  private netInstance: UpdateNet | null = null;
  /** Proxy environment for the build steps of the update in flight (source updates). */
  private buildProxyEnv: Record<string, string> = {};

  /**
   * `remote`: the update remote override, fixed or per channel (null = the checkout's origin).
   * `net.contained`: the agent-page / plugin network containment is engaged (pluginNetwork.ts): Chromium's
   * DNS is off for the rest of the run, transfers go through Node with Chromium's proxy decision
   * (updateNet.ts). `net.transport` / `net.updateNet`: replace the Chromium side (tests).
   */
  constructor(
    private readonly emit: (status: UpdateStatus) => void,
    remote: string | null | ((channel: string) => string | null) = null,
    private readonly netOpts: { contained?: () => boolean; transport?: Transport; updateNet?: UpdateNet } = {},
  ) {
    this.remoteFor = typeof remote === "function" ? remote : () => remote;
    this.status = { state: "unsupported", code: "devRun", current: null, latest: null };
    if (!app.isPackaged) {
      this.status.reason = "dev run";
      return;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
    } catch {
      // reported below
    }
    const info = parseReleaseInfo(raw);
    // Launched through the `current` link: Windows keeps the junction in execPath, Linux resolves it.
    // macOS launcher clone: its recorded release stands in for the running one (resolveInstallLayout).
    const execPath = realExecPath();
    let layout = resolveInstallLayout(execPath, WIN ? "\\" : "/", MAC && !("reason" in info) ? (info.releaseDir ?? (info.releasePage ? launcherSidecarReleaseFor(execPath, raw) : null)) : null);
    // A stale clone (its release already moved to old-releases) still finds the install by its base.
    if (!("reason" in layout) && layout.launcherBundle && !existsSync(layout.currentLink)) layout = { reason: `the launcher's install ${layout.baseDir} has no current link` };
    if (!("reason" in info) && "reason" in layout && info.releasePage) {
      // A release package unpacked outside the releases layout (e.g. Cutex.app dragged to /Applications):
      // updates are downloaded by hand from its release page.
      this.status = { state: "unsupported", code: "releasePackage", reason: layout.reason, releasePage: info.releasePage, ...(info.channel ? { channel: info.channel } : {}), current: { commit: info.commit, committedAt: info.committedAt }, latest: null };
      return;
    }
    if ("reason" in info || "reason" in layout) {
      this.status.code = "reason" in info ? "noReleaseInfo" : "notPortable";
      this.status.reason = "reason" in info ? info.reason : (layout as { reason: string }).reason;
      return;
    }
    this.layout = layout;
    this.maintenance = new ReleaseMaintenance(layout, (text) => this.log(text));
    this.channel = resolveChannel(readText(join(layout.baseDir, CHANNEL_FILE)), info.channel);
    const channel = this.channel;
    const current = { commit: info.commit, committedAt: info.committedAt };
    const sourceDir = resolveSourceDir(info.sourceDir, layout, WIN ? "\\" : "/", (dir) => existsSync(join(dir, ".git")));
    if (!sourceDir) {
      // Old-release maintenance above keeps running; only updating needs the checkout. A release package
      // (CI-built, no source) updates from its GitHub release when it can, else points at its page.
      const binary = info.releasePage ? binarySource(info, channel) : null;
      if (binary && !("reason" in binary)) {
        this.binary = { source: binary, client: new LatestReleaseClient(binary, this.transport()), version: info.version!, release: null };
        try {
          cleanBinaryLeftovers(layout.baseDir, layout.releasesDir);
        } catch (error) {
          this.log(`binary update leftovers: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.status = { state: "idle", channel, binary: true, releasePage: info.releasePage!, source: `github.com/${binary.repo.owner}/${binary.repo.repo}`, current: { ...current, version: info.version! }, latest: null };
        return;
      }
      this.status = info.releasePage
        ? { state: "unsupported", code: "releasePackage", reason: `release package without a source checkout${binary ? `: ${binary.reason}` : ""}`, releasePage: info.releasePage, channel, current: info.version ? { ...current, version: info.version } : current, latest: null }
        : { state: "unsupported", code: "noSource", reason: "no source checkout on this machine", channel, current, latest: null };
      return;
    }
    this.info = { ...info, sourceDir };
    this.status = { state: "idle", channel, canSwitchChannel: true, current, latest: null };
    void this.refreshSource();
  }

  /** The current channel's remote. */
  private get remote(): string | null {
    return this.remoteFor(this.channel);
  }

  /** Show where updates come from (credentials stripped). */
  private async refreshSource(): Promise<void> {
    const url = await this.remoteUrl();
    const source = url ? displayRemote(url) : undefined;
    if (source !== this.status.source) this.set({ source });
  }

  /**
   * Follow another channel (Settings → 更新与诊断): write `<base>/channel`, forget what the old channel
   * offered and check the new one. Switching to an older channel offers its head (updateOffer "switch").
   */
  async setChannel(channel: string): Promise<UpdateStatus> {
    const layout = this.layout;
    if (!this.info || !layout) throw new Error("this install cannot update itself");
    if (!isKnownChannel(channel)) throw new Error(`unknown update channel: ${channel}`);
    if (this.status.state === "updating" || this.status.state === "ready") return this.state();
    if (channel !== this.channel) {
      writeFileSync(join(layout.baseDir, CHANNEL_FILE), channelFileContent(channel));
      this.log(`channel ${this.channel} -> ${channel}`);
      this.channel = channel;
    }
    await this.checking?.catch(() => {}); // a check of the old channel finishes first (it then leaves the state alone)
    this.failures = 0;
    this.set({ state: "idle", channel, latest: null, code: undefined, reason: undefined, retryable: undefined, error: undefined, step: undefined });
    await this.refreshSource();
    const status = await this.check();
    this.schedule(this.minutes);
    return status;
  }

  /** The source checkout this install updates from (null: dev run / not a portable install / none on this machine). */
  sourceDir(): string | null {
    return this.info?.sourceDir ?? null;
  }

  state(): UpdateStatus {
    return structuredClone(this.status);
  }

  /** (Re)arm the periodic check; 0 minutes = off. The first check runs shortly after start. */
  schedule(minutes: number): void {
    this.minutes = minutes;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if ((!this.info && !this.binary) || minutes <= 0 || this.stopped()) return;
    // GitHub's unauthenticated API is shared by everyone behind one address: binary installs check hourly at most.
    if (this.binary) minutes = Math.max(minutes, BINARY_MIN_CHECK_MINUTES);
    const loop = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.check({ background: true }).finally(() => {
          if (!this.stopped()) loop(backoffMinutes(minutes, this.failures) * 60_000);
        });
      }, delay);
    };
    loop(this.status.checkedAt ? backoffMinutes(minutes, this.failures) * 60_000 : FIRST_CHECK_DELAY_MS);
  }

  /** Unsupported for good (not retryable): background checks stop. */
  private stopped(): boolean {
    return this.status.state === "unsupported" && !this.status.retryable;
  }

  /** The check in flight (setChannel waits for it before checking the new channel). */
  private checking: Promise<UpdateStatus> | null = null;

  check(opts: { background?: boolean } = {}): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    const applying = this.busy;
    const run = this.checkOnce(opts);
    if (applying) return run;
    const tracked = run.finally(() => {
      if (this.checking === tracked) this.checking = null;
    });
    this.checking = tracked;
    return tracked;
  }

  private async checkOnce(opts: { background?: boolean }): Promise<UpdateStatus> {
    if (this.binary) return this.checkBinary(opts);
    const info = this.info;
    if (!info || this.busy || this.status.state === "updating" || this.status.state === "ready") return this.state();
    if (this.stopped()) return this.state();
    this.busy = true;
    const before = this.status.state;
    // A background re-check of an unreachable remote stays quiet (no 「检查中」 flicker).
    if (before !== "available" && !(opts.background && before === "unsupported")) this.set({ state: "checking" });
    const remote = this.remote;
    const channel = this.channel;
    try {
      try {
        await this.git([...(await this.fetchProxyArgs()), ...fetchArgs(remote, channel)]);
      } catch (error) {
        this.unreachable(error, before);
        return this.state();
      }
      this.failures = 0;
      const head = (await this.git(["rev-parse", updateRef(remote, channel)])).trim();
      let latest: UpdateStatus["latest"] = null;
      if (head !== info.commit) {
        // Ahead: the usual update. Not on main at all (a release packaged by hand from another branch,
        // owner 2026-10-14: it then reported "up to date" forever): offer main too. A running build
        // newer than main (main is its ancestor) is never "updated" backwards — unless the owner switched
        // to this channel (the build was made for another one): then its head is offered as the switch.
        const ahead = await this.isAncestor(info.commit, head);
        const offer = updateOffer(ahead, !ahead && (await this.isAncestor(head, info.commit)), builtChannel(info) !== channel);
        if (offer) {
          const [commit, committedAt, ...subject] = (await this.git(["log", "-1", "--format=%H%x09%cI%x09%s", head])).trim().split("\t");
          const count = ahead ? Number((await this.git(["rev-list", "--count", `${info.commit}..${head}`])).trim()) || 1 : 0;
          latest = { commit: commit!, committedAt: committedAt!, subject: subject.join("\t"), count, ...(offer === "offMain" ? { offMain: true } : offer === "switch" ? { switchChannel: true } : {}) };
        }
      }
      if (channel !== this.channel) return this.state(); // switched meanwhile: setChannel checks again
      this.set({ state: latest ? "available" : "idle", latest, error: undefined, code: undefined, reason: undefined, retryable: undefined, checkedAt: new Date().toISOString() });
    } catch (error) {
      // A failed background check is not worth a red button; keep what we knew and log it.
      this.log(`check failed: ${error instanceof Error ? error.message : String(error)}`);
      this.set({ state: before === "available" ? "available" : "idle", code: undefined, reason: undefined, retryable: undefined, checkedAt: new Date().toISOString() });
    } finally {
      this.busy = false;
    }
    return this.state();
  }

  /**
   * The fetch failed: git missing → noGit (for good); a path remote that does not exist → for good;
   * anything else (network) → retryable, the background check backs off. An update already on offer
   * stays on offer (the remote may be back by the time the owner clicks).
   */
  private unreachable(error: unknown, before: UpdateStatus["state"]): void {
    const message = error instanceof Error ? error.message : String(error);
    const checkedAt = new Date().toISOString();
    const kind = fetchFailure(message, (error as NodeJS.ErrnoException)?.code);
    if (kind === "noGit") {
      this.log(`update check: git not found`);
      this.set({ state: "unsupported", code: "noGit", reason: "git not found", retryable: undefined, checkedAt });
      return;
    }
    if (kind === "channelMissing") {
      // The remote is fine; the channel's branch is not published yet (e.g. `release`). Quiet, checked
      // again at the normal interval (no backoff, no error), and nothing of the old offer stays.
      if (this.status.code !== "channelMissing") this.log(`update channel ${this.channel} has no branch on the update source yet`);
      this.failures = 0;
      this.set({ state: "unsupported", code: "channelMissing", reason: `no branch ${this.channel} on the update source`, retryable: true, latest: null, checkedAt });
      return;
    }
    this.failures++;
    if (this.failures === 1 || this.failures % 10 === 0) this.log(`update remote unreachable (${this.failures}x): ${message}`);
    if (before === "available") {
      this.set({ state: "available", checkedAt });
      return;
    }
    void this.remoteUrl().then((url) => {
      const gone = url !== null && isPathRemote(url) && !existsSync(pathRemotePath(url));
      this.set({ state: "unsupported", code: "remoteUnreachable", reason: gone ? "the update source is a path that does not exist on this machine" : tail(message, 2), retryable: gone ? undefined : true, checkedAt });
      if (gone) this.schedule(this.minutes);
    });
  }

  /**
   * Binary install: ask GitHub for the latest release; offer it when its version is newer than this
   * package's and it carries this platform's files. Unreachable / rate limited → quiet, retryable,
   * backing off like an unreachable git remote; no release yet → quiet `noRelease`.
   */
  private async checkBinary(opts: { background?: boolean }): Promise<UpdateStatus> {
    const b = this.binary!;
    if (this.busy || this.status.state === "updating" || this.status.state === "ready" || this.stopped()) return this.state();
    this.busy = true;
    const before = this.status.state;
    if (before !== "available" && !(opts.background && before === "unsupported")) this.set({ state: "checking" });
    const checkedAt = () => new Date().toISOString();
    try {
      const release = await b.client.latest();
      this.failures = 0;
      let latest: UpdateStatus["latest"] = null;
      if (isNewerVersion(release.version, b.version)) {
        const assets = updateAssets(release, b.source.platform);
        if ("reason" in assets) {
          if (b.release?.tag !== release.tag) this.log(`release ${release.tag} not offered: ${assets.reason}`);
        } else {
          latest = { commit: "", committedAt: release.publishedAt ?? "", subject: release.name, count: 0, version: release.version };
        }
      }
      b.release = latest ? release : null;
      this.set({ state: latest ? "available" : "idle", latest, error: undefined, code: undefined, reason: undefined, retryable: undefined, checkedAt: checkedAt() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ReleaseCheckError && error.kind === "noRelease") {
        if (this.status.code !== "noRelease") this.log(`update check: ${message}`);
        this.failures = 0;
        b.release = null;
        this.set({ state: "unsupported", code: "noRelease", reason: message, retryable: true, latest: null, checkedAt: checkedAt() });
      } else {
        this.failures++;
        if (this.failures === 1 || this.failures % 10 === 0) this.log(`update check failed (${this.failures}x): ${message}`);
        if (before === "available") this.set({ state: "available", checkedAt: checkedAt() });
        else this.set({ state: "unsupported", code: "remoteUnreachable", reason: tail(message, 2), retryable: true, checkedAt: checkedAt() });
      }
    } finally {
      this.busy = false;
    }
    return this.state();
  }

  /** Binary install: download, verify and unpack the release on offer, then switch and relaunch. */
  private async applyBinary(): Promise<UpdateStatus> {
    const b = this.binary!;
    const layout = this.layout;
    const release = b.release;
    if (!layout || !release || this.busy || this.status.state === "updating" || this.status.state === "ready") return this.state();
    this.busy = true;
    let step: UpdateStep = "download";
    try {
      // Never backwards, even if the offer went stale.
      if (!isNewerVersion(release.version, b.version)) throw new Error(`release ${release.version} is not newer than ${b.version}`);
      this.set({ state: "updating", step, error: undefined });
      this.log(`updating ${b.version} -> ${release.version} from github.com/${b.source.repo.owner}/${b.source.repo.repo}`);
      const dest = await installBinaryRelease({
        source: b.source,
        transport: this.transport(),
        release,
        baseDir: layout.baseDir,
        releasesDir: layout.releasesDir,
        launcher: layout.launcher,
        packageJson: MAC ? [layout.launcher[0]!, "Contents", "Resources", "app", "package.json"] : ["resources", "app", "package.json"],
        win: WIN,
        mac: MAC,
        suffix: MAC ? MAC_RELEASE_SUFFIX : "",
        onStep: (s) => {
          step = s;
          this.set({ step });
        },
        log: (text) => this.log(text),
      });
      step = "switch";
      this.set({ step });
      this.switchAndRelaunch(layout, dest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`update failed at ${step}: ${message}`);
      this.set({ state: "error", step, error: tail(message) });
    } finally {
      this.busy = false;
    }
    return this.state();
  }

  private updateNet(): UpdateNet {
    this.netInstance ??= this.netOpts.updateNet ?? createUpdateNet({ contained: this.netOpts.contained ?? (() => false), testProxy: this.binary?.source.testProxy ?? null });
    return this.netInstance;
  }

  /** The binary updater's transport: the injected one (tests), else Chromium's (updateNet.ts). */
  private transport(): Transport {
    if (this.netOpts.transport) return this.netOpts.transport;
    return (url, init) => this.updateNet().transport(url, init);
  }

  /**
   * git honours http.proxy / *_PROXY but not the OS proxy settings: for an http(s) remote with neither
   * set, pass the proxy Chromium resolves for it (`-c http.proxy=…`). ssh and path remotes: nothing.
   */
  private async fetchProxyArgs(): Promise<string[]> {
    try {
      const url = await this.remoteUrl();
      if (!url || !/^https?:\/\//i.test(url) || envHasProxy(process.env)) return [];
      if ((await this.git(["config", "--get", "http.proxy"]).catch(() => "")).trim()) return [];
      const args = gitProxyArgs(url, await this.updateNet().proxyFor(url));
      if (args.length) this.log(`git fetch uses the system proxy ${args[1]!.slice("http.proxy=".length)}`);
      return args;
    } catch {
      return [];
    }
  }

  /** The remote updates fetch from: the override, else origin's URL (null when unknown). */
  private async remoteUrl(): Promise<string | null> {
    if (this.remote) return this.remote;
    try {
      return (await this.git(["remote", "get-url", "origin"])).trim() || null;
    } catch {
      return null;
    }
  }

  async apply(): Promise<UpdateStatus> {
    if (this.binary) return this.applyBinary();
    const info = this.info;
    const layout = this.layout;
    if (!info || !layout || this.busy || this.status.state === "updating" || this.status.state === "ready") return this.state();
    this.busy = true;
    let step: UpdateStep = "pull";
    try {
      this.set({ state: "updating", step, error: undefined });
      // Only the install's own clone <base>/src gets its lockfile restored; a developer's tree is left alone.
      const dirty = sourceDirtyCheck(await this.git(["status", "--porcelain", "--untracked-files=no"]), isOwnClone(realPath(info.sourceDir), { baseDir: realPath(layout.baseDir) }, WIN));
      if (dirty.state === "restore") {
        // Only the lockfile a previous install rewrote: put it back so the pull can proceed.
        this.log(`restoring ${dirty.files.join(", ")} rewritten by an earlier pnpm install`);
        await this.git(["checkout", "--", ...dirty.files]);
      }
      if (dirty.state === "dirty") throw new Error(`source checkout has uncommitted changes (${dirty.files.join(", ")}): ${info.sourceDir}`);
      const remote = this.remote;
      const channel = this.channel;
      const ref = updateRef(remote, channel);
      await this.git([...(await this.fetchProxyArgs()), ...fetchArgs(remote, channel)]);
      // Onto the channel branch at the fetched head (a channel switch changes branch; never drops commits).
      const headBranch = await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"]).then((b) => b.trim() || null, () => null);
      const branchExists = await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${channel}`]).then(() => true, () => false);
      const plan = checkoutPlan(channel, ref, { headBranch, branchExists, branchBehindRef: branchExists && (await this.isAncestor(`refs/heads/${channel}`, ref)) });
      if ("reason" in plan) throw new Error(`${plan.reason} (${info.sourceDir})`);
      for (const args of plan) await this.git(args);
      const commit = (await this.git(["rev-parse", "HEAD"])).trim();
      if (commit !== (await this.git(["rev-parse", ref])).trim()) throw new Error(`source checkout is not at the ${channel} head after the pull: ${info.sourceDir}`);
      const name = releaseName(commit, (n) => existsSync(join(layout.releasesDir, n)), MAC ? MAC_RELEASE_SUFFIX : "");
      const dest = join(layout.releasesDir, name);
      const steps = buildSteps(dest, channel);
      // pnpm / corepack / Electron's downloader reach the npm registry and GitHub: the system proxy too.
      this.buildProxyEnv = envHasProxy(process.env) ? {} : proxyEnv(await this.updateNet().proxyFor("https://registry.npmjs.org/"));
      if (Object.keys(this.buildProxyEnv).length) this.log(`build steps use the system proxy ${this.buildProxyEnv.HTTPS_PROXY}`);
      for (const s of ["install", "build", "package"] as const) {
        step = s;
        this.set({ step });
        await this.run(steps[s].command, steps[s].args, join(info.sourceDir, steps[s].cwd));
      }
      step = "switch";
      this.set({ step });
      this.switchAndRelaunch(layout, dest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`update failed at ${step}: ${message}`);
      this.set({ state: "error", step, error: tail(message) });
    } finally {
      this.busy = false;
    }
    return this.state();
  }

  /**
   * Point `current` at the new release `dest`, record the pending update (watchLaunch rolls back when it
   * does not come up) and relaunch through the link. Throws (nothing switched) when `dest` has no launcher.
   */
  private switchAndRelaunch(layout: InstallLayout, dest: string): void {
    // Never point `current` at a release without its executable (a half-written package).
    const launcher = join(dest, ...layout.launcher);
    if (!existsSync(launcher)) throw new Error(`the new release has no ${launcher}; keeping ${layout.releaseDir}`);
    this.switchCurrent(layout.currentLink, dest);
    const relaunchPath = this.relaunchPath(layout);
    this.set({ state: "ready" });
    writeFileSync(this.pendingPath(), JSON.stringify({ from: layout.releaseDir, to: dest, at: new Date().toISOString() } satisfies PendingUpdate));
    this.log(`switched ${layout.currentLink} -> ${dest}; relaunching ${relaunchPath}`);
    // Relaunch from the link so the next update finds the same layout; exit skips close-to-tray.
    // Long enough to read 「更新完成，正在重启…」 (at 600 ms the owner took the relaunch for a crash).
    setTimeout(() => {
      app.relaunch({ execPath: relaunchPath, args: process.argv.slice(1) });
      app.exit(0);
    }, 2500);
  }

  /**
   * After a relaunch into a new release: wait for the renderer to report it rendered
   * (confirmReady). If it does not within READY_TIMEOUT_MS, or the renderer dies, switch `current`
   * back to the release we came from and relaunch it; that release shows the failure.
   */
  watchLaunch(onRendererGone: (listener: () => void) => void): void {
    const pending = this.readPending();
    const layout = this.layout;
    if (!pending || !layout) return;
    if (!samePath(pending.to, layout.releaseDir)) {
      // Running something else (e.g. the old release after a rollback): report and forget it.
      const rolledBack = samePath(pending.from, layout.releaseDir);
      this.clearPending();
      if (rolledBack) this.status = { ...this.status, state: "error", step: "switch", error: `the new release did not start (${pending.to}); rolled back` };
      return;
    }
    const rollback = (why: string) => {
      if (!this.readPending()) return;
      this.log(`new release ${pending.to} failed to start (${why}); rolling back to ${pending.from}`);
      try {
        this.switchCurrent(layout.currentLink, pending.from);
      } catch (error) {
        this.log(`rollback failed: ${error instanceof Error ? error.message : String(error)}`);
        this.clearPending();
        return;
      }
      app.relaunch({ execPath: this.relaunchPath(layout), args: process.argv.slice(1) });
      app.exit(0);
    };
    this.readyTimer = setTimeout(() => rollback("no UI after 25 s"), READY_TIMEOUT_MS);
    onRendererGone(() => rollback("renderer process gone"));
  }

  /** The renderer committed its first frame: a pending update is good; old releases are tidied up. */
  confirmReady(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const pending = this.readPending();
    if (pending) {
      this.log(`release ${this.layout?.releaseDir} started fine`);
      this.clearPending();
    }
    if (!this.maintenanceScheduled && this.maintenance) {
      this.maintenanceScheduled = true;
      // The release we came from (when this start follows an update) is the one to keep for rollback.
      setTimeout(() => void this.maintain(pending?.from ?? null), MAINTENANCE_DELAY_MS);
    }
  }

  /**
   * Housekeeping after a good start: macOS launcher clone on current, old releases moved to
   * old-releases/, archived ones older than 30 days deleted, then the remaining size reported.
   */
  private maintain(previous: string | null): Promise<void> {
    const m = this.maintenance;
    // Not while an update builds / switches (it relaunches; the next start tidies up). A check may run.
    if (!m || this.status.state === "updating" || this.status.state === "ready") return Promise.resolve();
    return this.serialized(async () => {
      if (MAC && this.layout) {
        try {
          m.syncLauncher();
        } catch (error) {
          this.log(`launcher sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      try {
        m.archive(previous);
      } catch (error) {
        this.log(`old releases: archive failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await m.deleteOld(false);
      await this.measureOld();
    });
  }

  /** Settings → 更新与诊断 → 删除旧版本: delete everything in old-releases/ now. */
  async deleteOldReleases(): Promise<UpdateStatus> {
    const m = this.maintenance;
    if (!m) throw new Error("this install has no old releases");
    await this.serialized(async () => {
      await m.deleteOld(true);
      await this.measureOld();
    });
    return this.state();
  }

  private async measureOld(): Promise<void> {
    const m = this.maintenance;
    if (!m) return;
    const { count, bytes } = await m.measure();
    this.set({ oldReleases: { count, bytes, autoDeleteDays: OLD_RELEASE_MAX_AGE_DAYS, dir: m.oldReleasesDir } });
  }

  private serialized(task: () => Promise<void>): Promise<void> {
    const run = (this.maintaining ?? Promise.resolve()).then(task, task).catch((error: unknown) => {
      this.log(`old releases: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.maintaining = run;
    return run;
  }

  /**
   * The executable to relaunch after `current` moved: on macOS the launcher clone (refreshed onto the
   * new current first) when this install has one, so the Dock keeps one icon; else `current`'s.
   */
  private relaunchPath(layout: InstallLayout): string {
    const viaCurrent = join(layout.currentLink, ...layout.launcher);
    if (!MAC || !this.maintenance) return viaCurrent;
    try {
      const result = this.maintenance.syncLauncher();
      if (result && (result.action === "created" || result.action === "refreshed" || result.action === "current")) return join(result.launcher, ...layout.launcher.slice(1));
    } catch (error) {
      this.log(`launcher sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return viaCurrent;
  }

  private pendingPath(): string {
    return join(app.getPath("userData"), "update-pending.json");
  }

  private readPending(): PendingUpdate | null {
    try {
      const v = JSON.parse(readFileSync(this.pendingPath(), "utf8")) as Partial<PendingUpdate>;
      return typeof v.from === "string" && typeof v.to === "string" ? { from: v.from, to: v.to, at: String(v.at ?? "") } : null;
    } catch {
      return null;
    }
  }

  private clearPending(): void {
    rmSync(this.pendingPath(), { force: true });
  }

  private switchCurrent(link: string, target: string): void {
    if (WIN) {
      // Junctions: remove the old link itself (rmdir never touches the target), then create anew.
      if (existsSync(link) || isLink(link)) rmdirSync(link);
      symlinkSync(target, link, "junction");
      return;
    }
    const tmp = `${link}.new-${process.pid}`;
    if (isLink(tmp)) unlinkSync(tmp);
    symlinkSync(target, tmp);
    renameSync(tmp, link); // atomic replace
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit(this.state());
  }

  private async isAncestor(a: string, b: string): Promise<boolean> {
    try {
      await this.git(["merge-base", "--is-ancestor", a, b]);
      return true;
    } catch {
      return false;
    }
  }

  private git(args: string[]): Promise<string> {
    return this.run("git", ["-C", this.info!.sourceDir, ...args], this.info!.sourceDir, true);
  }

  /** Run a command; resolve stdout, reject with the output tail. Never shows a console window. */
  private run(command: string, args: string[], cwd: string, quiet = false): Promise<string> {
    const info = this.info!;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("ELECTRON_")) delete env[key];
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    // The builder's node when it exists here (a release built on this machine), else PATH's.
    if (info.nodeDir && existsSync(info.nodeDir)) env[pathKey] = `${info.nodeDir}${WIN ? ";" : ":"}${env[pathKey] ?? ""}`;
    env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
    // No "Update available 10 → 12" banner: the pinned pnpm (packageManager) is the one to use.
    env.npm_config_update_notifier = "false";
    Object.assign(env, this.buildProxyEnv);
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_SSH_COMMAND ??= "ssh -o BatchMode=yes";
    // macOS: sign the next release with the identity this one was signed with (package-portable.mjs).
    if (info.codesignIdentity) env.CUTEX_DESKTOP_CODESIGN_IDENTITY ??= info.codesignIdentity;
    if (!quiet) this.log(`$ ${command} ${args.join(" ")}  (in ${cwd})`);
    // No shell: arguments (e.g. a release path under a profile with a space) stay whole. corepack is a
    // .cmd shim on Windows: run its JS entry with node instead (spawnPlan).
    const plan = spawnPlan(command, args, WIN, WIN && command === "corepack" ? findCorepackEntry(info.nodeDir, env[pathKey] ?? "") : null);
    if ("reason" in plan) return Promise.reject(new Error(plan.reason));
    return new Promise((resolve, reject) => {
      const child = spawn(plan.command, plan.args, { cwd, env, shell: plan.shell, windowsHide: true });
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        if (!quiet) this.log(out + err);
        if (code === 0) resolve(out);
        else reject(new Error(`${command} ${args.slice(0, 3).join(" ")} exited ${code}\n${tail(err || out)}`));
      });
    });
  }

  private log(text: string): void {
    try {
      appendFileSync(join(app.getPath("userData"), "update.log"), `[${new Date().toISOString()}] ${text}\n`);
    } catch {
      // logging is best effort
    }
  }
}

/**
 * Where a release package installed in the releases layout updates from, or why it cannot update itself:
 * the `release` channel only, Linux / Windows x64 or macOS arm64 / x64, a github.com release page, a
 * semver package version. (A macOS Cutex.app copied by hand outside the layout never gets here: it has
 * no layout, so it keeps the Releases-page link.)
 *
 * Packages built with `--update-test-hooks` (local end-to-end tests, never CI) honour
 * CUTEX_DESKTOP_UPDATE_TEST_API (a loopback http://127.0.0.1:<port> standing in for both api.github.com and
 * github.com), CUTEX_DESKTOP_UPDATE_TEST_PUBKEY (one more trusted minisign key) and
 * CUTEX_DESKTOP_UPDATE_TEST_PROXY (a loopback http proxy replacing the system proxy, loopback not
 * bypassed). Any other package ignores all three.
 */
/**
 * macOS: a process started from a launcher clone of a release package (its sealed bundle records no
 * releaseDir) finds its release through the sidecar syncMacLauncher wrote next to the clone, provided
 * the release there is the same build (launcherSidecarRelease). Null anywhere else.
 */
function launcherSidecarReleaseFor(execPath: string, ownPackage: unknown): string | null {
  const parts = execPath.split("/");
  const n = parts.length;
  if (n < 5 || parts[n - 2] !== "MacOS" || parts[n - 3] !== "Contents" || !/\.app$/i.test(parts[n - 4]!)) return null;
  const launcherDir = parts.slice(0, n - 4).join("/");
  const style = { sep: "/" as const, win: false };
  return launcherSidecarRelease(readText(join(launcherDir, LAUNCHER_INSTALL_FILE)), ownPackage ? JSON.stringify(ownPackage) : null, (dir) => readText(bundlePackageJson(style, join(dir, MAC_BUNDLE))));
}

export function binarySource(info: ReleaseInfo, channel: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, arch: string = process.arch): BinarySource | { reason: string } {
  if (channel !== "release") return { reason: `binary updates follow the release channel only (this install follows ${channel})` };
  const releasePlatformName = releasePlatform(platform, arch);
  if (!releasePlatformName) return { reason: `no release packages for ${platform}-${arch}` };
  const repo = githubRepoOf(info.releasePage);
  if (!repo) return { reason: "the release page is not a github.com repository" };
  if (!info.version || !parseVersion(info.version)) return { reason: "the package records no version" };
  const source: BinarySource = { repo, platform: releasePlatformName, apiBase: GITHUB_API, downloadBase: GITHUB_WEB, extraOrigins: [], keys: [...releaseKeyring()], testProxy: null };
  if (info.updateTestHooks) {
    const api = env.CUTEX_DESKTOP_UPDATE_TEST_API;
    if (api && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(api)) Object.assign(source, { apiBase: api, downloadBase: api, extraOrigins: [api] });
    const proxy = env.CUTEX_DESKTOP_UPDATE_TEST_PROXY;
    if (proxy && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(proxy)) source.testProxy = proxy;
    const key = env.CUTEX_DESKTOP_UPDATE_TEST_PUBKEY;
    if (key) {
      try {
        source.keys.push(parsePublicKey(key));
      } catch {
        // not a key: ignored
      }
    }
  }
  return source;
}

/**
 * Windows: corepack's JS entry (`<node dir>\node_modules\corepack\dist\corepack.js`) of the recorded
 * node dir, else of the first PATH dir holding node.exe or a corepack.cmd shim (npm's global dir).
 */
function findCorepackEntry(nodeDir: string | null, pathValue: string): string | null {
  const dirs = [nodeDir, ...pathValue.split(";")].filter((d): d is string => !!d && d.trim() !== "");
  for (const raw of dirs) {
    const dir = raw.replace(/^"|"$/g, "");
    if (dir !== nodeDir && !existsSync(join(dir, "node.exe")) && !existsSync(join(dir, "corepack.cmd"))) continue;
    const entry = corepackEntryIn(dir, "\\");
    if (existsSync(entry)) return entry;
  }
  return null;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function realExecPath(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return WIN ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A small text file's content, or null when it cannot be read. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
