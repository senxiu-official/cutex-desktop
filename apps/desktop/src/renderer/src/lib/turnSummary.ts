// Turn-end summary (轮尾摘要, the thin row under a finished turn's last reply): which files the turn
// changed through native `fileChange` items, and which links of its final reply are worth one click.
// Pure (no React) so it is unit-testable. Data comes from the timeline items only — native
// `turn/diff/updated` is not in thread history, so it is never used here.
import { extensionOf } from "./fileKinds";
import type { RawItem, TimelineEntry } from "./timeline";
import { resolveFileHref } from "./workspace";

export type ChangeStatus = "added" | "modified" | "deleted" | "moved";

/** One native change of a file (FileUpdateChange; `diff` is the content for add / delete). */
export interface ChangeRecord {
  kind: "add" | "delete" | "update";
  path: string;
  movePath: string | null;
  diff: string;
}

export interface TurnFileChange {
  /** The file's path after the turn (a move's destination), as the agent's tool reported it. */
  path: string;
  /** Where a moved file came from (its first path in the turn). */
  from: string | null;
  status: ChangeStatus;
  added: number;
  deleted: number;
  /** Every change of this file in the turn, in order (查看变更 concatenates them). */
  changes: ChangeRecord[];
}

export interface TurnChanges {
  turnId: string;
  files: TurnFileChange[];
  added: number;
  deleted: number;
  /** Stable for equal content (memo comparisons). */
  signature: string;
}

/** Lines of a whole-file body (add / delete): a trailing newline does not start a new line. */
function contentLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/** +/- lines of a unified diff body; file headers before the first hunk are not counted. */
export function countUnified(diff: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && /^(--- |\+\+\+ |diff |index )/.test(line)) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) deleted++;
  }
  return { added, deleted };
}

export function countChange(change: ChangeRecord): { added: number; deleted: number } {
  if (change.kind === "add") return { added: contentLines(change.diff), deleted: 0 };
  if (change.kind === "delete") return { added: 0, deleted: contentLines(change.diff) };
  return countUnified(change.diff);
}

/** Merge key of a path: `/` separators; Windows drive paths compare case-insensitively. */
function keyOf(path: string): string {
  const p = path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(p) ? p.toLowerCase() : p;
}

/** The changes of one `fileChange` item (unknown kinds are skipped). */
export function changeRecords(item: RawItem): ChangeRecord[] {
  const raw = Array.isArray(item.changes) ? (item.changes as unknown[]) : [];
  const out: ChangeRecord[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const { path, kind, diff } = c as { path?: unknown; kind?: unknown; diff?: unknown };
    if (typeof path !== "string" || !path) continue;
    const type = kind && typeof kind === "object" ? (kind as { type?: unknown }).type : null;
    // Older items carry no kind: an update.
    const k = type === "add" || type === "delete" ? type : "update";
    const move = k === "update" ? (kind as { move_path?: unknown; movePath?: unknown } | null) : null;
    const movePath = typeof move?.move_path === "string" && move.move_path ? move.move_path : typeof move?.movePath === "string" && move.movePath ? move.movePath : null;
    out.push({ kind: k, path, movePath, diff: typeof diff === "string" ? diff : "" });
  }
  return out;
}

/**
 * Merge the completed `fileChange` items of one turn into one row per file: counts add up, a move
 * renames the row (later changes to the new path land on it), a file added and deleted again in the
 * same turn drops out. Failed / declined / running items are ignored.
 */
export function summarizeFileChanges(items: readonly RawItem[]): TurnFileChange[] {
  const rows = new Map<string, TurnFileChange & { order: number }>();
  let order = 0;
  for (const item of items) {
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const change of changeRecords(item)) {
      const key = keyOf(change.path);
      const prev = rows.get(key);
      const { added, deleted } = countChange(change);
      const row = prev ?? { path: change.path, from: null, status: "modified" as ChangeStatus, added: 0, deleted: 0, changes: [], order: order++ };
      row.added += added;
      row.deleted += deleted;
      row.changes.push(change);
      if (change.kind === "add") {
        row.status = prev?.status === "deleted" ? "modified" : prev ? prev.status : "added";
      } else if (change.kind === "delete") {
        if (prev?.status === "added") {
          rows.delete(key);
          continue;
        }
        row.status = "deleted";
      } else if (change.movePath && keyOf(change.movePath) !== key) {
        rows.delete(key);
        row.from = row.from ?? change.path;
        row.path = change.movePath;
        if (row.status !== "added") row.status = "moved";
        rows.set(keyOf(change.movePath), row);
        continue;
      } else if (!prev) row.status = "modified";
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.order - b.order).map(({ order: _order, ...row }) => row);
}

