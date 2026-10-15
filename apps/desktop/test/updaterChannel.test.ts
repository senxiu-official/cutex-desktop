// Updater against real git repositories: the channel branch decides what is offered, and an install
// whose update source is missing stays quietly "unsupported" (main/updater.ts, shared/update.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ appPath: "", userData: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getAppPath: () => env.appPath, getPath: () => env.userData, relaunch: () => {}, exit: () => {} },
}));

const { Updater } = await import("../src/main/updater");

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

let root: string;
let upstream: string;
/** main m1 → m2 only (no release branch yet). */
let mainOnly: string;
/** main o1 → o2, release at o1 (an older release head). */
let olderRelease: string;
const commits: Record<string, string> = {};
const realExecPath = process.execPath;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-updater-"));
  upstream = join(root, "upstream");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  const commit = (name: string) => {
    writeFileSync(join(upstream, "f.txt"), name);
    git(upstream, "add", "f.txt");
    git(upstream, "commit", "-q", "-m", name);
    commits[name] = git(upstream, "rev-parse", "HEAD");
  };
  commit("m1");
  git(upstream, "branch", "release");
  commit("m2"); // main moves on…
  git(upstream, "checkout", "-q", "release");
  commit("r2"); // …and release gets its own newer commit
  git(upstream, "checkout", "-q", "main");

  mainOnly = join(root, "main-only");
  git(root, "clone", "-q", "--bare", "--single-branch", "--branch", "main", upstream, mainOnly);

  olderRelease = join(root, "older-release");
  mkdirSync(olderRelease);
  git(olderRelease, "init", "-q", "-b", "main");
  for (const name of ["o1", "o2"]) {
    writeFileSync(join(olderRelease, "f.txt"), name);
    git(olderRelease, "add", "f.txt");
    git(olderRelease, "commit", "-q", "-m", name);
    commits[name] = git(olderRelease, "rev-parse", "HEAD");
    if (name === "o1") git(olderRelease, "branch", "release");
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
});

/** A portable install at <base> running a build of `build`, with <base>/src cloned from `origin`. */
function install(name: string, opts: { build: string; channelFile?: string; packagedChannel?: string; origin?: string | null; from?: string; mac?: boolean }) {
  const base = join(root, name);
  const rel = join(base, "releases", "abc1234");
  const appDir = join(rel, "resources", "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(rel, "cutex"), "");
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ commit: opts.build, committedAt: null, sourceDir: null, nodeDir: null, ...(opts.packagedChannel ? { channel: opts.packagedChannel } : {}) }));
  if (opts.channelFile !== undefined) writeFileSync(join(base, "channel"), opts.channelFile);
  if (opts.origin !== null) {
    git(root, "clone", "-q", opts.from ?? upstream, join(base, "src"));
    git(join(base, "src"), "checkout", "-q", "--detach", opts.build);
    if (opts.origin) git(join(base, "src"), "remote", "set-url", "origin", opts.origin);
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
  await updater.check();
  // unreachable() words the state after an async `git remote get-url`.
  await new Promise((r) => setTimeout(r, 300));
  return updater.state();
}

describe("updater channels", () => {
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
    install("file-wins", { build: commits.m1!, channelFile: "main", packagedChannel: "release" });
    expect(new Updater(() => {}).state().channel).toBe("main");
    install("junk-file", { build: commits.m1!, channelFile: "--upload-pack=x", packagedChannel: "release" });
    expect(new Updater(() => {}).state().channel).toBe("release");
  });

  it("the remote override fetches the channel branch from that remote", async () => {
    install("override", { build: commits.m1!, channelFile: "release", origin: join(root, "nowhere") });
    const s = await settle(new Updater(() => {}, upstream));
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
    install("to-older", { build: commits.o2!, from: olderRelease });
    const updater = new Updater(() => {});
    expect((await settle(updater)).state).toBe("idle");
    const s = await updater.setChannel("release");
    expect(s).toMatchObject({ state: "available", channel: "release", latest: { commit: commits.o1, switchChannel: true, count: 0 } });
    // A build made for release (packaged with --channel release) that is newer than release: no offer.
    install("release-build-newer", { build: commits.o2!, from: olderRelease, packagedChannel: "release" });
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
    const base = install("apply-switch", { build: commits.o2!, from: olderRelease });
    const src = join(base, "src");
    git(src, "checkout", "-q", "main");
    const updater = new Updater(() => {});
    await updater.setChannel("release");
    const path = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      const s = await updater.apply();
      expect(s).toMatchObject({ state: "error", step: "install" });
    } finally {
      process.env.PATH = path;
    }
    expect(git(src, "symbolic-ref", "--short", "HEAD")).toBe("release");
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.o1);
  });

  it("macOS layout: <base>/releases/<hash>/Cutex.app is a portable install", async () => {
    install("mac", { build: commits.m1!, mac: true });
    const updater = new Updater(() => {});
    expect(updater.state()).toMatchObject({ state: "idle", channel: "main", canSwitchChannel: true });
    expect((await settle(updater)).latest).toMatchObject({ commit: commits.m2 });
  });
});
