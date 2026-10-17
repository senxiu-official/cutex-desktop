// Which parts of the 文件 tree to reload after a change (pure; lib/workspaceView.ts wires the sources).
// Sources: cutex's workspace watch (`fs/watch` batches: root-relative paths, or `overflow`), the
// agent's own edits as its turn reports them (`fileChange` items: absolute paths; this also covers a
// host whose watcher cannot see the change, e.g. a network filesystem), the end of an agent turn
// (shell commands may have written anything) and a watch that reconnected (the gap is unknown).
// Only directories the tree shows refetch: each open folder asks for its own path's version.

/** A set of changed workspace directories, or everything. */
export type DirChange = { all: true } | { all: false; dirs: ReadonlySet<string> };

export const ALL_DIRS: DirChange = { all: true };

/** Parent directory of a root-relative path ("" = the root). */
export function parentDir(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/**
 * Directories whose listing a change of these root-relative paths can alter: each path's parent (an
 * entry appeared, went or changed size) and the path itself (when it is a folder, e.g. renamed or
 * removed as a whole). Folders the tree does not show cost nothing.
 */
export function dirsForPaths(paths: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!path) {
      dirs.add("");
      continue;
    }
    dirs.add(path);
    dirs.add(parentDir(path));
  }
  return dirs;
}

const VERBATIM = /^\\\\\?\\/;
const DRIVE = /^[a-zA-Z]:\//;

/**
 * `path` relative to `root` ("/"-separated; "" = the root itself), or null when it lies outside.
 * Absolute POSIX and Windows paths (`\` or `/`, the `\\?\` prefix dropped; Windows compares
 * case-insensitively); a relative path is taken as already root-relative.
 */
export function relativeToRoot(root: string | null, path: string): string | null {
  const norm = (p: string) => p.replace(VERBATIM, "").replace(/\\/g, "/").replace(/\/+$/, "");
  const target = norm(path);
  const absolute = target.startsWith("/") || DRIVE.test(`${target}/`);
  if (!absolute) return target.split("/").some((seg) => seg === "..") ? null : target.replace(/^(\.\/)+/, "");
  if (!root) return null;
  const base = norm(root);
  const fold = DRIVE.test(`${base}/`) ? (x: string) => x.toLowerCase() : (x: string) => x;
  if (fold(target) === fold(base)) return "";
  if (!fold(target).startsWith(`${fold(base)}/`)) return null;
  const rel = target.slice(base.length + 1);
  return rel.split("/").some((seg) => seg === "..") ? null : rel;
}

interface FileChangeItem {
  type?: unknown;
  changes?: { path?: unknown; kind?: { type?: unknown; move_path?: unknown } | null }[] | null;
}

/** Paths a native `fileChange` item touched (both ends of a move); empty for anything else. */
export function fileChangePaths(item: unknown): string[] {
  const change = item as FileChangeItem | null;
  if (!change || change.type !== "fileChange" || !Array.isArray(change.changes)) return [];
  const out: string[] = [];
  for (const c of change.changes) {
    if (typeof c?.path === "string" && c.path) out.push(c.path);
    const moved = c?.kind?.move_path;
    if (typeof moved === "string" && moved) out.push(moved);
  }
  return out;
}

/**
 * Item kinds that cannot change files other than through their own reported paths (a `fileChange`
 * names its paths). Everything else — commands, MCP / dynamic tool calls, subagents, kinds this
 * desktop does not know — may have written anything.
 */
const NON_WRITING_ITEMS = new Set(["userMessage", "agentMessage", "reasoning", "plan", "fileChange", "webSearch", "imageView", "contextCompaction", "enteredReviewMode", "exitedReviewMode", "sleep"]);

/** Whether a completed native item may have changed files the tree shows without naming them. */
export function itemMayWrite(item: unknown): boolean {
  const type = (item as { type?: unknown } | null)?.type;
  return typeof type !== "string" || !NON_WRITING_ITEMS.has(type);
}

/**
 * The tree's reload directory for absolute (or relative) paths under `root`: their directories, or
 * everything when one lies outside the known root (a symlinked / differently spelled root: better a
 * full reload than a stale tree).
 */
export function changeForPaths(root: string | null, paths: readonly string[]): DirChange | null {
  if (!paths.length) return null;
  const rel: string[] = [];
  for (const path of paths) {
    const r = relativeToRoot(root, path);
    if (r === null) return ALL_DIRS;
    rel.push(r);
  }
  return { all: false, dirs: dirsForPaths(rel) };
}

/**
 * Per-directory versions for the open folders of one workspace (`useSyncExternalStore` source).
 * `version(dir)` changes whenever `dir` or everything was invalidated.
 */
export class DirVersions {
  private allGen = 0;
  private readonly gens = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  version(dir: string): number {
    return this.allGen + (this.gens.get(dir) ?? 0);
  }

  invalidate(change: DirChange): void {
    if (change.all) {
      this.allGen++;
      // Per-dir counters only need to differ from before; dropping them keeps the map small.
      this.allGen += [...this.gens.values()].reduce((a, b) => a + b, 0);
      this.gens.clear();
    } else {
      if (!change.dirs.size) return;
      for (const dir of change.dirs) this.gens.set(dir, (this.gens.get(dir) ?? 0) + 1);
    }
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Merge two pending changes. */
export function mergeChanges(a: DirChange | null, b: DirChange | null): DirChange | null {
  if (!a) return b;
  if (!b) return a;
  if (a.all || b.all) return ALL_DIRS;
  return { all: false, dirs: new Set([...a.dirs, ...b.dirs]) };
}

/**
 * Coalesces changes arriving close together (a patch of ten files, a watch batch right after the
 * turn's own item) into one reload `delayMs` after the first.
 */
export class ChangeBatcher {
  private pending: DirChange | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (change: DirChange) => void,
    private readonly delayMs = 150,
  ) {}

  add(change: DirChange | null): void {
    if (!change) return;
    this.pending = mergeChanges(this.pending, change);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const change = this.pending;
      this.pending = null;
      if (change) this.flush(change);
    }, this.delayMs);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

/** Same listing (names, kinds, sizes, times): a reload that found nothing new keeps the old array. */
export function sameEntries<T extends { path: string; kind: string; size: number | null; modifiedAt: string; ignored: boolean; targetKind: string | null }>(a: readonly T[] | null, b: readonly T[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (!y) return false;
    return x.path === y.path && x.kind === y.kind && x.size === y.size && x.modifiedAt === y.modifiedAt && x.ignored === y.ignored && x.targetKind === y.targetKind;
  });
}
