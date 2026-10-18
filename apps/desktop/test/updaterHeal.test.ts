// Updater against real git repositories: a pull cut short half-way (2026-10-18: disk full during
// `git merge --ff-only`) is discarded and retried by the next update, but only when every leftover path
// belongs to the incoming commit (main/updater.ts healInterruptedPull, shared/update.ts interruptedPullHeal).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const commits: Record<string, string> = {};
const realExecPath = process.execPath;
// chmod-based write failures need a POSIX file system and a non-root user.
const canFailWrites = process.platform !== "win32" && process.getuid?.() !== 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-updater-heal-"));
  upstream = join(root, "upstream");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  writeFileSync(join(upstream, "a.txt"), "a1\n");
  writeFileSync(join(upstream, "b.txt"), "b1\n");
  writeFileSync(join(upstream, "keep.txt"), "keep\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "h1");
  commits.h1 = git(upstream, "rev-parse", "HEAD");
  // h2: changes a.txt, deletes b.txt, adds dir/new.txt (written after a.txt: index order).
  writeFileSync(join(upstream, "a.txt"), "a2\n");
  rmSync(join(upstream, "b.txt"));
  mkdirSync(join(upstream, "dir"));
  writeFileSync(join(upstream, "dir", "new.txt"), "new\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "h2");
  commits.h2 = git(upstream, "rev-parse", "HEAD");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
});

/** A portable install at <base> running h1, its own clone <base>/src on main at h1. */
function install(name: string) {
  const base = join(root, name);
  const rel = join(base, "releases", "abc1234");
  const appDir = join(rel, "resources", "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(rel, "cutex"), "");
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ commit: commits.h1, committedAt: null, sourceDir: null, nodeDir: null }));
  const src = join(base, "src");
  git(root, "clone", "-q", upstream, src);
  git(src, "checkout", "-q", "-B", "main", commits.h1!);
  const userData = join(base, "userData");
  mkdirSync(userData, { recursive: true });
  env.appPath = appDir;
  env.userData = userData;
  Object.defineProperty(process, "execPath", { value: join(rel, "cutex"), configurable: true });
  return { base, src, marker: join(base, ".update-pull.json"), log: () => (existsSync(join(userData, "update.log")) ? readFileSync(join(userData, "update.log"), "utf8") : "") };
}

/** apply() with no corepack on PATH: a pull that goes through then fails at the install step. */
async function applyNoBuild(updater: InstanceType<typeof Updater>): Promise<UpdateStatus> {
  const path = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  try {
    return await updater.apply();
  } finally {
    process.env.PATH = path;
  }
}

/** First update: git cannot create dir/ entries, so the merge stops after rewriting a.txt / deleting b.txt. */
async function interruptedPull(src: string): Promise<UpdateStatus> {
  mkdirSync(join(src, "dir"));
  chmodSync(join(src, "dir"), 0o555);
  try {
    return await applyNoBuild(new Updater(() => {}));
  } finally {
    chmodSync(join(src, "dir"), 0o755);
  }
}

describe.skipIf(!canFailWrites)("interrupted pull", () => {
  it("a successful pull removes its marker", async () => {
    const { src, marker } = install("clean-pull");
    const s = await applyNoBuild(new Updater(() => {}));
    expect(s).toMatchObject({ state: "error", step: "install" });
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h2);
    expect(existsSync(marker)).toBe(false);
  });

  it("a half-written pull is discarded and retried by the next update", async () => {
    const { src, marker, log } = install("heal");
    const first = await interruptedPull(src);
    expect(first).toMatchObject({ state: "error", step: "pull" });
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h1);
    expect(git(src, "status", "--porcelain")).not.toBe(""); // the incoming commit's files, half-way
    expect(JSON.parse(readFileSync(marker, "utf8"))).toMatchObject({ from: commits.h1, to: commits.h2, untracked: [] });
    // The partly written new file is left behind too.
    writeFileSync(join(src, "dir", "new.txt"), "ne");

    const s = await applyNoBuild(new Updater(() => {}));
    expect(s).toMatchObject({ state: "error", step: "install" });
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h2);
    expect(git(src, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(src, "dir", "new.txt"), "utf8")).toBe("new\n");
    expect(existsSync(marker)).toBe(false);
    expect(log()).toMatch(/recovering the interrupted pull/);
  });

  it("refuses when a file the incoming commit does not touch is dirty", async () => {
    const { src, marker, log } = install("foreign-dirty");
    await interruptedPull(src);
    writeFileSync(join(src, "keep.txt"), "owner edit\n");
    const s = await applyNoBuild(new Updater(() => {}));
    expect(s).toMatchObject({ state: "error", step: "pull" });
    expect(s.error).toMatch(/uncommitted changes .*keep\.txt/);
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h1);
    expect(readFileSync(join(src, "keep.txt"), "utf8")).toBe("owner edit\n");
    expect(readFileSync(join(src, "a.txt"), "utf8")).toBe("a2\n"); // nothing was reset
    expect(existsSync(marker)).toBe(true);
    expect(log()).toMatch(/not part of the interrupted update: keep\.txt/);
  });

  it("refuses without a marker (changes nobody can attribute to an update)", async () => {
    const { src, marker } = install("no-marker");
    await interruptedPull(src);
    rmSync(marker);
    const s = await applyNoBuild(new Updater(() => {}));
    expect(s).toMatchObject({ state: "error", step: "pull" });
    expect(s.error).toMatch(/uncommitted changes/);
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h1);
    expect(readFileSync(join(src, "a.txt"), "utf8")).toBe("a2\n");
  });

  it("never removes an untracked file that was there before the pull", async () => {
    const { src, marker } = install("own-untracked");
    mkdirSync(join(src, "dir"));
    writeFileSync(join(src, "dir", "new.txt"), "mine\n"); // blocks the merge (would be overwritten)
    expect((await applyNoBuild(new Updater(() => {}))).step).toBe("pull");
    expect(JSON.parse(readFileSync(marker, "utf8")).untracked).toEqual(["dir/new.txt"]);
    expect((await applyNoBuild(new Updater(() => {}))).step).toBe("pull");
    expect(readFileSync(join(src, "dir", "new.txt"), "utf8")).toBe("mine\n");
    expect(git(src, "rev-parse", "HEAD")).toBe(commits.h1);
  });
});
