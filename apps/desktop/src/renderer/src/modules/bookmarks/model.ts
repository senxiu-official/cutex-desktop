import type { CutexRef } from "../slots";

export const BOOKMARK_LIMIT = 500;
export const BOOKMARK_BYTES = 1_500_000;
export const BOOKMARKS = "bookmarks.list";
/** Automatic location is context only; projectExplicit is a separate owner choice. */
export interface BookmarkScope { sessionId?: string; projectId?: string; projectExplicit?: boolean }
export interface BookmarkRecord { id: string; createdAt: string; ref: CutexRef; note?: string; scope?: BookmarkScope }
export interface BookmarkDocument { version: 3; records: BookmarkRecord[] }
export const EMPTY_BOOKMARKS: BookmarkDocument = { version: 3, records: [] };
export type BookmarkProblem = "invalid-ref" | "invalid-storage" | "storage-full" | "storage-failed" | "module-off";
export class BookmarkError extends Error { constructor(readonly code: BookmarkProblem) { super(code); } }
export type RefParser = (raw: unknown) => CutexRef | null;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, limit: number): v is string => typeof v === "string" && !!v.trim() && v.length <= limit && !v.includes("\0");
const date = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
export function checkedScope(raw: unknown): BookmarkScope {
  if (!object(raw) || (raw.sessionId !== undefined && !text(raw.sessionId, 200)) || (raw.projectId !== undefined && !text(raw.projectId, 200)) || (raw.projectExplicit !== undefined && typeof raw.projectExplicit !== "boolean") || (raw.projectExplicit === true && !raw.projectId)) throw new BookmarkError("invalid-storage");
  return { ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}), ...(typeof raw.projectId === "string" ? { projectId: raw.projectId } : {}), projectExplicit: raw.projectExplicit === true };
}
export const refKey = (ref: CutexRef): string => JSON.stringify([ref.hostId, ref.kind, ref.key]);
export function checkedRef(raw: unknown, parse: RefParser): CutexRef {
  const ref = parse(raw);
  // The obsolete frozen-copy target is never a valid new bookmark, even if syntactically valid.
  if (!ref || ref.kind === "conversation.snapshot") throw new BookmarkError("invalid-ref");
  return ref;
}
function bounded(doc: BookmarkDocument): BookmarkDocument {
  if (doc.records.length > BOOKMARK_LIMIT || JSON.stringify(doc).length > BOOKMARK_BYTES) throw new BookmarkError("storage-full");
  return doc;
}

