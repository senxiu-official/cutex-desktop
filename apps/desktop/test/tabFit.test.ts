// lib/tabFit (owner 2026-10-23): which tabs of a pane's row show, which go into 「⌄ N」, and when the pane's own
// buttons go compact so the titles stay readable.
import { describe, expect, it } from "vitest";
import { fitTabs, headerCompact, TAB_ACTIVE_MIN, TAB_GAP, TAB_MIN, TAB_MORE_W, TAB_PLUS_W, tabsNeed } from "../src/renderer/src/lib/tabFit";

describe("fitTabs", () => {
  it("all of them when they fit at their minimum (or the row is not measured yet)", () => {
    expect(fitTabs({ count: 3, active: 0, width: 0, plus: true })).toEqual({ shown: [0, 1, 2], hidden: [] });
    const w = tabsNeed(3, true) + TAB_PLUS_W;
    expect(fitTabs({ count: 3, active: 1, width: w, plus: true })).toEqual({ shown: [0, 1, 2], hidden: [] });
  });

  it("short of room: the first ones in order and the 「⌄ N」 list; the active one always stays in the row", () => {
    const w = tabsNeed(3, true) + TAB_PLUS_W + TAB_MORE_W;
    expect(fitTabs({ count: 6, active: 0, width: w, plus: true })).toEqual({ shown: [0, 1, 2], hidden: [3, 4, 5] });
    expect(fitTabs({ count: 6, active: 5, width: w, plus: true })).toEqual({ shown: [0, 1, 5], hidden: [2, 3, 4] });
    // Hardly any room: the active tab alone.
    expect(fitTabs({ count: 6, active: 4, width: 50, plus: true })).toEqual({ shown: [4], hidden: [0, 1, 2, 3, 5] });
  });

  it("the active tab's larger minimum counts", () => {
    expect(tabsNeed(2, true)).toBe(TAB_MIN + TAB_ACTIVE_MIN + TAB_GAP);
    expect(tabsNeed(2, false)).toBe(2 * TAB_MIN + TAB_GAP);
  });
});

describe("headerCompact", () => {
  it("the buttons go compact when, at full size, they leave less than two tabs' minimum", () => {
    const want = tabsNeed(2, true) + TAB_PLUS_W + TAB_MORE_W;
    expect(headerCompact({ header: 800, fixed: 100, full: 300, count: 5, plus: true })).toBe(800 - 400 < want);
    expect(headerCompact({ header: 1200, fixed: 100, full: 300, count: 5, plus: true })).toBe(false);
    expect(headerCompact({ header: 420, fixed: 100, full: 250, count: 5, plus: true })).toBe(true);
    expect(headerCompact({ header: 0, fixed: 100, full: 250, count: 5, plus: true })).toBe(false);
  });
});
