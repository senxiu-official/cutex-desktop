import { captureDebugError } from "./debugState";
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
  hostBusy: "queue.steer.hostBusy",
  unrecognized: "queue.steer.unrecognized",
  passingNotAllowed: "queue.steer.passingNotAllowed",
  internalError: "queue.steer.internalError",
  archiveBlocksInput: "queue.steer.archiveBlocksInput",
  persistenceUnavailable: "queue.steer.persistenceUnavailable",
  idempotencyConflict: "queue.steer.idempotencyConflict",
  interruptTimeout: "queue.steer.interruptTimeout",
  inputInProgress: "queue.steer.inputInProgress",
  invalidInput: "queue.steer.invalidInput",
  nativeRequestFailed: "queue.steer.nativeRequestFailed",
  invalidRequest: "queue.steer.invalidRequest",
  sessionNotFound: "queue.steer.sessionNotFound",
  requestInProgress: "queue.steer.requestInProgress",
  noActiveTurn: "queue.steer.noActiveTurn",
  turnFinishing: "queue.steer.turnFinishing",
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

/** Errors whose outcome a visible row already states (an unknown-outcome insert shown 不确定是否送达 in 接下来). */
const shownInRow = new WeakSet<object>();
/** The store confirmed the failed action's row now shows its uncertain state itself. */
export function markShownInRow(error: unknown): void {
  if (typeof error === "object" && error !== null) shownInRow.add(error);
}

/**
 * A raw error, not a notice the store worded: IPC-wrapped from main, cutex's `snake_code: message`, a refusal
 * main coded for the renderer (`queue_steer_refused:kind …`, no space after the colon), or a socket errno.
 */
const RAW_ERROR = /^Error invoking remote method |^[a-z][a-z0-9]*(?:_[a-z0-9]+)+:|\bE(?:CONNREFUSED|CONNRESET|TIMEDOUT|PIPE|HOSTUNREACH|NOTFOUND|ADDRINUSE)\b/;

/**
 * A 接下来 action's failure (删除 / 插话 / 移动 / 继续 / 放回 / 清空 / 让出 / 中断并发送) as one plain sentence for
 * the composer's notice line, or null when there is nothing to say there. The store's own worded notice as is; a
 * queue-steer / merge refusal in its readable words; an unknown outcome → null only when the store confirmed its
 * 接下来 row now says 不确定是否送达 with 重新发送 / 放弃 (markShownInRow), else its plain sentence; any other raw error → a plain 「没有完成」. Never the backend's codes or
 * words: those go to the console and, with 调试模式 on, to its error list (which can be copied).
 */
export function queueActionNotice(e: unknown, t: (key: MessageKey) => string): string | null {
  const message = e instanceof Error ? e.message : String(e);
  const steer = parseQueueSteerError(message);
  const merge = steer ? null : parseQueueMergeError(message);
  if (!steer && !merge && !RAW_ERROR.test(message)) return message;
  console.warn("queue action failed:", message);
  captureDebugError(e, "renderer.queueAction");
  if (steer?.kind === "outcomeUnknown" && typeof e === "object" && e !== null && shownInRow.has(e)) return null;
  if (steer) return queueSteerNotice(message, t);
  if (merge) return queueMergeNotice(message, t);
  return t("queue.actionFailed");
}
