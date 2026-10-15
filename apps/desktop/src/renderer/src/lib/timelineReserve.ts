// What the timeline keeps clear for things that stay floating over it (UI review 2026-10-15 #1): the
// boxes a reserving `conversation.overlay` item draws (the status capsule as it is now) and the
// gutter's top entries (书签 / 批注) — only where they cross the reading column. The conversation pads
// the column's top / bottom by the band they take, so the first and the last message (and a card's
// buttons, e.g. 「知道了」) are never under them. Pure; the conversation measures (components/Conversation).

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Bands {
  /** px from the scroller's top edge that floating boxes cover over the column (0 = none). */
  top: number;
  /** px from the scroller's bottom edge. */
  bottom: number;
}

/**
 * The bands `boxes` take over the column (`column`: the text column's box; `scroller`: the
 * timeline's viewport). A box belongs to the edge its centre is nearer to; boxes beside the column
 * (wide window, gutter) reserve nothing.
 */
export function reservedBands(scroller: Box, column: Box, boxes: readonly Box[]): Bands {
  const out: Bands = { top: 0, bottom: 0 };
  const middle = (scroller.top + scroller.bottom) / 2;
  for (const b of boxes) {
    if (b.right <= column.left || b.left >= column.right || b.bottom <= b.top) continue;
    if (b.bottom <= scroller.top || b.top >= scroller.bottom) continue;
    if ((b.top + b.bottom) / 2 <= middle) out.top = Math.max(out.top, Math.ceil(b.bottom - scroller.top));
    else out.bottom = Math.max(out.bottom, Math.ceil(scroller.bottom - b.top));
  }
  return out;
}

/** Column padding for the bands: the defaults (16 / 32 px) or the band plus a gap. */
export function bandPadding(bands: Bands): { top: number; bottom: number } {
  return { top: bands.top > 0 ? Math.max(16, bands.top + 8) : 16, bottom: bands.bottom > 0 ? Math.max(32, bands.bottom + 12) : 32 };
}
