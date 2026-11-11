// The countdown of a wake waiting on a busy agent (owner 2026-11-10: bring it back). cutex holds a wake (or delegation
// results) for a busy recipient until the running turn ends, at most `agentBus.wakeBusyWaitSecs`; from then on it
// is read at the agent's next read point inside the turn (Codex: its next input read; Claude: its next tool call),
// else when the turn ends. The time is never forced: 0 means "may be read from now on", not "inserted".
// The deadline is the server's, from the first source present (wakeSourceOf):
//   1. the ledger record's `wakeSchedule` (its capability decides, not the runtime rule below);
//   2. the admission ride-along of the same id (a bus record's `inputId` is its message id): `nextStepAt` =
//      cutex bus_admission_timing, queued + wait after its own after-turn / approval rules; it does not check the
//      recipient, so the runtime rule below takes the countdown away where cutex cannot read early;
//   3. neither: no countdown, the row keeps its after-turn wording.
// The desktop never adds the wait to the queued time itself. Pure (unit-tested).
import type { AdmissionHeld, AdmissionNextStep, InputWakeSchedule } from "@cutex-desktop/protocol";
import type { AgentRuntime } from "./agentFeatures";

/**
 * Whether a busy agent on `runtime` can read a wake before its turn ends (cutex `soon` delivery):
 * - Codex: yes.
 * - Claude: when its adapter serves native external input (`features.externalInput`). cutex starts every Claude
 *   adapter with `--backend subscription` (also for API-account profiles), and that backend offers `soon`;
 *   adapters without native external input (older claude-rNN, or no features map) read wakes after the turn.
 * - DSH / Kimi (ACP): no, after the turn.
 */
export function readsEarly(runtime: AgentRuntime, features: Readonly<Record<string, unknown>> | null): boolean {
  if (runtime === "codex") return true;
  if (runtime === "claude") return features?.externalInput === true;
  return false;
}

/** What the row shows: counting down to the deadline, or past it (waiting for the next read point). */
export type WakeSchedule = { kind: "countdown"; secs: number; left: number } | { kind: "readPoint" };

/**
 * The schedule of a waiting wake from its admission ride-along: null without one, when the runtime can't read
 * early, or when cutex gives no deadline (never early / always after the turn: alarms, `wakeBusyWaitSecs` null).
 * `secs` rounds up (the last second shows 1, not 0); `left` is the share of the wait still to go (1 → 0).
 */
export function wakeScheduleOf(item: Pick<AdmissionNextStep, "timing" | "nextStepAt" | "enqueuedAt"> | null | undefined, now: number, early: boolean): WakeSchedule | null {
  if (!item || !early) return null;
  if (item.timing === "nextStep") return { kind: "readPoint" };
  const deadline = item.nextStepAt ? Date.parse(item.nextStepAt) : NaN;
  if (!Number.isFinite(deadline)) return null;
  const rest = deadline - now;
  if (rest <= 0) return { kind: "readPoint" };
  const start = Date.parse(item.enqueuedAt);
  const total = Number.isFinite(start) && deadline > start ? deadline - start : rest;
  return { kind: "countdown", secs: Math.ceil(rest / 1000), left: Math.max(0, Math.min(1, rest / total)) };
}

/** What the countdown reads, normalised from either source. `held`: an owner stop / 暂停委托 holds it. */
export interface WakeSource {
  item: Pick<AdmissionNextStep, "timing" | "nextStepAt" | "enqueuedAt">;
  early: boolean;
  held?: AdmissionHeld | (string & {});
  /** cutex waits only for the native receipt (it was read). */
  read: boolean;
}

/** The record's own `wakeSchedule` first, else the admission ride-along (with the runtime rule), else null. */
export function wakeSourceOf(record: { wakeSchedule?: InputWakeSchedule; createdAt: string }, ride: AdmissionNextStep | null | undefined, runtimeEarly: boolean, ridealongsHeld?: AdmissionHeld): WakeSource | null {
  const ws = record.wakeSchedule;
  if (ws) {
    const deadline = ws.nextStepAt ? Date.parse(ws.nextStepAt) : NaN;
    // The ring's full length is the wait itself when cutex gives it; else from the record's creation.
    const start = Number.isFinite(deadline) && typeof ws.waitSecs === "number" && ws.waitSecs > 0 ? new Date(deadline - ws.waitSecs * 1000).toISOString() : record.createdAt;
    const timing = ws.timing === "nextStep" ? "nextStep" : "afterTurn";
    return { item: { timing, nextStepAt: ws.nextStepAt, enqueuedAt: start }, early: ws.capability === "soon", held: ws.held || undefined, read: false };
  }
  if (!ride) return null;
  return { item: ride, early: runtimeEarly, held: ride.held ?? ridealongsHeld, read: ride.waitReason === "nativeReceipt" };
}

/** 105 → "1:45", 45 → "0:45", 3725 → "62:05" (minutes : seconds). */
export function minSec(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
