// Where a menu flyout (components/Overlays `Flyout`) sits beside its row. Placed once when it opens;
// when its content later changes size (live rows, e.g. 用量 ▸), the side and the anchored edge stay:
// a flyout beside its row grows downwards, one lifted to the window's bottom edge grows upwards —
// only running out of window (or shrinking away from its row) moves it.

export interface FlyoutPlace {
  side: "right" | "left";
  /** Which edge is fixed: `offset` is the CSS `top` (anchor top) or `bottom` (anchor bottom) relative to the row. */
  anchor: "top" | "bottom";
  offset: number;
}

interface RowRect {
  top: number;
  bottom: number;
  right: number;
}

/** Window margin kept free around a flyout. */
const MARGIN = 4;

/** `prev`: the current placement (a resize); none = the flyout just opened. */
export function placeFlyout(row: RowRect, size: { width: number; height: number }, view: { width: number; height: number }, prev?: FlyoutPlace): FlyoutPlace {
  const side = prev?.side ?? (row.right + size.width + 8 > view.width ? "left" : "right");
  const floor = view.height - MARGIN;
  const atTop = (absTop: number): FlyoutPlace => ({ side, anchor: "top", offset: absTop - row.top });
  const atBottom: FlyoutPlace = { side, anchor: "bottom", offset: row.bottom - floor };
  // Taller than the window: from the top margin down (the old `lift` clamp).
  if (floor - size.height < MARGIN) return atTop(MARGIN);
  const beside = row.top - MARGIN;
  // Lifted: the bottom edge stays (it shrinks / grows at the top) while the flyout still reaches its row.
  if (prev?.anchor === "bottom") return floor - size.height > row.bottom ? atTop(beside) : atBottom;
  const top = prev ? row.top + prev.offset : beside;
  return top + size.height <= floor ? atTop(top) : atBottom;
}

export function samePlace(a: FlyoutPlace | null, b: FlyoutPlace): boolean {
  return !!a && a.side === b.side && a.anchor === b.anchor && Math.abs(a.offset - b.offset) < 0.5;
}
