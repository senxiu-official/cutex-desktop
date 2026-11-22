// The hover / details line of a batch member's `details.interruptBatch` (lib/inputLedger/interruptSelection): why the
// batch was not sent, or that it may already have been taken. Words only; the buttons follow the record's actions.
import type { InputRecord } from "@cutex-desktop/protocol";
import type { MessageKey } from "../../i18n";
import { batchBlocked, batchDeferred, batchRetryBlocked } from "./interruptSelection";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const HELD: Record<string, MessageKey> = { not_idle: "interruptBatch.waitBusy", pending_trigger_turn: "interruptBatch.waitBusy", plan_mode: "interruptBatch.waitPlan" };
const BLOCKED: Record<string, MessageKey> = {
  groupIncomplete: "interruptBatch.groupIncomplete",
  history_unavailable: "interruptBatch.historyUnavailable",
  recovery_required: "interruptBatch.recoveryRequired",
  hook_blocked: "interruptBatch.hookBlocked",
};

type Row = Pick<InputRecord, "kind" | "state" | "reason" | "attempt" | "details">;

/** The line for `record`: only facts the host states for its current attempt and state (an older attempt's audit mark
 *  says nothing about this one — that keeps the row's own meaning). */
export function interruptBatchLines(t: T, record: Row): string[] {
  if (batchRetryBlocked(record)) return [t("interruptBatch.retryBlocked")];
  const blocked = batchBlocked(record);
  if (blocked) return [BLOCKED[blocked.reason!] ? t(BLOCKED[blocked.reason!]!) : t("interruptBatch.notSentOther", { reason: blocked.reason! })];
  const deferred = batchDeferred(record);
  if (deferred && HELD[deferred.reason!]) return [t(HELD[deferred.reason!]!)];
  return [];
}

/** Retry on a member the host proved unsent for this attempt resends the original once (the registry's "may arrive
 *  twice" is not true there); anywhere else the registry tip stays. */
export function batchRetryTip(t: T, record: Row): string | undefined {
  return batchBlocked(record) ? t("interruptBatch.retryTip") : undefined;
}
