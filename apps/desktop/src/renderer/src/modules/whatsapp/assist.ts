// Phase 2 of the WhatsApp module (planned, not built): open a chat, draft a reply, and rewrite a reply in English.
// It lives here, in the `whatsapp` module, behind its own switch — separate from the module switch and from main's
// unread watch (WhatsAppCard「读取未读提醒」). Until it ships the switch stays off and has no UI.
//
// Ground rules for the phase-2 work (carry them into its design review):
// - Reading message text is a new data path: main does it in the owner tab's isolated world, on an owner gesture,
//   only while this switch is on; nothing is logged, stored on the host or offered to agents by default.
// - Sending stays an owner action (the owner presses send in WhatsApp, or confirms in place).
// - The English rewrite reuses 提示词增强's text-rewrite route (功能 Profile), not a new model path.

/** This desktop's saved choice (localStorage), read by phase 2 once it exists. */
export const WHATSAPP_ASSIST_KEY = "cutex-desktop.whatsapp.assist";

/** Phase 2 is not built: always off for now (the stored choice is ignored until it ships). */
export function whatsAppAssistEnabled(): boolean {
  return false;
}
