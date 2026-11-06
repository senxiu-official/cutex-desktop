// Device-local visibility of the header notice, independent of the durable failure/history.
import { useSyncExternalStore } from "react";
import type { TimelineState } from "./timeline";
import type { LastTurnError } from "./turnErrorSurface";

/** History is ordered oldest first; timestamps also work when the failed turn is on an older page. */
export function laterTurnStarted(error: LastTurnError, timeline: Pick<TimelineState, "turns" | "activeTurnId"> | undefined, runtimeActiveTurnId?: string | null): boolean {
  const turns = timeline?.turns ?? [];
  const failedIndex = turns.findIndex(turn => turn.id === error.turnId);
  if (failedIndex >= 0 && failedIndex < turns.length - 1) return true;
  const failedAt = error.at ? Date.parse(error.at) : NaN;
  if (Number.isFinite(failedAt) && turns.some(turn => turn.id !== error.turnId && turn.startedAt != null && turn.startedAt * 1000 > failedAt)) return true;
  const activeId = runtimeActiveTurnId ?? timeline?.activeTurnId;
  if (!activeId || activeId === error.turnId) return false;
  const active = turns.find(turn => turn.id === activeId);
  // An older active snapshot must not swallow a freshly reported failure.
  if (failedIndex >= 0 && active) return false;
  if (active && !runtimeActiveTurnId && (active.startedAt == null || !Number.isFinite(failedAt))) return false;
  return !active || active.startedAt == null || !Number.isFinite(failedAt) || active.startedAt * 1000 > failedAt;
}

const PREFIX = "cutex-desktop.turnErrorBanner.hidden:";
const listeners = new Set<() => void>();
const memory = new Set<string>();
const keyOf = (hostId: string, sessionId: string, turnId: string) => PREFIX + JSON.stringify([hostId, sessionId, turnId]);
const notify = () => { for (const listener of listeners) listener(); };
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another window hid a banner or settled a badge.
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(PREFIX) || event.key.startsWith(SETTLED)) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

/** A different failed turn has its own key, so a new failure always gets a fresh banner. */
export function dismissTurnErrorBanner(hostId: string, sessionId: string, turnId: string): void {
  const key = keyOf(hostId, sessionId, turnId);
  try { localStorage.setItem(key, "1"); } catch { memory.add(key); }
  notify();
}

export function useTurnErrorBannerDismissed(hostId: string, sessionId: string, turnId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => {
    if (!turnId) return false;
    const key = keyOf(hostId, sessionId, turnId);
    try { return localStorage.getItem(key) === "1" || memory.has(key); } catch { return memory.has(key); }
  });
}

// The agent list's error badge (owner decision 2026-11-05): a failed turn needs a look only until the agent
// moved on. Once a later turn started or the agent was opened, its badge stays gone (also after that later
// turn ends without clearing cutex's lastTurnError); a later failure has another turn id and shows again.
// One entry per host + agent (the failed turn it settled), shared by every window through localStorage.
const SETTLED = "cutex-desktop.turnErrorBadge.settled:";
const settledMemory = new Map<string, string>();
const settledKey = (hostId: string, sessionId: string) => SETTLED + JSON.stringify([hostId, sessionId]);
function settledTurn(hostId: string, sessionId: string): string | null {
  const key = settledKey(hostId, sessionId);
  try { return localStorage.getItem(key) ?? settledMemory.get(key) ?? null; } catch { return settledMemory.get(key) ?? null; }
}

/** The failed turn `turnId` of this agent no longer needs a badge (opened, or a later turn started). */
export function settleTurnErrorBadge(hostId: string, sessionId: string, turnId: string): void {
  if (settledTurn(hostId, sessionId) === turnId) return;
  const key = settledKey(hostId, sessionId);
  try { localStorage.setItem(key, turnId); } catch { settledMemory.set(key, turnId); }
  notify();
}

export function useTurnErrorBadgeSettled(hostId: string, sessionId: string, turnId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => !!turnId && settledTurn(hostId, sessionId) === turnId);
}
