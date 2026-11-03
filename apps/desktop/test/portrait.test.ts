// @vitest-environment jsdom
// Portrait layout (owner 2026-10-30, design .claude/previews/portrait/design.md; lib/portrait): when a window is portrait
// (auto with hysteresis 1.2 / 1.05, never under 760 px, or the device-wide setting), the split share's clamping, the
// stored prefs (per window, apart from landscape), the setting deciding every window again, and the sidebar toggle.
import { beforeEach, describe, expect, it } from "vitest";
import {
  bandShelves,
  DEFAULT_PORTRAIT,
  PORTRAIT_KEY,
  STACK_CONVERSATION_MIN,
  STACK_SHELF_MIN,
  clampSplit,
  stackColumns,
  stackRows,
  decideOrientation,
  noteWindowBox,
  parsePortrait,
  portraitOn,
  resetPortraitForTest,
  setOrientationSetting,
  setPortraitPrefs,
  swapPortrait,
  togglePortraitSidebar,
  usePortrait,
} from "../src/renderer/src/lib/portrait";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";

const DESK = "d0123456789ab";

beforeEach(() => {
  localStorage.removeItem(PORTRAIT_KEY);
  resetPortraitForTest();
});

describe("decideOrientation", () => {
  it("auto enters portrait at height ≥ 1.2 × width and leaves only below 1.05 × (no flapping near square)", () => {
    expect(decideOrientation({ width: 1080, height: 1920 }, "auto", "landscape")).toBe("portrait");
    expect(decideOrientation({ width: 720, height: 1280 }, "auto", "landscape")).toBe("portrait");
    expect(decideOrientation({ width: 1000, height: 1150 }, "auto", "landscape")).toBe("landscape");
    expect(decideOrientation({ width: 1000, height: 1150 }, "auto", "portrait")).toBe("portrait");
    expect(decideOrientation({ width: 1000, height: 1040 }, "auto", "portrait")).toBe("landscape");
    expect(decideOrientation({ width: 1920, height: 1080 }, "auto", "portrait")).toBe("landscape");
  });

  it("a short window stays landscape whatever its shape; the setting overrides the shape; an unmeasured box keeps the last", () => {
    expect(decideOrientation({ width: 500, height: 700 }, "auto", "landscape")).toBe("landscape");
    expect(decideOrientation({ width: 500, height: 700 }, "auto", "portrait")).toBe("landscape");
    expect(decideOrientation({ width: 1920, height: 1080 }, "portrait", "landscape")).toBe("portrait");
    expect(decideOrientation({ width: 1080, height: 1920 }, "landscape", "portrait")).toBe("landscape");
    expect(decideOrientation({ width: 0, height: 0 }, "auto", "portrait")).toBe("portrait");
  });
});

describe("clampSplit", () => {
  it("keeps both parts at their minimum and snaps near the default", () => {
    expect(clampSplit(0.05, 1800)).toBeCloseTo(STACK_CONVERSATION_MIN / 1800, 3);
    expect(clampSplit(0.99, 1800)).toBeCloseTo(1 - STACK_SHELF_MIN / 1800, 3);
    expect(clampSplit(0.59, 1800)).toBe(DEFAULT_PORTRAIT.split);
    expect(clampSplit(0.4, 1800)).toBe(0.4);
    expect(clampSplit(Number.NaN, 1800)).toBe(DEFAULT_PORTRAIT.split);
    // A stack too short for both minimums: a plain share between 10 % and 90 %.
    expect(clampSplit(0.02, 300)).toBe(0.1);
  });
});

describe("parsePortrait", () => {
  it("reads the setting and each window's prefs defensively", () => {
    expect(parsePortrait(null)).toEqual({ setting: "auto", windows: {} });
    expect(parsePortrait("not json")).toEqual({ setting: "auto", windows: {} });
    expect(parsePortrait("[1]")).toEqual({ setting: "auto", windows: {} });
    const raw = JSON.stringify({ setting: "portrait", windows: { main: { split: 0.4, swapped: true, sidebarShown: true }, [DESK]: { split: 7 }, bogus: { split: 0.3 } } });
    expect(parsePortrait(raw)).toEqual({
      setting: "portrait",
      windows: { main: { split: 0.4, swapped: true, sidebarShown: true }, [DESK]: { split: DEFAULT_PORTRAIT.split, swapped: false, sidebarShown: false } },
    });
  });
});

