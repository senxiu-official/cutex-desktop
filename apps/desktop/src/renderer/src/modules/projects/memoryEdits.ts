// Project memory edits in the timeline (owner 2026-11-28: 「把编辑记忆的动作单独显示」). Agents write project memory with their
// ordinary file tools (Claude Write / Edit, Codex apply_patch); both reach the timeline as `fileChange` items. A change
// whose file is inside a project memory directory is a memory edit: one row 「更新项目记忆 · <name>」 outside the work
// group, every memory edit of a turn in that one row (MemoryEditRow).
//
// Where the directory is: cutex keeps a project's memory at `<cutex home>/projects/<key>/memory/`, `<key>` being the
// project id's lowercase slug plus the first 12 hex digits of its SHA-256 (cutex src/memory/store.rs
// project_memory_key), and the files follow cutex's memory file names (MEMORY.md, `[a-z0-9][a-z0-9._-]*.md`). The row
// recognises that shape on `/` and `\` paths (not Claude Code's own `~/.claude/projects/<path>/memory`, whose folder
// has no hash); the host's `GET /v2/projects/{id}/memory` `dir` then confirms it is the conversation's project, which
// is what offers 「在记忆页打开」 and the entries' current names.
//
// Pure (unit-tested). Rows are built from MemoryEdit records, not from the tool call, so a future typed memory tool
// (a cutex `memory_write` with file, change kind and name) feeds the same row through its own `…Of(item)` here.
import type { RawItem } from "../../lib/timeline";
import { changeRecords, type ChangeRecord } from "../../lib/turnSummary";
import { MAX_MEMORY_FILE_NAME_CHARS, MEMORY_INDEX_FILE, parseMemory } from "../../../../shared/projectMemory";

export type MemoryChangeKind = "add" | "update" | "delete";

/** One memory file one tool call changed. */
export interface MemoryEdit {
  /** The path as the tool reported it. */
  path: string;
  /** The memory directory, `/`-separated (compare with sameMemoryDir). */
  dir: string;
  /** The `projects/<key>` folder name. */
  projectKey: string;
  /** `MEMORY.md` (the index) or an entry's file name. */
  file: string;
  kind: MemoryChangeKind;
  /** From the frontmatter the change carries (a new / deleted file's whole text, or an edit's lines); null = not in it. */
  name: string | null;
  description: string | null;
  /** The change as the tool reported it (lib/turnSummary ChangeRecord), for the diff. */
  change: ChangeRecord;
  status: "running" | "completed" | "failed";
}

const PROJECT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-[0-9a-f]{12}$/;
const ENTRY_FILE = /^[a-z0-9][a-z0-9._-]*\.md$/;

/** Where a path sits in a project memory directory; null = not a memory file. */
export function memoryPathOf(path: string): { dir: string; projectKey: string; file: string } | null {
  const parts = path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").split("/");
  if (parts.length < 4) return null;
  const [projects, projectKey, memory, file] = parts.slice(-4) as [string, string, string, string];
  if (projects.toLowerCase() !== "projects" || memory.toLowerCase() !== "memory" || !PROJECT_KEY.test(projectKey)) return null;
  if (file !== MEMORY_INDEX_FILE && !(file.length <= MAX_MEMORY_FILE_NAME_CHARS && ENTRY_FILE.test(file))) return null;
  return { dir: parts.slice(0, -1).join("/"), projectKey, file };
}

/** Two memory directories are the same folder (`/` vs `\`, a Windows drive's case, `\\?\`, a trailing separator). */
export function sameMemoryDir(a: string, b: string): boolean {
  const key = (p: string) => {
    const s = p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-zA-Z]:\//.test(s) ? s.toLowerCase() : s;
  };
  return key(a) === key(b);
}

const unquote = (v: string) => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v);

/** name / description from the lines an edit carries (context and added lines; a hunk rarely includes them). */
function frontmatterOfDiff(diff: string): { name: string | null; description: string | null } {
  let name: string | null = null;
  let description: string | null = null;
  for (const raw of diff.split("\n")) {
    if (!raw || raw[0] === "-" || raw.startsWith("@@") || raw.startsWith("+++")) continue;
    const line = raw[0] === "+" || raw[0] === " " ? raw.slice(1) : raw;
    const m = /^(name|description):\s*(.+?)\s*$/.exec(line.replace(/\r$/, ""));
    if (!m) continue;
    if (m[1] === "name") name ??= unquote(m[2]!);
    else description ??= unquote(m[2]!);
  }
  return { name, description };
}

function statusOf(item: RawItem): MemoryEdit["status"] {
  const s = item.status;
  return s === "inProgress" || s === "running" ? "running" : s === "failed" || s === "declined" ? "failed" : "completed";
}

