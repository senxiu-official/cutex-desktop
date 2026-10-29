// The 文件 explorer's pure parts (docs/design/019-file-explorer.md; tested in test/fileExplorer.test.ts):
// rows of the tree from the folder listings cutex gave (sorting, merged single-folder chains, hidden /
// ignored / changes-only, the filter), git marks, history (back / forward), reveal, type-ahead and the
// gallery default. No React, no daemon calls: Explorer.tsx feeds listings in and renders rows out.
import type { FsEntry, GitFileStatus, GitStatus } from "../../../../../shared/ipc";
import { isThumbnailPath } from "../../../lib/fileKinds";

/** At most this many children of one folder are drawn (cutex returns whole folders; 019 §9, API gap A1). */
export const MAX_CHILDREN = 2000;

export type SortKey = "name" | "mtime" | "size" | "kind";
export type IgnoredMode = "dim" | "hide";
export type FolderView = "list" | "gallery";

/** Options shared by every root (019 §4). */
export interface ExplorerOptions {
  follow: boolean;
  compact: boolean;
  sort: SortKey;
  desc: boolean;
  foldersFirst: boolean;
  ignored: IgnoredMode;
  changesOnly: boolean;
  /** Gallery tile size: 0 small, 1 medium, 2 large. */
  thumb: 0 | 1 | 2;
  /** The built-in preview (▥ / Space). */
  preview: boolean;
  /** Tree share of the pane (0.2–0.8) when the preview is beside / below. */
  split: number;
}

export const DEFAULT_OPTIONS: ExplorerOptions = {
  follow: true,
  compact: true,
  sort: "name",
  desc: false,
  foldersFirst: true,
  ignored: "dim",
  changesOnly: false,
  thumb: 1,
  preview: true,
  split: 0.5,
};

/** What is remembered per host + root (019 §2, rule 2). */
export interface RootView {
  /** The current folder ("" = the root). */
  loc: string;
  expanded: string[];
  sel: string | null;
  /** Show names starting with "." (owner decision 3: off by default, per host + root). */
  hidden: boolean;
  /** Folders whose list / gallery view the owner chose. */
  views: Record<string, FolderView>;
  at: number;
}

export const EMPTY_VIEW: RootView = { loc: "", expanded: [], sel: null, hidden: false, views: {}, at: 0 };

export const MAX_EXPANDED = 300;
export const MAX_VIEWS = 500;
export const MAX_ROOTS = 60;

// ---------- stored state ----------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const relPath = (v: unknown): v is string => typeof v === "string" && v.length <= 4000 && !v.startsWith("/") && !v.split("/").includes("..");

export function parseOptions(raw: unknown): ExplorerOptions {
  const v = isRecord(raw) ? raw : {};
  const d = DEFAULT_OPTIONS;
  const bool = (k: keyof ExplorerOptions) => (typeof v[k] === "boolean" ? (v[k] as boolean) : (d[k] as boolean));
  return {
    follow: bool("follow"),
    compact: bool("compact"),
    sort: v.sort === "mtime" || v.sort === "size" || v.sort === "kind" ? v.sort : "name",
    desc: bool("desc"),
    foldersFirst: bool("foldersFirst"),
    ignored: v.ignored === "hide" ? "hide" : "dim",
    changesOnly: bool("changesOnly"),
    thumb: v.thumb === 0 || v.thumb === 2 ? v.thumb : 1,
    preview: bool("preview"),
    split: typeof v.split === "number" && Number.isFinite(v.split) ? clampSplit(v.split) : d.split,
  };
}

export const clampSplit = (n: number): number => Math.max(0.2, Math.min(0.8, n));

export function parseRootView(raw: unknown): RootView {
  if (!isRecord(raw)) return { ...EMPTY_VIEW };
  const expanded = Array.isArray(raw.expanded) ? raw.expanded.filter(relPath).slice(-MAX_EXPANDED) : [];
  const views: Record<string, FolderView> = {};
  if (isRecord(raw.views)) for (const [k, v] of Object.entries(raw.views)) if (relPath(k) && (v === "list" || v === "gallery")) views[k] = v;
  return {
    loc: relPath(raw.loc) ? raw.loc : "",
    expanded: [...new Set(expanded)],
    sel: relPath(raw.sel) ? raw.sel : null,
    hidden: raw.hidden === true,
    views: trimViews(views),
    at: typeof raw.at === "number" ? raw.at : 0,
  };
}

