// Whether the owner is in the app now (multi-window P3, owner 2026-10-27): any app window — the main one or a desk
// (lib/appWindowSet) — has the focus. 「在看」 and the notification `looking` checks use it with the active
// window's selection (lib/windowScope), so the window the owner is in decides.
import { appWindowList, onEveryAppWindow } from "./appWindowSet";

export function appHasFocus(): boolean {
  // No window (unit tests of the store): the document alone.
  if (typeof window === "undefined") return !!globalThis.document?.hasFocus?.();
  return appWindowList().some((win) => {
    try {
      return win.document.hasFocus();
    } catch {
      return false;
    }
  });
}

type LookEvents = "focus" | "blur";
/** What lib/notifyRetract startLookRetract listens to: focus / blur and hasFocus. */
export interface AppLookWindow {
  addEventListener: (type: LookEvents, listener: () => void) => void;
  removeEventListener: (type: LookEvents, listener: () => void) => void;
  document: { hasFocus(): boolean };
}

/**
 * The app's windows as one for the look trigger (lib/notifyRetract): focused = any app window has the focus; focus /
 * blur of any of them (a desk opened later too). Looking at an agent from a desk takes its alerts back (P3).
 */
export function appLookWindow(): AppLookWindow | null {
  // No window, or a partial one (unit tests of the store): the look trigger falls back as before.
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return null;
  const offs = new Map<() => void, Map<LookEvents, () => void>>();
  return {
    document: { hasFocus: appHasFocus },
    addEventListener: (type, listener) => {
      const per = offs.get(listener) ?? new Map<LookEvents, () => void>();
      offs.set(listener, per);
      per.get(type)?.();
      per.set(
        type,
        onEveryAppWindow((win) => {
          win.addEventListener(type, listener);
          return () => win.removeEventListener(type, listener);
        }),
      );
    },
    removeEventListener: (type, listener) => {
      offs.get(listener)?.get(type)?.();
      offs.get(listener)?.delete(type);
    },
  };
}
