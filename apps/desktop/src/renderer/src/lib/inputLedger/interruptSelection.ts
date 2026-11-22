// 打断并发送 with several 插话 (cutex interrupt-send-many-v1, r292; handoff interrupt-send-many-api-handoff v4). An
// interrupt drops every 插话 the running turn has not read yet, so the one action takes all of them along in send order:
// the host interrupts once, keeps the ones it finds read, and starts the next turn with the rest (each under its own id).
// Pure: the store sends, the composer counts.
import type { InputInterruptSendManyParams, InputRecord, SessionDelivery } from "@cutex-desktop/protocol";

/** Most owner inputs one interruptSend names (the host's limit); a submit's selection leaves room for its draft. */
export const INTERRUPT_SEND_MAX = 100;
export const SUBMIT_SELECTION_MAX = 99;

/** The host interrupts once for an ordered set of owner inputs (the runtime pin may still refuse: 422). */
export function sendsManyAtOnce(features: Iterable<string> | null | undefined): boolean {
  if (!features) return false;
  for (const f of features) if (f === "interrupt-send-many-v1" || f === "interruptSendManyV1") return true;
  return false;
}

const sendOrder = (a: InputRecord, b: InputRecord) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || (a.inputId < b.inputId ? -1 : a.inputId > b.inputId ? 1 : 0);
const offered = (r: InputRecord) => r.kind === "owner" && !!r.actions?.includes("interruptSend");

/** The owner's 插话 the running turn `turnId` has not read yet (the host still offers 打断并发送 on them), in send order. */
export function unreadSteers(records: Iterable<InputRecord>, turnId: string | null | undefined): InputRecord[] {
  if (!turnId) return [];
  return [...records].filter(r => offered(r) && r.state === "accepted" && r.turnId === turnId).sort(sendOrder);
}

/**
 * What 打断并发送 on `clickedId` takes: every unread 插话 of the running turn (the interrupt would drop them) plus the
 * clicked input itself when it is a queued / held one, in send order. Never cut short: over the host's limit the caller
 * refuses the whole action (the one interrupt would drop the rest). Empty when the clicked input is not offered.
 */
export function interruptSelection(records: Iterable<InputRecord>, delivery: SessionDelivery | null | undefined, clickedId: string): InputRecord[] {
  const all = [...records];
  const clicked = all.find(r => r.inputId === clickedId);
  if (!clicked || !offered(clicked)) return [];
  const steers = unreadSteers(all, delivery?.turn?.turnId);
  return steers.some(r => r.inputId === clickedId) ? steers : [...steers, clicked].sort(sendOrder);
}

/** Refusal of an interrupt that would name more owner inputs than the host takes (`max`): nothing is sent. */
export class TooManyToInterrupt extends Error {
  readonly code = "interrupt_send_too_many";
  constructor(message: string, readonly max: number) { super(message); }
}

/** The batch params for `list` against the running turn (null without one: no batch to name). */
export function selectionParams(list: readonly InputRecord[], delivery: SessionDelivery | null | undefined): InputInterruptSendManyParams | null {
  const expectedTurnId = delivery?.turn?.turnId;
  const expectedRuntimeGeneration = delivery?.runtimeGeneration;
  if (!expectedTurnId || expectedRuntimeGeneration == null || !list.length) return null;
  return {
    inputIds: list.map(r => r.inputId),
    expectedRevs: Object.fromEntries(list.map(r => [r.inputId, r.rev])),
    expectedTurnId,
    expectedRuntimeGeneration,
  };
}

/** How many unread 插话 a cli-preset Esc would send: all of them on a host that sends several at once, else only a
 *  single one (an older host sends one per interrupt; with several Esc just stops, as before). */
export function escSteerCount(steers: number, many: boolean): number {
  return many || steers === 1 ? steers : 0;
}

// ---------- details.interruptBatch (cutex 1e92a78d, API handoff v6): what happened to a batch member ----------

export interface InterruptBatchFacts {
  /** The record attempt these facts belong to (the host keeps older batch audit marks on later attempts). */
  attempt: number | null;
  /** Retained for the host's automatic group resend (held{hostBusy}): true / false as the host wrote it, null when absent
   *  (the host's predicates need an explicit value either way). */
  deferred: boolean | null;
  /** Uncertain without the host's unsent proof: it may have been taken; only Dismiss (Retry is refused too). */
  retryBlocked: boolean;
  /** Definitely not sent and stopped (waiting{nativeHeld}); the host offers the existing Retry on it. */
  blocked: boolean;
  /** Why it was not sent: not_idle / pending_trigger_turn / plan_mode (held, the group goes later), history_unavailable /
   *  recovery_required / hook_blocked / groupIncomplete / another code (blocked). */
  reason: string | null;
}

/** A record's `details.interruptBatch`, read strictly (null when absent / not an object). */
export function interruptBatchOf(record: Pick<InputRecord, "details">): InterruptBatchFacts | null {
  const b = record.details?.interruptBatch;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const v = b as Record<string, unknown>;
  const reason = typeof v.notSubmittedReason === "string" && v.notSubmittedReason ? v.notSubmittedReason : null;
  return { attempt: typeof v.attempt === "number" ? v.attempt : null, deferred: typeof v.deferred === "boolean" ? v.deferred : null, retryBlocked: v.retryBlocked === true, blocked: v.blocked === true, reason };
}

type BatchRecord = Pick<InputRecord, "kind" | "state" | "reason" | "attempt" | "details">;
const current = (record: BatchRecord, b: InterruptBatchFacts | null): b is InterruptBatchFacts =>
  !!b && record.kind === "owner" && b.attempt !== null && b.attempt === record.attempt;

/** The host's proof, for this attempt, that a stopped batch member was not sent (cutex owner_batch_blocked). */
export function batchBlocked(record: BatchRecord): InterruptBatchFacts | null {
  const b = interruptBatchOf(record);
  return current(record, b) && record.state === "waiting" && record.reason === "nativeHeld" && b.blocked && b.deferred === false && !!b.reason ? b : null;
}

/** This attempt was refused without the unsent proof: it may have been taken (cutex owner_batch_retry_blocked). */
export function batchRetryBlocked(record: BatchRecord): boolean {
  const b = interruptBatchOf(record);
  return current(record, b) && record.state === "uncertain" && b.retryBlocked;
}

/** This attempt's group waits for the host's automatic resend (held{hostBusy}, deferred custody). */
export function batchDeferred(record: BatchRecord): InterruptBatchFacts | null {
  const b = interruptBatchOf(record);
  return current(record, b) && record.state === "held" && record.reason === "hostBusy" && b.deferred === true && !!b.reason ? b : null;
}
