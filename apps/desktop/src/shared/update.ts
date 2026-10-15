// Pure self-update logic (no Electron / child_process): what a portable release recorded about its
// build, where its install lives, and the commands each update step runs. The main-process updater
// (src/main/updater.ts) executes them.
import type { UpdateStatus } from "./ipc";

/** Fields scripts/package-portable.mjs writes into resources/app/package.json. */
export interface ReleaseInfo {
  /** Full commit the release was built from. */
  commit: string;
  committedAt: string | null;
  /** The git checkout it was built from (updates pull and build there); null in a release packaged
   *  with `--no-source` (for other machines: the builder's paths stay out of the package). */
  sourceDir: string | null;
  /** Directory of the node binary used to build it (put first on PATH for the build); null as above. */
  nodeDir: string | null;
  /** Update branch recorded at packaging (`--channel`); null = not recorded (see resolveChannel). */
  channel: string | null;
  /** macOS: the code-signing identity the release was signed with (`CUTEX_DESKTOP_CODESIGN_IDENTITY`
   *  at packaging); updates sign the next release with it too. null = ad hoc. */
  codesignIdentity: string | null;
  /** The release dir the package was written to (`<base>/releases/<name>`); a macOS launcher clone
   *  (`~/Applications/Cutex.app`, shared/releases.ts syncMacLauncher) finds its install through it.
   *  null in `--no-source` packages and in releases packaged before it was recorded. */
  releaseDir: string | null;
  /** Where new packages of this build are published (`--release-page`, https only; CI release
   *  packages). An install without a source checkout points the owner there instead of updating. */
  releasePage: string | null;
}

export function parseReleaseInfo(raw: unknown): ReleaseInfo | { reason: string } {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (k: string) => (typeof v[k] === "string" && v[k] ? (v[k] as string) : null);
  const commit = str("commit");
  const sourceDir = str("sourceDir");
  const nodeDir = str("nodeDir");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) return { reason: "release has no full commit (packaged before self-update)" };
  // `--no-source` packages write explicit nulls; a release from before self-update has no keys at all.
  if (!("sourceDir" in v) || !("nodeDir" in v)) return { reason: "release has no sourceDir / nodeDir (packaged before self-update)" };
  return { commit, committedAt: str("committedAt"), sourceDir, nodeDir, channel: parseChannel(v.channel), codesignIdentity: parseCodesignIdentity(v.codesignIdentity), releaseDir: str("releaseDir"), releasePage: parseReleasePage(v.releasePage) };
}

/** A release page URL to open in the system browser: https only, no credentials, ≤ 2048 chars; else null. */
export function parseReleasePage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 2048 || /[\s\x00-\x1f\x7f]/.test(v)) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return url.href;
}

/** A codesign identity name / hash (`codesign -s <identity>`); "-" or anything odd = ad hoc (null). */
export function parseCodesignIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.startsWith("-") || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}

export interface InstallLayout {
  /** <base> — holds releases/, current and (optionally) src/. */
  baseDir: string;
  /** <base>/releases/<name> — the running release. */
  releaseDir: string;
  releasesDir: string;
  /** <base>/current — link to the active release (launchers point here). */
  currentLink: string;
  /** Path of the executable inside a release dir, as segments: `["cutex"]` / `["cutex.exe"]`, on macOS
   *  `["Cutex.app", "Contents", "MacOS", "Cutex"]`. Relaunch = currentLink + these. */
  launcher: string[];
  /** macOS: the stable launcher bundle this process runs from (a clone of current's Cutex.app outside
   *  `<base>`); absent when it runs from a release dir. */
  launcherBundle?: string;
}

/**
 * The install layout around the running executable, or a reason it is not a portable install:
 * `<base>/releases/<release>/cutex[.exe]`, or on macOS `<base>/releases/<release>/<Name>.app/Contents/MacOS/<exe>`.
 */
