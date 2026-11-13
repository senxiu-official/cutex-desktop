// Where a window-wide toast goes (the Shelf toast, the desk notice): centred, near the bottom, but never over
// the tray (its dock, at any edge) or a conversation's composer (its input, 接下来 and notice line). A tray docked
// left / right narrows the room it is centred in (the toast shrinks to fit; its text truncates, the full text then
// in the tooltip). Rising above the composers would end too high (a tall composer in a short window) → under the
// title bar instead, below a top-docked tray. Measured from the live layout, so it follows the tray's edge, rows and
// the composer's height.
import { useLayoutEffect, useState, type RefObject } from "react";

/** What a toast must not cover. */
export const TOAST_AVOID = "[data-pane-tray], .side-col-composer, [data-toast-avoid]";
/** Of those, what sits along a side edge (a tray docked left / right): it narrows the room instead. */
const SIDE = "[data-pane-tray][data-vertical]";

export interface ToastRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToastObstacle extends ToastRect {
  /** Docked along the left or right edge (a side tray). */
  side?: boolean;
}

/** Where the toast goes: its top edge and the free span [left, right] it is centred in (and may not exceed). */
export interface ToastSpot {
  top: number;
  left: number;
  right: number;
}

const GAP = 8;
/** Kept clear of the window's own edges. */
const EDGE = 16;
/** The resting spot with nothing below it: this far above the window's bottom edge. */
const BOTTOM = 16;
/** Under the title bar when it cannot sit low. */
const TOP = 48;

/**
 * Where a toast of `toast` size goes in `view`, clear of `avoid`. Side boxes narrow the span; the rest are only
 * the ones the toast (centred in that span, at most its width) would cross horizontally.
 */
export function toastSpot(toast: { width: number; height: number }, view: { width: number; height: number }, avoid: readonly ToastObstacle[]): ToastSpot {
  let spanLeft = EDGE, spanRight = view.width - EDGE;
  for (const r of avoid) {
    if (!r.side || r.bottom <= r.top) continue;
    if ((r.left + r.right) / 2 < view.width / 2) spanLeft = Math.max(spanLeft, r.right + GAP);
    else spanRight = Math.min(spanRight, r.left - GAP);
  }
  if (spanRight < spanLeft) spanLeft = spanRight = (spanLeft + spanRight) / 2;
  const width = Math.min(toast.width, spanRight - spanLeft);
  const centre = (spanLeft + spanRight) / 2;
  const left = centre - width / 2 - GAP, right = centre + width / 2 + GAP;
  const across = avoid.filter((r) => !r.side && r.right > left && r.left < right && r.bottom > r.top);
  // Low: above everything in the lower part of the window.
  let floor = view.height - BOTTOM;
  for (const r of across) if (r.bottom > view.height * 0.4) floor = Math.min(floor, r.top - GAP);
  const low = floor - toast.height;
  if (low >= view.height * 0.3) return { top: low, left: spanLeft, right: spanRight };
  // High: under the title bar and anything docked at the top (a top tray).
  let top = TOP;
  for (const r of across) if (r.bottom <= view.height * 0.4) top = Math.max(top, r.bottom + GAP);
  return { top, left: spanLeft, right: spanRight };
}

/** The top edge only (no side boxes), for callers that centre in the whole window. */
export function toastTop(toast: { width: number; height: number }, view: { width: number; height: number }, avoid: readonly ToastRect[]): number {
  return toastSpot(toast, view, avoid).top;
}

function obstacles(doc: Document): ToastObstacle[] {
  return [...doc.querySelectorAll<HTMLElement>(TOAST_AVOID)].flatMap((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [{ left: r.left, top: r.top, right: r.right, bottom: r.bottom, side: el.matches(SIDE) }] : [];
  });
}

/**
 * The fixed position for a toast `ref` (its card) while `shown`: the wrapper takes `top` / `left` / `right` and
 * centres the card in that span; the card takes `maxWidth`. Kept up to date while it is up (the composer grows,
 * the tray moves, the window resizes). Before the first measure: off screen.
 */
export function useToastSpot(ref: RefObject<HTMLElement | null>, shown: unknown): { wrapper: { top: number; left: number; right: number }; maxWidth: number | undefined } {
  const [spot, setSpot] = useState<ToastSpot | null>(null);
  const [view, setView] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    const place = () => {
      const b = el.getBoundingClientRect();
      const s = toastSpot({ width: b.width, height: b.height }, { width: win.innerWidth, height: win.innerHeight }, obstacles(el.ownerDocument));
      const next = { top: Math.round(s.top), left: Math.round(s.left), right: Math.round(s.right) };
      setSpot((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.right === next.right ? prev : next));
      setView((prev) => (prev === win.innerWidth ? prev : win.innerWidth));
    };
    place();
    win.addEventListener("resize", place);
    const timer = win.setInterval(place, 400);
    return () => {
      win.removeEventListener("resize", place);
      win.clearInterval(timer);
    };
  }, [ref, shown]);
  if (!spot) return { wrapper: { top: -9999, left: 0, right: 0 }, maxWidth: undefined };
  return { wrapper: { top: spot.top, left: spot.left, right: Math.max(0, view - spot.right) }, maxWidth: Math.max(0, spot.right - spot.left) };
}
