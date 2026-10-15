// Queue tray 插入 / 立即发送 on cutex with queue-steer (r223): main uses the atomic
// `cutex/userInput/queue/steer`; its refusals arrive as `queue_steer_refused:` messages.
import { parseQueueSteerError, type QueueSteerErrorKind } from "../../../shared/queueSteer";
import type { MessageKey } from "../i18n";

export const QUEUE_STEER_FEATURE = "queue-steer";

const KEYS: Record<QueueSteerErrorKind, MessageKey> = {
  delegationTurn: "queue.steer.delegationTurn",
  runtimeNoSteer: "queue.steer.runtimeNoSteer",
  runtimeRefused: "queue.steer.runtimeRefused",
  noActiveTurn: "queue.steer.noActiveTurn",
  turnConflict: "queue.steer.turnConflict",
  sessionOffline: "queue.steer.sessionOffline",
  outcomeUnknown: "queue.steer.outcomeUnknown",
  changed: "queue.steer.changed",
};

/** A readable notice for a queue-steer refusal message; null for any other error. */
export function queueSteerNotice(message: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string | null {
  const parsed = parseQueueSteerError(message);
  if (!parsed) return null;
  if (parsed.kind === "runtimeRefused" && !parsed.detail) return t("queue.steer.runtimeRefusedPlain");
  return t(KEYS[parsed.kind], { detail: parsed.detail });
}