describe("the per-window store", () => {
  it("each window follows its own size; its prefs are its own and stored apart from landscape", () => {
    expect(noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 })).toBe("landscape");
    expect(noteWindowBox(DESK, { width: 1080, height: 1920 })).toBe("portrait");
    expect(portraitOn(MAIN_WINDOW)).toBe(false);
    expect(portraitOn(DESK)).toBe(true);
    setPortraitPrefs(DESK, { split: 0.4 });
    swapPortrait(DESK);
    expect(usePortrait.of(DESK).getState().prefs).toEqual({ split: 0.4, swapped: true, sidebarShown: false });
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs).toEqual(DEFAULT_PORTRAIT);
    expect(JSON.parse(localStorage.getItem(PORTRAIT_KEY)!).windows[DESK]).toEqual({ split: 0.4, swapped: true, sidebarShown: false });
  });

  it("the setting decides every measured window again (always portrait / always landscape / auto)", () => {
    noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 });
    noteWindowBox(DESK, { width: 1080, height: 1920 });
    setOrientationSetting("portrait");
    expect([portraitOn(MAIN_WINDOW), portraitOn(DESK)]).toEqual([true, true]);
    setOrientationSetting("landscape");
    expect([portraitOn(MAIN_WINDOW), portraitOn(DESK)]).toEqual([false, false]);
    setOrientationSetting("auto");
    expect([portraitOn(MAIN_WINDOW), portraitOn(DESK)]).toEqual([false, true]);
    expect(JSON.parse(localStorage.getItem(PORTRAIT_KEY)!).setting).toBe("auto");
  });

  it("the sidebar toggle is portrait's own while portrait, landscape's again after; the portrait prefs are kept", () => {
    expect(togglePortraitSidebar(MAIN_WINDOW)).toBe(false);
    noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 });
    expect(togglePortraitSidebar(MAIN_WINDOW)).toBe(true);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.sidebarShown).toBe(true);
    expect(noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 })).toBe("landscape");
    expect(togglePortraitSidebar(MAIN_WINDOW)).toBe(false);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.sidebarShown).toBe(true);
  });
});

// P3: two workspaces side by side when each column gets 520 px (back below that only 16 px under it), left + right
// Shelves side by side in the band when each gets 360 px (else the one in focus open, the other its rail, a view only).
describe("P3 room rules", () => {
  it("stackColumns: 2 × 520 + 8 px to stand side by side, 16 px of slack to stay", () => {
    expect(stackColumns(1064, false)).toBe(true);
    expect(stackColumns(1048, false)).toBe(true);
    expect(stackColumns(1047, false)).toBe(false);
    expect(stackColumns(1040, true)).toBe(true);
    expect(stackColumns(1032, true)).toBe(true);
    expect(stackColumns(1031, true)).toBe(false);
    // 1080 × 1920 at 150 % (a 704 px stack): never.
    expect(stackColumns(704, true)).toBe(false);
  });

  const L = { id: "l", side: "left" as const, expanded: true, active: false };
  const R = { id: "r", side: "right" as const, expanded: true, active: false };
  it("bandShelves: both open with the room; else the one in focus (else the right), the other its rail", () => {
    expect(bandShelves(1064, [L, R], false)).toEqual({ open: ["l", "r"], rails: [] });
    expect(bandShelves(704, [L, R], false)).toEqual({ open: ["r"], rails: ["l"] });
    expect(bandShelves(704, [{ ...L, active: true }, R], false)).toEqual({ open: ["l"], rails: ["r"] });
    // Hysteresis: open side by side down to 712 px, not at 704 (the design's narrow portrait).
    expect(bandShelves(720, [L, R], true)).toEqual({ open: ["l", "r"], rails: [] });
    expect(bandShelves(712, [L, R], true)).toEqual({ open: ["l", "r"], rails: [] });
    expect(bandShelves(704, [L, R], true)).toEqual({ open: ["r"], rails: ["l"] });
    expect(bandShelves(720, [L, R], false)).toEqual({ open: ["r"], rails: ["l"] });
    // A collapsed Shelf is its rail whatever the room; one open Shelf takes the band.
    expect(bandShelves(1064, [{ ...L, expanded: false }, R], false)).toEqual({ open: ["r"], rails: ["l"] });
    expect(bandShelves(300, [R], false)).toEqual({ open: ["r"], rails: [] });
  });

  it("stackRows: the conversation's share, the divider, the Shelves' (swapped: reversed), each at its minimum or more", () => {
    expect(stackRows(0.58, false)).toBe(`minmax(${STACK_CONVERSATION_MIN}px, 0.58fr) 8px minmax(${STACK_SHELF_MIN}px, 0.42fr)`);
    expect(stackRows(0.6, true)).toBe(`minmax(${STACK_SHELF_MIN}px, 0.4fr) 8px minmax(${STACK_CONVERSATION_MIN}px, 0.6fr)`);
  });
});
