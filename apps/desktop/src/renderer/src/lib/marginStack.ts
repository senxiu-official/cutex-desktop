// Margin attachments (timeline.turnAttachment with `margin`, docs/desktop-modules.md §19.3): each sits
// beside its turn's first line and scrolls with it. When two would overlap, the later one is pushed
// down (document-comment layout): top = max(own anchor, previous bottom + gap). Pure.

export interface MarginBox {
  id: string;
  /** The anchor's top in the column (px). */
  anchor: number;
  height: number;
}

/** id → top (px, same coordinates as `anchor`). Boxes are taken in anchor order (ties: input order). */
export function marginStack(boxes: readonly MarginBox[], gap = 8): Map<string, number> {
  const sorted = boxes.map((b, i) => ({ b, i })).sort((x, y) => x.b.anchor - y.b.anchor || x.i - y.i);
  const out = new Map<string, number>();
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { b } of sorted) {
    const top = Math.max(b.anchor, bottom + gap);
    out.set(b.id, top);
    bottom = top + Math.max(0, b.height);
  }
  return out;
}
