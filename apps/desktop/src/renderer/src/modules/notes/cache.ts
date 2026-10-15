import type { Note, NoteCreate, NotesQuery, NoteUpdate } from "../../../../shared/notes";

export interface NotesClient {
  notesList(query?: NotesQuery): Promise<{ notes: Note[]; nextCursor: string | null }>;
  notesGet(id: string): Promise<Note>;
  notesCreate(input: NoteCreate): Promise<Note>;
  notesUpdate(id: string, patch: NoteUpdate): Promise<Note>;
  notesDelete(id: string, expectedRevision: number): Promise<{ deleted: true }>;
}
export interface NotesResult { notes: Note[]; nextCursor: string | null; loading: boolean; loaded: boolean; error: string | null }
export interface NoteResult { note: Note | null; loading: boolean; loaded: boolean; error: string | null }
export const EMPTY_RESULT: NotesResult = { notes: [], nextCursor: null, loading: false, loaded: false, error: null };
export const EMPTY_NOTE: NoteResult = { note: null, loading: false, loaded: false, error: null };
export const notesQueryKey = (host: string, q: NotesQuery, all: boolean): string => JSON.stringify([host, q.scope ?? "host", q.id ?? null, !!q.pinnedOnly, q.query ?? "", all]);
type Entry = { host: string; query?: NotesQuery; noteId?: string; all: boolean; value: NotesResult & NoteResult; listeners: Set<() => void>; request: Promise<void> | null; generation: number; again: boolean };

/** Each request is bound to the referenced host, not whichever host has focus when it resolves. */
export function createNotesCache(clientFor: (hostId: string) => NotesClient) {
  const entries = new Map<string, Entry>();
  function entry(host: string, query: NotesQuery, all = false, noteId?: string): Entry {
    const key = noteId ? JSON.stringify([host, "note", noteId]) : notesQueryKey(host, query, all);
    let e = entries.get(key);
    if (!e) {
      if (entries.size >= 128) for (const [key, old] of entries) { if (!old.listeners.size && !old.request) entries.delete(key); if (entries.size < 96) break; }
      e = { host, query, noteId, all, value: { ...EMPTY_RESULT, ...EMPTY_NOTE }, listeners: new Set(), request: null, generation: 0, again: false };
      entries.set(key, e);
    }
    return e;
  }
  function publish(e: Entry, patch: Partial<Entry["value"]>) { e.value = { ...e.value, ...patch }; for (const fn of e.listeners) fn(); }
  function fetch(e: Entry, more = false): Promise<void> {
    if (more && !e.value.nextCursor) return Promise.resolve();
    if (e.request) { if (!more) e.again = true; return e.request; }
    e.again = false;
    const generation = e.generation;
    publish(e, { loading: true, error: null });
    e.request = Promise.resolve().then(async () => {
      try {
        const client = clientFor(e.host);
        if (e.noteId) {
          const note = await client.notesGet(e.noteId);
          if (generation === e.generation) publish(e, { note, loaded: true, error: null });
        } else {
          let cursor = more ? e.value.nextCursor : null;
          const notes = more ? [...e.value.notes] : [];
          const seen = new Set<string>();
          do {
            if (generation !== e.generation) return;
            const page = await client.notesList({ ...e.query, limit: 100, ...(cursor ? { cursor } : {}) });
            notes.push(...page.notes);
            cursor = page.nextCursor;
            if (cursor && seen.has(cursor)) throw new Error("Notes pagination returned a repeated cursor");
            if (cursor) seen.add(cursor);
          } while (e.all && cursor);
          if (generation === e.generation) publish(e, { notes: [...new Map(notes.map((n) => [n.id, n])).values()], nextCursor: cursor, loaded: true, error: null });
        }
      } catch (error) {
        if (generation === e.generation) publish(e, { error: error instanceof Error ? error.message : String(error), ...(e.noteId ? { note: null } : {}) });
      } finally {
        e.request = null;
        publish(e, { loading: false });
        if (e.again && e.listeners.size) void fetch(e);
      }
    });
    return e.request;
  }
  function subscribe(e: Entry, fn: () => void) { const first = !e.listeners.size; e.listeners.add(fn); if (first) void fetch(e); return () => { e.listeners.delete(fn); }; }
  function invalidate(host: string, noteId?: string, deleted = false) {
    for (const e of entries.values()) {
      if (e.host !== host || (noteId && e.noteId && e.noteId !== noteId)) continue;
      e.generation++;
      if (deleted && e.noteId) publish(e, { note: null });
      if (e.listeners.size) void fetch(e);
    }
  }
  return {
    get: (host: string, query: NotesQuery, all = false): NotesResult => entry(host, query, all).value,
    getNote: (host: string, noteId: string): NoteResult => entry(host, {}, false, noteId).value,
    subscribe: (host: string, query: NotesQuery, all: boolean, fn: () => void) => subscribe(entry(host, query, all), fn),
    subscribeNote: (host: string, noteId: string, fn: () => void) => subscribe(entry(host, {}, false, noteId), fn),
    refresh: (host: string, query: NotesQuery, all = false) => fetch(entry(host, query, all)),
    refreshNote: (host: string, noteId: string) => fetch(entry(host, {}, false, noteId)),
    loadMore: (host: string, query: NotesQuery) => fetch(entry(host, query), true),
    invalidate,
    async create(host: string, input: NoteCreate) { const note = await clientFor(host).notesCreate(input); invalidate(host); return note; },
    async update(host: string, id: string, patch: NoteUpdate) { try { return await clientFor(host).notesUpdate(id, patch); } finally { invalidate(host, id); } },
    async remove(host: string, note: Note) { try { await clientFor(host).notesDelete(note.id, note.revision); invalidate(host, note.id, true); } catch (e) { invalidate(host, note.id); throw e; } },
  };
}
