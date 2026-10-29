// Presentation state for an explicit queue-insert request, shared by panes of the same host/agent.
// This is an operation receipt, not a second queue or a runtime-health signal.
import { create } from "zustand";
import type { QueueItem } from "@cutex-desktop/protocol";
import { viewKey } from "./viewKey";
import type { MessageKey } from "../i18n";
import { imageDeliveryKey } from "./imageSteer";

export type QueueInsertState = "requesting" | "inserted" | "started" | "delivered" | "queued" | "rejected" | "unknown" | "changed";
export interface QueueInsertFeedback {
  token: object;
  item: QueueItem;
  state: QueueInsertState;
  reason?: string;
  /** Hide an acknowledged unknown outcome without forgetting its duplicate-send guard. */
  hidden?: boolean;
  /** The id cutex sent the steer under, when it differs from the queue item's. */
  sentId?: string;
  /** image-input-steering receipt of an `inserted` steer (cutex's word only; absent = nothing is said). */
  imageDelivery?: "pathText" | "nativeImage";
  /** The backend's own words (code, message, original code): a 详情 tooltip only, never the row's text. */
  detail?: string;
  /**
   * `unknown` only: the desktop is resyncing the session (store resolveUnknownInsert: history, then
   * cutex's queue) to learn whether it landed. False = it could not tell: 再发一次 / 已送达 / 删除.
   */
  checking?: boolean;
}

/** A durable row's delivered state cannot inherit an older operation's refusal text/actions. */
export function queueInsertFeedbackView(feedback: QueueInsertFeedback): QueueInsertFeedback {
  if (feedback.state !== "delivered" && feedback.item.state !== "delivered") return feedback;
  return { ...feedback, state: "delivered", reason: undefined, detail: undefined, checking: undefined };
}
export const DELIVERED_FEEDBACK_MS = 1000;
const EMPTY: readonly QueueInsertFeedback[] = [];
export const useQueueInsertFeedback = create<{ byView: Record<string, readonly QueueInsertFeedback[]> }>(() => ({ byView: {} }));
export const insertFeedbackOf = (host: string, session: string) => (s: ReturnType<typeof useQueueInsertFeedback.getState>) => s.byView[viewKey(host, session)] ?? EMPTY;
export const hasQueueInsertRequest = (host: string, session: string) => insertFeedbackOf(host, session)(useQueueInsertFeedback.getState()).some((f) => f.state === "requesting");
export const insertLocked = (s: QueueInsertState) => s === "requesting" || s === "unknown";
export const insertFinished = (s: QueueInsertState) => s === "inserted" || s === "started" || s === "delivered" || s === "changed";
export const insertDismissible = (s: QueueInsertState) => s === "rejected" || s === "unknown" || s === "changed";
/** An unknown outcome the resync could not settle: the owner decides (再发一次 / 已送达 / 删除). */
export const insertUnsure = (f: Pick<QueueInsertFeedback, "state" | "checking">) => f.state === "unknown" && !f.checking;

function expireDelivered(key: string, tokens: ReadonlySet<object>) {
  // Owned by the operation, not a mounted row: pane switches cannot restart this deadline.
  setTimeout(() => useQueueInsertFeedback.setState((s) => {
    const list = s.byView[key] ?? EMPTY;
    const kept = list.filter((f) => !tokens.has(f.token) || f.state !== "delivered");
    return kept.length === list.length ? s : { byView: { ...s.byView, [key]: kept } };
  }), DELIVERED_FEEDBACK_MS);
}

/** Return null when an earlier request's outcome is still unknown: never silently send twice. */
export function beginQueueInsert(host: string, session: string, item: QueueItem): object | null {
  const key = viewKey(host, session);
  const list = useQueueInsertFeedback.getState().byView[key] ?? EMPTY;
  if (list.some((f) => f.item.clientUserMessageId === item.clientUserMessageId && (insertLocked(f.state) || insertFinished(f.state)))) return null;
  const token = {};
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: [...list.filter((f) => f.item.clientUserMessageId !== item.clientUserMessageId), { token, item, state: "requesting" }] } }));
  return token;
}
export function finishQueueInsert(host: string, session: string, token: object, state: QueueInsertState, reason?: string, sentId?: string, imageDelivery?: "pathText" | "nativeImage", more: Pick<QueueInsertFeedback, "detail" | "checking"> = {}) {
  const key = viewKey(host, session);
  // A durable delivered item can normalize even a late refusal into delivery.
  const firstDelivery = (useQueueInsertFeedback.getState().byView[key] ?? EMPTY).some((f) => f.token === token && f.state !== "delivered" && queueInsertFeedbackView({ ...f, state }).state === "delivered");
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: (s.byView[key] ?? EMPTY).map((f) => f.token === token && f.state !== "delivered" ? queueInsertFeedbackView({ ...f, state, reason, detail: more.detail, checking: more.checking, ...(sentId && sentId !== f.item.clientUserMessageId ? { sentId } : {}), ...(imageDelivery ? { imageDelivery } : {}) }) : f) } }));
  if (firstDelivery) expireDelivered(key, new Set([token]));
}
/**
 * `cutex/userInput/submitted` carried an image-input-steering receipt for `clientId` (the queue item's id
 * or the id cutex sent it under): an `inserted` receipt without one says how its images went in.
 */
