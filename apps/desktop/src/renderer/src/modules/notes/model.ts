import type { Note, NoteScope } from "../../../../shared/notes";
import { agentRef, turnRef } from "../../lib/refs";
import type { CutexRef } from "../slots";

export const LIST = "notes.list";
export const NOTE = "notes.note";
export type ListState = { sessionId?: string; projectId?: string; scope?: "session" | "project" | "host"; query?: string; pinnedOnly?: boolean };
export type NoteState = { noteId: string; title?: string; snippet?: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

export function parseList(raw: unknown): ListState | null {
  if (!record(raw)) return null;
  return {
    ...(id(raw.sessionId) ? { sessionId: raw.sessionId } : {}),
    ...(id(raw.projectId) ? { projectId: raw.projectId } : {}),
    ...(raw.scope === "session" || raw.scope === "project" || raw.scope === "host" ? { scope: raw.scope } : {}),
    ...(typeof raw.query === "string" ? { query: raw.query.slice(0, 500) } : {}),
    ...(typeof raw.pinnedOnly === "boolean" ? { pinnedOnly: raw.pinnedOnly } : {}),
  };
}
export function parseNote(raw: unknown): NoteState | null {
  return record(raw) && id(raw.noteId) ? { noteId: raw.noteId, ...(typeof raw.title === "string" ? { title: raw.title.slice(0, 200) } : {}), ...(typeof raw.snippet === "string" ? { snippet: raw.snippet.slice(0, 500) } : {}) } : null;
}
export function sameScope(a: NoteScope, b: NoteScope): boolean { return a.kind === b.kind && (a.kind === "host" || (b.kind !== "host" && a.id === b.id)); }
export const hasPin = (pins: readonly NoteScope[], scope: NoteScope): boolean => pins.some((pin) => sameScope(pin, scope));
export const togglePin = (pins: readonly NoteScope[], scope: NoteScope): NoteScope[] => hasPin(pins, scope) ? pins.filter((pin) => !sameScope(pin, scope)) : [...pins, scope];
export const scopeKey = (scope: NoteScope): string => scope.kind === "host" ? "host" : `${scope.kind}:${scope.id}`;

/** Daemon lifecycle evidence wins; an unloaded/partial local history is never proof of deletion. */
export function anchorStatus(note: Pick<Note, "anchor" | "anchorState">, history?: { loading: boolean; error: string | null; older: unknown; timeline: { threadId: string | null; turns: readonly { id: string }[] } }): "none" | "unknown" | "available" | "reverted" | "sessionDeleted" {
  if (note.anchorState !== "ok") return note.anchorState;
  const anchor = note.anchor;
  if (!anchor?.turnId) return "none";
  if (!history || history.loading || history.error) return "unknown";
  if (anchor.threadId && history.timeline.threadId && anchor.threadId !== history.timeline.threadId) return "reverted";
  if (history.timeline.turns.some((turn) => turn.id === anchor.turnId)) return "available";
  return history.older ? "unknown" : "reverted";
}
export function sourceRef(hostId: string, note: Note, name?: string): CutexRef | null {
  const sessionId = note.anchor?.sessionId ?? (note.scope.kind === "session" ? note.scope.id : null);
  if (!sessionId) return null;
  return note.anchor?.turnId ? turnRef({ hostId, sessionId, turnId: note.anchor.turnId, threadId: note.anchor.threadId, agentName: name ?? sessionId }) : agentRef(hostId, sessionId, name ?? sessionId);
}
export const noteRef = (hostId: string, note: Note): CutexRef => ({ hostId, kind: NOTE, key: note.id, title: note.title, params: { noteId: note.id }, snapshot: { at: note.updatedAt, snippet: note.body.slice(0, 500) } });
/** Explicit owner action only: append this to a draft, never send it. */
export function noteQuote(note: Pick<Note, "title" | "body">): string { return [note.title.trim(), note.body.trim()].filter(Boolean).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n"); }