export function installLayout(execPath: string, sep: "/" | "\\"): InstallLayout | { reason: string } {
  const parts = execPath.split(/[\\/]/);
  const n = parts.length;
  // macOS: the executable sits inside the .app bundle, which sits in the release dir.
  const inBundle = n >= 7 && parts[n - 2] === "MacOS" && parts[n - 3] === "Contents" && /\.app$/i.test(parts[n - 4]!);
  const depth = inBundle ? 4 : 1;
  if (n < depth + 3 || parts[n - depth - 2]!.toLowerCase() !== "releases") {
    return { reason: `not under <base>${sep}releases${sep}<release> (${execPath})` };
  }
  const base = parts.slice(0, n - depth - 2).join(sep);
  return {
    baseDir: base,
    releaseDir: parts.slice(0, n - depth).join(sep),
    releasesDir: parts.slice(0, n - depth - 1).join(sep),
    currentLink: `${base}${sep}current`,
    launcher: parts.slice(n - depth),
  };
}

/**
 * The layout of a process started from the macOS launcher clone (`<dir>/Cutex.app`, outside `<base>`):
 * the release it was cloned from (`releaseDir` recorded in its package) stands in for the running
 * release; `launcherBundle` is the clone. Anything else: installLayout's answer.
 */
export function resolveInstallLayout(execPath: string, sep: "/" | "\\", recordedReleaseDir: string | null): InstallLayout | { reason: string } {
  const direct = installLayout(execPath, sep);
  if (!("reason" in direct) || !recordedReleaseDir) return direct;
  const parts = execPath.split(/[\\/]/);
  const n = parts.length;
  const inBundle = n >= 5 && parts[n - 2] === "MacOS" && parts[n - 3] === "Contents" && /\.app$/i.test(parts[n - 4]!);
  if (!inBundle) return direct;
  const viaRelease = installLayout([recordedReleaseDir.replace(/[\\/]+$/, ""), parts[n - 4]!, "Contents", "MacOS", parts[n - 1]!].join(sep), sep);
  if ("reason" in viaRelease) return direct;
  return { ...viaRelease, launcherBundle: parts.slice(0, n - 3).join(sep) };
}

/**
 * Release directory name for a commit: the short hash (+ `suffix`, macOS `.noindex`), suffixed -2, -3 …
 * before it when that name is taken.
 */
export function releaseName(commit: string, taken: (name: string) => boolean, suffix = ""): string {
  const short = commit.slice(0, 7);
  if (!taken(short + suffix)) return short + suffix;
  for (let i = 2; ; i++) if (!taken(`${short}-${i}${suffix}`)) return `${short}-${i}${suffix}`;
}

export interface StepCommand {
  command: string;
  args: string[];
  /** Relative to the source checkout. */
  cwd: string;
}

/** The build pipeline, run in the source checkout after `git pull --ff-only`. */
export function buildSteps(dest: string, channel: string = DEFAULT_CHANNEL): { install: StepCommand; build: StepCommand; package: StepCommand } {
  return {
    install: { command: "corepack", args: ["pnpm", "install", "--frozen-lockfile"], cwd: "." },
    build: { command: "corepack", args: ["pnpm", "build"], cwd: "apps/desktop" },
    // The new release keeps the channel (main stays implicit: packages of the owner's installs are unchanged).
    package: { command: "node", args: ["scripts/package-portable.mjs", dest, ...(channel !== DEFAULT_CHANNEL ? ["--channel", channel] : [])], cwd: "." },
  };
}

/** Path of corepack's JS entry inside a Node install dir (Windows layout: next to node.exe). */
export function corepackEntryIn(dir: string, sep: "/" | "\\"): string {
  return [dir.replace(/[\\/]+$/, ""), "node_modules", "corepack", "dist", "corepack.js"].join(sep);
}

