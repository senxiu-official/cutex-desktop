// Updater against real git repositories: the channel branch decides what is offered, and an install
// whose update source is missing stays quietly "unsupported" (main/updater.ts, shared/update.ts).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ appPath: "", userData: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getAppPath: () => env.appPath, getPath: () => env.userData, relaunch: () => {}, exit: () => {} },
}));

let Updater!: typeof import("../src/main/updater")["Updater"];

/**
 * A PATH with git and no node / corepack, so the build step cannot start. POSIX: /usr/bin:/bin. Windows: Git for
 * Windows' own folders only (cmd, mingw64\bin, usr\bin — its fetch needs the msys runtime in usr\bin) —
 * "/usr/bin:/bin" means nothing there and hid git too (the apply then failed at "pull", not "install");
 * main/updater finds corepack only beside a node.exe or a corepack.cmd on PATH.
 */
function gitOnlyPath(): string {
  if (process.platform !== "win32") return "/usr/bin:/bin";
  const dirs = (process.env.PATH ?? "").split(";").map((d) => d.replace(/^"|"$/g, ""));
  const dir = dirs.find((d) => d && existsSync(join(d, "git.exe")));
  if (!dir) throw new Error("no git.exe on PATH");
  // <Git>\cmd, <Git>\bin or <Git>\mingw64\bin → <Git>.
  const root = [join(dir, ".."), join(dir, "..", "..")].find((r) => existsSync(join(r, "cmd", "git.exe")));
  const path = (root ? [join(root, "cmd"), join(root, "mingw64", "bin"), join(root, "usr", "bin")] : [dir]).filter((d) => existsSync(d));
  if (path.some((d) => existsSync(join(d, "node.exe")) || existsSync(join(d, "corepack.cmd")))) throw new Error(`node beside git in ${path.join(";")}`);
  return path.join(";");
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

// The updater runs real fetch and history queries. On a loaded Windows host,
// Git process startup alone can take seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let root: string;
let upstream: string;
/** main m1 → m2 only (no release branch yet). */
let mainOnly: string;
/** main m1 → m2, release at m1 (an older release head). */
let olderRelease: string;
const checkoutTemplates = new Map<string, Map<string, string>>();
const commits: Record<string, string> = {};
const realExecPath = process.execPath;

beforeAll(async () => {
  ({ Updater } = await import("../src/main/updater"));
  root = mkdtempSync(join(tmpdir(), "cutex-updater-"));
  upstream = join(root, "upstream");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "--template=", "-b", "main");
  const file = join(upstream, "f.txt");
  writeFileSync(file, "m1");
  git(upstream, "add", "f.txt");
  git(upstream, "commit", "-qm", "m1");
  writeFileSync(file, "m2");
  git(upstream, "commit", "-qam", "m2");
  const [m1, m2] = git(upstream, "rev-parse", "HEAD^", "HEAD").split(/\r?\n/);
  commits.m1 = m1!;
  commits.m2 = m2!;
  mainOnly = join(root, "main-only");
  cpSync(upstream, mainOnly, { recursive: true });

  olderRelease = join(root, "older-release");
  cpSync(mainOnly, olderRelease, { recursive: true });
  git(olderRelease, "branch", "release", commits.m1!);

  git(upstream, "checkout", "-q", "-b", "release", commits.m1!);
  writeFileSync(file, "r2");
  git(upstream, "commit", "-qam", "r2");
  commits.r2 = git(upstream, "rev-parse", "HEAD");
  git(upstream, "checkout", "-q", "main");
});

afterAll(() => {
  // Windows: a git child's handles (or Defender's) on a fresh repository can outlive the call by a moment; rm
  // retries EBUSY / EPERM / ENOTEMPTY.
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
});

/** Copy a clean checkout so fetch, config edits and branch switches stay local to each test. */
function copyCheckout(destination: string, origin: string, start: string) {
  let templates = checkoutTemplates.get(origin);
  if (!templates) {
    const main = mkdtempSync(join(root, "checkout-"));
    git(root, "clone", "-q", "--template=", "-c", "maintenance.auto=false", origin, main);
    templates = new Map([["main", main]]);
    checkoutTemplates.set(origin, templates);
  }
  let template = templates.get(start);
  if (!template) {
    template = mkdtempSync(join(root, "checkout-"));
    cpSync(templates.get("main")!, template, { recursive: true });
    git(template, "checkout", "-q", "--detach", start);
    templates.set(start, template);
  }
  cpSync(template, destination, { recursive: true });
}

