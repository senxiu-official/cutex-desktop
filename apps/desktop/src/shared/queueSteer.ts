// queue-steer refusals (cutex `cutex/userInput/queue/steer`): error codes do not survive the IPC hop,
// so main turns cutex's refusal into a message with a fixed prefix and the renderer maps it to a
// readable notice. Every kind but `outcomeUnknown` means the item is still queued, unchanged.

export const QUEUE_STEER_ERROR_PREFIX = "queue_steer_refused";

export type QueueSteerErrorKind =
  // steer_unavailable `details.reason`
  | "ownerRequired"
  | "joinChanged"
  | "agentPaused"
  | "delegationTurn"
  | "runtimeNoSteer"
  | "runtimeNotReady"
  | "runtimeRefused"
  | "hostBusy"
  | "unrecognized"
  | "passingNotAllowed" | "internalError" | "archiveBlocksInput" | "persistenceUnavailable"
  | "idempotencyConflict" | "interruptTimeout" | "inputInProgress" | "invalidInput"
  | "nativeRequestFailed" | "invalidRequest" | "sessionNotFound" | "requestInProgress"
  | "noActiveTurn"
  | "turnFinishing"
  // image-input-steering (r264): a Claude image without a file path on the target host (URL / data
  // image), or its file there is missing / unreadable.
  | "imagePathRequired"
  | "imageUnavailable"
  // other codes
  | "turnConflict"
  | "sessionOffline"
  | "outcomeUnknown"
  /** revision_conflict / queue_item_not_found / queue_input_already_submitted: sent or edited meanwhile. */
  | "changed";

const REASONS = new Set<QueueSteerErrorKind>(["joinChanged", "agentPaused", "delegationTurn", "runtimeNoSteer", "runtimeNotReady", "runtimeRefused", "noActiveTurn", "turnFinishing", "imagePathRequired", "imageUnavailable", "hostBusy", "unrecognized"]);
const CODES: Record<string, QueueSteerErrorKind> = {
  admission_deferred: "hostBusy",
  passing_not_allowed: "passingNotAllowed",
  admission_item_not_found: "changed",
  internal_error: "internalError",
  archive_blocks_input: "archiveBlocksInput",
  event_persistence_unavailable: "persistenceUnavailable",
  app_server_unavailable: "runtimeNotReady",
  idempotency_conflict: "idempotencyConflict",
  interrupt_timeout: "interruptTimeout",
  user_input_in_progress: "inputInProgress",
  invalid_input: "invalidInput",
  native_request_failed: "nativeRequestFailed",
  invalid_request: "invalidRequest",
  session_not_found: "sessionNotFound",
  request_in_progress: "requestInProgress",
  idempotency_capacity_exceeded: "hostBusy",
  agent_paused: "agentPaused",
  owner_required: "ownerRequired",
  turn_conflict: "turnConflict",
  session_offline: "sessionOffline",
  // cutex's queue/steer says `outcome_unknown`, but the v2 server re-labels every generic unknown
  // outcome `request_outcome_unknown` (details: resyncRequired, originalCode, originalDetails).
  outcome_unknown: "outcomeUnknown",
  request_outcome_unknown: "outcomeUnknown",
  revision_conflict: "changed",
  queue_item_not_found: "changed",
  queue_input_already_submitted: "changed",
};

/** The kind of a queue/steer error (CutexApiError code + details); null for anything else. */
export function queueSteerErrorKind(code: string, details: unknown): QueueSteerErrorKind | null {
  if (code === "steer_unavailable") {
    // An explicit resync requirement wins over a nominal pre-send refusal.
    if ((details as { resyncRequired?: unknown } | null | undefined)?.resyncRequired === true) return "outcomeUnknown";
    const reason = (details as { reason?: unknown } | null | undefined)?.reason;
    if (reason === "admissionBusy") return "hostBusy";
    return typeof reason === "string" && REASONS.has(reason as QueueSteerErrorKind) ? (reason as QueueSteerErrorKind) : "unrecognized";
  }
  if (code === "admission_busy" && (details as { reason?: unknown } | null | undefined)?.reason === "hostBusy"
    && (details as { resyncRequired?: unknown } | null | undefined)?.resyncRequired !== true) return "hostBusy";
  // Any other answer that asks for a resync: whether it landed is not known here either.
  return (details as { resyncRequired?: unknown } | null | undefined)?.resyncRequired === true ? "outcomeUnknown" : Object.hasOwn(CODES, code) ? CODES[code]! : "unrecognized";
}

/**
 * The backend's own words for an outcome-unknown answer (`message` = CutexApiError's "code: message"),
 * one line with the original code: for the row's 详情 only, never its text.
 */
export function queueSteerRawDetail(message: string, details: unknown): string {
  const original = (details as { originalCode?: unknown } | null | undefined)?.originalCode;
  const words = typeof original === "string" && !message.startsWith(`${original}:`) ? `${message} (originalCode: ${original})` : message;
  return words.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** `runtimeRefused`: the native refusal's message (e.g. "cannot steer a review turn"), short. */
export function queueSteerErrorDetail(details: unknown): string {
  const message = (details as { nativeError?: { message?: unknown } } | null | undefined)?.nativeError?.message;
  return typeof message === "string" ? message.replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

export function queueSteerErrorMessage(kind: QueueSteerErrorKind, detail = ""): string {
  return `${QUEUE_STEER_ERROR_PREFIX}:${kind}${detail ? ` ${detail}` : ""}`;
}

/** The kind (+ detail) named by a queue-steer error message (after the IPC hop it is wrapped by Electron). */
export function parseQueueSteerError(message: string): { kind: QueueSteerErrorKind; detail: string } | null {
  const m = new RegExp(`${QUEUE_STEER_ERROR_PREFIX}:(\\w+)(?: (.*))?`).exec(message);
  const kind = m?.[1] as QueueSteerErrorKind | undefined;
  return kind && (REASONS.has(kind) || Object.values(CODES).includes(kind)) ? { kind, detail: m![2] ?? "" } : null;
}
