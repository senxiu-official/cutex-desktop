// Old-release housekeeping of a portable install (pure logic + orchestration over injected file
// operations; no Node / Electron imports). Used by the main process (src/main/releaseMaintenance.ts)
// and by scripts/archive-releases.mjs (install-portable.sh / .ps1), which imports this file directly
// through Node's type stripping — so keep it self-contained and erasable-syntax only (no enums, no
// parameter properties, no imports).
//
// Layout:
//   <base>/releases/<name>/        current's target + one previous release (the rollback target)
//   <base>/old-releases/<name>/    everything older, moved there (same-filesystem rename, never a
//                                  copy); `.moved-at` inside records when. Deleted automatically
//                                  OLD_RELEASE_MAX_AGE_DAYS after the move, or earlier from Settings
//                                  → 更新与诊断 / by hand. Nothing in releases/ is ever deleted.
//
// Guards: only real directories that are direct children of the (realpath of the) container are
// touched; links / junctions are never followed or moved; current's target and the running release
// are always kept; a release younger than ARCHIVE_MIN_AGE_MS is left alone (it may still be being
// packaged by an install script); a rename that fails (Windows: a file inside is open) is skipped and
// retried at the next start.
//
// macOS: a bundle in an archived release is unregistered from LaunchServices and renamed
// `Cutex.app` → `Cutex.app.old` so the Apps picker / Spotlight no longer list it; new release dirs are
// named `<hash>.noindex` (Spotlight skips `.noindex` folders) and the one visible app is the launcher
// `~/Applications/Cutex.app`, an APFS clone of current's bundle (syncMacLauncher).

export const RELEASES_DIR = "releases";
export const OLD_RELEASES_DIR = "old-releases";
/** Written into an archived release dir: ISO time of the move (the auto-delete clock). */
export const MOVED_AT_FILE = ".moved-at";
/** macOS Spotlight marker dropped into releases/ and old-releases/ (belt and braces next to `.noindex`). */
export const NO_INDEX_MARKER = ".metadata_never_index";
/** macOS: suffix of new release dir names (Spotlight does not index folders ending in `.noindex`). */
export const MAC_RELEASE_SUFFIX = ".noindex";
export const MAC_BUNDLE = "Cutex.app";
export const MAC_ARCHIVED_BUNDLE = "Cutex.app.old";
/** Suffix of an old release being deleted (renamed first: a locked dir on Windows fails the rename, not half the delete). */
export const DELETING_SUFFIX = ".deleting";
/** Releases younger than this stay in releases/ (an install script may still be writing one). */
export const ARCHIVE_MIN_AGE_MS = 15 * 60_000;
/** Archived releases are deleted automatically this many days after the move. */
export const OLD_RELEASE_MAX_AGE_DAYS = 30;

export interface DirEntryInfo {
  name: string;
  /** From lstat: a link / junction is "link", never "dir". */
  kind: "dir" | "link" | "file" | "other";
  mtimeMs: number;
}

export interface PathStyle {
  sep: "/" | "\\";
  /** Windows: paths compare case-insensitively. */
  win: boolean;
}

/** A plain directory entry name (no separators, not `.` / `..`, no NUL). */
export function safeChildName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[\\/\x00]/.test(name);
}

function norm(path: string, win: boolean): string {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return win ? p.toLowerCase() : p;
}

export function samePath(a: string, b: string, win: boolean): boolean {
  return norm(a, win) === norm(b, win);
}

/** Whether `child` is a direct child of `parent` (both already resolved), with a safe name. */
export function isDirectChild(parent: string, child: string, win: boolean): boolean {
  const c = norm(child, win);
  const at = c.lastIndexOf("/");
  if (at < 0) return false;
  return c.slice(0, at) === norm(parent, win) && safeChildName(child.replace(/\\/g, "/").replace(/\/+$/, "").slice(at + 1));
}

/** Last path segment. */
export function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}

export function joinPath(style: PathStyle, ...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join(style.sep);
}

/**
 * Which release dirs to move to old-releases/: every real directory except current's target, the
 * running release and the previous release (`previous` when it names an existing dir, else the newest
 * other one by mtime), and except dirs younger than ARCHIVE_MIN_AGE_MS. Without a current target
 * nothing moves.
 */