/** File changes of every turn that has completed ones, keyed by turn id. */
export function fileChangesByTurn(entries: Iterable<TimelineEntry>): Map<string, TurnChanges> {
  const byTurn = new Map<string, RawItem[]>();
  for (const e of entries) {
    if (e.kind !== "tool" || e.item.type !== "fileChange" || !e.turnId) continue;
    const list = byTurn.get(e.turnId);
    if (list) list.push(e.item);
    else byTurn.set(e.turnId, [e.item]);
  }
  const out = new Map<string, TurnChanges>();
  for (const [turnId, items] of byTurn) {
    const files = summarizeFileChanges(items);
    if (!files.length) continue;
    const added = files.reduce((n, f) => n + f.added, 0);
    const deleted = files.reduce((n, f) => n + f.deleted, 0);
    const signature = files.map((f) => `${f.from ?? ""}>${f.path}:${f.status}:${f.added}:${f.deleted}:${f.changes.length}`).join("|");
    out.set(turnId, { turnId, files, added, deleted, signature });
  }
  return out;
}

function prefixed(text: string, mark: "+" | "-"): string {
  if (!text) return "";
  return text
    .replace(/\r?\n$/, "")
    .split(/\r?\n/)
    .map((line) => mark + line)
    .join("\n");
}

/** One unified diff of everything the turn did to a file (side pane 查看变更); `show` words the header paths. */
export function turnFileDiff(file: TurnFileChange, show: (path: string) => string = (p) => p): string {
  const parts: string[] = [];
  for (const c of file.changes) {
    const n = contentLines(c.diff);
    if (c.kind === "add") parts.push(`--- /dev/null\n+++ b/${show(c.path)}\n@@ -0,0 +1,${n} @@\n${prefixed(c.diff, "+")}`);
    else if (c.kind === "delete") parts.push(`--- a/${show(c.path)}\n+++ /dev/null\n@@ -1,${n} +0,0 @@\n${prefixed(c.diff, "-")}`);
    else {
      const body = c.diff.replace(/\r?\n$/, "");
      const header = /^(--- |diff )/.test(body) ? "" : `--- a/${show(c.path)}\n+++ b/${show(c.movePath ?? c.path)}\n`;
      parts.push(`${header}${body}`);
    }
  }
  return parts.join("\n");
}

// ---- links of the final reply ----

/** Document types worth a chip even when the turn did not change them (checked to exist first). */
const DOC_EXTS = new Set(["md", "markdown", "html", "htm", "pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg", "gif", "webp", "svg"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export const MAX_LINKS = 6;

export type LinkKind = "web" | "file";

export interface TurnLink {
  kind: LinkKind;
  /** The URL (web) or the file href with its line suffix stripped (file). */
  target: string;
  /** Markdown link text when it says more than the target, else null (the chip shows a name). */
  label: string | null;
  /** `[x](path "open")`: the agent asked for this to be opened; shown first. */
  pinned: boolean;
  /** A file this turn changed (no existence check needed). */
  changed: boolean;
  /** Absolute host path (when known) and workspace-relative path (inside the root). */
  abs: string | null;
  rel: string | null;
  /** Lower-cased extension ("" for web links / none). */
  ext: string;
  /** Exists-check through the host file read before showing (documents not changed this turn). */
  verify: boolean;
}

const MD_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/gi;
const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i;

/** Fenced code blocks are not prose: their URLs and links are examples, not results. */
function stripFences(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      out.push("");
    } else if (mark) {
      fence = mark;
      out.push("");
    } else out.push(line);
  }
  return out.join("\n");
}

function cleanUrl(url: string): string {
  return url.replace(/[.,;:!?，。！？；：、]+$/u, "");
}

export interface LinkPickOptions {
  /** Workspace root of the agent (resolves relative links). */
  root: string | null;
  /** The host's home directory (`~/…` links), when known. */
  home?: string | null;
  /** cutex fs-file-read: documents the turn did not change may be checked for existence. */
  hostRead: boolean;
}

/**
 * Links of a turn's final reply worth a chip: Markdown links / bare URLs pointing at files changed
 * this turn; document files (md / html / pdf / office / images) that will be checked to exist (only
 * with the host file read); local web servers (`http://localhost`, `127.0.0.1`) and explicit
 * Markdown http(s) links. A code reference with a line (`[a.rs:42](src/a.rs:42)`) is not a result.
 * `[x](target "open")` links are always kept and come first. Deduped, at most [`MAX_LINKS`].
 */
