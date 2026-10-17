import type { BrowserWindow } from "electron";
import { ProtocolError } from "@cutex-desktop/browser-protocol";

type VisibilityWindow = Pick<BrowserWindow, "isDestroyed" | "isVisible" | "isMinimized"> & {
  webContents: Pick<BrowserWindow["webContents"], "isDestroyed" | "executeJavaScriptInIsolatedWorld">;
};
export interface BrowserVisibilityOptions {
  window: VisibilityWindow;
  guestId: string;
  hiddenTarget: "reveal" | "reject";
  signal?: AbortSignal;
  deadline?: number;
  /** Existing card only, same view scope, reveal:true/focus:false. Never show/restore a window. */
  reveal(): void | Promise<void>;
}
export interface BrowserViewportBounds { width: number; height: number }
const hidden = () => new ProtocolError("target_hidden", "Browser target must be visible in an already-visible window");
function checkOperation(options: BrowserVisibilityOptions): void {
  if (options.signal?.aborted) throw new ProtocolError("cancelled", "Visibility check was cancelled");
  if (options.deadline !== undefined && (!Number.isFinite(options.deadline) || Date.now() >= options.deadline))
    throw new ProtocolError("deadline_exceeded", "Visibility deadline expired");
}

/** Fixed main-owned inspection of the app document, not the untrusted guest page. */
export function browserVisibilityScript(guestId: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(guestId)) throw hidden();
  return `(() => {
    if (document.visibilityState !== 'visible') return false;
    const matches = Array.from(document.querySelectorAll('webview[data-browser-guest]'))
      .filter(node => node.getAttribute('data-browser-guest') === ${JSON.stringify(guestId)});
    if (matches.length !== 1) return false;
    const guest = matches[0];
    if (!guest.isConnected) return false;
    const rect = guest.getBoundingClientRect();
    if (![rect.left,rect.top,rect.right,rect.bottom,rect.width,rect.height].every(Number.isFinite)
      || rect.width < 1 || rect.height < 1 || rect.left < -1 || rect.top < -1
      || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) return false;
    let node = guest;
    for (let depth = 0; node && depth < 128; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0
        || style.contentVisibility === 'hidden' || style.pointerEvents === 'none') return false;
      if (node !== guest && /(hidden|clip|scroll|auto)/.test(style.overflowX + ' ' + style.overflowY)) {
        const clip = node.getBoundingClientRect();
        if (rect.left < clip.left - 1 || rect.right > clip.right + 1
          || rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1) return false;
      }
    }
    if (node) return false;
    // Co-control marker (0.1.3): a passive, input-transparent sibling covering this viewport in its
    // granted card, ready once the renderer's focus guard is installed. Owner input reaches the page.
    const viewport = guest.parentElement;
    const card = guest.closest('[data-browser-card]');
    const layers = Array.from(document.querySelectorAll('[data-browser-owner-capture]'))
      .filter(layer => layer.getAttribute('data-browser-owner-capture') === ${JSON.stringify(guestId)});
    let capture;
    if (layers.length === 1 && viewport?.hasAttribute('data-browser-viewport') && card) {
      const layer = layers[0], box = layer.getBoundingClientRect(), style = getComputedStyle(layer);
      if (layer.isConnected && layer.parentElement === viewport.parentElement
        && layer.closest('[data-browser-card]') === card && layer.childElementCount === 0
        && !layer.hidden && !layer.inert && layer.getAttribute('aria-hidden') !== 'true'
        && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0
        && style.contentVisibility !== 'hidden' && style.pointerEvents === 'none'
        && ['left','top','right','bottom','width','height'].every(key => Number.isFinite(box[key]) && Math.abs(box[key]-rect[key]) <= 1)) capture = layer;
    }
    // Ancestor visibility is the primary overlay gate; sampled hit testing also rejects a
    // covering app overlay. Inset samples avoid the card's rounded border corners.
    const shielded = !!capture && card?.getAttribute('data-browser-granted') === 'true'
      && capture.getAttribute('data-browser-owner-ready') === 'true';
    // The marker is input-transparent, so every sample must land on the guest itself: any app
    // overlay (menu, dialog, toast) covering the card denies dispatch.
    for (const x of [.15,.5,.85]) for (const y of [.15,.5,.85]) {
      const hit = document.elementFromPoint(rect.left + rect.width*x, rect.top + rect.height*y);
      if (hit !== guest) return false;
    }
    // Only provider control uses this gate. A bare visible guest is not safe to dispatch
    // into: publication/render/listener installation may still be in flight after grant.
    return shielded ? {width:rect.width, height:rect.height} : {capturePending:true};
  })()`;
}
function windowVisible(window: VisibilityWindow): boolean {
  try { return !window.isDestroyed() && !window.webContents.isDestroyed() && window.isVisible() && !window.isMinimized(); }
  catch { return false; }
}
async function bounded<T>(promise: Promise<T>, timeout: number, options: BrowserVisibilityOptions): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ProtocolError("cancelled", "Visibility check was cancelled"));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const remaining = options.deadline === undefined ? timeout : Math.min(timeout, Math.max(0, options.deadline - Date.now()));
      timer = setTimeout(() => { try { checkOperation(options); reject(hidden()); } catch (error) { reject(error); } }, remaining);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
