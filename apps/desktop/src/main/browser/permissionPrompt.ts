// The owner's native site-permission prompt (0.1.3, Windows acceptance E4 fix). Main-only: the
// page, renderer and agents can never answer it. Chromium keeps the page's request (getUserMedia,
// Notification.requestPermission, …) pending until this resolves, so the prompt must never sit
// unnoticed: a native dialog only rises with its owner window, and a window that is not in front
// (another app on top, the request came from an agent's or a script's action) hides it — the page
// then waited forever and, because prompts are serialized, every later request queued behind it.
//   - window hidden / minimized: no dialog (nobody would see it). An owner-pool request not caused by the
//     agent's input waits for the window instead (A7, 2026-11-18): the taskbar entry flashes, the tab says so,
//     and the native dialog rises once the owner restores the window, inside the same absolute deadline.
//     Never allowed by the wait itself. Up to HELD_LIMIT such waits per hidden spell; once one expires
//     unseen, later ones deny at once until the window is seen again. Agent / agent-acting requests deny,
//     remember nothing, and say so (as before);
//   - window not focused: flash the taskbar entry and post an in-app notice pointing at the dialog;
//   - unanswered for `timeoutMs`, the tab navigated to another origin or closed (signal): the dialog
//     closes as a deny, nothing is remembered, and the next request asks again.
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { BrowserSitePermission } from "../../shared/browser";
import type { BrowserPermissionQueueSlot } from "./sitePermissions";
import { browserPermissionPromptText } from "./promptText";

/** permission-held: waiting for the hidden window; permission-shown: the held request's dialog is up now. */
export type BrowserPermissionNotice = "permission-waiting" | "permission-hidden" | "permission-timeout" | "permission-held" | "permission-shown";
export interface BrowserPermissionPromptRequest {
  guestId: string; origin: string; permissions: BrowserSitePermission[]; pool: "owner" | "agent"; agentName?: string; agentActing: boolean;
  /** Aborted by the caller when the asking page is gone (navigated to another origin / closed). */
  signal?: AbortSignal;
  /** The site-permission queue slot: given up while held (other tabs still get asked), taken again before the dialog. */
  queue?: BrowserPermissionQueueSlot;
}
export interface BrowserPermissionPromptWindow {
  isDestroyed(): boolean; isVisible(): boolean; isMinimized(): boolean; isFocused?(): boolean; flashFrame?(flag: boolean): void;
}
export interface BrowserPermissionPromptDeps<W extends BrowserPermissionPromptWindow> {
  /** The window the asking tab is drawn in (multi-window P5: the main window or a desk); null = none (treated as hidden). */
  window(request: BrowserPermissionPromptRequest): W | null;
  showMessageBox(window: W, options: MessageBoxOptions): Promise<Pick<MessageBoxReturnValue, "response" | "checkboxChecked">>;
  locale(): string | undefined;
  /** Module disabled / window torn down: never show, never trust a late answer. */
  closed(): boolean;
  notice(kind: BrowserPermissionNotice, request: BrowserPermissionPromptRequest): void;
  timeoutMs?: number;
  /** How often a held request looks at its window again (tests). */
  pollMs?: number;
}
export const BROWSER_PERMISSION_PROMPT_TIMEOUT_MS = 120_000;
/** Held requests (window hidden) per hidden spell; the site-permission queue shows one prompt at a time anyway. */
export const BROWSER_PERMISSION_HELD_LIMIT = 4;

export function createBrowserPermissionPrompt<W extends BrowserPermissionPromptWindow>(deps: BrowserPermissionPromptDeps<W>) {
  const call = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
  const hidden = (window: W | null): boolean => !window || call(() => window.isDestroyed() || !window.isVisible() || window.isMinimized(), true);
  // Holds started since the window was last seen; HELD_LIMIT after one expired unseen.
  let held = 0;
  /** The request's window once it is on screen; null on abort / close (polled: no single Electron "shown" event covers restore + show). */
  const whenShown = (request: BrowserPermissionPromptRequest, signal: AbortSignal) => new Promise<W | null>(resolve => {
    const done = (value: W | null) => { clearInterval(poll); signal.removeEventListener("abort", stop); resolve(value); };
    const stop = () => done(null);
    const poll = setInterval(() => {
      if (deps.closed()) return done(null);
      const window = call(() => deps.window(request), null);
      if (window && !hidden(window)) done(window);
    }, deps.pollMs ?? 500);
    (poll as { unref?: () => void }).unref?.();
    signal.addEventListener("abort", stop, { once: true });
  });
  return async (request: BrowserPermissionPromptRequest): Promise<{ allow: boolean; remember: boolean } | null> => {
    if (deps.closed() || request.signal?.aborted) return null;
    let window = call(() => deps.window(request), null);
    // Only a real window (a tab drawn nowhere is background: deny) and only the owner's pool without agent input.
    const hold = !!window && hidden(window) && request.pool === "owner" && !request.agentActing && held < BROWSER_PERMISSION_HELD_LIMIT;
    if (hidden(window) && !hold) { deps.notice("permission-hidden", request); return null; }
    if (!hidden(window)) held = 0;
    // One absolute deadline for the wait and the dialog together.
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, deps.timeoutMs ?? BROWSER_PERMISSION_PROMPT_TIMEOUT_MS);
    timer.unref?.();
    const forward = () => abort.abort();
    request.signal?.addEventListener("abort", forward, { once: true });
    let focused = true;
    const flashing = new Set<W>();
    try {
      if (hold) {
        held++;
        const minimized = window!;
        call(() => minimized.flashFrame?.(true), undefined); flashing.add(minimized);
        deps.notice("permission-held", request);
        call(() => request.queue?.release(), undefined);
        window = await whenShown(request, abort.signal);
        // Another tab's dialog may be up: wait for the slot (still inside this request's deadline).
        if (window && request.queue) await Promise.race([request.queue.acquire(), new Promise(resolve => abort.signal.addEventListener("abort", resolve, { once: true }))]);
        if (window && hidden(window)) window = null;
        if (!window || abort.signal.aborted || deps.closed()) {
          if (timedOut && !deps.closed()) { held = BROWSER_PERMISSION_HELD_LIMIT; deps.notice("permission-timeout", request); }
          return null;
        }
        held = 0;
        deps.notice("permission-shown", request);
      }
      const shown = window!;
      focused = call(() => shown.isFocused?.() ?? true, false);
      if (!focused) { call(() => shown.flashFrame?.(true), undefined); flashing.add(shown); if (!hold) deps.notice("permission-waiting", request); }
      const text = browserPermissionPromptText(deps.locale(), request);
      const answer = await deps.showMessageBox(shown, { type: "question", title: text.title, message: text.message, detail: text.detail,
        buttons: [text.allow, text.deny], defaultId: 1, cancelId: 1, noLink: true, checkboxLabel: text.remember, checkboxChecked: false, signal: abort.signal });
      if (abort.signal.aborted) { if (timedOut && !deps.closed()) deps.notice("permission-timeout", request); return null; }
      return deps.closed() ? null : { allow: answer.response === 0, remember: answer.checkboxChecked === true };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", forward);
      for (const target of flashing) call(() => target.isDestroyed() || target.flashFrame?.(false), undefined);
    }
  };
}
