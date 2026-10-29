import { BrowserWindow } from "electron";

// Never-shown background browser carriers (browser/carrier.ts) are BrowserWindows too: anything that
// means "the app's window" (activate, dialog parents, fallbacks) must skip them.
const background = new WeakSet<BrowserWindow>();

export function markBackgroundWindow(window: BrowserWindow): void {
  background.add(window);
}

/** The app's own windows: every BrowserWindow except background carriers. */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !background.has(window));
}

// The window the owner is using (multi-window): native dialogs, the big alert and the taskbar flash go there,
// not always to the main window. Only the main window and desk windows count (markOwnerWindow), never
// carriers or the big alert window itself.
const ownerWindows = new WeakSet<BrowserWindow>();
let lastFocused: BrowserWindow | null = null;

/** The main window and every desk window: their focus says where the owner is. */
export function markOwnerWindow(window: BrowserWindow): void {
  ownerWindows.add(window);
  window.on("focus", () => (lastFocused = window));
  window.on("closed", () => {
    if (lastFocused === window) lastFocused = null;
  });
}

/** The focused app window, else the one focused last (still shown), else `fallback` (the main window). */
export function ownerWindow(fallback: BrowserWindow | null): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && ownerWindows.has(focused)) return focused;
  if (lastFocused && !lastFocused.isDestroyed() && lastFocused.isVisible() && !lastFocused.isMinimized()) return lastFocused;
  return fallback && !fallback.isDestroyed() ? fallback : null;
}
