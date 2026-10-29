// Queue tray 插入 / 立即发送 on cutex with queue-steer (r223): main uses the atomic
// `cutex/userInput/queue/steer`; its refusals arrive as `queue_steer_refused:` messages.
import { parseQueueSteerError, type QueueSteerErrorKind } from "../../../shared/queueSteer";
import { parseQueueMergeError, type QueueMergeErrorKind } from "../../../shared/queueMerge";
import type { MessageKey } from "../i18n";

export const QUEUE_STEER_FEATURE = "queue-steer";

const KEYS: Record<QueueSteerErrorKind, MessageKey> = {
  ownerRequired: "queue.steer.ownerRequired",
  joinChanged: "queue.steer.joinChanged",
  agentPaused: "queue.steer.agentPaused",
  delegationTurn: "queue.steer.delegationTurn",
  runtimeNoSteer: "queue.steer.runtimeNoSteer",
  runtimeNotReady: "queue.steer.runtimeNotReady",
  runtimeRefused: "queue.steer.runtimeRefusedPlain",
  noActiveTurn: "queue.steer.noActiveTurn",
  imagePathRequired: "queue.steer.imagePathRequired",
  imageUnavailable: "queue.steer.imageUnavailable",
  turnConflict: "queue.steer.turnConflict",
  sessionOffline: "queue.steer.sessionOffline",
  outcomeUnknown: "queue.steer.outcomeUnknown",
  changed: "queue.steer.changed",
};

/**
 * What was steered, for the wording (image-input-steering): `images` = the message carries images,
 * `imageSteering` = the session's declaration (lib/imageSteer imageSteerMode; null = unknown / no feature).
 */
export interface SteerNoticeContext {
  images?: boolean;
  imageSteering?: "pathText" | "nativeImage" | "unsupported" | null;
}

/**
 * A readable notice for a queue-steer refusal message; null for any other error. A runtime refusal of a
 * message with images on a runtime that declares `unsupported` says that it cannot insert images. Never
 * the backend's own words (a native refusal, an unknown outcome's answer): those are queueSteerRaw's.
 */
export function queueSteerNotice(message: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string, ctx: SteerNoticeContext = {}): string | null {
  const parsed = parseQueueSteerError(message);
  if (!parsed) return null;
  if (ctx.images && ctx.imageSteering === "unsupported" && (parsed.kind === "runtimeNoSteer" || parsed.kind === "runtimeRefused")) return t("queue.steer.imageUnsupported");
  return t(KEYS[parsed.kind]);
}

/** The backend's words a queue-steer refusal carried (native refusal / unknown outcome), for a 详情 tooltip; "" = none. */
export function queueSteerRaw(message: string): string {
  return parseQueueSteerError(message)?.detail ?? "";
}

const MERGE_KEYS: Record<Exclude<QueueMergeErrorKind, "kept">, MessageKey> = {
  changed: "queue.merge.changed",
  tooLarge: "queue.merge.tooLarge",
};

/**
 * 「全部合并插入」's failure as readable text: a merge refusal (shared/queueMerge; `kept` = merged into
 * one queued item at the front, with the steer refusal when there was one), else a steer notice, else a
 * plain 「没有完成」 — never the backend's own words (a toast has no 详情).
 */
export function queueMergeNotice(message: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string, ctx: SteerNoticeContext = {}): string {
  const parsed = parseQueueMergeError(message);
  if (!parsed) return queueSteerNotice(message, t, ctx) ?? t("queue.merge.failed");
  if (parsed.kind !== "kept") return t(MERGE_KEYS[parsed.kind]);
  const reason = parsed.detail ? queueSteerNotice(parsed.detail, t, ctx) : null;
  return reason ? t("queue.merge.keptReason", { reason }) : t("queue.merge.kept");
}

/** A raw error (IPC-wrapped from main, or cutex's `snake_code: message`), not a notice the store worded. */
const RAW_ERROR = /^Error invoking remote method |^[a-z][a-z0-9]*(?:_[a-z0-9]+)+: /;

/**
 * A 接下来 action's failure (删除 / 插话 / 移动 / 继续 / 放回 / 清空 / 让出 / 中断并发送) as a toast: the store's
 * own worded notice as is; a raw error becomes a plain 「没有完成」 (a toast has no 详情; it goes to the console).
 */
export function queueActionNotice(e: unknown, t: (key: MessageKey) => string): string {
  const message = e instanceof Error ? e.message : String(e);
  if (!RAW_ERROR.test(message)) return message;
  console.warn("queue action failed:", message);
  return t("queue.actionFailed");
}