/** Visibility only: never activates, focuses, restores, or shows the native window. */
export async function ensureBrowserVisible(options: BrowserVisibilityOptions): Promise<BrowserViewportBounds> {
  const { window } = options;
  const code = browserVisibilityScript(options.guestId);
  const inspect = async () => {
    checkOperation(options);
    if (!windowVisible(window)) throw hidden();
    let result: unknown;
    try { result = await bounded(window.webContents.executeJavaScriptInIsolatedWorld(1005, [{ code }], false), 1000, options); }
    catch (error) { if (error instanceof ProtocolError) throw error; throw hidden(); }
    checkOperation(options);
    if (!windowVisible(window)) throw hidden();
    if (result && typeof result === "object" && "capturePending" in result && result.capturePending === true) return "capture-pending" as const;
    const size = result as Partial<BrowserViewportBounds> | null;
    return size && typeof size.width === "number" && typeof size.height === "number"
      && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width >= 1 && size.height >= 1
      && size.width <= 16_384 && size.height <= 16_384 ? { width: size.width, height: size.height } : undefined;
  };
  let initial = await inspect();
  if (initial === "capture-pending") {
    // Wait for the grant's app render, even in reject-hidden mode. This is read-only
    // readiness of an already-visible card, not a reveal or retry of a browser action.
    for (let sample = 0; sample < 10 && initial === "capture-pending"; sample++) {
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 25); timer.unref?.(); });
      initial = await inspect();
    }
    if (initial === "capture-pending") throw hidden();
  }
  if (initial) return initial;
  checkOperation(options);
  if (options.hiddenTarget !== "reveal" || !windowVisible(window)) throw hidden();
  try { await bounded(Promise.resolve(options.reveal()), 1000, options); }
  catch (error) { if (error instanceof ProtocolError) throw error; throw hidden(); }
  // A reveal publication may need the app's next render. Each sample rechecks native visibility.
  for (let sample = 0; sample < 11; sample++) {
    const bounds = await inspect();
    if (bounds && bounds !== "capture-pending") return bounds;
    if (sample < 10) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 25); timer.unref?.(); });
  }
  throw hidden();
}

/** Fixed main-owned app-document script: if this guest holds focus, return it to the element the
 * renderer marked as the owner's last focus outside it (data-browser-focus-return), else blur. */
export function browserFocusRestoreScript(guestId: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(guestId)) throw hidden();
  return `(() => { const active = document.activeElement;
    if (!active || String(active.tagName).toUpperCase() !== 'WEBVIEW' || active.getAttribute('data-browser-guest') !== ${JSON.stringify(guestId)}) return false;
    const back = Array.from(document.querySelectorAll('[data-browser-focus-return]'))
      .find(node => node.getAttribute('data-browser-focus-return') === ${JSON.stringify(guestId)});
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    if (document.activeElement === active) active.blur();
    return true; })()`;
}
/** After an agent pointer action pulled app focus into the guest: give it back (never to the page). */
export async function restoreBrowserAppFocus(window: VisibilityWindow, guestId: string): Promise<void> {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    await window.webContents.executeJavaScriptInIsolatedWorld(1005, [{ code: browserFocusRestoreScript(guestId) }], false);
  } catch { /* Best effort: keyboard actions still require the guest to hold focus. */ }
}
/** Fixed main-owned check of the app document (never the guest page): is this guest the focused element? */
export function browserKeyboardFocusScript(guestId: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(guestId)) throw hidden();
  return `(() => { const active = document.activeElement;
    return document.hasFocus() && !!active && String(active.tagName).toUpperCase() === 'WEBVIEW'
      && active.getAttribute('data-browser-guest') === ${JSON.stringify(guestId)}; })()`;
}
/**
 * Read-only: does the app document's keyboard focus sit on this exact guest? CDP keyboard / text
 * input follows that focus (Electron 44), so the provider refuses fill / press without it.
 */
export async function browserGuestKeyboardFocused(window: VisibilityWindow, guestId: string): Promise<boolean> {
  try {
    const code = browserKeyboardFocusScript(guestId);
    if (!windowVisible(window)) return false;
    return await window.webContents.executeJavaScriptInIsolatedWorld(1005, [{ code }], false) === true;
  } catch { return false; }
}
