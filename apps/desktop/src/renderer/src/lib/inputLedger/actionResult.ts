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

/**
 * The reason a failed action's error gives, for the toast when the row has no 查看详情 / 查看原因 (owner 2026-11-28:
 * 「…「查看详情」/「查看原因」里有原因」 on a row without either). A leading `code: ` is dropped (the code is in the
 * diagnostic log); empty → null. Clipped: a toast is one or two lines.
 */
export function failureReason(error: unknown, max = 200): string | null {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  // Electron's IPC wrapper, then `Error:` / `SomethingError:` prefixes, then the cutex code.
  const text = raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(?:[A-Za-z]*Error:\s*)+/, "")
    .replace(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+:\s*/, "").trim() || raw;
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
