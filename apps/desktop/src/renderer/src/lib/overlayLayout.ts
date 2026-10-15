// Space the `conversation.overlay` items reserve (docs/desktop-modules.md §16.5): the conversation
// turns their reported layouts into insets of the reading column, without knowing who they are.
import type { OverlayLayout } from "../modules/slots";

export interface OverlayInsets {
  /** Extra top inset of the column (an overlay floats over its top). */
  top: boolean;
  /** Extra bottom inset of the column. */
  bottom: boolean;
  /** Something floats at the top edge: sticky headers (an expanded message's 收起) sit below it. */
  stickyTop: boolean;
}

export function overlayInsets(layouts: Iterable<OverlayLayout>): OverlayInsets {
  const out: OverlayInsets = { top: false, bottom: false, stickyTop: false };
  for (const l of layouts) {
    if (l.anchor === "top") out.stickyTop = true;
    if (l.overColumn && l.anchor === "top") out.top = true;
    if (l.overColumn && l.anchor === "bottom") out.bottom = true;
  }
  return out;
}

/** The reservations map after `id` reports `layout` (same map when nothing changed). */
export function withReservation(map: ReadonlyMap<string, OverlayLayout>, id: string, layout: OverlayLayout | null): ReadonlyMap<string, OverlayLayout> {
  const before = map.get(id);
  if (layout === null) {
    if (!before) return map;
    const next = new Map(map);
    next.delete(id);
    return next;
  }
  if (before && before.anchor === layout.anchor && before.overColumn === layout.overColumn && before.side === layout.side) return map;
  return new Map(map).set(id, layout.side ? { anchor: layout.anchor, overColumn: layout.overColumn, side: layout.side } : { anchor: layout.anchor, overColumn: layout.overColumn });
}

/** A window-edge overlay (the capsule beside the column) the gutters keep clear of (§19.2); null = none. */
export function edgeOverlay(layouts: Iterable<OverlayLayout>): { side: "left" | "right"; anchor: "top" | "bottom" } | null {
  for (const l of layouts) if (!l.overColumn && l.side) return { side: l.side, anchor: l.anchor };
  return null;
}
