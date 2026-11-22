// What came of 停止 on a Claude background subagent (state surfaces N13; Claude adapter C1 `claude/tasks/stop` answer,
// shared/ownerDispositions ClaudeTaskStopResult). `accepted` only means the request was taken — the task is not
// confirmed ended (terminalConfirmed is always false) — so the row keeps running and says 已请求停止; `refused`
// says why; `unknown` = the outcome could not be read (also every answer the bridge does not pass on: today's
// `stopClaudeTask` resolves with nothing). Kept for this app session per agent and task; the row goes when the
// task's own update says it ended.
import { useSyncExternalStore } from "react";
import type { ClaudeTaskStopResult } from "../../../shared/ownerDispositions";

export interface StopOutcome {
  outcome: ClaudeTaskStopResult["outcome"];
  reason: string | null;
}

/** The outcome of a `claude/tasks/stop` answer; anything not a well-formed answer is `unknown`. */
export function claudeStopOutcome(answer: unknown): StopOutcome {
  const a = (answer && typeof answer === "object" ? answer : {}) as Partial<ClaudeTaskStopResult>;
  const reason = typeof a.reason === "string" && a.reason.trim() ? a.reason.trim() : null;
  if (a.outcome === "accepted" || a.outcome === "refused") return { outcome: a.outcome, reason };
  return { outcome: "unknown", reason };
}

const outcomes = new Map<string, StopOutcome>();
const listeners = new Set<() => void>();
let version = 0;
const keyOf = (sessionId: string, ref: string) => `${sessionId}\n${ref}`;

export function recordStopOutcome(sessionId: string, ref: string, outcome: StopOutcome): void {
  outcomes.set(keyOf(sessionId, ref), outcome);
  version += 1;
  for (const l of listeners) l();
}

export function stopOutcomeOf(sessionId: string, ref: string): StopOutcome | null {
  return outcomes.get(keyOf(sessionId, ref)) ?? null;
}

/** Re-renders when any outcome is recorded; read rows with stopOutcomeOf. */
export function useStopOutcomes(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
