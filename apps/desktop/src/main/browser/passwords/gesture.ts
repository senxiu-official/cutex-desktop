// The owner's native gesture on an app window, as main itself observes it (before-input-event / before-mouse-event of
// the window's webContents). Renderer code — a third-party module runs with app trust — cannot produce these events;
// it can only ask. Copy, show, fill and turning the 5-minute grace on each consume one fresh gesture: one press or key,
// one secret operation.
import type { BrowserWindow } from "electron";

export const OWNER_GESTURE_MS = 1_500;

type Contents = { on(event: string, listener: (...args: never[]) => void): unknown; removeListener(event: string, listener: (...args: never[]) => void): unknown };

export interface OwnerGestures {
  /** Starts observing one app window; returns its stop function. */
  listen(contents: Contents, window: BrowserWindow | null): () => void;
  /** The window of a fresh unused gesture (and uses it up), or null. */
  consume(): { window: BrowserWindow | null } | null;
  note(window: BrowserWindow | null): void;
}

export function createOwnerGestures(now: () => number = Date.now): OwnerGestures {
  let last: { at: number; window: BrowserWindow | null } | null = null;
  const gestures: OwnerGestures = {
    note(window) { last = { at: now(), window }; },
    consume() {
      const g = last;
      last = null;
      return g && now() - g.at <= OWNER_GESTURE_MS ? { window: g.window } : null;
    },
    listen(contents, window) {
      const key = (_event: unknown, input: { type?: string; isAutoRepeat?: boolean }) => {
        if ((input?.type === "keyDown" || input?.type === "rawKeyDown") && !input.isAutoRepeat) gestures.note(window);
      };
      const mouse = (_event: unknown, input: { type?: string }) => {
        if (input?.type === "mouseDown" || input?.type === "mouseUp") gestures.note(window);
      };
      contents.on("before-input-event", key as never);
      contents.on("before-mouse-event", mouse as never);
      return () => {
        contents.removeListener("before-input-event", key as never);
        contents.removeListener("before-mouse-event", mouse as never);
      };
    },
  };
  return gestures;
}
