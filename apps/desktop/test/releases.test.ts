import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_MIN_AGE_MS,
  archiveName,
  archiveOldReleases,
  formatBytes,
  isDirectChild,
  launcherReleaseDir,
  MAC_ARCHIVED_BUNDLE,
  MOVED_AT_FILE,
  NO_INDEX_MARKER,
  nodeReleaseOps,
  oldReleasesToDelete,
  parseMovedAt,
  releasesToArchive,
  safeChildName,
  staleLauncherTemps,
  syncMacLauncher,
  type DirEntryInfo,
  type LauncherOps,
} from "../src/shared/releases";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const HOUR = 3_600_000;
const dir = (name: string, ageMs = 48 * HOUR): DirEntryInfo => ({ name, kind: "dir", mtimeMs: NOW - ageMs });

describe("path guards", () => {
  it("accepts plain names only", () => {
    expect(safeChildName("4eec8be")).toBe(true);
    expect(safeChildName("4eec8be-2.noindex")).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "a\0b"]) expect(safeChildName(bad)).toBe(false);
  });

  it("isDirectChild: one level below, case-insensitive on Windows", () => {
    expect(isDirectChild("/b/releases", "/b/releases/abc", false)).toBe(true);
    expect(isDirectChild("/b/releases", "/b/releases/abc/def", false)).toBe(false);
    expect(isDirectChild("/b/releases", "/b/releases", false)).toBe(false);
    expect(isDirectChild("/b/releases", "/b/other/abc", false)).toBe(false);
    expect(isDirectChild("/b/releases", "/b/releasesX/abc", false)).toBe(false);
    expect(isDirectChild("C:\\B\\releases", "c:\\b\\Releases\\abc", true)).toBe(true);
    expect(isDirectChild("C:\\B\\releases", "c:\\b\\Releases\\abc", false)).toBe(false);
  });
});

describe("releasesToArchive", () => {
  it("keeps current, running and the named previous; moves the rest", () => {
    const entries = [dir("a"), dir("b"), dir("c"), dir("d"), dir("e")];
    expect(releasesToArchive(entries, { current: "e", running: "c", previous: "a" }, NOW, false)).toEqual({ archive: ["b", "d"], keep: ["a", "c", "e"] });
  });

  it("without a named previous keeps the newest other release", () => {
    const entries = [dir("a", 90 * HOUR), dir("b", 30 * HOUR), dir("c", 60 * HOUR), dir("cur", 2 * HOUR)];
    expect(releasesToArchive(entries, { current: "cur", running: "cur" }, NOW, false).archive).toEqual(["a", "c"]);
    // A previous that no longer exists falls back the same way.
    expect(releasesToArchive(entries, { current: "cur", running: null, previous: "gone" }, NOW, false).archive).toEqual(["a", "c"]);
  });

  it("never touches links, files, dot entries or young dirs", () => {
    const entries: DirEntryInfo[] = [
      dir("cur"),
      dir("prev", 3 * HOUR),
      { name: "link", kind: "link", mtimeMs: 0 },
      { name: "file", kind: "file", mtimeMs: 0 },
      dir(".hidden"),
      dir("packaging", ARCHIVE_MIN_AGE_MS / 2),
      dir("old"),
    ];
    expect(releasesToArchive(entries, { current: "cur", running: null, previous: "prev" }, NOW, false).archive).toEqual(["old"]);
  });

  it("moves nothing when current is unknown or not among the releases", () => {
    const entries = [dir("a"), dir("b"), dir("c")];
    expect(releasesToArchive(entries, { current: null, running: null }, NOW, false).archive).toEqual([]);
    expect(releasesToArchive(entries, { current: "zzz", running: null }, NOW, false).archive).toEqual([]);
  });

  it("compares names case-insensitively on Windows", () => {
    const entries = [dir("ABC"), dir("def"), dir("old")];
    expect(releasesToArchive(entries, { current: "abc", running: "ABC", previous: "DEF" }, NOW, true).archive).toEqual(["old"]);
  });
});

