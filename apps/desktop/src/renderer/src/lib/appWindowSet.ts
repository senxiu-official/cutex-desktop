// The app's windows as this renderer sees them (multi-window P1): this window and every desk window it draws
// (lib/deskStore). Window-wide shortcuts attach to each of them, and what opens from a shortcut opens in the
// window the owner is in (owner 2026-10-27: Ctrl+K works in every window). Desk windows share this document's
// JS, so `window` / `document` alone always mean the main window (P2 moves the rest of the app to its element's window).
import { useDesks } from "./deskStore";

/** The open desk windows. */
function deskWindows(): Window[] {
  return useDesks.getState().desks.map((d) => d.handle.win).filter((w) => !w.closed);
}

/** This window first, then the open desk windows. */
export function appWindowList(): Window[] {
  return [window, ...deskWindows()];
}

/** The app window that has the focus (its document), else this window. */
export function activeAppWindow(): Window {
  for (const win of appWindowList()) {
    try {
      if (win.document.hasFocus()) return win;
    } catch {
      // closing
    }
  }
  return window;
}

/** The document of the app window that has the focus: a desk's when one has it, else this document. */
export function activeAppDocument(): Document {
  for (const win of deskWindows()) {
    try {
      if (win.document.hasFocus()) return win.document;
    } catch {
      // closing
    }
  }
  return document;
}

/**
 * The first element matching `selector` in the app windows, this window first (multi-window P2): a lookup by id
 * (a pane, a chip, a conversation header) finds it in whichever window draws it. Without desks: this document's.
 */
export function queryAppWindows<E extends Element = Element>(selector: string): E | null {
  const here = document.querySelector<E>(selector);
  if (here) return here;
  for (const win of deskWindows()) {
    try {
      const found = win.document.querySelector<E>(selector);
      if (found) return found;
    } catch {
      // closing
    }
  }
  return null;
}

/** Every element matching `selector` in the app windows, this window's first. */
export function queryAllAppWindows<E extends Element = Element>(selector: string): E[] {
  const out: E[] = [...document.querySelectorAll<E>(selector)];
  for (const win of deskWindows()) {
    try {
      out.push(...win.document.querySelectorAll<E>(selector));
    } catch {
      // closing
    }
  }
  return out;
}

/** Run `attach` for every app window, now and when desks open; its returned detach runs when a desk goes or on stop. */
export function onEveryAppWindow(attach: (win: Window) => () => void): () => void {
  const attached = new Map<Window, () => void>();
  const sync = () => {
    const now = appWindowList();
    for (const [win, detach] of attached) {
      if (now.includes(win)) continue;
      attached.delete(win);
      try {
        detach();
      } catch {
        // the window is gone already
      }
    }
    for (const win of now) if (!attached.has(win)) attached.set(win, attach(win));
  };
  sync();
  const stop = useDesks.subscribe(sync);
  return () => {
    stop();
    for (const detach of attached.values()) detach();
    attached.clear();
  };
}

/** The window of an app window key (multi-window P3, lib/windowScope): "main" = this window, else that desk's (null: closed). */
export function appWindowOfKey(key: string): Window | null {
  if (key === "main") return window;
  const win = useDesks.getState().desks.find((d) => d.deskId === key)?.handle.win ?? null;
  return win && !win.closed ? win : null;
}

/** An app window's place on the screen (DIP): what appWindowAt compares a pointer's screen position with. */
interface ScreenBox {
  readonly screenLeft: number;
  readonly screenTop: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
}

/**
 * `windows` with the ones used most recently first (`keyOf` names each; `recent`: newest first, lib/windowScope
 * recentWindows). Windows never used keep their order, after the others. Pure.
 */
export function byRecency<W>(windows: readonly W[], keyOf: (win: W) => string, recent: readonly string[]): W[] {
  const rank = (win: W) => {
    const i = recent.indexOf(keyOf(win));
    return i < 0 ? recent.length : i;
  };
  return windows.map((win, i) => ({ win, i, r: rank(win) })).sort((a, b) => a.r - b.r || a.i - b.i).map((e) => e.win);
}

/**
 * The app window under a point on the screen, other than `from` (multi-window P3: a drag released outside its own
 * window over another one). The topmost cannot be known here; the first match wins — callers pass the windows the
 * owner used last first (`byRecency`), since desks open 32 px apart and overlap (dual-screen run 2026-10-28).
 */
export function appWindowAt<W extends ScreenBox>(windows: readonly W[], x: number, y: number, from: W): W | null {
  for (const win of windows) {
    if (win === from) continue;
    try {
      if (x >= win.screenLeft && x < win.screenLeft + win.outerWidth && y >= win.screenTop && y < win.screenTop + win.outerHeight) return win;
    } catch {
      // closing
    }
  }
  return null;
}
