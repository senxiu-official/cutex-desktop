// Main window size / position memory (userData/window-state.json): parse the stored record and fit it
// to the displays connected now. Pure (no Electron), unit-tested; main/windowState.ts does the I/O.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What is stored: the normal (un-maximized) bounds and whether the window was maximized. */
export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 820 } as const;
export const MIN_WINDOW_SIZE = { width: 880, height: 560 } as const;
/** How much of a saved window must still lie on a display to restore it there (else default, centred). */
const MIN_VISIBLE = { width: 160, height: 80 } as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const b = value.bounds as Record<string, unknown> | undefined;
  if (!b || typeof b !== "object" || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height)) return null;
  if (b.width <= 0 || b.height <= 0) return null;
  const bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  return { bounds, maximized: value.maximized === true };
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

const clampSize = (size: number, min: number, max: number) => Math.max(Math.min(size, max), Math.min(min, max));

/**
 * The window options to start with. `workAreas` = the connected displays' work areas, primary first.
 * Saved bounds that still overlap a display enough are kept, shrunk to that display's work area and
 * moved fully onto it; otherwise (nothing saved, display gone) the default size, fitted to the primary
 * display, without a position (Electron centres it). `maximized` is kept either way.
 */
export function restoreWindowBounds(saved: WindowState | null, workAreas: readonly Rect[]): { bounds: Rect | { width: number; height: number }; maximized: boolean } {
  const maximized = saved?.maximized ?? false;
  if (saved) {
    let best: Rect | null = null;
    let bestArea = 0;
    for (const area of workAreas) {
      const o = overlap(saved.bounds, area);
      if (o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height && o.width * o.height > bestArea) {
        best = area;
        bestArea = o.width * o.height;
      }
    }
    if (best) {
      const width = clampSize(saved.bounds.width, MIN_WINDOW_SIZE.width, best.width);
      const height = clampSize(saved.bounds.height, MIN_WINDOW_SIZE.height, best.height);
      const x = Math.min(Math.max(saved.bounds.x, best.x), best.x + best.width - width);
      const y = Math.min(Math.max(saved.bounds.y, best.y), best.y + best.height - height);
      return { bounds: { x, y, width, height }, maximized };
    }
  }
  const primary = workAreas[0];
  if (!primary) return { bounds: { ...DEFAULT_WINDOW_SIZE }, maximized };
  return {
    bounds: {
      width: clampSize(DEFAULT_WINDOW_SIZE.width, MIN_WINDOW_SIZE.width, primary.width),
      height: clampSize(DEFAULT_WINDOW_SIZE.height, MIN_WINDOW_SIZE.height, primary.height),
    },
    maximized,
  };
}

// ── Desk windows (multi-window, main/deskShell.ts): one record per desk id next to the main window's ──

/** A desk window's first size (no saved record): a little smaller than the main window's default. */
export const DEFAULT_DESK_SIZE = { width: 1040, height: 760 } as const;
export const MIN_DESK_SIZE = { width: 560, height: 420 } as const;
/** A new desk opens this far right / down of the main window, on the main window's display. */
export const DESK_CASCADE = 32;
/** Desk records kept at most (the newest first wins; a closed desk is forgotten, see forgetDesk). */
export const MAX_DESK_RECORDS = 8;

/** window-state.json: the main window's record and one per desk id. The old single record = `main`. */
export interface WindowStates {
  main: WindowState | null;
  desks: Record<string, WindowState>;
}

const DESK_KEY = /^d[0-9a-f]{12}$/;

export function parseWindowStates(raw: unknown): WindowStates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { main: null, desks: {} };
  const value = raw as Record<string, unknown>;
  // Before desks the file was one WindowState ({bounds, maximized}).
  if ("bounds" in value) return { main: parseWindowState(value), desks: {} };
  const desks: Record<string, WindowState> = {};
  const stored = value.desks && typeof value.desks === "object" && !Array.isArray(value.desks) ? (value.desks as Record<string, unknown>) : {};
  for (const [id, record] of Object.entries(stored)) {
    if (Object.keys(desks).length >= MAX_DESK_RECORDS) break;
    const state = DESK_KEY.test(id) ? parseWindowState(record) : null;
    if (state) desks[id] = state;
  }
  return { main: parseWindowState(value.main), desks };
}

/** The display (work area) a rect lies on most, or null when none shows MIN_VISIBLE of it. */
function bestArea(rect: Rect, workAreas: readonly Rect[]): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const o = overlap(rect, area);
    if (o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height && o.width * o.height > bestArea) {
      best = area;
      bestArea = o.width * o.height;
    }
  }
  return best;
}

