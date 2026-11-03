// Settings → 协作 → 高级 → 待清理, the pure parts: the shared age filter (stored on this device) and
// which open delegations count as stale. The categories' state lives in useCleanup.ts / useStuckMessages.ts,
// the section in CleanupSection.tsx.
import type { AskSummary } from "../../../../shared/ipc";
import { delegationBucket, type ContextOf } from "../../lib/delegations";
import { DEFAULT_MIN_AGE, isMinAgeChoice } from "./stuck";

/** The age filter's key (the former 卡住的消息 filter: a stored choice carries over). */
export const MIN_AGE_KEY = "cutex-desktop.stuckBusMinAge";

export function loadMinAge(): number {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MIN_AGE_KEY) ?? "null");
    return isMinAgeChoice(stored) ? stored : DEFAULT_MIN_AGE;
  } catch {
    return DEFAULT_MIN_AGE;
  }
}

export function saveMinAge(secs: number): void {
  try {
    localStorage.setItem(MIN_AGE_KEY, JSON.stringify(secs));
  } catch {
    // not persisted
  }
}

/** Seconds since `iso` (null when it does not parse). */
export function secondsSince(iso: string | null | undefined, now: number): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : null;
}

/**
 * Open delegations that are not moving: neither finished nor running normally (cutex's own status words
 * via lib/delegations — waiting, held, interrupted, awaiting a review or an acceptance, running on an
 * offline target), unchanged for at least `minAge` seconds. Oldest change first. cutex has no stale
 * marker of its own yet (backend item); this is a view over its open list, never a local close.
 */
export function staleDelegations(rows: readonly AskSummary[], minAge: number, now: number, ctxOf: ContextOf): AskSummary[] {
  return rows
    .filter((d) => {
      const bucket = delegationBucket(d, ctxOf(d));
      if (bucket === "done" || bucket === "active") return false;
      const age = secondsSince(d.updatedAt, now);
      return minAge === 0 || (age !== null && age >= minAge);
    })
    .sort((a, b) => (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0));
}
