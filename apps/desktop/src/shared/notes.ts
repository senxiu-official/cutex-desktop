/** Owner notes are daemon data, never native conversation items or model memory. */
export type NoteScope = { kind: "session" | "project"; id: string } | { kind: "host" };
export interface NoteAnchor { sessionId: string; threadId?: string; turnId?: string }
export interface Note {
  id: string;
  title: string;
  body: string;
  scope: NoteScope;
  /** Explicit findability markers; removing one never removes natural scope membership. */
  pins: NoteScope[];
  anchor: NoteAnchor | null;
  anchorState: "ok" | "reverted" | "sessionDeleted";
  anchorStateAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface NotesQuery {
  scope?: "session" | "project" | "host";
  id?: string;
  pinnedOnly?: boolean;
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface NotesResult { notes: Note[]; nextCursor: string | null }
export interface NoteCreate {
  clientNonce: string;
  title: string;
  body: string;
  scope: NoteScope;
  pins?: NoteScope[];
  anchor?: NoteAnchor | null;
}
export interface NoteUpdate { expectedRevision: number; title?: string; body?: string; pins?: NoteScope[] }

export const NOTES_CAPABILITY = "notes";
export const NOTE_CHANGED_EVENT = "cutex/note/changed";
export const NOTE_TITLE_LIMIT = 200;
export const NOTE_BODY_LIMIT = 64_000;
