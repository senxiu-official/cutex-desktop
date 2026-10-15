import { create } from "zustand";

export interface NoteFloat {
  id: string; hostId: string; sessionId: string; turnId: string; editing: boolean;
  /** Ephemeral focus/position only, never persisted in notes or layout. */
  trigger: HTMLElement | null;
}
export const useNoteFloat = create<{ active: NoteFloat | null }>(() => ({ active: null }));
export function openTurnNotes(hostId: string, sessionId: string, turnId: string, editing = false, trigger?: HTMLElement | null) {
  const focused = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useNoteFloat.setState({ active: { id: crypto.randomUUID(), hostId, sessionId, turnId, editing, trigger: trigger ?? focused } });
}
export function closeTurnNotes(id: string) {
  if (useNoteFloat.getState().active?.id === id) useNoteFloat.setState({ active: null });
}
export function finishTurnNote(id: string) {
  const active = useNoteFloat.getState().active;
  if (active?.id === id) useNoteFloat.setState({ active: { ...active, editing: false } });
}
/** A turn's first row is marked; its remaining rows end just before the next marker. */
export function noteTurnRange(markers: readonly (string | null)[], turnId: string) {
  const start = markers.indexOf(turnId);
  if (start < 0) return null;
  const next = markers.findIndex((id, i) => i > start && !!id);
  return { start, end: (next < 0 ? markers.length : next) - 1, next: next < 0 ? null : next };
}

export interface NoteFloatBounds { left: number; right: number; top: number; bottom: number }
/** Bottom-anchored: content growth goes up, never into the next turn or a side panel. */
export function noteFloatPosition(viewport: { width: number; height: number }, bounds: NoteFloatBounds, anchor: { right: number; bottom: number }) {
  const gap = 8;
  const leftEdge = Math.max(gap, bounds.left + gap), rightEdge = Math.min(viewport.width - gap, bounds.right - gap);
  const topEdge = Math.max(gap, bounds.top + gap), bottomEdge = Math.min(viewport.height - gap, bounds.bottom);
  const bottom = anchor.bottom - gap;
  if (bottom <= topEdge + 48 || anchor.bottom > bottomEdge || rightEdge <= leftEdge) return null;
  const width = Math.min(480, rightEdge - leftEdge);
  return { width, maxHeight: Math.min(640, bottom - topEdge), left: Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width)), bottom: viewport.height - bottom };
}