/** `rect` shrunk to `area` (not below `min` unless the area is smaller) and moved fully onto it. */
function fitInto(rect: Rect, area: Rect, min: { width: number; height: number }): Rect {
  const width = clampSize(rect.width, min.width, area.width);
  const height = clampSize(rect.height, min.height, area.height);
  return { x: Math.min(Math.max(rect.x, area.x), area.x + area.width - width), y: Math.min(Math.max(rect.y, area.y), area.y + area.height - height), width, height };
}

/**
 * A desk window's bounds to start with. A saved record still on a display is kept (fitted to it, like the
 * main window). Otherwise the default desk size on the display the main window (`anchor`) is on, cascaded
 * DESK_CASCADE from it; with no anchor on any display, centred on the primary display.
 */
export function restoreDeskBounds(saved: WindowState | null, workAreas: readonly Rect[], anchor: Rect | null): { bounds: Rect; maximized: boolean } {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: DEFAULT_DESK_SIZE.width, height: DEFAULT_DESK_SIZE.height };
  if (saved) {
    const area = bestArea(saved.bounds, workAreas);
    if (area) return { bounds: fitInto(saved.bounds, area, MIN_DESK_SIZE), maximized: saved.maximized };
  }
  const area = (anchor && bestArea(anchor, workAreas)) ?? null;
  const size = { width: DEFAULT_DESK_SIZE.width, height: DEFAULT_DESK_SIZE.height };
  if (area && anchor) return { bounds: fitInto({ x: anchor.x + DESK_CASCADE, y: anchor.y + DESK_CASCADE, ...size }, area, MIN_DESK_SIZE), maximized: false };
  const fitted = fitInto({ x: primary.x, y: primary.y, ...size }, primary, MIN_DESK_SIZE);
  return { bounds: { ...fitted, x: primary.x + Math.round((primary.width - fitted.width) / 2), y: primary.y + Math.round((primary.height - fitted.height) / 2) }, maximized: false };
}

/**
 * A display was removed or changed (resolution, scaling, arrangement): where an open window must move so
 * it stays reachable, or null when it is still on a display. Windows usually moves such windows itself,
 * X11 does not always.
 */
export function refitBounds(bounds: Rect, workAreas: readonly Rect[], min: { width: number; height: number } = MIN_WINDOW_SIZE): Rect | null {
  if (workAreas.length === 0 || bestArea(bounds, workAreas)) return null;
  const primary = workAreas[0]!;
  const fitted = fitInto(bounds, primary, min);
  return { ...fitted, x: primary.x + Math.round((primary.width - fitted.width) / 2), y: primary.y + Math.round((primary.height - fitted.height) / 2) };
}

// ── Restoring exactly (Windows, hidden title bar, fractional scaling) ──

/** What settleWindowBounds uses of a BrowserWindow. */
export interface BoundsWindow {
  getNormalBounds(): Rect;
  setBounds(bounds: Rect): void;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * A new window's bounds made to read back as asked. On Windows a window with the hidden title bar
 * (`titleBarStyle: "hidden"`, main/index.ts, main/deskShell.ts) does not come up at the size it was created
 * with at a fractional scale: at 150 % `width: 1282` reads back 1284 DIP, 1284 → 1287, 1287 → 1291 … (measured
 * with Electron 44, dual-screen run 2026-10-28), and that is what got saved, so the window grew on every start; a
 * single setBounds is off by one too. So: set it again, corrected by the difference, until getNormalBounds
 * matches (at most `tries` times). A size that maps to no whole pixel count (1275 DIP at 150 %) ends on a
 * neighbouring one that does, which then restores exactly — the next start is stable either way.
 * `want` without a position (the default size, centred) keeps the position the window got.
 */
export function settleWindowBounds(win: BoundsWindow, want: Partial<Rect> & { width: number; height: number }, tries = 3): Rect {
  let got = win.getNormalBounds();
  const target: Rect = { x: want.x ?? got.x, y: want.y ?? got.y, width: want.width, height: want.height };
  let asked = target;
  for (let i = 0; i < tries && !sameRect(got, target); i++) {
    asked = { x: asked.x + target.x - got.x, y: asked.y + target.y - got.y, width: asked.width + target.width - got.width, height: asked.height + target.height - got.height };
    win.setBounds(asked);
    got = win.getNormalBounds();
  }
  return got;
}
