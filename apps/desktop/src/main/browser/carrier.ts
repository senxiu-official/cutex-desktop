import { BrowserWindow, type NativeImage, type WebContents, type WebPreferences } from "electron";
import { markBackgroundWindow } from "../appWindows";
import { browserPartition } from "./attachPolicy";

/**
 * Background carrier for agent-opened tabs (2026-10-18, owner option C): an offscreen-rendered,
 * never-shown BrowserWindow in the host's agent pool. It renders and accepts CDP input while the
 * app window is minimized / hidden / showing something else, so several agents can drive their
 * own tabs at once (spike: docs/research/browser-background-tabs-spike-20261018.md).
 *
 * Only main creates one, only for the agent partition (owner tabs never get one: their logins and
 * co-control stay on the visible-only webview path). The guest gets exactly the hardened webview
 * preferences (no preload, no Node, sandboxed, isolated) plus offscreen rendering; network,
 * popup, permission, download and certificate policy are the same session hooks every guest of
 * that partition passes (installBrowserSessionPolicy / hardenBrowserGuest, attributed by
 * webContentsId through the registry).
 */
export const BROWSER_CARRIER_FRAME_RATE = 15;
/** Owner-facing live thumbnail: at most one frame per interval, this wide, JPEG. */
export const BROWSER_THUMBNAIL_INTERVAL_MS = 1000;
export const BROWSER_THUMBNAIL_WIDTH = 480;
export const MAX_BROWSER_THUMBNAIL_LENGTH = 256 * 1024;

/** The exact preference bag (webview attach hardening + offscreen); never merged with caller input. */
export function browserCarrierPreferences(hostId: string): WebPreferences {
  return { partition: browserPartition(hostId, "agent"), offscreen: true, backgroundThrottling: false,
    contextIsolation: true, sandbox: true, webSecurity: true,
    nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
    webviewTag: false, plugins: false, allowRunningInsecureContent: false,
    safeDialogs: true, navigateOnDragDrop: false, spellcheck: false };
}
export interface BrowserCarrier {
  readonly guest: WebContents;
  /** Closes the page and its offscreen window. Idempotent. */
  destroy(): void;
}
export interface BrowserCarrierOptions {
  hostId: string;
  viewport: { width: number; height: number };
  /** Runs synchronously right after creation, before any URL is loaded: the popup guard etc. */
  guard(guest: WebContents): void;
  /** Throttled owner thumbnail (data:image/jpeg); asked only while wanted() is true. */
  thumbnail?(dataUrl: string): void;
  wanted?(): boolean;
  now?(): number;
}
export function createBrowserCarrier(options: BrowserCarrierOptions): BrowserCarrier {
  const window = new BrowserWindow({ show: false, width: options.viewport.width, height: options.viewport.height, useContentSize: true,
    frame: false, skipTaskbar: true, fullscreenable: false, paintWhenInitiallyHidden: true, title: "",
    webPreferences: browserCarrierPreferences(options.hostId) });
  markBackgroundWindow(window);
  const guest = window.webContents;
  const now = options.now ?? Date.now;
  let destroyed = false, lastThumb = -Infinity, pending: NativeImage | undefined, thumbTimer: ReturnType<typeof setTimeout> | undefined;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (thumbTimer) clearTimeout(thumbTimer);
    try { if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false }); } catch { /* Already gone. */ }
    try { if (!window.isDestroyed()) window.destroy(); } catch { /* Already gone. */ }
  };
  // Never on screen: an offscreen window has no visible surface, and a stray show() is undone.
  window.on("show", () => { try { window.hide(); } catch { /* Destroyed meanwhile. */ } });
  guest.once("destroyed", destroy);
  window.once("closed", destroy);
  try { options.guard(guest); }
  catch (error) { destroy(); throw error; }
  guest.setFrameRate(BROWSER_CARRIER_FRAME_RATE);
  const emit = () => {
    thumbTimer = undefined;
    const image = pending; pending = undefined;
    if (!image || destroyed || !options.thumbnail || options.wanted?.() === false) return;
    lastThumb = now();
    try {
      const size = image.getSize();
      if (size.width < 1 || size.height < 1) return;
      const scaled = size.width > BROWSER_THUMBNAIL_WIDTH ? image.resize({ width: BROWSER_THUMBNAIL_WIDTH, quality: "good" }) : image;
      const url = `data:image/jpeg;base64,${scaled.toJPEG(60).toString("base64")}`;
      if (url.length <= MAX_BROWSER_THUMBNAIL_LENGTH) options.thumbnail(url);
    } catch { /* A thumbnail is a convenience; never a reason to touch the page. */ }
  };
  guest.on("paint", (_event: unknown, _dirty: unknown, image: NativeImage) => {
    if (destroyed || !options.thumbnail || options.wanted?.() === false) return;
    pending = image;
    if (thumbTimer) return;
    thumbTimer = setTimeout(emit, Math.max(0, lastThumb + BROWSER_THUMBNAIL_INTERVAL_MS - now()));
    thumbTimer.unref?.();
  });
  return { guest, destroy };
}

/** The CDP surface the dialog guard needs (a WebContents' debugger). */
export interface BrowserCarrierDebugger {
  isAttached(): boolean;
  attach(version?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: "message", listener: (event: unknown, method: string, params: Record<string, unknown>) => void): unknown;
  removeListener(event: "message", listener: (event: unknown, method: string, params: Record<string, unknown>) => void): unknown;
}
/**
 * A page in a background carrier must never put a native alert / confirm / prompt / beforeunload
 * dialog on the owner's desktop (it has no visible window to belong to). While no agent binding
 * holds the debugger, this guard does: it enables Page events and dismisses every JavaScript dialog
 * (the page sees cancel). While the provider is bound, its executor already dismisses dialogs the
 * agent did not arm. yieldTo() releases the debugger to the provider; resume() takes it back.
 */
export function guardBrowserCarrierDialogs(guest: { isDestroyed(): boolean; debugger: BrowserCarrierDebugger }) {
  const debug = guest.debugger;
  let owned = false, disposed = false, dismissed = 0;
  const onMessage = (_event: unknown, method: string) => {
    if (owned && method === "Page.javascriptDialogOpening") { dismissed++; void debug.sendCommand("Page.handleJavaScriptDialog", { accept: false }).catch(() => {}); }
  };
  debug.on("message", onMessage);
  const resume = () => {
    if (disposed || owned || guest.isDestroyed()) return;
    try { if (debug.isAttached()) return; debug.attach("1.3"); owned = true; } catch { return; }
    void debug.sendCommand("Page.enable").catch(() => {});
  };
  const yieldTo = () => {
    if (!owned) return;
    owned = false;
    try { if (!guest.isDestroyed() && debug.isAttached()) debug.detach(); } catch { /* Already detached. */ }
  };
  resume();
  return { resume, yieldTo, owns: () => owned, dismissed: () => dismissed,
    dispose() { disposed = true; yieldTo(); debug.removeListener("message", onMessage); } };
}
export type BrowserCarrierDialogGuard = ReturnType<typeof guardBrowserCarrierDialogs>;
