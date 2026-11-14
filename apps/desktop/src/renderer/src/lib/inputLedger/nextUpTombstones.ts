// Durable local "hide this row" marks for Next Up (registry 1.4 §五): 「清除此提示」 on an unrecognised status (state 14)
// and 「不再显示」 on a local pending send (O0). Local only: nothing is withdrawn or settled on the host. A mark names the
// exact thing hidden (`what`): an unknown status mark names the status and its delivery attempt, so another status or a
// new delivery of the same input brings the row back with what it says then. Written before the row goes; a failed write
// is reported, never claimed done. Marks never expire by time: one goes only when the thing it hides is gone
// (`pruneTombstones`: the host no longer has the input / the local send is gone).
import { useSyncExternalStore } from "react";

export const NEXT_UP_TOMBSTONES_KEY = "cutex-desktop.nextUp.tombstones.v1";
type Marks = Record<string, number>;
const listeners = new Set<() => void>();
let marks: Marks | null = null;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function load(target = storage()): Marks {
  if (marks) return marks;
  marks = {};
  try {
    const parsed = JSON.parse(target?.getItem(NEXT_UP_TOMBSTONES_KEY) ?? "{}") as unknown;
    if (parsed && typeof parsed === "object") for (const [key, at] of Object.entries(parsed as Record<string, unknown>))
      if (typeof at === "number") marks[key] = at;
  } catch { /* a broken value hides nothing */ }
  return marks;
}

/** `id`: the row identity (registry 1.9 `rowIdentity`: the input id, which is the host's per-occurrence id). */
export const tombstoneKey = (hostId: string, sessionId: string, id: string, what: string) => JSON.stringify([hostId, sessionId, id, what]);

/** The mark for an unrecognised status: only this exact status of this delivery attempt (`attempt`, and `since` = when it
 *  entered that status) stays hidden; ordinary updates of the same status (rev ticks) do not change it. */
export const unknownWhat = (record: { state: string; reason: string | null; stage: string | null; kind: string; attempt?: number; since?: string }) =>
  `unknown:${record.kind}:${record.state}:${record.reason ?? ""}:${record.stage ?? ""}:${record.attempt ?? ""}:${record.since ?? ""}`;
export const LOCAL_SEND_WHAT = "o0";

/** Writes the mark durably. Returns false (and changes nothing) when it cannot be stored. */
export function addTombstone(key: string, target = storage()): boolean {
  const next = { ...load(target), [key]: Date.now() };
  try {
    if (!target) return false;
    target.setItem(NEXT_UP_TOMBSTONES_KEY, JSON.stringify(next));
  } catch { return false; }
  marks = next;
  for (const listener of listeners) listener();
  return true;
}

/** The keys of every stored mark (for "which marks existed when this request started"). */
export function listTombstones(target = storage()): string[] {
  return Object.keys(load(target));
}

export function hasTombstone(key: string, target = storage()): boolean {
  return key in load(target);
}

/** Drops marks `gone(hostId, sessionId, inputId, what)` says hide nothing any more. Returns false when the write fails
 *  (the marks stay; nothing is lost). */
export function pruneTombstones(gone: (hostId: string, sessionId: string, inputId: string, what: string) => boolean, target = storage()): boolean {
  const current = load(target);
  const next: Marks = {};
  let changed = false;
  for (const [key, at] of Object.entries(current)) {
    let parts: unknown;
    try { parts = JSON.parse(key); } catch { parts = null; }
    const [hostId, sessionId, inputId, what] = Array.isArray(parts) ? parts.map(String) : [];
    if (hostId !== undefined && gone(hostId, sessionId!, inputId!, what!)) { changed = true; continue; }
    next[key] = at;
  }
  if (!changed) return true;
  try { target?.setItem(NEXT_UP_TOMBSTONES_KEY, JSON.stringify(next)); } catch { return false; }
  marks = next;
  for (const listener of listeners) listener();
  return true;
}

/** Test helper: forget the in-memory copy (the next read loads storage again). */
export function resetTombstonesForTest(): void { marks = null; }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Re-renders when marks change. */
export function useTombstones(): Marks {
  return useSyncExternalStore(subscribe, () => load(), () => load());
}
