// The answer of a Next Up input action (store retryInput / dismissInput / holdInput / interruptSendInput). A guard that
// does not run the action says why (registry 1.4: store action guards return explicit results, never silent no-ops).
import type { Text } from "./nextUpRegistry";

export type InputActionRefusal =
  /** The host lacks the input ledger / the feature this action needs. */
  | "featureOff"
  /** The row is gone or already handled (left Next Up after a re-read). */
  | "gone"
  /** The host does not offer this action for the row now. */
  | "notOffered"
  /** The row changed while you clicked; it offers the action again: click once more. */
  | "changed"
  /** The host answered but did not do it (a resend it refused). */
  | "refused";

export type InputActionResult = { ok: true } | { ok: false; reason: InputActionRefusal };

/** What the owner is told for a refusal (registered words). `refused` already notified by the store. */
export const REFUSAL_TEXT = {
  featureOff: { zh: "这台主机不支持这个操作", en: "This host does not support this" },
  gone: { zh: "这一条已经处理过了", en: "This one is already handled" },
  notOffered: { zh: "这台主机现在不接受这个操作，状态已刷新", en: "The host does not accept this right now; the status was refreshed" },
  changed: { zh: "状态刚变了，请再点一次", en: "The status just changed; click again" },
  refused: null,
} as const satisfies Record<InputActionRefusal, Text | null>;
