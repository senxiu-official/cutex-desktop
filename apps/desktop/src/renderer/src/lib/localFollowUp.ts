// 结束跟进 kept on this device only (state surfaces S12): native sub-agents and background terminals have no host record
// to settle — once their parent agent disconnects nothing can say whether they still run, so their rows read 结果未确认
// and the owner may stop waiting for them. Ending follow-up hides the row here for good (a late status or a reconnect
// does not bring it back); it stops nothing and tells the host nothing. Keys name the parent's host and agent plus the
// item (`subagentFollowUpKey`, `terminalFollowUpKey`). Device-local (localStorage, best effort). A mark never expires
// with time (an old transcript can rebuild the same item at any time); only past MAX_ENTRIES do the oldest go.
import { useSyncExternalStore } from "react";

/** The most marks kept; each names one occurrence (one thread / one process of one runtime generation). */
export const MAX_ENTRIES = 5000;

export type FollowUpEnded = Readonly<Record<string, number>>;

export const subagentFollowUpKey = (hostId: string, sessionId: string, threadId: string): string => JSON.stringify(["sub", hostId, sessionId, threadId]);
/** A terminal is one process of one runtime generation (process ids are per runtime). */
export const terminalFollowUpKey = (hostId: string, sessionId: string, generation: number, processId: string): string => JSON.stringify(["term", hostId, sessionId, generation, processId]);

/**
 * At most `max` marks; the same object when none goes. Never by age. Order is explicit: the later time first, and on
 * equal times the later write first (the record's key order is its write order: a write moves its key to the end, and
 * JSON keeps that order across restarts — keys are JSON arrays, never integer-like). Marks in `keep` (the ones written
 * by this same operation) never go.
 */
export function pruneFollowUps(ended: FollowUpEnded, max = MAX_ENTRIES, keep: readonly string[] = []): FollowUpEnded {
  const keys = Object.keys(ended);
  if (keys.length <= max) return ended;
  const writeOrder = new Map(keys.map((k, i) => [k, i]));
  const kept = new Set(keep.filter((k) => k in ended));
  const rest = keys.filter((k) => !kept.has(k)).sort((a, b) => ended[b]! - ended[a]! || writeOrder.get(b)! - writeOrder.get(a)!);
  const survivors = new Set([...kept, ...rest.slice(0, Math.max(0, max - kept.size))]);
  // Survivors keep their write order.
  return Object.fromEntries(keys.filter((k) => survivors.has(k)).map((k) => [k, ended[k]!]));
}

const STORAGE_KEY = "cutex-desktop.localFollowUpEnded";
const listeners = new Set<() => void>();
let current: FollowUpEnded = load();

function load(): FollowUpEnded {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "number") out[k] = v;
    return pruneFollowUps(out);
  } catch {
    return {};
  }
}

function save(next: FollowUpEnded): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // kept for this run only
  }
  for (const l of listeners) l();
}

/** Stop waiting for these items (keys above). */
export function endLocalFollowUp(keys: readonly string[], now = Date.now()): void {
  const next: Record<string, number> = { ...current };
  for (const k of keys) {
    // Moved to the end: the newest write on a tie.
    delete next[k];
    next[k] = now;
  }
  save(pruneFollowUps(next, MAX_ENTRIES, keys));
}

export function localFollowUpEnded(): FollowUpEnded {
  return current;
}

export function useLocalFollowUpEnded(): FollowUpEnded {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Tests only. */
export function resetLocalFollowUps(): void {
  save({});
}
