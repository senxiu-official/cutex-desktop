// The open desk windows (multi-window P1, lib/deskWindows). P3: a desk is a whole window of its own — sidebar,
// up to two conversation columns with their Shelves, a tray — with its own layout (lib/paneStore, scope
// `host:<id>/desk:<deskId>`); `content` is only what it opened with (the first conversation). Closing the desk
// window gives its conversations back to the main window as chips in the tray. Remembered per device
// (DESKS_STORAGE_KEY) so the desks come back at their last places on the next start (main remembers the bounds
// per desk id, main/windowState.ts; the layout is the desk scope's).
import { create } from "zustand";
import type { DeskBridge, DeskWindowEvent } from "../../../shared/ipc";
import { openDeskWindow, type DeskHandle } from "./deskWindows";

export const DESKS_STORAGE_KEY = "cutex-desktop.desks.v1";

/** What a desk opens with (P3: then its own layout). `probe`: the P0 check (styles, timers, focus) only. */
export type DeskContent = { kind: "conversation"; hostId: string; sessionId: string } | { kind: "probe" };

export interface DeskRecord {
  deskId: string;
  handle: DeskHandle;
  content: DeskContent;
}

interface DesksState {
  desks: DeskRecord[];
  /** The desk window that last took the focus (null: the main window). */
  focused: string | null;
}

export const useDesks = create<DesksState>(() => ({ desks: [], focused: null }));

/** Stored: the desks to reopen and the conversation each showed (its layout is stored in its scope; this seeds it when not). */
export interface StoredDesk {
  deskId: string;
  hostId: string;
  sessionId: string;
}

export function parseStoredDesks(raw: string | null): StoredDesk[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((d): d is StoredDesk => !!d && typeof d === "object" && /^d[0-9a-f]{12}$/.test((d as StoredDesk).deskId) && typeof (d as StoredDesk).hostId === "string" && typeof (d as StoredDesk).sessionId === "string")
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** The conversation a desk shows now (lib/deskSync: its focused column's), null = none (an empty desk is not reopened). */
let shownBy: (deskId: string) => { hostId: string; sessionId: string } | null = () => null;
export function setDeskShownBy(fn: typeof shownBy): void {
  shownBy = fn;
}

function persist(desks: DeskRecord[]): void {
  const stored: StoredDesk[] = desks.flatMap((d) => {
    const shown = shownBy(d.deskId) ?? (d.content.kind === "conversation" ? { hostId: d.content.hostId, sessionId: d.content.sessionId } : null);
    return shown ? [{ deskId: d.deskId, ...shown }] : [];
  });
  try {
    localStorage.setItem(DESKS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // no storage (tests): the desks are not reopened next time
  }
}

/** Store the open desks as they are now (lib/deskSync: before the main document goes away). */
export function persistDesks(): void {
  persist(useDesks.getState().desks);
}

/** The desk that opened with this agent's conversation, if any (P3: lib/windowRoute knows where it shows now). */
export function deskShowing(desks: readonly DeskRecord[], hostId: string, sessionId: string): DeskRecord | null {
  return desks.find((d) => d.content.kind === "conversation" && d.content.hostId === hostId && d.content.sessionId === sessionId) ?? null;
}

/** Open a desk window showing `content`. Null: main refused (too many desks) or no desk bridge. */
export async function openDesk(desk: DeskBridge | undefined, content: DeskContent, deskId?: string, opener: Window = window): Promise<DeskRecord | null> {
  const handle = await openDeskWindow(desk, opener, deskId);
  if (!handle) return null;
  const record: DeskRecord = { deskId: handle.deskId, handle, content };
  const desks = [...useDesks.getState().desks.filter((d) => d.deskId !== record.deskId), record];
  useDesks.setState({ desks });
  persist(desks);
  return record;
}

/**
 * A desk window went away (main's `closed`, or its document unloaded): forget it and hand back what it
 * showed (`giveBack`: the main window takes the conversation back as a chip). `quitting`: the app (or the
 * main document) is going away — the desk stays remembered for the next start.
 */
export function deskGone(deskId: string, giveBack: (content: DeskContent, deskId: string) => void, quitting = false): void {
  const record = useDesks.getState().desks.find((d) => d.deskId === deskId);
  if (!record) return;
  record.handle.dispose();
  const desks = useDesks.getState().desks.filter((d) => d.deskId !== deskId);
  useDesks.setState({ desks, focused: useDesks.getState().focused === deskId ? null : useDesks.getState().focused });
  if (quitting) return;
  persist(desks);
  giveBack(record.content, deskId);
}

/** Main's desk events: a closed window gives its content back; a focused one is the focused desk. */
export function onDeskWindowEvent(event: DeskWindowEvent, giveBack: (content: DeskContent, deskId: string) => void): void {
  if (event.kind === "closed") deskGone(event.deskId, giveBack);
  else if (event.kind === "focus") useDesks.setState({ focused: event.deskId });
}