function trimViews(views: Record<string, FolderView>): Record<string, FolderView> {
  const keys = Object.keys(views);
  if (keys.length <= MAX_VIEWS) return views;
  const out: Record<string, FolderView> = {};
  for (const k of keys.slice(-MAX_VIEWS)) out[k] = views[k]!;
  return out;
}

/** Add / remove an expanded folder (the newest last; capped, the oldest go). */
export function withExpanded(list: readonly string[], path: string, open: boolean): string[] {
  const rest = list.filter((p) => p !== path);
  return open ? [...rest, path].slice(-MAX_EXPANDED) : rest;
}

/** Keep the newest MAX_ROOTS root records. */
export function trimRoots(roots: Record<string, RootView>): Record<string, RootView> {
  const keys = Object.keys(roots);
  if (keys.length <= MAX_ROOTS) return roots;
  const keep = keys.sort((a, b) => roots[b]!.at - roots[a]!.at).slice(0, MAX_ROOTS);
  return Object.fromEntries(keep.map((k) => [k, roots[k]!]));
}

// ---------- paths ----------

export const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
/** `path` is `dir` or inside it ("" contains everything). */
export const within = (path: string, dir: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);
/** Folders from just below `from` down to `path`'s parent (what must open to show `path`). */
export function foldersBetween(from: string, path: string): string[] {
  if (!within(path, from) || path === from) return [];
  const rest = (from ? path.slice(from.length + 1) : path).split("/");
  rest.pop();
  const out: string[] = [];
  let p = from;
  for (const seg of rest) {
    p = p ? `${p}/${seg}` : seg;
    out.push(p);
  }
  return out;
}
/** Breadcrumb segments of a folder: [{ name, path }], the root not included. */
export function segmentsOf(loc: string): { name: string; path: string }[] {
  if (!loc) return [];
  const parts = loc.split("/");
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}

/**
 * `abs` relative to `root` ("" = the root itself; forward slashes); null when outside it. Windows roots
 * compare without case (as lib/workspace resolveFileHref).
 */
export function relativeTo(abs: string, root: string): string | null {
  const win = /^[a-zA-Z]:/.test(root) || root.includes("\\");
  const norm = (p: string) => {
    const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return win ? s.toLowerCase() : s;
  };
  const a = abs.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const an = win ? a.toLowerCase() : a;
  if (an === r) return "";
  if (!an.startsWith(`${r}/`)) return null;
  return a.slice(r.length + 1);
}
/** `rel` under `root`, in the root's own separator style. */
export function absoluteOf(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  if (!rel) return base || sep;
  return `${base}${sep}${sep === "\\" ? rel.replace(/\//g, "\\") : rel}`;
}

// ---------- git ----------

export type GitMark = "M" | "A" | "U" | "D" | "R" | "C" | "T" | "!";
const MARK: Record<GitFileStatus["status"], GitMark> = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", typechange: "T", conflicted: "!", untracked: "U" };

export interface GitMarks {
  files: ReadonlyMap<string, GitMark>;
  /** Folders with a change somewhere inside ("" = the root). */
  dirty: ReadonlySet<string>;
}
export const NO_MARKS: GitMarks = { files: new Map(), dirty: new Set() };

/** `prefix`: the shown root inside the git status's root ("" = same root); paths outside it are skipped. */
export function gitMarks(git: GitStatus | null, prefix = ""): GitMarks {
  if (!git?.isRepo || !git.files.length) return NO_MARKS;
  const files = new Map<string, GitMark>();
  const dirty = new Set<string>();
  for (const f of git.files) {
    if (!within(f.path, prefix) || f.path === prefix) continue;
    const rel = prefix ? f.path.slice(prefix.length + 1) : f.path;
    const mark = MARK[f.status];
    // Unstaged wins over staged for the letter (it is what the tree shows now); conflicts win over all.
    if (!files.has(rel) || mark === "!" || !f.staged) files.set(rel, mark);
    let p = parentOf(rel);
    for (;;) {
      dirty.add(p);
      if (!p) break;
      p = parentOf(p);
    }
  }
  return { files, dirty };
}