describe("old-releases deletion plan", () => {
  it("deletes what was moved more than 30 days ago, and interrupted deletes", () => {
    const day = 86_400_000;
    const entries = [
      { ...dir("fresh"), movedAtMs: NOW - 2 * day },
      { ...dir("expired"), movedAtMs: NOW - 31 * day },
      { ...dir("no-record", 40 * day), movedAtMs: null },
      { ...dir("x.deleting", 0), movedAtMs: NOW },
      { name: "link", kind: "link" as const, mtimeMs: 0, movedAtMs: null },
      { name: NO_INDEX_MARKER, kind: "file" as const, mtimeMs: 0, movedAtMs: null },
    ];
    expect(oldReleasesToDelete(entries, NOW)).toEqual(["expired", "no-record", "x.deleting"]);
    expect(oldReleasesToDelete(entries, NOW, { all: true })).toEqual(["fresh", "expired", "no-record", "x.deleting"]);
  });

  it("parses .moved-at and names collisions", () => {
    expect(parseMovedAt("2026-10-15T12:00:00.000Z\n")).toBe(NOW);
    expect(parseMovedAt("junk")).toBeNull();
    expect(parseMovedAt(null)).toBeNull();
    const taken = new Set(["a", "a-2"]);
    expect(archiveName("a", (n) => taken.has(n))).toBe("a-3");
    expect(archiveName("b", (n) => taken.has(n))).toBe("b");
  });

  it("formats sizes", () => {
    expect(formatBytes(44e9)).toBe("44 GB");
    expect(formatBytes(6.9e9)).toBe("6.9 GB");
    expect(formatBytes(350e6)).toBe("350 MB");
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("archiveOldReleases (real files)", () => {
  let root: string;
  let base: string;
  const style = { sep: "/" as const, win: false };
  const ops = () => nodeReleaseOps(fs, style);
  const release = (name: string, ageHours = 48, bundle = false) => {
    const d = join(base, "releases", name);
    mkdirSync(bundle ? join(d, "Cutex.app", "Contents") : d, { recursive: true });
    writeFileSync(join(d, "cutex"), "x");
    const t = (NOW - ageHours * HOUR) / 1000;
    utimesSync(d, t, t);
    return d;
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cutex-releases-test-"));
    base = join(root, "base");
    mkdirSync(join(base, "releases"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("moves all but current + previous, records the move, never follows links", () => {
    release("a", 100);
    release("b", 90);
    const prev = release("c", 80);
    const cur = release("d", 1);
    symlinkSync(cur, join(base, "current"));
    // A link inside releases/ to something outside must stay, and its target untouched.
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep"), "1");
    symlinkSync(outside, join(base, "releases", "evil"));
    const r = archiveOldReleases(base, ops(), { ...style, mac: false, running: cur, previous: prev, now: NOW });
    expect(r.reason).toBeUndefined();
    expect(r.moved.map((m) => m.name).sort()).toEqual(["a", "b"]);
    expect(readdirSync(join(base, "releases")).sort()).toEqual(["c", "d", "evil"]);
    expect(readdirSync(join(base, "old-releases")).sort()).toEqual(["a", "b"]);
    expect(parseMovedAt(readFileSync(join(base, "old-releases", "a", MOVED_AT_FILE), "utf8"))).toBe(NOW);
    expect(existsSync(join(outside, "keep"))).toBe(true);
    // Idempotent.
    expect(archiveOldReleases(base, ops(), { ...style, mac: false, running: cur, previous: prev, now: NOW }).moved).toEqual([]);
  });

  it("does nothing without current, or with current outside releases/", () => {
    release("a");
    release("b");
    release("c");
    expect(archiveOldReleases(base, ops(), { ...style, mac: false, running: null, now: NOW }).reason).toBe("no current link");
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(base, "current"));
    expect(archiveOldReleases(base, ops(), { ...style, mac: false, running: null, now: NOW }).reason).toMatch(/outside/);
    expect(readdirSync(join(base, "releases")).sort()).toEqual(["a", "b", "c"]);
  });

  it("refuses an old-releases that is a link out of the base", () => {
    release("a", 100);
    release("b", 90);
    const cur = release("c", 80);
    symlinkSync(cur, join(base, "current"));
    const trap = join(root, "trap");
    mkdirSync(trap);
    symlinkSync(trap, join(base, "old-releases"));
    const r = archiveOldReleases(base, ops(), { ...style, mac: false, running: null, now: NOW });
    expect(r.reason).toMatch(/not a directory inside/);
    expect(readdirSync(trap)).toEqual([]);
    expect(readdirSync(join(base, "releases")).sort()).toEqual(["a", "b", "c"]);
  });

  it("skips a release whose move fails (a locked dir on Windows) and goes on", () => {
    release("a", 100);
    release("b", 90);
    release("c", 85);
    const cur = release("d", 80);
    symlinkSync(cur, join(base, "current"));
    const real = ops();
    const flaky: LauncherOps = { ...real, rename: (from, to) => (from.endsWith("/a") ? (() => { throw new Error("EBUSY: resource busy or locked"); })() : real.rename(from, to)) };
    const r = archiveOldReleases(base, flaky, { ...style, mac: false, running: null, previous: "c", now: NOW });
    expect(r.moved.map((m) => m.name)).toEqual(["b"]);
    expect(r.skipped).toEqual([{ name: "a", error: "EBUSY: resource busy or locked" }]);
    expect(readdirSync(join(base, "releases")).sort()).toEqual(["a", "c", "d"]);
  });

  it("macOS: unregisters and renames the bundle, marks both dirs not-indexed", () => {
    release("a", 100, true);
    const prev = release("b", 90, true);
    const cur = release("c", 80, true);
    symlinkSync(cur, join(base, "current"));
    const unregistered: string[] = [];
    const r = archiveOldReleases(base, { ...ops(), unregisterApp: (b) => unregistered.push(b) }, { ...style, mac: true, running: null, previous: prev, now: NOW });
    expect(r.moved.map((m) => m.name)).toEqual(["a"]);
    expect(unregistered).toEqual([join(base, "releases", "a", "Cutex.app")]);
    expect(readdirSync(join(base, "old-releases", "a")).sort()).toEqual([MOVED_AT_FILE, MAC_ARCHIVED_BUNDLE, "cutex"].sort());
    expect(existsSync(join(base, "releases", NO_INDEX_MARKER))).toBe(true);
    expect(existsSync(join(base, "old-releases", NO_INDEX_MARKER))).toBe(true);
  });
});

describe("syncMacLauncher (real files, cp stands in for clonefile)", () => {
  let root: string;
  let base: string;
  let apps: string;
  const ops = (): LauncherOps => ({ ...nodeReleaseOps(fs, { sep: "/", win: false }), clone: (from, to) => cpSync(from, to, { recursive: true, verbatimSymlinks: true }) });
  const release = (name: string, recorded: string | null) => {
    const d = join(base, "releases", name);
    mkdirSync(join(d, "Cutex.app", "Contents", "Resources", "app"), { recursive: true });
    writeFileSync(join(d, "Cutex.app", "Contents", "Resources", "app", "package.json"), JSON.stringify({ name: "x", ...(recorded ? { releaseDir: recorded } : {}) }));
    return d;
  };
  const point = (target: string) => {
    rmSync(join(base, "current"), { force: true });
    symlinkSync(target, join(base, "current"));
  };
  const launcherRelease = () => launcherReleaseDir(readFileSync(join(apps, "Cutex.app", "Contents", "Resources", "app", "package.json"), "utf8"));
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cutex-launcher-test-"));
    base = join(root, "base");
    apps = join(root, "Applications");
    mkdirSync(join(base, "releases"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates, keeps, then refreshes the clone as current moves", () => {
    const a = release("a.noindex", join(base, "releases", "a.noindex"));
    point(a);
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" }).action).toBe("created");
    expect(launcherRelease()).toBe(a);
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" }).action).toBe("current");
    const b = release("b.noindex", join(base, "releases", "b.noindex"));
    point(b);
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "2" }).action).toBe("refreshed");
    expect(launcherRelease()).toBe(b);
    expect(readdirSync(apps)).toEqual(["Cutex.app"]);
  });

  it("leaves another install's Cutex.app alone", () => {
    point(release("a", join(base, "releases", "a")));
    mkdirSync(join(apps, "Cutex.app", "Contents"), { recursive: true });
    writeFileSync(join(apps, "Cutex.app", "Contents", "Info.plist"), "theirs");
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" }).action).toBe("foreign");
    expect(readFileSync(join(apps, "Cutex.app", "Contents", "Info.plist"), "utf8")).toBe("theirs");
    // A clone recorded for another base is foreign too.
    rmSync(join(apps, "Cutex.app"), { recursive: true });
    mkdirSync(join(apps, "Cutex.app", "Contents", "Resources", "app"), { recursive: true });
    writeFileSync(join(apps, "Cutex.app", "Contents", "Resources", "app", "package.json"), JSON.stringify({ releaseDir: "/elsewhere/releases/a" }));
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" }).action).toBe("foreign");
  });

  it("does not clone a release that recorded no releaseDir", () => {
    point(release("old", null));
    expect(syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" }).action).toBe("noReleaseDir");
    expect(existsSync(apps)).toBe(false);
  });

  it("restores the old launcher when the swap fails", () => {
    const a = release("a", join(base, "releases", "a"));
    point(a);
    syncMacLauncher(ops(), { launcherDir: apps, baseDir: base, tag: "1" });
    point(release("b", join(base, "releases", "b")));
    const real = ops();
    const failing: LauncherOps = { ...real, rename: (from, to) => (from.includes(".Cutex.app.new-") ? (() => { throw new Error("EPERM"); })() : real.rename(from, to)) };
    expect(syncMacLauncher(failing, { launcherDir: apps, baseDir: base, tag: "2" })).toMatchObject({ action: "failed", error: "EPERM" });
    expect(launcherRelease()).toBe(a);
    expect(readdirSync(apps)).toEqual(["Cutex.app"]);
  });

  it("finds leftover temporaries", () => {
    expect(staleLauncherTemps([".Cutex.app.new-12", ".Cutex.app.old-9", "Cutex.app", "Other.app", ".DS_Store"])).toEqual([".Cutex.app.new-12", ".Cutex.app.old-9"]);
  });
});

describe("ReleaseMaintenance (main process, real files)", () => {
  let root: string;
  let base: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cutex-maint-test-"));
    base = join(root, "base");
    mkdirSync(join(base, "releases"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const layoutFor = (release: string) => ({ baseDir: base, releaseDir: release, releasesDir: join(base, "releases"), currentLink: join(base, "current"), launcher: ["cutex"] });
  const old = (name: string, movedDaysAgo: number, bytes = 1000) => {
    const d = join(base, "old-releases", name);
    mkdirSync(join(d, "sub"), { recursive: true });
    writeFileSync(join(d, "sub", "blob"), Buffer.alloc(bytes));
    writeFileSync(join(d, MOVED_AT_FILE), new Date(Date.now() - movedDaysAgo * 86_400_000).toISOString());
  };

  it("deletes only releases moved more than 30 days ago, all on request, and measures the rest", async () => {
    const { ReleaseMaintenance } = await import("../src/main/releaseMaintenance");
    const cur = join(base, "releases", "cur");
    mkdirSync(cur);
    symlinkSync(cur, join(base, "current"));
    old("fresh", 2, 2000);
    old("expired", 31);
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep"), "1");
    symlinkSync(outside, join(base, "old-releases", "link"));
    const logs: string[] = [];
    const m = new ReleaseMaintenance(layoutFor(cur), (t) => logs.push(t));
    expect(await m.deleteOld(false)).toEqual({ deleted: ["expired"], failed: [] });
    expect(readdirSync(join(base, "old-releases")).sort()).toEqual(["fresh", "link"]);
    expect(await m.measure()).toEqual({ count: 1, bytes: 2000 + Buffer.byteLength(readFileSync(join(base, "old-releases", "fresh", MOVED_AT_FILE))) });
    expect(await m.deleteOld(true)).toEqual({ deleted: ["fresh"], failed: [] });
    expect(readdirSync(join(base, "old-releases"))).toEqual(["link"]);
    expect(existsSync(join(outside, "keep"))).toBe(true);
    expect(await m.measure()).toEqual({ count: 0, bytes: 0 });
  });
});
