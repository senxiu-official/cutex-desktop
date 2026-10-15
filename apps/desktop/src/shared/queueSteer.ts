// queue-steer refusals (cutex `cutex/userInput/queue/steer`): error codes do not survive the IPC hop,
// so main turns cutex's refusal into a message with a fixed prefix and the renderer maps it to a
// readable notice. Every kind but `outcomeUnknown` means the item is still queued, unchanged.

export const QUEUE_STEER_ERROR_PREFIX = "queue_steer_refused";

export type QueueSteerErrorKind =
  // steer_unavailable `details.reason`
  | "delegationTurn"
  | "runtimeNoSteer"
  | "runtimeRefused"
  | "noActiveTurn"
  // other codes
  | "turnConflict"
  | "sessionOffline"
  | "outcomeUnknown"
  /** revision_conflict / queue_item_not_found / queue_input_already_submitted: sent or edited meanwhile. */
  | "changed";

const REASONS = new Set<QueueSteerErrorKind>(["delegationTurn", "runtimeNoSteer", "runtimeRefused", "noActiveTurn"]);
const CODES: Record<string, QueueSteerErrorKind> = {
  turn_conflict: "turnConflict",
  session_offline: "sessionOffline",
  outcome_unknown: "outcomeUnknown",
  revision_conflict: "changed",
  queue_item_not_found: "changed",
  queue_input_already_submitted: "changed",
};

/** The kind of a queue/steer error (CutexApiError code + details); null for anything else. */
export function queueSteerErrorKind(code: string, details: unknown): QueueSteerErrorKind | null {
  if (code === "steer_unavailable") {
    const reason = (details as { reason?: unknown } | null | undefined)?.reason;
    // An unknown future reason still means "kept in the queue": the runtime refused it.
    return typeof reason === "string" && REASONS.has(reason as QueueSteerErrorKind) ? (reason as QueueSteerErrorKind) : "runtimeRefused";
  }
  return CODES[code] ?? null;
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
