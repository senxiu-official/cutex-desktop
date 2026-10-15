import { useCallback, useSyncExternalStore } from "react";
import { create } from "zustand";
import { NOTE_CHANGED_EVENT, type NoteAnchor, type NoteScope, type NotesQuery } from "../../../../shared/notes";
import { bridge } from "../../bridge";
import { sidebarOf, useApp } from "../../store";
import { services } from "../app";
import type { AppModuleContext, CutexRef } from "../slots";
import { createNotesCache, notesQueryKey } from "./cache";
import { openTurnNotes } from "./floating";
import { useModulePref } from "../react";

export const notesCache = createNotesCache((hostId) => services.daemonFor(hostId));
export function startNotesSync(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    if (envelope.cutex?.method !== NOTE_CHANGED_EVENT) return;
    const p = envelope.cutex.params as { noteId?: unknown; change?: unknown } | undefined;
    notesCache.invalidate(hostId, typeof p?.noteId === "string" ? p.noteId : undefined, p?.change === "deleted");
  });
  ctx.signal.addEventListener("abort", () => off?.(), { once: true });
}
const noop = () => () => {};
export function useNotesQuery(hostId: string, query: NotesQuery, all = false, visible = true) {
  const key = notesQueryKey(hostId, query, all);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- normalized query identity
  const subscribe = useCallback((fn: () => void) => notesCache.subscribe(hostId, query, all, fn), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- normalized query identity
  const snapshot = useCallback(() => notesCache.get(hostId, query, all), [key]);
  return useSyncExternalStore(visible ? subscribe : noop, snapshot);
}
export function useNote(hostId: string, noteId: string, visible = true) {
  const subscribe = useCallback((fn: () => void) => notesCache.subscribeNote(hostId, noteId, fn), [hostId, noteId]);
  const snapshot = useCallback(() => notesCache.getNote(hostId, noteId), [hostId, noteId]);
  return useSyncExternalStore(visible ? subscribe : noop, snapshot);
}
export function useHostSidebar(hostId: string) { return useApp((s) => sidebarOf(s, hostId)); }
export interface NoteDraft { clientNonce: string; title: string; body: string; scope: NoteScope; pins: NoteScope[]; anchor: NoteAnchor | null; noteId?: string; revision?: number }
export const useNoteDrafts = create<{ drafts: Record<string, NoteDraft> }>(() => ({ drafts: {} }));
export const turnDraftKey = (host: string, session: string, turn: string): string => JSON.stringify([host, "turn", session, turn]);
export function setNoteDraft(key: string, draft: NoteDraft | null): void { useNoteDrafts.setState((s) => { const drafts = { ...s.drafts }; if (draft) drafts[key] = draft; else delete drafts[key]; return { drafts }; }); }
export function patchNoteDraft(key: string, patch: Partial<NoteDraft>): void { const d = useNoteDrafts.getState().drafts[key]; if (d) setNoteDraft(key, { ...d, ...patch }); }
export function newDraft(scope: NoteScope, anchor: NoteAnchor | null = null): NoteDraft { return { clientNonce: crypto.randomUUID(), title: "", body: "", scope, pins: [], anchor }; }
export function draftFromTurn(ref: CutexRef): void {
  const parsed = services.refs.parse(ref);
  if (parsed?.kind !== "turn" || !parsed.params.sessionId || !parsed.params.turnId) return;
  const { sessionId, turnId, threadId } = parsed.params;
  const key = turnDraftKey(parsed.hostId, sessionId, turnId);
  if (!useNoteDrafts.getState().drafts[key]) setNoteDraft(key, newDraft({ kind: "session", id: sessionId }, { sessionId, turnId, ...(threadId ? { threadId } : {}) }));
  openTurnNotes(parsed.hostId, sessionId, turnId, true);
}
/** `ref.action` live state: the turn already has notes → a filled icon (shown only with the timeline entry on). */
export function useTurnNotesState(ref: CutexRef): { active: boolean; titleKey: "notes.addAnother" } | null {
  const [show] = useModulePref("notes", "showTimeline", true);
  const { sessionId, turnId } = ref.params;
  const result = useNotesQuery(ref.hostId, { scope: "session", id: sessionId ?? "" }, true, show && ref.kind === "turn" && !!sessionId);
  const has = show && !!sessionId && result.notes.some((n) => n.anchor?.sessionId === sessionId && n.anchor.turnId === turnId);
  return has ? { active: true, titleKey: "notes.addAnother" } : null;
}
