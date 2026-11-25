// WhatsApp (module `whatsapp`): main's watcher view and its status words.
import type { WhatsAppWatchView } from "../../../../shared/browser";

export const WHATSAPP_SLUG = "whatsapp";
export const WHATSAPP_URL = "https://web.whatsapp.com/";

/** main's WhatsApp watcher view (shared/browser.ts). */
export type WhatsAppWatch = WhatsAppWatchView;

export type WhatsAppState = "relink" | "link" | "ready" | "offline" | "unknown" | "disabled" | "waiting" | "credential";

/** 待关联 vs 需重新关联: a tab that was linked before and shows the QR again needs re-linking. */
export function whatsAppState(w: WhatsAppWatch | null): WhatsAppState {
  if (!w || !w.enabled) return "disabled";
  if (w.status === "link") return w.linked ? "relink" : "link";
  return w.status;
}

export const WHATSAPP_TONE: Record<WhatsAppState, "ok" | "warn" | "muted" | "busy"> = {
  ready: "ok",
  link: "warn",
  relink: "warn",
  offline: "warn",
  unknown: "warn",
  credential: "warn",
  waiting: "busy",
  disabled: "muted",
};