/** A portable install at <base> running a build of `build`, with <base>/src cloned from `origin`. */
function install(name: string, opts: { build: string; channelFile?: string; packagedChannel?: string; origin?: string | null; from?: string; mac?: boolean; onMain?: boolean }) {
  const base = join(root, name);
  const rel = join(base, "releases", "abc1234");
  const appDir = join(rel, "resources", "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(rel, "cutex"), "");
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ commit: opts.build, committedAt: null, sourceDir: null, nodeDir: null, ...(opts.packagedChannel ? { channel: opts.packagedChannel } : {}) }));
  if (opts.channelFile !== undefined) writeFileSync(join(base, "channel"), opts.channelFile);
  if (opts.origin !== null) {
    const src = join(base, "src");
    copyCheckout(src, opts.from ?? upstream, opts.onMain ? "main" : opts.build);
    if (opts.origin) git(src, "remote", "set-url", "origin", opts.origin);
  }
  const userData = join(base, "userData");
  mkdirSync(userData, { recursive: true });
  env.appPath = appDir;
  env.userData = userData;
  let exe = join(rel, "cutex");
  if (opts.mac) {
    mkdirSync(join(rel, "Cutex.app", "Contents", "MacOS"), { recursive: true });
    exe = join(rel, "Cutex.app", "Contents", "MacOS", "Cutex");
    writeFileSync(exe, "");
  }
  Object.defineProperty(process, "execPath", { value: exe, configurable: true });
  return base;
}

async function settle(updater: InstanceType<typeof Updater>): Promise<UpdateStatus> {
  // The check resolves once its state is worded (an unreachable remote too: no fixed wait for its `git remote get-url`).
  await updater.check();
  return updater.state();
}

