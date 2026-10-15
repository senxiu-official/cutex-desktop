// Width of the docked (常驻) gutter lists (docs/desktop-modules.md §19.3): a device-local UI pref
// (`gutterDockWidth`, lib/prefs), dragged on the list's inner edge, clamped to a range and to what the
// gutter has room for. Before 2026-10-11 a docked list filled the whole gutter (too wide on big windows).

/** Pref range and default (px). */
export const DOCK_WIDTH_RANGE = [200, 480] as const;
export const DOCK_WIDTH_DEFAULT = 260;
/** Arrow-key step on the handle (px). */
export const DOCK_WIDTH_STEP = 16;

/** A stored / dragged width as a pref value: a finite number in range (default otherwise). */
export function clampDockPref(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DOCK_WIDTH_DEFAULT;
  return Math.round(Math.min(DOCK_WIDTH_RANGE[1], Math.max(DOCK_WIDTH_RANGE[0], value)));
}

/**
 * The width the docked lists draw at: the pref (clamped to the range), never more than `available`
 * (the gutter's room, the old full width). Docking itself only happens when the gutter is at least
 * the item's `dockMinWidth`, so `available` is normally ≥ the range's minimum.
 */
export function dockWidth(pref: unknown, available: number): number {
  return Math.max(0, Math.min(clampDockPref(pref), Math.floor(available)));
}

/** A drag from `start` by `dx` px on `side`'s list (left lists grow to the right, right lists to the left). */
export function dragDockWidth(side: "left" | "right", start: number, dx: number): number {
  return clampDockPref(side === "left" ? start + dx : start - dx);
}
