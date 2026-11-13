// Project memory editing (项目 → 记忆, cutex `project-memory`): the rules of one memory file and of its MEMORY.md
// line, mirrored from cutex `src/memory/store.rs` so the form can say what is wrong before saving. cutex validates
// again on every write and stays the authority; nothing here touches the filesystem.
//
// File: `<name>.md`, `[a-z0-9][a-z0-9._-]*\.md`, at most 128 chars (MEMORY.md is the index, never an entry).
// Content: a leading `---` YAML frontmatter block with `name` (kebab-case, ≤ 64), `description` (one line, ≤ 300)
// and `metadata.type` (user | feedback | project | reference), then the markdown body; ≤ 64 KiB in UTF-8.

/** cutex capability: project memory reads and writes (`/v2/projects/{id}/memory[/{file}]`, root). */
export const PROJECT_MEMORY_FEATURE = "project-memory";
export const MEMORY_INDEX_FILE = "MEMORY.md";
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
export const MAX_MEMORY_FILE_NAME_CHARS = 128;
export const MAX_MEMORY_FILE_BYTES = 64 * 1024;
export const MAX_MEMORY_NAME_CHARS = 64;
export const MAX_MEMORY_DESCRIPTION_CHARS = 300;

/** The editable parts of one memory file. `frontmatter`: the raw block lines (without the fences, line ends stripped),
 *  kept so keys the form doesn't show survive an edit; null for a new file or one without a closed block.
 *  `source`: how the file was written (set by parseMemory), so an unchanged frontmatter is written back byte for byte. */
export interface MemoryDraft {
  name: string;
  description: string;
  type: string;
  body: string;
  frontmatter: string[] | null;
  source?: MemorySource | null;
}

/** The read file's frontmatter as it was: `head` is everything before the body (BOM, fences, block, separator). */
export interface MemorySource {
  head: string;
  bom: string;
  eol: "\n" | "\r\n";
  close: string;
  name: string;
  description: string;
  type: string;
  body: string;
}

export type MemoryProblem =
  | "fileName"
  | "fileIndex"
  | "fileTaken"
  | "name"
  | "description"
  | "descriptionLines"
  | "type"
  | "tooLarge";

const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.md$/;

export function memoryFileProblem(file: string, taken: readonly string[] = []): MemoryProblem | null {
  if (file === MEMORY_INDEX_FILE) return "fileIndex";
  if (file.length > MAX_MEMORY_FILE_NAME_CHARS || file.length <= 3 || !FILE_RE.test(file)) return "fileName";
  if (taken.includes(file)) return "fileTaken";
  return null;
}

export function isKebabSlug(value: string): boolean {
  return value.length > 0 && [...value].length <= MAX_MEMORY_NAME_CHARS && value.split("-").every((part) => /^[a-z0-9]+$/.test(part));
}

/** A kebab slug made from free text (best effort; empty when nothing usable is left, e.g. all-CJK text). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_MEMORY_NAME_CHARS)
    .replace(/-+$/, "");
}

/** Problems of a draft, in form order (empty = cutex will accept it). */
export function memoryDraftProblems(draft: MemoryDraft): MemoryProblem[] {
  const out: MemoryProblem[] = [];
  if (!isKebabSlug(draft.name)) out.push("name");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(draft.description)) out.push("descriptionLines");
  else if (!draft.description.trim() || [...draft.description].length > MAX_MEMORY_DESCRIPTION_CHARS) out.push("description");
  if (!(MEMORY_TYPES as readonly string[]).includes(draft.type)) out.push("type");
  if (out.length === 0 && new TextEncoder().encode(serializeMemory(draft)).length > MAX_MEMORY_FILE_BYTES) out.push("tooLarge");
  return out;
}

// ---------- frontmatter ----------

