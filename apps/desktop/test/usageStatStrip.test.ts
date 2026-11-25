// 用量 header strip (owner 2026-11-24): the stats wrap as a group with full rows only, a divider only between stats of
// one row (and before the first when beside the Token figure), sized by each column's own widest stat.
import { describe, expect, it } from "vitest";
import { columnChoices, hasDivider, statColumns, stripWidth } from "../src/renderer/src/modules/usage/statStrip";

describe("usage stat strip", () => {
  it("only full rows: 4 → 4 / 2 / 1, 3 → 3 / 1, 2 → 2 / 1", () => {
    expect(columnChoices(4)).toEqual([4, 2, 1]);
    expect(columnChoices(3)).toEqual([3, 1]);
    expect(columnChoices(2)).toEqual([2, 1]);
    expect(columnChoices(1)).toEqual([1]);
  });
  it("a column is as wide as its widest stat", () => {
    expect(stripWidth([100, 80, 60, 120], 4, 24)).toBe(100 + 80 + 60 + 120 + 3 * 24);
    expect(stripWidth([100, 80, 60, 120], 2, 24)).toBe(100 + 120 + 24);
    expect(stripWidth([100, 80, 60, 120], 1, 24)).toBe(120);
  });
  it("picks the widest layout that fits, never a lone stat on a row", () => {
    const w = [110, 90, 100, 120];
    expect(statColumns(w, 600, 24)).toBe(4);
    expect(statColumns(w, 360, 24)).toBe(2); // 3 columns (358) would fit: never chosen, it leaves one stat alone
    expect(statColumns(w, 200, 24)).toBe(1);
    expect(statColumns([110, 90, 100], 330, 24)).toBe(1); // 3 do not fit: one column, not 2 + 1
    expect(statColumns([110, 90, 100], 400, 24)).toBe(3);
  });
  it("dividers only inside a row, and before the first stat only beside the Token figure", () => {
    expect([0, 1, 2, 3].map((i) => hasDivider(i, 4, true))).toEqual([true, true, true, true]);
    expect([0, 1, 2, 3].map((i) => hasDivider(i, 4, false))).toEqual([false, true, true, true]);
    expect([0, 1, 2, 3].map((i) => hasDivider(i, 2, false))).toEqual([false, true, false, true]);
    expect([0, 1, 2].map((i) => hasDivider(i, 1, false))).toEqual([false, false, false]);
  });
});