describe("updater channels", () => {
  function exportedInstall(name: string, source?: string, legacy = false, origin?: string) {
    const base = install(name, { build: commits.m1!, channelFile: "main", packagedChannel: "release", origin });
    const info = { commit: "e".repeat(40), committedAt: null, sourceDir: null, nodeDir: null, version: "0.2.1", channel: "release", releasePage: "https://github.com/example-org/cutex-desktop/releases" };
    writeFileSync(join(env.appPath, "package.json"), JSON.stringify(info));
    if (source) writeFileSync(legacy ? join(base, "RELEASE-RECEIPT.json") : join(env.appPath, "..", "..", "source-provenance.json"), JSON.stringify(legacy
      ? { version: info.version, publicStagingCommit: info.commit, privateProductCommit: source }
      : { version: info.version, build: info.commit, sourceCommit: source }));
    return base;
  }

  it("does not call an exported commit missing from source Git a fork", async () => {
    exportedInstall("export-no-mapping");
    const s = await settle(new Updater(() => {}));
    expect(s).toMatchObject({ state: "available", latest: { sourceComparison: "unknown", sourceBuild: true, installedReleaseVersion: "0.2.1", count: 0 } });
    expect(s.latest?.offMain).toBeUndefined();
    expect(s.current?.commit).toBe("e".repeat(40)); // Show actual packaged identity, never the private source hash.
  });

  it.each([false, true])("counts from exact private source provenance (legacy=%s)", async (legacy) => {
    exportedInstall(`export-provenance-${legacy}`, commits.m1, legacy);
    const s = await settle(new Updater(() => {}));
    expect(s.latest).toMatchObject({ commit: commits.m2, count: 1, sourceComparison: "ahead", sourceBuild: true });
    expect(s.latest?.offMain).toBeUndefined();
  });

  it("recognizes a valid source fork", async () => {
    exportedInstall("export-divergent", commits.r2);
    expect((await settle(new Updater(() => {}))).latest).toMatchObject({ offMain: true, sourceComparison: "diverged" });
  });

  it("keeps the comparison unknown if the source object is unavailable", async () => {
    exportedInstall("export-source-unavailable", "d".repeat(40));
    const s = await settle(new Updater(() => {}));
    expect(s.latest?.sourceComparison).toBe("unknown");
    expect(s.latest?.offMain).toBeUndefined();
  });

  it("does not offer a source build already at the followed head", async () => {
    exportedInstall("export-current", commits.m2);
    expect((await settle(new Updater(() => {}))).latest).toBeNull();
  });

  it("recognizes a release source merged into main through a merge commit", async () => {
    const merged = join(root, "merged-release-origin");
    copyCheckout(merged, upstream, "main");
    git(merged, "merge", "--no-ff", "-s", "ours", "origin/release", "-m", "release merged");
    const head = git(merged, "rev-parse", "HEAD");
    exportedInstall("export-merged-release", commits.r2, false, merged);
    const s = await settle(new Updater(() => {}));
    // The merge commit and m2 are the two commits outside the release history.
    expect(s.latest).toMatchObject({ commit: head, count: 2, sourceComparison: "ahead" });
    expect(s.latest?.offMain).toBeUndefined();
  });

  it.each(["source", "standalone"])("keeps the package version visible for a %s install", async (kind) => {
    install(`version-${kind}`, { build: commits.m1!, origin: kind === "standalone" ? null : undefined });
    const packagePath = join(env.appPath, "package.json");
    const info = JSON.parse(readFileSync(packagePath, "utf8"));
    writeFileSync(packagePath, JSON.stringify({ ...info, version: "0.2.0", releasePage: "https://github.com/example-org/cutex-desktop/releases" }));
    if (kind === "standalone") Object.defineProperty(process, "execPath", { value: join(root, "standalone", "cutex"), configurable: true });
    const updater = new Updater(() => {});
    expect(updater.state().current).toMatchObject({ version: "0.2.0", commit: commits.m1 });
    if (kind === "standalone") expect(updater.state()).toMatchObject({ state: "unsupported", code: "releasePackage" });
    expect((await settle(updater)).current?.version).toBe("0.2.0");
  });

  it("main channel (nothing recorded): offers the newest main, as before", async () => {
    install("main-install", { build: commits.m1! });
    const updater = new Updater(() => {});
    expect(updater.state()).toMatchObject({ state: "idle", channel: "main" });
    const s = await settle(updater);
    expect(s.state).toBe("available");
    expect(s.latest).toMatchObject({ commit: commits.m2, count: 1 });
    expect(s.latest?.offMain).toBeUndefined();
  });

  it("release channel: offers release commits only and ignores newer main commits", async () => {
    install("release-install", { build: commits.m1!, channelFile: "release\n" });
    const updater = new Updater(() => {});
    expect(updater.state().channel).toBe("release");
    const s = await settle(updater);
    expect(s.state).toBe("available");
    expect(s.latest).toMatchObject({ commit: commits.r2, count: 1 });
  });

  it("release channel with nothing new on release stays idle while main moves", async () => {
    install("release-current", { build: commits.r2!, packagedChannel: "release" });
    const updater = new Updater(() => {});
    expect(updater.state().channel).toBe("release");
    const s = await settle(updater);
    expect(s.state).toBe("idle");
    expect(s.latest).toBeNull();
  });

  it("a build not on the channel branch is offered the branch head (offMain)", async () => {
    install("release-from-main", { build: commits.m2!, channelFile: "release" });
    const s = await settle(new Updater(() => {}));
    expect(s.latest).toMatchObject({ commit: commits.r2, offMain: true, count: 0 });
  });

  it("the <base>/channel file wins over the packaged channel; junk falls back", async () => {
    install("file-wins", { build: commits.m1!, channelFile: "main", packagedChannel: "release", origin: null });
    expect(new Updater(() => {}).state().channel).toBe("main");
    install("junk-file", { build: commits.m1!, channelFile: "--upload-pack=x", packagedChannel: "release", origin: null });
    expect(new Updater(() => {}).state().channel).toBe("release");
  });

  it("the remote override fetches the channel branch from that remote", async () => {
    install("override", { build: commits.m1!, channelFile: "release", from: mainOnly, origin: join(root, "nowhere") });
    const s = await settle(new Updater(() => {}, pathToFileURL(upstream).href));
    expect(s.latest).toMatchObject({ commit: commits.r2 });
  });
});

