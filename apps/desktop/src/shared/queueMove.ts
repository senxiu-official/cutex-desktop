// admission-order moves (cutex `cutex/userInput/queue/move`): error codes do not survive the IPC hop,
// so main turns cutex's refusal into a message with a fixed prefix and the renderer maps it to a
// readable notice (like shared/queueSteer.ts). Every kind leaves the order as it was.

export const QUEUE_MOVE_ERROR_PREFIX = "queue_move_refused";

export type QueueMoveErrorKind =
  /** revision_conflict: the admission order changed since it was read (the panel lists it again). */
  | "conflict"
  /** passing_not_allowed: `queue.ownerMayPassAsks` is off and the move passes a non-owner item. */
  | "passingNotAllowed"
  /** queue_item_not_found / not_found: the item or the `before` item was sent or removed meanwhile. */
  | "gone";

const CODES: Record<string, QueueMoveErrorKind> = {
  revision_conflict: "conflict",
  admission_revision_conflict: "conflict",
  passing_not_allowed: "passingNotAllowed",
  queue_item_not_found: "gone",
  admission_item_not_found: "gone",
  queue_input_already_submitted: "gone",
};

/** The kind of a queue/move error code; null for anything else (passed on as is). */
export function queueMoveErrorKind(code: string): QueueMoveErrorKind | null {
  return CODES[code] ?? null;
}

export function queueMoveErrorMessage(kind: QueueMoveErrorKind): string {
  return `${QUEUE_MOVE_ERROR_PREFIX}:${kind}`;
}

/** The kind named by a queue-move error message (after the IPC hop it is wrapped by Electron). */
export function parseQueueMoveError(message: string): QueueMoveErrorKind | null {
  const kind = new RegExp(`${QUEUE_MOVE_ERROR_PREFIX}:(\\w+)`).exec(message)?.[1];
  return kind && Object.values(CODES).includes(kind as QueueMoveErrorKind) ? (kind as QueueMoveErrorKind) : null;
}