export function pickTurnLinks(text: string, changed: readonly TurnFileChange[], opts: LinkPickOptions): TurnLink[] {
  const prose = stripFences(text);
  const changedKeys = new Set<string>();
  for (const f of changed) {
    if (f.status === "deleted") continue;
    const ref = resolveFileHref(f.path, opts.root, opts.home ?? null);
    changedKeys.add(keyOf(f.path));
    if (ref?.abs) changedKeys.add(keyOf(ref.abs));
    if (ref?.rel) changedKeys.add(`rel:${ref.rel}`);
  }
  const found: (TurnLink & { at: number })[] = [];
  const seen = new Set<string>();
  const push = (link: TurnLink, at: number) => {
    const key = link.kind === "web" ? link.target : link.abs ? keyOf(link.abs) : `rel:${link.rel ?? link.target}`;
    const twin = seen.has(key) ? found.find((x) => (x.kind === "web" ? x.target : x.abs ? keyOf(x.abs) : `rel:${x.rel ?? x.target}`) === key) : undefined;
    if (twin) {
      // The same target again: keep the first, but an "open" mark or a label anywhere counts.
      twin.pinned ||= link.pinned;
      twin.label ??= link.label;
      return;
    }
    seen.add(key);
    found.push({ ...link, at });
  };
  const linkSpans: [number, number][] = [];
  for (const m of prose.matchAll(MD_LINK)) {
    linkSpans.push([m.index, m.index + m[0].length]);
    const [, , rawLabel, href, dq, sq] = m;
    const title = (dq ?? sq ?? "").trim().toLowerCase();
    const pinned = title === "open";
    const label = rawLabel?.trim() || null;
    if (!href) continue;
    if (/^https?:\/\//i.test(href)) {
      const url = cleanUrl(href);
      push({ kind: "web", target: url, label: label && label !== url ? label : null, pinned, changed: false, abs: null, rel: null, ext: "", verify: false }, m.index);
      continue;
    }
    const ref = resolveFileHref(href, opts.root, opts.home ?? null);
    if (!ref) continue;
    const isChanged = (ref.abs && changedKeys.has(keyOf(ref.abs))) || (ref.rel && changedKeys.has(`rel:${ref.rel}`)) || changedKeys.has(keyOf(ref.path));
    const ext = extensionOf(ref.path);
    const doc = DOC_EXTS.has(ext);
    // A code reference (`file.rs:42`) is a citation, not something the turn produced.
    if (ref.line != null && !pinned) continue;
    if (!isChanged && !doc && !pinned) continue;
    // Without the host file read only changed files (and the agent's own "open" picks) are shown.
    if (!isChanged && !opts.hostRead && !pinned) continue;
    const name = ref.path.split(/[\\/]/).filter(Boolean).pop() ?? ref.path;
    push(
      { kind: "file", target: ref.path, label: label && label !== name && label !== ref.path && label !== href ? label : null, pinned, changed: !!isChanged, abs: ref.abs, rel: ref.rel, ext, verify: !isChanged && opts.hostRead && !!ref.abs },
      m.index,
    );
  }
  // Bare local web servers (also inside `inline code`, where agents usually put them).
  for (const m of prose.matchAll(BARE_URL)) {
    if (linkSpans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const url = cleanUrl(m[0]);
    if (!LOCAL_URL.test(url)) continue;
    push({ kind: "web", target: url, label: null, pinned: false, changed: false, abs: null, rel: null, ext: "", verify: false }, m.index);
  }
  return found
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.at - b.at)
    .slice(0, MAX_LINKS)
    .map(({ at: _at, ...link }) => link);
}

/** Type label for a link row: 网站 / 文档 · MD / 图片 · PNG / 文件 · TS. */
export function linkTypeOf(link: Pick<TurnLink, "kind" | "ext">): { group: "web" | "doc" | "image" | "file"; ext: string } {
  if (link.kind === "web") return { group: "web", ext: "" };
  const ext = link.ext.toUpperCase();
  if (IMAGE_EXTS.has(link.ext)) return { group: "image", ext };
  if (DOC_EXTS.has(link.ext)) return { group: "doc", ext: link.ext === "markdown" ? "MD" : link.ext === "htm" ? "HTML" : ext };
  return { group: "file", ext };
}

/** What a chip shows: the Markdown label, else the file name / the URL without its scheme. */
export function linkName(link: Pick<TurnLink, "kind" | "target" | "label">): string {
  if (link.label) return link.label;
  if (link.kind === "web") return link.target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return link.target.split(/[\\/]/).filter(Boolean).pop() ?? link.target;
}

/** Whether a finished turn's summary row starts expanded (Settings → 对话 → 轮尾摘要). */
export type TurnSummaryMode = "collapsed" | "latestExpanded" | "off";
export const TURN_SUMMARY_EXPAND_MAX_FILES = 5;

export function startsExpanded(mode: TurnSummaryMode, latest: boolean, files: number): boolean {
  return mode === "latestExpanded" && latest && files <= TURN_SUMMARY_EXPAND_MAX_FILES;
}
