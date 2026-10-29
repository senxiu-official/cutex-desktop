// Where a drop puts things (owner 2026-10-23, item 3b): the drop zone shows the drop's result, not half of the target.
// One source of truth: the caller runs the function the drop itself runs (lib/sideDrop applyToolDrop / applyWorkDrop)
// on the current layout, and these turn the predicted layout into boxes — a Shelf page's panes by the same
// cardHeights the page draws them with (components/side/SidePageView), conversation columns by the slots they take
// now (a column's width belongs to its place in the row: lib/workspaceRow `split`, the dragged widths by index).
// Pure; tested (test/dropForecast.test.ts).
import { cardHeights } from "./sideLayout";

export interface ForecastBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A pane of the page after the drop, as cardHeights needs it. */
export interface ForecastCard {
  id: string;
  size: number;
  collapsed: boolean;
  minHeight?: number;
}

/** Each pane's box in `column` (the page's body) after the drop, top → bottom, `gap` px between panes. */
export function pageForecast(cards: readonly ForecastCard[], column: ForecastBox, gap: number): Map<string, ForecastBox> {
  const single = cards.length === 1;
  const heights = cardHeights(
    cards.map((c) => ({ size: c.size, collapsed: c.collapsed && !single, minHeight: c.minHeight })),
    column.height,
    gap,
  );
  const out = new Map<string, ForecastBox>();
  let top = column.top;
  cards.forEach((c, k) => {
    const h = heights[k]?.height ?? 0;
    out.set(c.id, { left: column.left, top, width: column.width, height: h });
    top += h + gap;
  });
  return out;
}

/**
 * The conversation columns after a reorder: the column at place i of `after` takes the box of place i now (the
 * places sorted left → right). Empty when the set of columns changed (not a reorder).
 */
export function orderForecast(before: readonly string[], after: readonly string[], rects: ReadonlyMap<string, ForecastBox>): Map<string, ForecastBox> {
  const out = new Map<string, ForecastBox>();
  if (before.length !== after.length || before.some((id) => !after.includes(id))) return out;
  const slots = before.map((id) => rects.get(id)).filter((b): b is ForecastBox => !!b);
  if (slots.length !== before.length) return out;
  slots.sort((a, b) => a.left - b.left);
  after.forEach((id, i) => out.set(id, slots[i]!));
  return out;
}

/** Two boxes the same within `tol` px (a pane that does not move gets no ghost). */
export function sameBox(a: ForecastBox, b: ForecastBox, tol = 2): boolean {
  return Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}