// ---------- rows ----------

export interface Listing {
  entries: FsEntry[] | null;
  error: string | null;
}
export type Listings = ReadonlyMap<string, Listing>;

export const isDirEntry = (e: FsEntry): boolean => e.kind === "dir" || e.targetKind === "dir";

export interface EntryRow {
  type: "entry";
  /** The row's path: the last folder of a merged chain. */
  path: string;
  entry: FsEntry;
  /** Merged single-folder chain (`a/b/c` on one row); one element when not merged. */
  chain: FsEntry[];
  depth: number;
  dir: boolean;
  open: boolean;
  git: GitMark | null;
  /** A folder with changes inside (shown while it is closed). */
  dirty: boolean;
  /** Shown only because a reveal asked for it (hidden / ignored / filtered). */
  forced: boolean;
}
export interface NoteRow {
  type: "loading" | "error" | "more" | "empty";
  path: string;
  depth: number;
  text?: string;
  count?: number;
}
export type Row = EntryRow | NoteRow;

export interface RowsInput {
  listings: Listings;
  loc: string;
  expanded: ReadonlySet<string>;
  options: Pick<ExplorerOptions, "compact" | "sort" | "desc" | "foldersFirst" | "ignored" | "changesOnly">;
  hidden: boolean;
  marks: GitMarks;
  /** Filter text (019 §5): only names of listings already read; no merging while filtering. */
  filter?: string;
  /** A path a reveal asked to show even if it would be hidden. */
  force?: string | null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
const mtimeOf = (e: FsEntry) => (e.modifiedAt ? Date.parse(e.modifiedAt) || 0 : 0);

/** A folder's children sorted (019 §4: natural names, case-insensitive; folders first by default). */
export function sortEntries(entries: readonly FsEntry[], options: Pick<ExplorerOptions, "sort" | "desc" | "foldersFirst">): FsEntry[] {
  const cmp: (a: FsEntry, b: FsEntry) => number =
    options.sort === "mtime"
      ? (a, b) => mtimeOf(b) - mtimeOf(a) || collator.compare(a.name, b.name)
      : options.sort === "size"
        ? (a, b) => (b.size ?? -1) - (a.size ?? -1) || collator.compare(a.name, b.name)
        : options.sort === "kind"
          ? (a, b) => collator.compare(extOf(a.name), extOf(b.name)) || collator.compare(a.name, b.name)
          : (a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return [...entries].sort((a, b) => {
    if (options.foldersFirst) {
      const d = Number(isDirEntry(b)) - Number(isDirEntry(a));
      if (d) return d;
    }
    const c = cmp(a, b);
    return options.desc ? -c : c;
  });
}

/** Children shown under a folder (hidden / ignored / changes-only applied; `force` always kept). */
export function visibleChildren(entries: readonly FsEntry[], input: Pick<RowsInput, "options" | "hidden" | "marks" | "force">): FsEntry[] {
  const { options, hidden, marks, force } = input;
  const kept = entries.filter((e) => {
    if (force && within(force, e.path)) return true;
    if (!hidden && e.name.startsWith(".")) return false;
    if (options.ignored === "hide" && e.ignored) return false;
    if (options.changesOnly && !(isDirEntry(e) ? marks.dirty.has(e.path) : marks.files.has(e.path))) return false;
    return true;
  });
  return sortEntries(kept, options);
}

/**
 * The rows under `loc`, in order, plus the folders whose listing is wanted (the open ones, and the one
 * folder inside a merged chain so the chain can grow: 019 §4 「展开时如果只剩一个子文件夹，就顺手把它也读了」).
 */
export function buildRows(input: RowsInput): { rows: Row[]; wanted: string[] } {
  const { listings, loc, expanded, options, marks, force } = input;
  const filter = (input.filter ?? "").trim().toLowerCase();
  const rows: Row[] = [];
  const wanted = new Set<string>([loc]);
  const hits = filter ? matchingFolders(input, filter) : null;
  const walk = (dir: string, depth: number) => {
    const listing = listings.get(dir);
    if (!listing?.entries) {
      if (listing?.error) rows.push({ type: "error", path: dir, depth, text: listing.error });
      else rows.push({ type: "loading", path: dir, depth });
      return;
    }
    let kids = visibleChildren(listing.entries, input);
    if (hits) kids = kids.filter((e) => e.name.toLowerCase().includes(filter) || (isDirEntry(e) && hits.has(e.path)) || (force && within(force, e.path)));
    if (!kids.length && depth === 0 && dir === loc) rows.push({ type: "empty", path: dir, depth });
    const shown = kids.slice(0, MAX_CHILDREN);
    for (const entry of shown) {
      const dirEntry = isDirEntry(entry);
      const chain = [entry];
      if (dirEntry && options.compact && !filter) {
        // Merge while the last folder's only shown child is a folder (its listing must be known).
        for (;;) {
          const last = chain[chain.length - 1]!;
          const l = listings.get(last.path);
          if (!l?.entries) break;
          const only = visibleChildren(l.entries, input);
          if (only.length !== 1 || !isDirEntry(only[0]!)) break;
          chain.push(only[0]!);
        }
      }
      const last = chain[chain.length - 1]!;
      const open = dirEntry && (chain.some((c) => expanded.has(c.path)) || (!!hits && hits.has(last.path)));
      const forced = !!force && within(force, entry.path) && !kidsWithout(listing.entries, input).some((e) => e.path === entry.path);
      rows.push({
        type: "entry",
        path: last.path,
        entry: last,
        chain,
        depth,
        dir: dirEntry,
        open,
        git: dirEntry ? null : (marks.files.get(last.path) ?? null),
        dirty: dirEntry && marks.dirty.has(last.path),
        forced,
      });
      if (open) {
        wanted.add(last.path);
        walk(last.path, depth + 1);
        // A merged chain whose last folder holds a single folder: read it too, so the chain can grow.
        const l = listings.get(last.path);
        if (options.compact && !filter && l?.entries) {
          const only = visibleChildren(l.entries, input);
          if (only.length === 1 && isDirEntry(only[0]!)) wanted.add(only[0]!.path);
        }
      }
    }
    if (kids.length > shown.length) rows.push({ type: "more", path: dir, depth, count: kids.length - shown.length });
  };
  walk(loc, 0);
  return { rows, wanted: [...wanted] };
}

function kidsWithout(entries: readonly FsEntry[], input: RowsInput): FsEntry[] {
  return visibleChildren(entries, { ...input, force: null });
}

/** Folders (already read) holding a name that matches `filter` somewhere below. */
function matchingFolders(input: RowsInput, filter: string): Set<string> {
  const out = new Set<string>();
  const visit = (dir: string): boolean => {
    const l = input.listings.get(dir);
    if (!l?.entries) return false;
    let any = false;
    for (const e of visibleChildren(l.entries, input)) {
      const self = e.name.toLowerCase().includes(filter);
      const below = isDirEntry(e) && visit(e.path);
      if (below) out.add(e.path);
      any = any || self || below;
    }
    return any;
  };
  visit(input.loc);
  return out;
}

/** Index of the row showing `path` (the row itself or a merged chain that contains it); -1 if none. */
export function rowIndexOf(rows: readonly Row[], path: string | null): number {
  if (path === null) return -1;
  return rows.findIndex((r) => r.type === "entry" && (r.path === path || r.chain.some((c) => c.path === path)));
}

/** The row's parent row (← on a closed folder / a file); -1 at the top level. */
export function parentRowIndex(rows: readonly Row[], index: number): number {
  const row = rows[index];
  if (!row) return -1;
  for (let i = index - 1; i >= 0; i--) if (rows[i]!.type === "entry" && rows[i]!.depth < row.depth) return i;
  return -1;
}

/** Up to `max` rows the first visible row sits inside (sticky folders at the top, 019 §4). */
export function stickyAncestors(rows: readonly Row[], first: number, max = 3): number[] {
  const out: number[] = [];
  const row = rows[first];
  if (!row) return out;
  let depth = row.depth;
  for (let i = first - 1; i >= 0 && depth > 0; i--) {
    const r = rows[i]!;
    if (r.type === "entry" && r.depth < depth) {
      out.unshift(i);
      depth = r.depth;
    }
  }
  return out.slice(-max);
}

/**
 * Type-ahead (019 §4): the next entry row after `from` (wrapping; from itself for a longer prefix)
 * whose name starts with `prefix` (case-insensitive). -1 when none.
 */
export function typeAhead(rows: readonly Row[], from: number, prefix: string): number {
  const p = prefix.toLowerCase();
  if (!p || !rows.length) return -1;
  const start = p.length > 1 ? Math.max(from, 0) : from + 1;
  for (let k = 0; k < rows.length; k++) {
    const i = (start + k + rows.length) % rows.length;
    const r = rows[i]!;
    if (r.type === "entry" && r.entry.name.toLowerCase().startsWith(p)) return i;
  }
  return -1;
}

// ---------- gallery ----------

/** 019 §6 / decision 4: a folder of at least 4 images that are ≥ 80 % of its files opens as thumbnails. */
export function autoGallery(entries: readonly FsEntry[] | null | undefined): boolean {
  if (!entries) return false;
  const files = entries.filter((e) => !isDirEntry(e));
  const images = files.filter((e) => isThumbnailPath(e.name)).length;
  return images >= 4 && images >= files.length * 0.8;
}

export function folderView(view: RootView, loc: string, entries: readonly FsEntry[] | null | undefined): FolderView {
  return view.views[loc] ?? (autoGallery(entries) ? "gallery" : "list");
}

// ---------- history (019 §2) ----------

export interface HistoryEntry {
  root: string;
  loc: string;
  sel: string | null;
  scroll: number;
}
export interface History {
  entries: HistoryEntry[];
  index: number;
}
export const MAX_HISTORY = 50;
export const emptyHistory = (first: HistoryEntry): History => ({ entries: [first], index: 0 });

/** Go somewhere new: the current entry is updated with `here`, forward entries drop, `next` is appended. */
export function pushHistory(h: History, here: HistoryEntry, next: HistoryEntry): History {
  const entries = h.entries.slice(0, h.index + 1);
  entries[entries.length - 1] = here;
  entries.push(next);
  const over = Math.max(0, entries.length - MAX_HISTORY);
  return { entries: entries.slice(over), index: entries.length - 1 - over };
}
/** Back (delta −1) / forward (+1) / jump: null when it cannot. `here` updates the entry being left. */
export function stepHistory(h: History, here: HistoryEntry, delta: number): History | null {
  const to = h.index + delta;
  if (!delta || to < 0 || to >= h.entries.length) return null;
  const entries = [...h.entries];
  entries[h.index] = here;
  return { entries, index: to };
}

// ---------- reveal (019 §3) ----------

export interface RevealPlan {
  /** New current folder (a history step), or null to stay. */
  loc: string | null;
  /** Folders to open (from the current / new location down). */
  expand: string[];
  sel: string;
}

/**
 * Show `path` (a file or folder, root-relative): inside the current folder → stay, open the way down;
 * outside → go to its folder. A folder target is opened too (as the old 打开文件夹 did).
 */
export function planReveal(path: string, loc: string, isDir: boolean): RevealPlan {
  const inside = within(path, loc) && path !== loc;
  if (path === loc) return { loc: null, expand: [], sel: path };
  const base = inside ? loc : parentOf(path);
  const expand = foldersBetween(base, path);
  if (isDir) expand.push(path);
  return { loc: inside ? null : base, expand, sel: path };
}

/** Follow (019 §3): select the open file only when it is in the current folder; never moves. */
export function planFollow(path: string, loc: string): RevealPlan | null {
  if (!within(path, loc) || path === loc) return null;
  return { loc: null, expand: foldersBetween(loc, path), sel: path };
}
