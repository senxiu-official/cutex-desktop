// 「需要你」 strip: the owner's × on a needs-you chip. Dismissing can't resolve the need (an approval,
// an owner message, a delegation), so it only hides the chip until the need changes: the dismissal
// remembers a fingerprint of the need (reasons, count, delegation / notification ids) and a new or
// different need shows the chip again. Device-local (localStorage, best effort); sidebar badges keep
// showing the real state. Done / failed chips are dismissed by marking the turn seen (lib/turnUnread).
import { useSyncExternalStore } from "react";
import type { AttentionChip, NeedsYou } from "./agentAttention";

export interface Dismissal {
  /** The need's fingerprint when it was dismissed. */
  fp: string;
  /** When it was dismissed (ms). */
  at: number;
}

/** By host key (`hostKey(host, agentId)`). */
export type Dismissals = Readonly<Record<string, Dismissal>>;

/** Dismissals older than this go even when the agent is out of view. */
export const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000;

/** What the needs-you chip stands for; any change (new approval, message, delegation…) changes it. */
export function needFingerprint(need: NeedsYou | undefined): string {
  if (!need) return "needsInput"; // the runtime waits for input, nothing more specific known
  return JSON.stringify([[...need.reasons].sort(), need.count, need.askIds, need.notificationIds ?? []]);
}

/** Whether a needs-you chip is hidden by a dismissal (done / error chips never are: they go when seen). */
export function isDismissed(dismissals: Dismissals, key: string, chip: Pick<AttentionChip, "signal">, need: NeedsYou | undefined): boolean {
  return chip.signal === "needsYou" && dismissals[key]?.fp === needFingerprint(need);
}

/**
 * Drop stale dismissals: those of agents in view (`current`: host key → the need's fingerprint of
 * every needs-you chip; `inView`: host keys of all rows in view) whose need is gone or changed, and
 * any older than the TTL. The same object when nothing goes.
 */
export function pruneDismissals(dismissals: Dismissals, current: ReadonlyMap<string, string>, inView: ReadonlySet<string>, now: number): Dismissals {
  const stale = Object.entries(dismissals).filter(([key, d]) => now - d.at > DISMISS_TTL_MS || (inView.has(key) && current.get(key) !== d.fp));
  if (stale.length === 0) return dismissals;
  const next = { ...dismissals };
  for (const [key] of stale) delete next[key];
  return next;
}

// ---------- persisted store ----------

const KEY = "cutex-desktop.needsYouDismissed";
const listeners = new Set<() => void>();
let current: Dismissals = load();

function load(): Dismissals {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<Dismissal>>;
    const out: Record<string, Dismissal> = {};
    for (const [key, d] of Object.entries(raw)) if (d && typeof d.fp === "string" && typeof d.at === "number") out[key] = { fp: d.fp, at: d.at };
    return out;
  } catch {
    return {};
  }
}

function save(next: Dismissals): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

export function getDismissals(): Dismissals {
  return current;
}

/** Hide the needs-you chip of `key` (host key) until its need changes. */
export function dismissNeed(key: string, need: NeedsYou | undefined, now = Date.now()): void {
  save({ ...current, [key]: { fp: needFingerprint(need), at: now } });
}

export function pruneStoredDismissals(currentNeeds: ReadonlyMap<string, string>, inView: ReadonlySet<string>, now = Date.now()): void {
  save(pruneDismissals(current, currentNeeds, inView, now));
}

export function useDismissals(): Dismissals {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
