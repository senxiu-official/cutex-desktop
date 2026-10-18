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
