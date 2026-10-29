// Shared submenu placement in window coordinates. Preserve the anchored vertical edge on live
// size changes, but never preserve a side that no longer fits the current viewport.
export interface FlyoutPlace {
  side: "right" | "left";
  anchor: "top" | "bottom";
  /** Relative vertical edge retained while live content grows or shrinks. */
  offset: number;
  left: number;
  top: number;
}
interface RowRect { left: number; top: number; bottom: number; right: number }
const MARGIN = 4;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/** `size` includes the pointer bridge padding; oversized content scrolls within the viewport. */
export function placeFlyout(row: RowRect, size: { width: number; height: number }, view: { width: number; height: number }, prev?: FlyoutPlace, align: "top" | "bottom" = "top"): FlyoutPlace {
  const width = Math.min(size.width, Math.max(0, view.width - MARGIN * 2));
  const height = Math.min(size.height, Math.max(0, view.height - MARGIN * 2));
  const fitsRight = row.right + width <= view.width - MARGIN;
  const fitsLeft = row.left - width >= MARGIN;
  const side = prev?.side === "left" && fitsLeft ? "left" : prev?.side === "right" && fitsRight ? "right" : fitsRight ? "right" : fitsLeft ? "left" : "right";
  const left = clamp(side === "right" ? row.right : row.left - width, MARGIN, view.width - width - MARGIN);
  const floor = view.height - MARGIN;
  let anchor: FlyoutPlace["anchor"] = "top";
  let top = prev?.anchor === "top" ? row.top + prev.offset : row.top - MARGIN;
  if (size.height >= floor - MARGIN) top = MARGIN;
  else if (align === "bottom") { anchor = "bottom"; top = row.bottom + MARGIN - height; }
  else if ((prev?.anchor === "bottom" && floor - height <= row.bottom) || top + height > floor) { anchor = "bottom"; top = floor - height; }
  top = clamp(top, MARGIN, floor - height);
  const offset = anchor === "top" ? top - row.top : row.bottom - (top + height);
  return { side, anchor, offset, left, top };
}
export function samePlace(a: FlyoutPlace | null, b: FlyoutPlace): boolean {
  return !!a && a.side === b.side && a.anchor === b.anchor && Math.abs(a.offset - b.offset) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5;
}
