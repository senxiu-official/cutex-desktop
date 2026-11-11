// cutex `wake-busy-wait` (r220): a wake (or delegation results) for a busy Codex agent waits up to
// `/v2/settings` agentBus.wakeBusyWaitSecs (default 120) for the running turn to end, then is read
// at the agent's next step (no turn of its own). 0 = next step at once; null = never early (wait
// for the turn to end, the old behaviour). Which runtimes can read early: lib/wakeCountdown readsEarly (Codex;
// Claude with native external input; not DSH / Kimi).
// Pure (no React, no store) so it is unit-tested; the cached settings hook is wakeBusyWaitView.ts.
import type { AgentRuntime } from "./agentFeatures";
import { readsEarly } from "./wakeCountdown";
import type { GlobalSettings } from "../../../shared/ipc";

export const WAKE_BUSY_WAIT_FEATURE = "wake-busy-wait";
export const DEFAULT_WAKE_BUSY_WAIT_SECS = 120;
export const WAKE_BUSY_WAIT_RANGE: readonly [number, number] = [0, 86_400];

/** The wait in seconds; null = never early; undefined = unknown (older cutex / not loaded). */
export type WakeBusyWait = number | null | undefined;

/** `agentBus.wakeBusyWaitSecs` of a `/v2/settings` view (a negative stored value means never early). */
export function readWakeBusyWait(settings: Pick<GlobalSettings, "agentBus"> | null | undefined): WakeBusyWait {
  const agentBus = settings?.agentBus;
  if (!agentBus || !("wakeBusyWaitSecs" in agentBus)) return undefined;
  const secs = agentBus.wakeBusyWaitSecs;
  if (secs === null) return null;
  return typeof secs === "number" && Number.isFinite(secs) ? (secs < 0 ? null : secs) : undefined;
}

/** What the 待读留言 row says for a wake while its recipient is busy. */
export type PendingWakeLabel = { key: "afterTurn" } | { key: "nextStep" } | { key: "busyWait"; secs: number };

/**
 * The label for a pending wake to a busy agent: the old 本轮结束后处理 without the capability, for a runtime
 * that reads only after the turn (`features`: the agent's adapter feature map, lib/agentFeatures), while the
 * setting is unknown and when it is never early (null); else the wait.
 */
export function pendingWakeLabel(supported: boolean, runtime: AgentRuntime, wait: WakeBusyWait, features: Readonly<Record<string, unknown>> | null = null): PendingWakeLabel {
  if (!supported || !readsEarly(runtime, features) || wait === null || wait === undefined) return { key: "afterTurn" };
  if (wait <= 0) return { key: "nextStep" };
  return { key: "busyWait", secs: Math.round(wait) };
}

/** The 唤醒 tooltip as a catalog key (+ the `{n}` seconds where it has one). */
export interface WakeHint {
  key: "agentMsg.kind.wakeHint" | "agentMsg.pending.busyWaitHint" | "agentMsg.pending.nextStepHint";
  n?: number;
}

/**
 * The 唤醒 tooltip for a label: the capability-aware wording (the wait, or the next step at once), the
 * old after-turn hint `agentMsg.kind.wakeHint` for `afterTurn`. Shared by the 待读留言 row and the
 * timeline bus-message rows, so both always say the same.
 */
export function wakeHintOf(label: PendingWakeLabel): WakeHint {
  if (label.key === "busyWait") return { key: "agentMsg.pending.busyWaitHint", n: label.secs };
  if (label.key === "nextStep") return { key: "agentMsg.pending.nextStepHint" };
  return { key: "agentMsg.kind.wakeHint" };
}
