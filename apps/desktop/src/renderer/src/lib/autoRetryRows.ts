import type { ExternalMessage, TimelineEntry, TurnView } from "./timeline";

export interface AutomaticRetryLink {
  failedTurnId: string;
  planId: string;
  attempt: number;
  maxAttempts: number;
}

/** Exact daemon view and service identity; ordinary Continue text is never hidden. */
export function automaticRetryLink(message: ExternalMessage): AutomaticRetryLink | null {
  if (message.schema !== "cutex.model-overload-retry.v1" ||
    message.sourceKind !== "service" || message.senderId !== "cutex-model-overload-retry" ||
    message.eventType !== "model_overload_continue") return null;
  const { failedTurnId, planId, attempt, maxAttempts } = message.data;
  if (typeof failedTurnId !== "string" || !failedTurnId || typeof planId !== "string" || !planId ||
    !Number.isInteger(attempt) || !Number.isInteger(maxAttempts) || maxAttempts !== 3 ||
    (attempt as number) < 1 || (attempt as number) > maxAttempts) return null;
  return { failedTurnId, planId, attempt: attempt as number, maxAttempts };
}

/** Fold only when the destination error card is in the visible history window. */
export function foldAutomaticRetryRows(entries: TimelineEntry[], turns: readonly TurnView[], enabled: boolean) {
  const retried = new Map<string, AutomaticRetryLink>();
  const folded = new Set<string>();
  if (!enabled) return { entries, retried, folded };
  const visible = new Set(entries.map((entry) => entry.turnId));
  const errors = new Set(turns.filter((turn) => visible.has(turn.id) && turn.status === "failed" && turn.error).map((turn) => turn.id));
  for (const entry of entries) {
    const link = entry.kind === "received" ? automaticRetryLink(entry.message) : null;
    if (!link || !errors.has(link.failedTurnId)) continue;
    const previous = retried.get(link.failedTurnId);
    if (!previous || previous.attempt < link.attempt) retried.set(link.failedTurnId, link);
    folded.add(entry.id);
  }
  // Preserve segment anchors: a retry may fail before any output, leaving only its
  // input entry. Removing it would also remove that turn's error and next retry badge.
  return { entries, retried, folded };
}
