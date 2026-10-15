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
