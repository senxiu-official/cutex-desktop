// One-line chip strips without a horizontal scrollbar (「需要你」 above the composer, owner report
// 2026-10-15: many agents made it a long sideways slider). The strip measures its chips and shows the
// first ones that fit; the rest go behind one 「还有 N 项」 chip at the end.

/**
 * How many of `widths` (in order) fit in `available` px with `gap` between items. When not all
 * fit, the shown ones leave room for the overflow chip (`moreWidth`, plus its gap). Never negative.
 */
export function fitCount(widths: readonly number[], available: number, gap: number, moreWidth: number): number {
  const all = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= available) return widths.length;
  let used = moreWidth;
  let n = 0;
  for (const w of widths) {
    if (used + gap + w > available) break;
    used += gap + w;
    n++;
  }
  return n;
}

export type StripItem<C> = { kind: "chip"; chip: C } | { kind: "done"; chips: C[] };

/**
 * The strip's items in order: every chip that is not 完成 on its own (most urgent first, as given),
 * then the 完成 ones — one 「N 个已完成」 group when there are two or more, else the single chip.
 */
export function stripItems<C extends { signal: string }>(chips: readonly C[]): StripItem<C>[] {
  const done = chips.filter((c) => c.signal === "done");
  const rest: StripItem<C>[] = chips.filter((c) => c.signal !== "done").map((chip) => ({ kind: "chip", chip }));
  if (done.length >= 2) return [...rest, { kind: "done", chips: done }];
  return [...rest, ...done.map((chip): StripItem<C> => ({ kind: "chip", chip }))];
}