/**
 * The memory edits of a `fileChange` item, when every file it changes is a memory file; null otherwise (a patch that
 * also touches code stays an ordinary file row: the memory row never hides other edits). A move counts as an edit of
 * the file it moved to, and only when both ends are in the same memory directory.
 */
export function memoryEditsOfFileChange(item: RawItem): MemoryEdit[] | null {
  if (item.type !== "fileChange") return null;
  const changes = changeRecords(item);
  if (!changes.length) return null;
  const out: MemoryEdit[] = [];
  for (const change of changes) {
    const at = memoryPathOf(change.path);
    if (!at) return null;
    let file = at.file;
    if (change.movePath) {
      const to = memoryPathOf(change.movePath);
      if (!to || !sameMemoryDir(to.dir, at.dir)) return null;
      file = to.file;
    }
    const meta = file === MEMORY_INDEX_FILE ? { name: null, description: null } : change.kind === "update" ? frontmatterOfDiff(change.diff) : (() => {
      const m = parseMemory(change.diff);
      return { name: m.name || null, description: m.description || null };
    })();
    out.push({ path: change.path, dir: at.dir, projectKey: at.projectKey, file, kind: change.kind, ...meta, change, status: statusOf(item) });
  }
  return out;
}

/** Every memory edit an item carries (the sources: file changes today; a typed memory tool would join here). */
export function memoryEditsOf(item: RawItem): MemoryEdit[] | null {
  return memoryEditsOfFileChange(item);
}

/** timeline.tool `gather`: memory edits of one turn and one memory directory share a row. */
export function memoryGatherKey(item: RawItem): string | null {
  const edits = memoryEditsOf(item);
  return edits ? `memory:${edits[0]!.dir.toLowerCase()}` : null;
}

/** One file of the row: what happened to it over the turn and what it is called. */
export interface MemoryRowFile {
  file: string;
  kind: MemoryChangeKind;
  /** Frontmatter name, else the description, else the file name without `.md`. */
  label: string;
  description: string | null;
  edits: MemoryEdit[];
  status: MemoryEdit["status"];
}

export interface MemoryRowModel {
  /** The verb of the row: every file the same → that; mixed → update. Index-only → "index". */
  verb: MemoryChangeKind | "index";
  /** Entry files, first-touched first (MEMORY.md is not one). */
  files: MemoryRowFile[];
  /** MEMORY.md changed too (「及索引」). */
  index: boolean;
  indexEdits: MemoryEdit[];
  status: MemoryEdit["status"];
  dir: string;
}

const worst = (a: MemoryEdit["status"], b: MemoryEdit["status"]): MemoryEdit["status"] => (a === "running" || b === "running" ? "running" : a === "failed" || b === "failed" ? "failed" : "completed");

/**
 * The row for a turn's memory edits. `known`: the host's entries (file → current name / description), used when the
 * change itself does not carry them (an edit's hunk usually has no frontmatter). A failed edit stays listed, marked.
 */
export function memoryRow(edits: readonly MemoryEdit[], known?: ReadonlyMap<string, { name?: string | null; description?: string | null }>): MemoryRowModel | null {
  if (!edits.length) return null;
  const files = new Map<string, MemoryRowFile>();
  const indexEdits: MemoryEdit[] = [];
  let status: MemoryEdit["status"] = "completed";
  for (const e of edits) {
    status = worst(status, e.status);
    if (e.file === MEMORY_INDEX_FILE) {
      indexEdits.push(e);
      continue;
    }
    const prev = files.get(e.file);
    // Over the turn: created then edited is still 新增; anything then deleted is 删除; a delete then a create, 更新.
    const kind: MemoryChangeKind = !prev ? e.kind : e.kind === "delete" ? "delete" : prev.kind === "delete" ? "update" : prev.kind === "add" ? "add" : e.kind === "add" ? "update" : prev.kind;
    const host = known?.get(e.file);
    const name = e.name ?? prev?.edits.findLast((x) => x.name)?.name ?? (host?.name || null);
    const description = e.description ?? prev?.description ?? (host?.description || null);
    const row: MemoryRowFile = prev ?? { file: e.file, kind, label: "", description: null, edits: [], status: e.status };
    row.kind = kind;
    row.edits.push(e);
    row.status = prev ? worst(prev.status, e.status) : e.status;
    row.description = description;
    row.label = name || description || e.file.replace(/\.md$/, "");
    files.set(e.file, row);
  }
  const list = [...files.values()];
  const kinds = new Set(list.map((f) => f.kind));
  const verb: MemoryRowModel["verb"] = !list.length ? "index" : kinds.size === 1 ? list[0]!.kind : "update";
  return { verb, files: list, index: indexEdits.length > 0, indexEdits, status, dir: edits[0]!.dir };
}