export function releasesToArchive(
  entries: DirEntryInfo[],
  keep: { current: string | null; running: string | null; previous?: string | null },
  now: number,
  win: boolean,
): { archive: string[]; keep: string[] } {
  const same = (a: string, b: string | null | undefined) => !!b && (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  const dirs = entries.filter((e) => e.kind === "dir" && safeChildName(e.name) && !e.name.startsWith("."));
  if (!keep.current || !dirs.some((e) => same(e.name, keep.current))) return { archive: [], keep: dirs.map((e) => e.name) };
  const kept = new Set<string>();
  for (const e of dirs) if (same(e.name, keep.current) || same(e.name, keep.running)) kept.add(e.name);
  const rest = dirs.filter((e) => !kept.has(e.name));
  const previous = rest.find((e) => same(e.name, keep.previous)) ?? [...rest].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (previous) kept.add(previous.name);
  for (const e of rest) if (now - e.mtimeMs < ARCHIVE_MIN_AGE_MS) kept.add(e.name);
  return { archive: dirs.filter((e) => !kept.has(e.name)).map((e) => e.name), keep: dirs.filter((e) => kept.has(e.name)).map((e) => e.name) };
}

/** Name for a release moved into old-releases/: its own, suffixed -2, -3 … when taken. */
export function archiveName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name;
  for (let i = 2; ; i++) if (!taken(`${name}-${i}`)) return `${name}-${i}`;
}

