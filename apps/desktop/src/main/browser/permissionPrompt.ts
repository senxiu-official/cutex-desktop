// The owner's native site-permission prompt (0.1.3, Windows acceptance E4 fix). Main-only: the
// page, renderer and agents can never answer it. Chromium keeps the page's request (getUserMedia,
// Notification.requestPermission, …) pending until this resolves, so the prompt must never sit
// unnoticed: a native dialog only rises with its owner window, and a window that is not in front
// (another app on top, the request came from an agent's or a script's action) hides it — the page
// then waited forever and, because prompts are serialized, every later request queued behind it.
//   - window hidden / minimized: no dialog (nobody would see it); deny, remember nothing, and say so;
//   - window not focused: flash the taskbar entry and post an in-app notice pointing at the dialog;
//   - unanswered for `timeoutMs`, the tab navigated to another origin or closed (signal): the dialog
//     closes as a deny, nothing is remembered, and the next request asks again.
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { BrowserSitePermission } from "../../shared/browser";
import { browserPermissionPromptText } from "./promptText";

export type BrowserPermissionNotice = "permission-waiting" | "permission-hidden" | "permission-timeout";
export interface BrowserPermissionPromptRequest {
  guestId: string; origin: string; permissions: BrowserSitePermission[]; pool: "owner" | "agent"; agentName?: string; agentActing: boolean;
  /** Aborted by the caller when the asking page is gone (navigated to another origin / closed). */
  signal?: AbortSignal;
}
export interface BrowserPermissionPromptWindow {
  isDestroyed(): boolean; isVisible(): boolean; isMinimized(): boolean; isFocused?(): boolean; flashFrame?(flag: boolean): void;
}
export interface BrowserPermissionPromptDeps<W extends BrowserPermissionPromptWindow> {
  window: W;
  showMessageBox(window: W, options: MessageBoxOptions): Promise<Pick<MessageBoxReturnValue, "response" | "checkboxChecked">>;
  locale(): string | undefined;
  /** Module disabled / window torn down: never show, never trust a late answer. */
  closed(): boolean;
  notice(kind: BrowserPermissionNotice, request: BrowserPermissionPromptRequest): void;
  timeoutMs?: number;
}
export const BROWSER_PERMISSION_PROMPT_TIMEOUT_MS = 120_000;

export function createBrowserPermissionPrompt<W extends BrowserPermissionPromptWindow>(deps: BrowserPermissionPromptDeps<W>) {
  const call = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
  return async (request: BrowserPermissionPromptRequest): Promise<{ allow: boolean; remember: boolean } | null> => {
    if (deps.closed() || request.signal?.aborted) return null;
    const { window } = deps;
    if (call(() => window.isDestroyed() || !window.isVisible() || window.isMinimized(), true)) { deps.notice("permission-hidden", request); return null; }
    const focused = call(() => window.isFocused?.() ?? true, false);
    if (!focused) { call(() => window.flashFrame?.(true), undefined); deps.notice("permission-waiting", request); }
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, deps.timeoutMs ?? BROWSER_PERMISSION_PROMPT_TIMEOUT_MS);
    timer.unref?.();
    const forward = () => abort.abort();
    request.signal?.addEventListener("abort", forward, { once: true });
    try {
      const text = browserPermissionPromptText(deps.locale(), request);
      const answer = await deps.showMessageBox(window, { type: "question", title: text.title, message: text.message, detail: text.detail,
        buttons: [text.allow, text.deny], defaultId: 1, cancelId: 1, noLink: true, checkboxLabel: text.remember, checkboxChecked: false, signal: abort.signal });
      if (abort.signal.aborted) { if (timedOut && !deps.closed()) deps.notice("permission-timeout", request); return null; }
      return deps.closed() ? null : { allow: answer.response === 0, remember: answer.checkboxChecked === true };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", forward);
      if (!focused) call(() => window.isDestroyed() || window.flashFrame?.(false), undefined);
    }
  };
}