function unquote(value: string): string {
  let v = value;
  if (!v.startsWith('"') && !v.startsWith("'")) {
    const comment = v.indexOf(" #");
    if (comment >= 0) v = v.slice(0, comment).trimEnd();
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

/** A YAML scalar for `value`: plain when that reads back the same (cutex's parser and YAML), else double-quoted. */
export function yamlScalar(value: string): string {
  const plain =
    value.length > 0 &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !value.includes(": ") &&
    !value.includes(" #") &&
    !value.endsWith(":") &&
    !/^(true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9_.:eE+-]*)$/i.test(value);
  return plain ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Split a memory file into the form's fields (the same keys cutex reads: name, description, metadata.type, with a
 *  top-level `type` as fallback). A file without a closed frontmatter block is all body. */
export function parseMemory(content: string): MemoryDraft {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = content.slice(bom.length);
  const lines = text.split("\n");
  const empty: MemoryDraft = { name: "", description: "", type: "", body: text, frontmatter: null };
  if (lines[0]?.trimEnd() !== "---") return empty;
  const close = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."));
  if (close < 0) return empty;
  const block = lines.slice(1, close).map((l) => l.replace(/\r$/, ""));
  let name = "";
  let description = "";
  let metaType: string | null = null;
  let topType: string | null = null;
  let parent: string | null = null;
  for (const line of block) {
    const end = line.trimEnd();
    const body = end.trimStart();
    if (!body || body.startsWith("#")) continue;
    const colon = body.indexOf(":");
    if (colon < 0) continue;
    const key = body.slice(0, colon).trim();
    const value = unquote(body.slice(colon + 1).trim());
    if (body.length === end.length) {
      if (!value) {
        parent = key;
        continue;
      }
      parent = null;
      if (key === "name") name = value;
      else if (key === "description") description = value;
      else if (key === "type") topType = value;
    } else if (parent === "metadata" && key === "type" && value) metaType = value;
  }
  // The body starts after the closing line and one blank line; `head` keeps all of that verbatim.
  let at = Math.min(text.length, lines.slice(0, close + 1).reduce((n, l) => n + l.length + 1, 0));
  if (text.startsWith("\r\n", at)) at += 2;
  else if (text.startsWith("\n", at)) at += 1;
  const body = text.slice(at);
  const type = metaType ?? topType ?? "";
  const source: MemorySource = { head: bom + text.slice(0, at), bom, eol: lines[0]!.endsWith("\r") ? "\r\n" : "\n", close: lines[close]!.replace(/\r$/, ""), name, description, type, body };
  return { name, description, type, body, frontmatter: block, source };
}

const topKey = (line: string, key: string) => line.length === line.trimStart().length && new RegExp(`^${key}\\s*:`).test(line);

/** The file content for a draft. Unchanged name / description / type: the read frontmatter as it was (BOM, line ends,
 *  closing `...`) followed by the body. Otherwise only the changed fields' lines are rewritten, other keys kept, in the
 *  file's own line ends and delimiters. */
export function serializeMemory(draft: MemoryDraft): string {
  const src = draft.frontmatter ? draft.source ?? null : null;
  const sameBody = src !== null && draft.body === src.body;
  const tail = (body: string) => (sameBody || !body || body.endsWith("\n") ? body : body + (src?.eol ?? "\n"));
  if (src && src.name === draft.name && src.description === draft.description && src.type === draft.type) return src.head + tail(draft.body);
  const block = [...(draft.frontmatter ?? [])];
  const before = src;
  const nameAt = block.findIndex((l) => topKey(l, "name"));
  if (nameAt < 0) block.unshift(`name: ${yamlScalar(draft.name)}`);
  else if (before?.name !== draft.name) block[nameAt] = `name: ${yamlScalar(draft.name)}`;
  // description goes after name when it is new.
  const descAt = block.findIndex((l) => topKey(l, "description"));
  if (descAt >= 0) {
    if (before?.description !== draft.description) block[descAt] = `description: ${yamlScalar(draft.description)}`;
  } else {
    block.splice(block.findIndex((l) => topKey(l, "name")) + 1, 0, `description: ${yamlScalar(draft.description)}`);
  }
  if (before?.type !== draft.type || !before) {
    const metaAt = block.findIndex((l) => topKey(l, "metadata"));
    const metaTypeAt = metaAt < 0 ? -1 : (() => {
      for (let i = metaAt + 1; i < block.length; i++) {
        const l = block[i]!;
        if (l.trim() && l.length === l.trimStart().length) return -1;
        if (/^\s+type\s*:/.test(l)) return i;
      }
      return -1;
    })();
    const topTypeAt = block.findIndex((l) => topKey(l, "type"));
    if (metaTypeAt >= 0) block[metaTypeAt] = `${block[metaTypeAt]!.match(/^\s+/)![0]}type: ${yamlScalar(draft.type)}`;
    else if (metaAt >= 0) block.splice(metaAt + 1, 0, `  type: ${yamlScalar(draft.type)}`);
    else if (topTypeAt >= 0) block[topTypeAt] = `type: ${yamlScalar(draft.type)}`;
    else block.push("metadata:", `  type: ${yamlScalar(draft.type)}`);
  }
  const eol = src?.eol ?? "\n";
  const body = sameBody ? draft.body : draft.body.replace(/^(\r?\n)+/, "");
  return `${src?.bom ?? ""}---${eol}${block.join(eol)}${eol}${src?.close ?? "---"}${eol}${eol}${tail(body)}`;
}

// ---------- MEMORY.md ----------

/** Same test as cutex `index_line_references`: a `- [` / `* [` line linking `file` (or `./file`). */
export function indexLineReferences(line: string, file: string): boolean {
  const l = line.trimStart();
  return (l.startsWith("- [") || l.startsWith("* [")) && (l.includes(`](${file})`) || l.includes(`](./${file})`));
}

const DASH = " — ";

/**
 * MEMORY.md after saving `file` with `name` / `description`; null when nothing changes.
 * `prev`: the fields before the edit (null for a new file). An existing line is left alone when neither changed (its
 * hook may be the owner's own words); otherwise it keeps its bullet, link and a title the owner wrote (only a title
 * equal to the old name follows a rename) and gets the new description as its hook. A missing line is added at the
 * top (cutex's rule: newest first, so it survives truncation of long indexes).
 */
export function nextMemoryIndex(index: string | null | undefined, file: string, prev: { name: string; description: string } | null, next: { name: string; description: string }): string | null {
  const text = index ?? "";
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  const at = lines.findIndex((l) => indexLineReferences(l, file));
  let line: string;
  if (at >= 0) {
    if (prev && prev.name === next.name && prev.description === next.description) return null;
    const old = lines[at]!;
    const m = /^(\s*[-*] \[)(.*?)(\]\((?:\.\/)?[^)]*\))(.*)$/.exec(old);
    if (!m) return null;
    const title = prev && m[2] === prev.name ? next.name : m[2]!;
    line = `${m[1]}${title}${m[3]}${DASH}${next.description.trim()}`;
    if (line === old.replace(/\r$/, "")) return null;
    lines[at] = line;
  } else {
    line = `- [${next.name}](${file})${DASH}${next.description.trim()}`;
    const first = lines.findIndex((l) => /^\s*[-*] \[/.test(l));
    lines.splice(first < 0 ? lines.length : first, 0, line);
  }
  return `${lines.join("\n")}\n`;
}

// ---------- save / delete ----------

/** The daemon calls the editor needs (a host's DesktopApi). */
export interface MemoryApi {
  projectMemory(projectId: string): Promise<import("./ipc").ProjectMemoryView | null>;
  projectMemoryWrite(projectId: string, file: string, content: string, expectedRevision: string | null, updateIndex: boolean): Promise<import("./ipc").ProjectMemoryMutation>;
  projectMemoryDelete(projectId: string, file: string, expectedRevision: string): Promise<import("./ipc").ProjectMemoryMutation>;
}

export type MemorySaveResult =
  | { ok: true; revision: string | null; indexError: string | null }
  | Exclude<import("./ipc").ProjectMemoryMutation, { ok: true }>;

/**
 * Save one entry, then its MEMORY.md line. `baseRevision`: the revision the edit started from (null = create only), so a
 * change made meanwhile (an agent writing the same file) comes back as `revision_conflict` instead of being overwritten.
 * The index is written separately (`updateIndex: false`, then MEMORY.md with its own revision) so the owner's titles
 * survive. It is reconciled against a fresh read, never the page's snapshot: the line is (re)added when it is missing
 * there (e.g. after "save mine" recreated a deleted memory), and nothing is written when the entry is gone or was
 * rewritten by someone else after our write. A concurrent index change is retried once.
 * Window left: a delete landing between the fresh read and the index write (cutex proposal: an atomic entry + line write).
 */
export async function saveMemoryEntry(
  api: MemoryApi,
  projectId: string,
  input: { file: string; draft: MemoryDraft; baseRevision: string | null; prev: { name: string; description: string } | null },
): Promise<MemorySaveResult> {
  const content = serializeMemory(input.draft);
  const written = await api.projectMemoryWrite(projectId, input.file, content, input.baseRevision, false);
  if (!written.ok) return written;
  const next = { name: input.draft.name, description: input.draft.description };
  const failed = (message: string) => ({ ok: true as const, revision: written.revision, indexError: message });
  for (let attempt = 0; ; attempt++) {
    const fresh = await api.projectMemory(projectId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (!fresh || fresh instanceof Error) return failed(fresh?.message ?? "project memory unavailable");
    const entry = fresh.entries.find((e) => e.file === input.file);
    if (!entry) return { ok: false, code: "memory_not_found", message: "memory_not_found: the memory was deleted right after it was saved" };
    if (entry.revision && written.revision && entry.revision !== written.revision)
      return { ok: false, code: "revision_conflict", currentRevision: entry.revision, message: "revision_conflict: the memory was changed right after it was saved" };
    const updated = nextMemoryIndex(fresh.index, input.file, input.prev, next);
    if (updated === null) return { ok: true, revision: written.revision, indexError: null };
    const r = await api.projectMemoryWrite(projectId, MEMORY_INDEX_FILE, updated, fresh.indexRevision ?? null, false).catch((e: unknown) => ({ ok: false as const, code: "other" as const, message: e instanceof Error ? e.message : String(e) }));
    if (r.ok) return { ok: true, revision: written.revision, indexError: null };
    if (r.code !== "revision_conflict" || attempt > 0) return failed(r.message);
  }
}