/** `.moved-at` content → epoch ms (null when unreadable). */
export function parseMovedAt(text: string | null): number | null {
  if (!text) return null;
  const ms = Date.parse(text.trim());
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Old releases due for deletion: real directories moved more than `maxAgeDays` ago (by `.moved-at`,
 * else the dir's mtime), plus leftovers of an interrupted delete (`*.deleting`). `all`: every real
 * directory (the 「删除旧版本」 button).
 */
export function oldReleasesToDelete(
  entries: (DirEntryInfo & { movedAtMs: number | null })[],
  now: number,
  opts: { all?: boolean; maxAgeDays?: number } = {},
): string[] {
  const maxAge = (opts.maxAgeDays ?? OLD_RELEASE_MAX_AGE_DAYS) * 86_400_000;
  return entries
    .filter((e) => e.kind === "dir" && safeChildName(e.name) && !e.name.startsWith("."))
    .filter((e) => opts.all || e.name.endsWith(DELETING_SUFFIX) || now - (e.movedAtMs ?? e.mtimeMs) > maxAge)
    .map((e) => e.name);
}

/** Synchronous file operations the orchestrators run (the main process and the install script pass Node's). */
export interface ReleaseFsOps {
  /** Entries of a directory from lstat (links are "link"); throws when it cannot be read. */
  list(dir: string): DirEntryInfo[];
  /** Resolved path, or null when it does not exist. */
  realpath(path: string): string | null;
  /** Whether something (a link included) exists at the path. */
  exists(path: string): boolean;
  mkdir(path: string): void;
  /** Same-filesystem rename; throws on failure (e.g. a locked file on Windows). */
  rename(from: string, to: string): void;
  writeFile(path: string, text: string): void;
  readFile(path: string): string | null;
  /** macOS: `lsregister -u <bundle>`, best effort. */
  unregisterApp?(bundle: string): void;
}

export interface ArchiveResult {
  oldReleasesDir: string;
  moved: { name: string; to: string }[];
  skipped: { name: string; error: string }[];
  /** Why nothing was looked at (no current link, current outside releases/ …). */
  reason?: string;
}

/**
 * Move every release except current's target, the running one and the previous one from
 * `<base>/releases` to `<base>/old-releases` (see the file header for the guards). `running` /
 * `previous` are release dir paths or names (null = unknown).
 */
export function archiveOldReleases(
  baseDir: string,
  ops: ReleaseFsOps,
  opts: PathStyle & { mac: boolean; running: string | null; previous?: string | null; now: number },
): ArchiveResult {
  const releasesDir = joinPath(opts, baseDir, RELEASES_DIR);
  const oldDir = joinPath(opts, baseDir, OLD_RELEASES_DIR);
  const result: ArchiveResult = { oldReleasesDir: oldDir, moved: [], skipped: [] };
  const realBase = ops.realpath(baseDir);
  const realReleases = ops.realpath(releasesDir);
  if (!realBase || !realReleases || !isDirectChild(realBase, realReleases, opts.win)) return { ...result, reason: `${releasesDir} is not a directory inside ${baseDir}` };
  const currentTarget = ops.realpath(joinPath(opts, baseDir, "current"));
  if (!currentTarget) return { ...result, reason: "no current link" };
  if (!isDirectChild(realReleases, currentTarget, opts.win)) return { ...result, reason: `current points outside ${releasesDir}` };
  const nameIn = (path: string | null | undefined): string | null => {
    if (!path) return null;
    if (safeChildName(path)) return path;
    const real = ops.realpath(path) ?? path;
    return isDirectChild(realReleases, real, opts.win) ? baseName(real) : null;
  };
  let entries: DirEntryInfo[];
  try {
    entries = ops.list(releasesDir);
  } catch (error) {
    return { ...result, reason: errorText(error) };
  }
  const plan = releasesToArchive(entries, { current: baseName(currentTarget), running: nameIn(opts.running), previous: nameIn(opts.previous) }, opts.now, opts.win);
  if (opts.mac) markNoIndex(ops, opts, releasesDir);
  if (plan.archive.length === 0) return result;
  try {
    if (!ops.exists(oldDir)) ops.mkdir(oldDir);
  } catch (error) {
    return { ...result, reason: `cannot create ${oldDir}: ${errorText(error)}` };
  }
  const realOld = ops.realpath(oldDir);
  if (!realOld || !isDirectChild(realBase, realOld, opts.win)) return { ...result, reason: `${oldDir} is not a directory inside ${baseDir}` };
  if (opts.mac) markNoIndex(ops, opts, oldDir);
  for (const name of plan.archive) {
    const from = joinPath(opts, releasesDir, name);
    const real = ops.realpath(from);
    // Never a link, never anything that resolves outside releases/ (or to current's target).
    if (!real || !isDirectChild(realReleases, real, opts.win) || samePath(real, currentTarget, opts.win)) {
      result.skipped.push({ name, error: "not a release directory inside releases/" });
      continue;
    }
    const target = archiveName(name, (n) => ops.exists(joinPath(opts, oldDir, n)));
    const to = joinPath(opts, oldDir, target);
    if (opts.mac && ops.unregisterApp && ops.exists(joinPath(opts, from, MAC_BUNDLE))) ops.unregisterApp(joinPath(opts, from, MAC_BUNDLE));
    try {
      ops.rename(from, to);
    } catch (error) {
      result.skipped.push({ name, error: errorText(error) });
      continue;
    }
    result.moved.push({ name, to });
    try {
      ops.writeFile(joinPath(opts, to, MOVED_AT_FILE), `${new Date(opts.now).toISOString()}\n`);
    } catch {
      // the dir's mtime (the move) stands in
    }
    // No longer an app: the Apps picker / Spotlight drop it.
    if (opts.mac && ops.exists(joinPath(opts, to, MAC_BUNDLE)) && !ops.exists(joinPath(opts, to, MAC_ARCHIVED_BUNDLE))) {
      try {
        ops.rename(joinPath(opts, to, MAC_BUNDLE), joinPath(opts, to, MAC_ARCHIVED_BUNDLE));
      } catch {
        // unregistered already; the next start does not retry this one (it is out of releases/)
      }
    }
  }
  return result;
}

function markNoIndex(ops: ReleaseFsOps, style: PathStyle, dir: string): void {
  const marker = joinPath(style, dir, NO_INDEX_MARKER);
  try {
    if (!ops.exists(marker)) ops.writeFile(marker, "");
  } catch {
    // best effort
  }
}

/** The release a macOS launcher bundle was cloned from, from its Contents/Resources/app/package.json. */
export function launcherReleaseDir(packageJson: string | null): string | null {
  if (!packageJson) return null;
  try {
    const v = JSON.parse(packageJson) as { releaseDir?: unknown };
    return typeof v.releaseDir === "string" && v.releaseDir ? v.releaseDir : null;
  } catch {
    return null;
  }
}

export interface LauncherOps extends ReleaseFsOps {
  /** Copy a bundle (macOS: `cp -cR`, an APFS clone that shares the blocks). */
  clone(from: string, to: string): void;
  /** Delete a directory tree (only ever the launcher's own temporary / replaced copies). */
  removeTree(path: string): void;
}

export type LauncherAction = "created" | "refreshed" | "current" | "foreign" | "noReleaseDir" | "failed";

/** Path of the app package.json inside a bundle. */
export function bundlePackageJson(style: PathStyle, bundle: string): string {
  return joinPath(style, bundle, "Contents", "Resources", "app", "package.json");
}

/**
 * macOS: keep `<launcherDir>/Cutex.app` an up-to-date clone of current's `Cutex.app`, so the Dock pin
 * and the Apps picker entry stay on one stable path across updates. A launcher that was not cloned from
 * this install (its package.json names no release under `<base>/releases` or `<base>/old-releases`) is
 * left alone ("foreign"). The swap: clone to `.Cutex.app.new-<tag>`, move the old launcher to
 * `.Cutex.app.old-<tag>`, move the clone in, delete the old one (restored when the swap fails).
 */
export function syncMacLauncher(
  ops: LauncherOps,
  opts: { launcherDir: string; baseDir: string; tag: string },
): { action: LauncherAction; launcher: string; error?: string } {
  const style: PathStyle = { sep: "/", win: false };
  const launcher = joinPath(style, opts.launcherDir, MAC_BUNDLE);
  const current = ops.realpath(joinPath(style, opts.baseDir, "current"));
  const realReleases = ops.realpath(joinPath(style, opts.baseDir, RELEASES_DIR));
  if (!current || !realReleases || !isDirectChild(realReleases, current, false)) return { action: "failed", launcher, error: "no current release" };
  const source = joinPath(style, current, MAC_BUNDLE);
  const sourceRelease = launcherReleaseDir(ops.readFile(bundlePackageJson(style, source)));
  // A release packaged before `releaseDir` was recorded cannot find its install from a clone.
  if (!sourceRelease) return { action: "noReleaseDir", launcher };
  if (ops.exists(launcher)) {
    const recorded = launcherReleaseDir(ops.readFile(bundlePackageJson(style, launcher)));
    if (!recorded) return { action: "foreign", launcher };
    const resolved = ops.realpath(recorded) ?? recorded;
    if (samePath(resolved, current, false)) return { action: "current", launcher };
    const realBase = ops.realpath(opts.baseDir) ?? opts.baseDir;
    const ours = [RELEASES_DIR, OLD_RELEASES_DIR].some((d) => isDirectChild(joinPath(style, realBase, d), resolved, false) || isDirectChild(joinPath(style, opts.baseDir, d), recorded, false));
    if (!ours) return { action: "foreign", launcher };
  }
  const tmp = joinPath(style, opts.launcherDir, `.${MAC_BUNDLE}.new-${opts.tag}`);
  const old = joinPath(style, opts.launcherDir, `.${MAC_BUNDLE}.old-${opts.tag}`);
  const existed = ops.exists(launcher);
  try {
    if (!ops.exists(opts.launcherDir)) ops.mkdir(opts.launcherDir);
    if (ops.exists(tmp)) ops.removeTree(tmp);
    ops.clone(source, tmp);
    if (existed) ops.rename(launcher, old);
    try {
      ops.rename(tmp, launcher);
    } catch (error) {
      if (existed) ops.rename(old, launcher);
      throw error;
    }
  } catch (error) {
    try {
      if (ops.exists(tmp)) ops.removeTree(tmp);
    } catch {
      // left for the next sync
    }
    return { action: "failed", launcher, error: errorText(error) };
  }
  if (existed) {
    try {
      ops.removeTree(old);
    } catch {
      // a stale `.Cutex.app.old-*` (not an app: the name does not end in .app) is removed by the next sync
    }
  }
  return { action: existed ? "refreshed" : "created", launcher };
}

/** Leftover launcher temporaries from an interrupted sync (`.Cutex.app.new-*` / `.Cutex.app.old-*`). */
export function staleLauncherTemps(names: string[]): string[] {
  return names.filter((n) => n.startsWith(`.${MAC_BUNDLE}.new-`) || n.startsWith(`.${MAC_BUNDLE}.old-`)).filter(safeChildName);
}

export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** The parts of node:fs the operations use (passed in: this file imports nothing). */
export interface NodeFsLike {
  lstatSync(path: string): { isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean; mtimeMs: number };
  readdirSync(path: string): string[];
  realpathSync(path: string): string;
  mkdirSync(path: string, opts?: { recursive?: boolean }): unknown;
  renameSync(from: string, to: string): void;
  writeFileSync(path: string, data: string): void;
  readFileSync(path: string, encoding: "utf8"): string;
  rmSync(path: string, opts: { recursive: boolean; force: boolean }): void;
}

/**
 * ReleaseFsOps / LauncherOps over node:fs. `run(command, args)` runs a program without a shell and
 * throws on a non-zero exit (macOS: lsregister, cp -c). Path separators: `style`.
 */
export function nodeReleaseOps(fs: NodeFsLike, style: PathStyle, run?: (command: string, args: string[]) => void): LauncherOps {
  const lstat = (path: string) => {
    try {
      return fs.lstatSync(path);
    } catch {
      return null;
    }
  };
  return {
    list(dir) {
      return fs.readdirSync(dir).map((name) => {
        const st = lstat(joinPath(style, dir, name));
        const kind = !st ? "other" : st.isSymbolicLink() ? "link" : st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
        return { name, kind, mtimeMs: st?.mtimeMs ?? 0 };
      });
    },
    realpath(path) {
      try {
        return fs.realpathSync(path);
      } catch {
        return null;
      }
    },
    exists: (path) => lstat(path) !== null,
    mkdir: (path) => void fs.mkdirSync(path, { recursive: true }),
    rename: (from, to) => fs.renameSync(from, to),
    writeFile: (path, text) => fs.writeFileSync(path, text),
    readFile(path) {
      try {
        return fs.readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    unregisterApp: run
      ? (bundle) => {
          try {
            run(LSREGISTER, ["-u", bundle]);
          } catch {
            // best effort: the rename to Cutex.app.old hides it anyway
          }
        }
      : undefined,
    clone(from, to) {
      if (!run) throw new Error("no command runner");
      run("/bin/cp", ["-cR", from, to]);
    },
    removeTree: (path) => fs.rmSync(path, { recursive: true, force: true }),
  };
}

/** Size as "1.2 GB" / "350 MB" (decimal units, like Finder / Explorer's "size on disk" ballpark). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
