// Desktop-local default for the Director rotation dialog (Settings → 协作 → 轮换{{director}}):
// how long cutex waits for the handoff note. The dialog can override it per rotation.
import { useSyncExternalStore } from "react";

export const HANDOFF_MINUTE_CHOICES = [1, 5, 10, 20, 30, 60, 120, 240] as const;
export const DEFAULT_HANDOFF_MINUTES = 10;

const KEY = "cutex-desktop.ownerRotation";
const listeners = new Set<() => void>();

function load(): number {
  try {
    const stored = (JSON.parse(localStorage.getItem(KEY) ?? "{}") as { handoffMinutes?: unknown }).handoffMinutes;
    return typeof stored === "number" && (HANDOFF_MINUTE_CHOICES as readonly number[]).includes(stored) ? stored : DEFAULT_HANDOFF_MINUTES;
  } catch {
    return DEFAULT_HANDOFF_MINUTES;
  }
}

let current = load();

export function setHandoffMinutes(minutes: number): void {
  current = minutes;
  try {
    localStorage.setItem(KEY, JSON.stringify({ handoffMinutes: minutes }));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

export function useHandoffMinutes(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