describe("updater without a reachable source", () => {
  it("no source checkout on this machine: unsupported (noSource), never checks", async () => {
    install("no-src", { build: commits.m1!, origin: null });
    const emitted: UpdateStatus[] = [];
    const updater = new Updater((s) => emitted.push(s));
    expect(updater.state()).toMatchObject({ state: "unsupported", code: "noSource" });
    await updater.check();
    expect(emitted).toEqual([]);
  });

  it("a path remote that does not exist: quiet unsupported, not retried", async () => {
    install("gone-remote", { build: commits.m1!, channelFile: "release", origin: join(root, "missing-upstream") });
    const updater = new Updater(() => {});
    const s = await settle(updater);
    expect(s).toMatchObject({ state: "unsupported", code: "remoteUnreachable" });
    expect(s.retryable).toBeUndefined();
    expect(s.error).toBeUndefined();
  });
});

describe("switching channels (Settings → 更新与诊断)", () => {
  it("a channel whose branch is not published yet: quiet channelMissing, retryable, no error", async () => {
    const base = install("no-release-branch", { build: commits.m1!, from: mainOnly });
    const updater = new Updater(() => {});
    const s = await updater.setChannel("release");
    expect(readFileSync(join(base, "channel"), "utf8")).toBe("release\n");
    expect(s).toMatchObject({ state: "unsupported", code: "channelMissing", retryable: true, channel: "release", latest: null });
    expect(s.error).toBeUndefined();
    // Back to 开发版: the usual offer again.
    const back = await updater.setChannel("main");
    expect(back).toMatchObject({ state: "available", channel: "main", latest: { commit: commits.m2 } });
    expect(readFileSync(join(base, "channel"), "utf8")).toBe("main\n");
  });

  it("switching to an older channel offers its head behind the button, never by itself", async () => {
    install("to-older", { build: commits.m2!, from: olderRelease });
    const updater = new Updater(() => {});
    expect((await settle(updater)).state).toBe("idle");
    const s = await updater.setChannel("release");
    expect(s).toMatchObject({ state: "available", channel: "release", latest: { commit: commits.m1, switchChannel: true, count: 0 } });
  });

  it("does not offer an older release to a build already on the release channel", async () => {
    install("release-build-newer", { build: commits.m2!, from: olderRelease, packagedChannel: "release" });
    expect((await settle(new Updater(() => {}))).latest).toBeNull();
  });

  it("refuses unknown channels", async () => {
    install("unknown-channel", { build: commits.m1! });
    await expect(new Updater(() => {}).setChannel("--upload-pack=x")).rejects.toThrow();
  });

  it("per-channel remotes: release from another remote, dev from origin; the source is shown", async () => {
    install("per-channel", { build: commits.m1!, from: mainOnly });
    const updater = new Updater(() => {}, (channel) => (channel === "release" ? upstream : null));
    const dev = await settle(updater);
    expect(dev).toMatchObject({ state: "available", source: mainOnly, latest: { commit: commits.m2 } });
    const rel = await updater.setChannel("release");
    expect(rel).toMatchObject({ state: "available", source: upstream, latest: { commit: commits.r2, count: 1 } });
  });

  it("apply after a switch puts the source checkout on the channel branch (build then fails here: no corepack)", async () => {
    const base = install("apply-switch", { build: commits.m2!, from: olderRelease, onMain: true });
    const src = join(base, "src");
    const updater = new Updater(() => {});
    await updater.setChannel("release");
    const path = process.env.PATH;
    process.env.PATH = gitOnlyPath();
    try {
      const s = await updater.apply();
      expect(s).toMatchObject({ state: "error", step: "install" });
    } finally {
      process.env.PATH = path;
    }
    expect(git(src, "symbolic-ref", "--short", "HEAD")).toBe("release");
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.m1);
  });

  it("macOS layout: <base>/releases/<hash>/Cutex.app is a portable install", async () => {
    install("mac", { build: commits.m1!, mac: true });
    const updater = new Updater(() => {});
    expect(updater.state()).toMatchObject({ state: "idle", channel: "main", canSwitchChannel: true });
    expect((await settle(updater)).latest).toMatchObject({ commit: commits.m2 });
  });
});