export function noteQueueInsertImageDelivery(host: string, session: string, clientId: string, imageDelivery: "pathText" | "nativeImage") {
  const key = viewKey(host, session);
  const list = useQueueInsertFeedback.getState().byView[key] ?? EMPTY;
  const hit = (f: QueueInsertFeedback) => f.state === "inserted" && !f.imageDelivery && (f.item.clientUserMessageId === clientId || f.sentId === clientId);
  if (!list.some(hit)) return;
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: (s.byView[key] ?? EMPTY).map((f) => (hit(f) ? { ...f, imageDelivery } : f)) } }));
}
/**
 * Positive native history evidence may resolve a lost reply; queue presence alone cannot. `delivered`
 * gets the queue item's id and, when cutex sent it under another one, that id too. store.settleSteers
 * also passes the steers it saw recorded (a history row without a clientId echo is matched by text).
 */
export function reconcileQueueInsert(host: string, session: string, delivered: (clientId: string) => boolean) {
  const key = viewKey(host, session);
  const list = useQueueInsertFeedback.getState().byView[key] ?? EMPTY;
  const tokens = new Set(list.filter((f) => f.state !== "delivered" && (delivered(f.item.clientUserMessageId) || (!!f.sentId && delivered(f.sentId)))).map((f) => f.token));
  if (!tokens.size) return;
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: (s.byView[key] ?? EMPTY).map((f) => tokens.has(f.token) ? { ...f, state: "delivered", reason: undefined, detail: undefined, checking: undefined, hidden: undefined } : f) } }));
  expireDelivered(key, tokens);
}
/** One request's feedback (by its token), if it is still shown or remembered. */
export function queueInsertByToken(host: string, session: string, token: object): QueueInsertFeedback | undefined {
  return (useQueueInsertFeedback.getState().byView[viewKey(host, session)] ?? EMPTY).find((f) => f.token === token);
}
/** An unknown outcome's resync started again (true) or could not tell (false). */
export function setQueueInsertChecking(host: string, session: string, token: object, checking: boolean) {
  const key = viewKey(host, session);
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: (s.byView[key] ?? EMPTY).map((f) => (f.token === token && f.state === "unknown" ? { ...f, checking } : f)) } }));
}
/** 已送达 on an unknown outcome (the owner saw it in the conversation): local only, it leaves like a delivered one. */
export function markQueueInsertDelivered(host: string, session: string, token: object) {
  const f = queueInsertByToken(host, session, token);
  if (f?.state === "unknown") reconcileQueueInsert(host, session, (cid) => cid === f.item.clientUserMessageId);
}
/**
 * Forget a request's feedback altogether: the resync found it still queued (its row is a plain queued
 * row again, 插话 offered), or the owner sent it again under a new id (再发一次).
 */
export function clearQueueInsert(host: string, session: string, token: object) {
  const key = viewKey(host, session);
  useQueueInsertFeedback.setState((s) => {
    const list = s.byView[key] ?? EMPTY;
    const kept = list.filter((f) => f.token !== token || f.state === "requesting");
    return kept.length === list.length ? s : { byView: { ...s.byView, [key]: kept } };
  });
}
export function dismissQueueInsert(host: string, session: string, token: object) {
  const key = viewKey(host, session);
  useQueueInsertFeedback.setState((s) => ({ byView: { ...s.byView, [key]: (s.byView[key] ?? EMPTY).flatMap((f) => f.token !== token || f.state === "requesting" ? [f] : f.state === "unknown" ? [{ ...f, hidden: true }] : []) } }));
}
export function queueInsertLabel(f: QueueInsertFeedback): MessageKey {
  f = queueInsertFeedbackView(f);
  // An insert with images: how they went in, when cutex said so (lib/imageSteer; it is not "seen").
  const images = f.state === "inserted" ? imageDeliveryKey(f.imageDelivery) : null;
  if (images) return images;
  if (f.state === "unknown" && f.checking) return "queue.insert.checking";
  return ({ requesting: "queue.insert.requesting", inserted: "queue.insertedToast", started: "queue.insert.started", delivered: "queue.insert.delivered", queued: "queue.turn.startsNow", rejected: "queue.insert.rejected", unknown: "queue.insert.unknown", changed: "queue.steer.changed" } as const)[f.state];
}