/** Forward-only v1 migration. Invalid input stays untouched; only known frozen copies are dropped. */
export function readBookmarks(raw: unknown, parse: RefParser): { document: BookmarkDocument; error: BookmarkProblem | null; migrated: boolean; discarded: number } {
  if (raw == null) return { document: EMPTY_BOOKMARKS, error: null, migrated: false, discarded: 0 };
  try {
    if (!object(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) || !Array.isArray(raw.records)) throw new BookmarkError("invalid-storage");
    if (raw.records.length > BOOKMARK_LIMIT || JSON.stringify(raw).length > BOOKMARK_BYTES) throw new BookmarkError("storage-full");
    const ids = new Set<string>();
    let discarded = 0;
    const records: BookmarkRecord[] = [];
    for (const value of raw.records) {
      if (!object(value) || !text(value.id, 100) || ids.has(value.id) || !date(value.createdAt)) throw new BookmarkError("invalid-storage");
      ids.add(value.id);
      let pointer: unknown = value.ref;
      if (raw.version === 1) {
        if (!text(value.hostId, 200) || !object(value.target)) throw new BookmarkError("invalid-storage");
        if (value.target.kind === "conversation.snapshot") { discarded++; continue; }
        pointer = { ...value.target, hostId: value.hostId };
      }
      const ref = checkedRef(pointer, parse);
      if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 500)) throw new BookmarkError("invalid-storage");
      // Old versions never recorded explicit project intent. Do not infer it during migration.
      const scope = raw.version === 3 && value.scope !== undefined ? checkedScope(value.scope) : undefined;
      records.push({ id: value.id, createdAt: value.createdAt, ref, ...(scope ? { scope } : {}), ...(typeof value.note === "string" ? { note: value.note } : {}) });
    }
    return { document: bounded({ version: 3, records }), error: null, migrated: raw.version !== 3, discarded };
  } catch (e) { return { document: EMPTY_BOOKMARKS, error: e instanceof BookmarkError ? e.code : "invalid-storage", migrated: false, discarded: 0 }; }
}
export function addBookmark(doc: BookmarkDocument, raw: unknown, parse: RefParser, id: string = crypto.randomUUID(), createdAt = new Date().toISOString(), scope?: BookmarkScope): BookmarkDocument {
  const ref = checkedRef(raw, parse);
  if (doc.records.some((r) => refKey(r.ref) === refKey(ref))) return doc;
  if (!text(id, 100) || !date(createdAt) || doc.records.some((r) => r.id === id)) throw new BookmarkError("invalid-ref");
  return bounded({ version: 3, records: [{ id, createdAt, ref, ...(scope ? { scope: checkedScope(scope) } : {}) }, ...doc.records] });
}
export function renameBookmark(doc: BookmarkDocument, id: string, title: string, parse: RefParser): BookmarkDocument {
  if (!text(title, 200)) throw new BookmarkError("invalid-ref");
  return bounded({ version: 3, records: doc.records.map((r) => r.id === id ? { ...r, ref: checkedRef({ ...r.ref, title: title.trim() }, parse) } : r) });
}
export function scopeBookmark(doc: BookmarkDocument, id: string, scope: BookmarkScope): BookmarkDocument {
  const checked = checkedScope(scope);
  return bounded({ ...doc, records: doc.records.map(r => r.id === id ? { ...r, scope: checked } : r) });
}
export function matchingBookmarks(doc: BookmarkDocument, query = "", hostId?: string): BookmarkRecord[] {
  const q = query.trim().toLocaleLowerCase();
  return doc.records.filter((r) => (!hostId || r.ref.hostId === hostId) && (!q || `${r.ref.title}\n${r.ref.snapshot?.snippet ?? ""}\n${r.note ?? ""}\n${r.ref.kind}`.toLocaleLowerCase().includes(q)));
}
export const belongsToSession = (r: BookmarkRecord, hostId: string, sessionId: string): boolean => r.ref.hostId === hostId && (r.scope?.sessionId ?? r.ref.params.sessionId) === sessionId;
export function homeBookmarks(records: readonly BookmarkRecord[], hostId: string, sessionId: string, projectId?: string): BookmarkRecord[] {
  return records.filter(r => r.ref.hostId === hostId && (belongsToSession(r, hostId, sessionId) || (!!projectId && r.scope?.projectExplicit === true && r.scope.projectId === projectId)));
}
export interface BookmarkGroup { key: string; hostId: string; sessionId: string | null; current: boolean; records: BookmarkRecord[] }
export function groupBookmarks(records: readonly BookmarkRecord[], hostId: string, sessionId?: string): BookmarkGroup[] {
  const groups = new Map<string, BookmarkGroup>();
  for (const r of records) {
    const session = r.scope?.sessionId ?? r.ref.params.sessionId ?? null;
    const key = JSON.stringify([r.ref.hostId, session]);
    const group = groups.get(key) ?? { key, hostId: r.ref.hostId, sessionId: session, current: !!sessionId && belongsToSession(r, hostId, sessionId), records: [] };
    group.records.push(r); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.current) - Number(a.current) || Number(b.hostId === hostId) - Number(a.hostId === hostId) || a.hostId.localeCompare(b.hostId) || (a.sessionId ?? "").localeCompare(b.sessionId ?? ""));
}
export type ListState = { query?: string; allHosts?: boolean };
export function parseList(raw: unknown): ListState | null {
  if (!object(raw)) return null;
  return { ...(typeof raw.query === "string" ? { query: raw.query.slice(0, 500) } : {}), ...(typeof raw.allHosts === "boolean" ? { allHosts: raw.allHosts } : {}) };
}
