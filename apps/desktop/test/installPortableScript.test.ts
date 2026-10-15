// scripts/install-portable.sh with fake node / corepack: the lockfile is restored only in the install's
// own clone <base>/src, and `current` is never pointed at a release without its launcher.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../../scripts/install-portable.sh");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

let root: string;
let bin: string;

function checkout(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(dir, "apps/desktop"), { recursive: true });
  writeFileSync(join(dir, "apps/desktop/.keep"), "");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, CUTEX_DESKTOP_PORTABLE_BASE: "", CUTEX_DEV_NODE_DIR: bin, ...env } });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-install-portable "));
  bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "node"),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v24.1.0; exit 0; fi\nif [ "$1" = "scripts/package-portable.mjs" ]; then mkdir -p "$2"; if [ -n "$FAKE_LAUNCHER" ]; then : > "$2/cutex"; chmod +x "$2/cutex"; fi; exit 0; fi\nexit 3\n',
  );
  writeFileSync(join(bin, "corepack"), '#!/bin/sh\nexit "${FAKE_COREPACK_EXIT:-0}"\n');
  chmodSync(join(bin, "node"), 0o755);
  chmodSync(join(bin, "corepack"), 0o755);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("install-portable.sh", () => {
  it("keeps a developer tree's edited lockfile (--source) and refuses", () => {
    const base = join(root, "base");
    const dev = join(root, "dev tree");
    checkout(dev);
    writeFileSync(join(dev, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# my edit\n");
    const r = run(["--base", base, "--source", dev]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("uncommitted changes");
    expect(readFileSync(join(dev, "pnpm-lock.yaml"), "utf8")).toContain("# my edit");
  });

  it("restores the lockfile in the install's own <base>/src", () => {
    const base = join(root, "base");
    const src = join(base, "src");
    checkout(src);
    writeFileSync(join(src, "pnpm-lock.yaml"), "rewritten\n");
    const r = run(["--base", base], { FAKE_COREPACK_EXIT: "7" });
    expect(r.stdout).toContain("restoring pnpm-lock.yaml");
    expect(r.status).toBe(7); // stopped at the (fake) install, after the restore
    expect(readFileSync(join(src, "pnpm-lock.yaml"), "utf8")).toBe("lockfileVersion: '9.0'\n");
  });

  it("does not switch current to a release without its launcher (base path with a space)", () => {
    const base = join(root, "John Smith", "cutex-desktop");
    checkout(join(base, "src"));
    const bad = run(["--base", base]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("has no");
    expect(existsSync(join(base, "current"))).toBe(false);
    const good = run(["--base", base], { FAKE_LAUNCHER: "1" });
    expect(good.status, good.stderr).toBe(0);
    expect(lstatSync(join(base, "current")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(base, "current", "cutex"))).toBe(true);
  });
});
