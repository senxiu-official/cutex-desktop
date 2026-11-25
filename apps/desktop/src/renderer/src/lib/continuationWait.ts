// r290 P14 yielded wait (continuationWait): what follows the status word. Pure, so tests and the views agree.
import type { ContinuationWait } from "../../../shared/ipc";
import { formatAt } from "./time";

export type ContinuationTrailing =
  | { key: "delegation.cont.inMinutes" | "delegation.cont.inHours"; n: number }
  | { key: "delegation.cont.at"; time: string }
  | { key: "delegation.cont.overdue" | "delegation.cont.children" | "delegation.cont.jobs" };

/** Reasons a host may give for a wait that has not continued (continuationWait.blockedReason); others show none. */
export const CONTINUATION_BLOCKED_REASONS = [
  "quota", "login", "runtimeDown", "budget", "runtimeOffline", "reconnecting", "paused", "planMode", "profileSwitchPending",
  "targetBusy", "admission", "routing", "runtimeUnsupported", "reconciling",
] as const;
export type ContinuationBlockedReason = (typeof CONTINUATION_BLOCKED_REASONS)[number];

/** The message key of a known blocked reason (admission and routing share one: both wait for permission to start). */
export function blockedReasonKey(reason: string | null | undefined): `delegation.cont.blocked.${Exclude<ContinuationBlockedReason, "routing">}` | null {
  if (!reason || !(CONTINUATION_BLOCKED_REASONS as readonly string[]).includes(reason)) return null;
  return `delegation.cont.blocked.${reason === "routing" ? "admission" : (reason as Exclude<ContinuationBlockedReason, "routing">)}`;
}

/** A timed wait whose time has passed while it still waits: no turn has started (owner 2026-11-25: never 「即将」 then). */
export function continuationOverdue(cont: ContinuationWait, now: number): boolean {
  if (cont.state !== "waiting" || cont.kind === "children" || cont.kind === "jobs") return false;
  const at = cont.nextWakeAt ? Date.parse(cont.nextWakeAt) : NaN;
  return Number.isFinite(at) && at <= now;
}

/**
 * A timed wait (owner 2026-11-25): within the hour 「约 N 分钟后继续」, within 24 h 「约 N 小时后继续」, later
 * 「预计 {time} 继续」 (the exact time is on hover); once the time has passed and nothing started
 * 「已到时间，还未继续」. Event waits say what they wait for (「等待子委托完成」). Nothing for ready / limited (the word
 * says it) or a timed wait without a time.
 */
export function continuationTrailing(cont: ContinuationWait, now: number): ContinuationTrailing | null {
  if (cont.state !== "waiting") return null;
  if (cont.kind === "children") return { key: "delegation.cont.children" };
  if (cont.kind === "jobs") return { key: "delegation.cont.jobs" };
  const at = cont.nextWakeAt ? Date.parse(cont.nextWakeAt) : NaN;
  if (!Number.isFinite(at)) return null;
  if (at <= now) return { key: "delegation.cont.overdue" };
  const min = Math.ceil((at - now) / 60_000);
  if (min < 60) return { key: "delegation.cont.inMinutes", n: min };
  if (min < 24 * 60) return { key: "delegation.cont.inHours", n: Math.round(min / 60) };
  return { key: "delegation.cont.at", time: formatAt(at / 1000, now) };
}
