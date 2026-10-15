// Idle agent: a ride-along item the agent picks up by itself (「马上开始」) usually starts its turn
// within a second; the queue card shows it only once it has waited STARTS_NOW_DELAY_MS, so it does
// not flash (owner 2026-10-15). One filter for everything that depends on what the card shows — the
// card's visibility, the header count, the compact chips (components/QueuePanel) and the rows
// (components/TurnQueue) — so an item still settling never yields an empty 「接下来 · 1」 card.
import { useEffect, useState } from "react";
import type { AdmissionNextStep, QueueAdmission } from "@cutex-desktop/protocol";
import { splitHeld } from "./stopHold";

export const STARTS_NOW_DELAY_MS = 2000;

type Timed = Pick<AdmissionNextStep, "id" | "enqueuedAt">;

/** First time each id was seen (module-level: survives re-mounts while the list re-renders). */
const firstSeen = new Map<string, number>();

/**
 * The ids among `items` waiting for at least `ms` at `now`: since cutex enqueued them (an item already
 * waiting when the view opened counts at once), else since first seen (recorded in `seen`). Also the
 * ms until the next one settles (null: none left). Pure apart from `seen`.
 */
export function settledIds(items: readonly Timed[], ms: number, now: number, seen: Map<string, number> = firstSeen): { settled: Set<string>; nextInMs: number | null } {
  const ids = items.map((i) => i.id);
  const live = new Set(ids);
  for (const i of items) {
    if (seen.has(i.id)) continue;
    const at = Date.parse(i.enqueuedAt ?? "");
    seen.set(i.id, Number.isFinite(at) ? Math.min(at, now) : now);
  }
  for (const id of seen.keys()) if (!live.has(id) && now - seen.get(id)! > 60_000) seen.delete(id);
  const settled = new Set(ids.filter((id) => now - seen.get(id)! >= ms));
  const wait = ids.filter((id) => !settled.has(id)).map((id) => ms - (now - seen.get(id)!));
  return { settled, nextInMs: wait.length ? Math.max(0, Math.min(...wait)) : null };
}

/**
 * The ride-along items the card shows: while a turn runs, all; idle, the held ones (a stop / pause
 * holds them: they will not start by themselves) and the free ones that have settled.
 */
export function shownNextStep(nextStep: readonly AdmissionNextStep[], running: boolean, admission: Pick<QueueAdmission, "ridealongsHeld"> | null | undefined, settled: ReadonlySet<string>): AdmissionNextStep[] {
  if (running) return nextStep as AdmissionNextStep[];
  const { free } = splitHeld(nextStep, admission);
  const freeIds = new Set(free.map((i) => i.id));
  const out = nextStep.filter((i) => !freeIds.has(i.id) || settled.has(i.id));
  return out.length === nextStep.length ? (nextStep as AdmissionNextStep[]) : out;
}

/** `shownNextStep` as a hook: re-renders when the next item settles. */
export function useShownNextStep(nextStep: readonly AdmissionNextStep[], running: boolean, admission: Pick<QueueAdmission, "ridealongsHeld"> | null | undefined): AdmissionNextStep[] {
  const [, tick] = useState(0);
  const candidates = running ? [] : splitHeld(nextStep, admission).free;
  const { settled, nextInMs } = settledIds(candidates, STARTS_NOW_DELAY_MS, Date.now());
  const key = candidates.map((i) => i.id).join("\u0000");
  useEffect(() => {
    if (nextInMs === null) return;
    const timer = setTimeout(() => tick((n) => n + 1), nextInMs + 20);
    return () => clearTimeout(timer);
  }, [nextInMs, key]);
  return shownNextStep(nextStep, running, admission, settled);
}