/** Characters cmd.exe interprets even inside double quotes (or that end the quoting). */
const CMD_UNSAFE = /["%^&|<>!\r\n]/;

/** An argument for a cmd.exe command line: quoted when it has spaces; null when cmd would reinterpret it. */
export function cmdQuote(arg: string): string | null {
  if (CMD_UNSAFE.test(arg)) return null;
  return arg === "" || /[\s,;=()]/.test(arg) ? `"${arg}"` : arg;
}

/**
 * How the updater starts a build step. Everything runs without a shell (paths with spaces, `&`, `^`
 * or `%` — e.g. a profile "John Smith" under %LOCALAPPDATA% — stay single arguments), except on Windows
 * `corepack`, a `.cmd` shim: it runs as `node <corepack.js> …` when corepack's entry is found
 * (`corepackEntry`), else through cmd.exe with every argument quoted (refused when an argument holds a
 * character cmd would reinterpret).
 */
export function spawnPlan(
  command: string,
  args: string[],
  win: boolean,
  corepackEntry: string | null,
): { command: string; args: string[]; shell: boolean } | { reason: string } {
  if (!win || command !== "corepack") return { command, args, shell: false };
  if (corepackEntry) return { command: "node", args: [corepackEntry, ...args], shell: false };
  const quoted = args.map(cmdQuote);
  if (quoted.some((a) => a === null)) return { reason: `cannot pass ${JSON.stringify(args)} to corepack.cmd safely (corepack.js not found next to node)` };
  return { command, args: quoted as string[], shell: true };
}

/**
 * Files the install step itself may rewrite in the source checkout. A frozen pnpm install can
 * still normalise pnpm-lock.yaml (e.g. a lockfile from an older export missing `path: {}`
 * importers), which would otherwise leave every later update refused as "uncommitted changes".
 */
export const INSTALL_REWRITTEN_FILES = ["pnpm-lock.yaml"] as const;

/**
 * Reads `git status --porcelain --untracked-files=no` of the source checkout before an update.
 * Clean, or only unstaged edits to INSTALL_REWRITTEN_FILES (restore those, then go on), or dirty.
 * `ownClone`: the checkout is the install's own `<base>/src` (the updater's clean clone). Any other
 * checkout (a developer's tree recorded with `--source`) is never restored: an edited lockfile there
 * may be the developer's own work, so it counts as dirty.
 */
export function sourceDirtyCheck(porcelain: string, ownClone = true): { state: "clean" } | { state: "restore"; files: string[] } | { state: "dirty"; files: string[] } {
  const lines = porcelain.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { state: "clean" };
  if (!ownClone) return { state: "dirty", files: lines.map((l) => l.slice(3)) };
  // " M <path>": modified in the work tree only (index untouched, no rename).
  const rewritten = (l: string) => l.startsWith(" M ") && (INSTALL_REWRITTEN_FILES as readonly string[]).includes(l.slice(3));
  if (lines.every(rewritten)) return { state: "restore", files: lines.map((l) => l.slice(3)) };
  return { state: "dirty", files: lines.map((l) => l.slice(3)) };
}

/** Last `max` non-empty lines of a step's output (for the error tooltip). */
export function tail(output: string, max = 12): string {
  return output
    .split(/\r?\n/)
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter(Boolean)
    .slice(-max)
    .join("\n");
}

/** The button shows only while there is something to act on (or an update is running). */
export function updateButtonVisible(status: UpdateStatus | null): boolean {
  if (!status) return false;
  return status.state === "available" || status.state === "updating" || status.state === "ready" || (status.state === "error" && status.latest !== null);
}

/**
 * What to offer when the update source's channel branch (`head`, "main" below) differs from the running
 * build: "ahead" when the build is an ancestor of main (the usual update), otherwise "offMain" (the build
 * is not on main at all, e.g. packaged by hand from another branch, or its commit is missing from the
 * source checkout). When main is an ancestor of the build (the build is newer) nothing is offered — never
 * update backwards by itself — unless the owner switched channel (`switched`: the build was made for
 * another channel than the one now followed): then the older head is offered as "switch", still behind
 * the update button.
 */
export function updateOffer(buildIsAncestorOfMain: boolean, mainIsAncestorOfBuild: boolean, switched = false): "ahead" | "offMain" | "switch" | null {
  if (buildIsAncestorOfMain) return "ahead";
  if (mainIsAncestorOfBuild) return switched ? "switch" : null;
  return "offMain";
}

/**
 * Git commands that put the source checkout on the channel branch at `ref` (the fetched head) before a
 * build, without ever discarding local commits: already on the branch → fast-forward; the local branch
 * does not exist → create it at `ref`; it exists and is behind `ref` → switch to it and fast-forward;
 * it has commits `ref` lacks → refuse (reason).
 */
export function checkoutPlan(
  channel: string,
  ref: string,
  s: { headBranch: string | null; branchExists: boolean; branchBehindRef: boolean },
): string[][] | { reason: string } {
  const ff = ["merge", "--ff-only", "--quiet", ref];
  if (s.headBranch === channel) return [ff];
  if (!s.branchExists) return [["checkout", "--quiet", "-b", channel, ref]];
  if (s.branchBehindRef) return [["checkout", "--quiet", channel], ff];
  return { reason: `local branch ${channel} has commits the update source does not have` };
}

/**
 * Why a portable install cannot update itself (UpdateStatus.code; the renderer words it):
 * devRun — electron + app path; noReleaseInfo — packaged before self-update; notPortable — not under
 * <base>/releases/<release>; noSource — no git source checkout on this machine (a package copied from
 * another machine); noGit — git is not installed; remoteUnreachable — the checkout's update remote
 * cannot be reached (retryable: a later check may succeed); releasePackage — installed from a release
 * package (it records a `releasePage`) and has no source checkout or is not in the portable layout
 * (e.g. macOS Cutex.app dragged to /Applications): updates are downloaded by hand from the release
 * page (UpdateStatus.releasePage); takes the place of notPortable / noSource for such packages.
 */
export type UpdateUnsupportedCode = "devRun" | "noReleaseInfo" | "notPortable" | "noSource" | "releasePackage" | "noGit" | "remoteUnreachable" | "channelMissing";

/**
 * Why a `git fetch` of the channel branch failed: git is not installed (spawn ENOENT), the remote has
 * no such branch (channelMissing: e.g. `release` before the first release is published; retryable, not
 * an error), or anything else (the remote cannot be reached).
 */
export function fetchFailure(message: string, errno?: string): "noGit" | "channelMissing" | "unreachable" {
  if (errno === "ENOENT") return "noGit";
  if (/couldn'?t find remote ref|could not find remote ref/i.test(message)) return "channelMissing";
  return "unreachable";
}

/**
 * Update remote override (env `CUTEX_DESKTOP_UPDATE_REMOTE`, else desktop-prefs.json `updateRemote`):
 * a git URL or path fetched instead of the checkout's `origin`. Null when unset or unusable (blank,
 * whitespace / control characters, a leading "-" that git would read as an option, over 2048 chars).
 */
export function parseUpdateRemote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 2048 || v.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}

/** The override in effect: the environment wins over the stored pref. */
export function updateRemoteOverride(env: string | undefined, pref: unknown): string | null {
  return parseUpdateRemote(env) ?? parseUpdateRemote(pref);
}

/** Per-channel update remotes (desktop-prefs.json `updateRemotes`), e.g. dev from the owner's git over
 *  SSH and release from a public repository. Only the two known channels; unusable entries dropped. */
export type UpdateRemotes = Partial<Record<KnownChannel, string>>;

export function parseUpdateRemotes(value: unknown): UpdateRemotes | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: UpdateRemotes = {};
  for (const channel of KNOWN_CHANNELS) {
    const remote = parseUpdateRemote((value as Record<string, unknown>)[channel]);
    if (remote) out[channel] = remote;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The remote a channel fetches from: env `CUTEX_DESKTOP_UPDATE_REMOTE` (all channels), else prefs
 * `updateRemotes[channel]`, else prefs `updateRemote` (all channels), else null = the checkout's origin.
 */
export function resolveUpdateRemote(env: string | undefined, prefs: { updateRemote?: unknown; updateRemotes?: unknown }, channel: string): string | null {
  const perChannel = parseUpdateRemotes(prefs.updateRemotes);
  const own = isKnownChannel(channel) ? perChannel?.[channel] : undefined;
  return parseUpdateRemote(env) ?? own ?? parseUpdateRemote(prefs.updateRemote);
}

/**
 * A remote URL safe to show: credentials stripped. `scheme://user:pass@host/…` and `https://token@host/…`
 * lose their userinfo (an http user name is often a token), `ssh://user@host` keeps the user (not a
 * secret) but loses a password; query strings and fragments are dropped. scp-like `user@host:path` and
 * paths are shown as they are.
 */
export function displayRemote(remote: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*@)?([^?#]*)/i.exec(remote);
  if (!m) return remote;
  const [, scheme, userinfo, rest] = m;
  if (!userinfo) return scheme! + rest!;
  if (/^(ssh|git\+ssh|ssh\+git):\/\//i.test(scheme!)) return `${scheme}${userinfo.slice(0, -1).split(":")[0]}@${rest}`;
  return scheme! + rest!;
}

/**
 * Whether a git remote is a path on this machine (or a mounted share) rather than a network URL:
 * `scheme://…` and scp-like `user@host:path` / `host:path` are network remotes; a Windows drive path
 * (`C:\…`, `C:/…`) and everything else is a path. A missing path remote never comes back by itself,
 * so the updater stops checking it.
 */
export function isPathRemote(remote: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) return remote.toLowerCase().startsWith("file://");
  if (/^[a-z]:[\\/]/i.test(remote)) return true;
  return !/^[^/\\]+:/.test(remote);
}

/** Path of a path remote (file:// stripped), for an existence check. */
export function pathRemotePath(remote: string): string {
  return remote.toLowerCase().startsWith("file://") ? decodeURIComponent(remote.slice(7)) : remote;
}

/**
 * The source checkout updates pull and build in: the one recorded at packaging when it exists on this
 * machine, else `<base>/src` (the documented portable layout). `isCheckout` tells whether a directory
 * is a git work tree.
 */
/** Whether `sourceDir` is the install's own clone `<base>/src` (Windows: case-insensitive). */
export function isOwnClone(sourceDir: string, layout: Pick<InstallLayout, "baseDir">, win: boolean): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(sourceDir);
  const b = `${norm(layout.baseDir)}/src`;
  return win ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function resolveSourceDir(recorded: string | null, layout: InstallLayout, sep: "/" | "\\", isCheckout: (dir: string) => boolean): string | null {
  if (recorded && isCheckout(recorded)) return recorded;
  const local = `${layout.baseDir}${sep}src`;
  return isCheckout(local) ? local : null;
}

/**
 * Update channel = the branch an install follows. The owner's installs follow `main` (the default:
 * nothing recorded = unchanged behaviour); installs for colleagues follow `release`. Resolved per
 * install: `<base>/channel` (one line, written by the install procedure; wins), else the `channel`
 * recorded in the package (`package-portable.mjs --channel <branch>`), else `main`.
 */
export const DEFAULT_CHANNEL = "main";
export const CHANNEL_FILE = "channel";
/** The channels Settings offers: 开发版 = main, 正式版 = release. Other branches still work via the file. */
export const KNOWN_CHANNELS = ["main", "release"] as const;
export type KnownChannel = (typeof KNOWN_CHANNELS)[number];

export function isKnownChannel(value: unknown): value is KnownChannel {
  return value === "main" || value === "release";
}

/** Content of `<base>/channel` for a channel (one line). */
export function channelFileContent(channel: string): string {
  return `${channel}\n`;
}

/** The channel a release was built for: its packaged `channel`, else main (owner packages record none). */
export function builtChannel(info: Pick<ReleaseInfo, "channel">): string {
  return info.channel ?? DEFAULT_CHANNEL;
}

/** A branch name usable as a channel (a plain git branch name; no options, no `..`, ≤ 100 chars). */
export function parseChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(v) || v.includes("..") || v.includes("//") || v.endsWith("/") || v.endsWith(".lock") || v.endsWith(".")) return null;
  return v;
}

/** The install's channel: `<base>/channel` file content (null = missing), else the packaged one, else main. */
export function resolveChannel(fileContent: string | null, packaged: string | null): string {
  return parseChannel(fileContent) ?? packaged ?? DEFAULT_CHANNEL;
}

/** The ref the channel branch of the update source lands in after `fetchArgs`. */
export function updateRef(remote: string | null, branch: string = DEFAULT_CHANNEL): string {
  return remote ? `refs/remotes/cutex-update/${branch}` : `refs/remotes/origin/${branch}`;
}

/** `git fetch` arguments for the channel branch: from the checkout's origin, or the override remote. */
export function fetchArgs(remote: string | null, branch: string = DEFAULT_CHANNEL): string[] {
  const refspec = `+refs/heads/${branch}:${updateRef(remote, branch)}`;
  return remote ? ["fetch", "--quiet", "--", remote, refspec] : ["fetch", "--quiet", "origin", refspec];
}

/** Delay before the next background check after `failures` unreachable checks in a row (doubling, ≤ 24 h). */
export function backoffMinutes(minutes: number, failures: number): number {
  if (failures <= 0) return minutes;
  return Math.min(24 * 60, minutes * 2 ** Math.min(failures, 16));
}
