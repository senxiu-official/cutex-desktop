// Where the right side sits (lib/sideFrame.ts; docs/desktop-modules.md §18.3–§18.4, RFC §3.8a):
// closed / in the row (并排, 让位) / over the conversation (悬浮) / drawer / maximised / full screen,
// the width it takes from the conversation card and the 让位 shift of the reading column.
import { describe, expect, it } from "vitest";
import { FLOAT_KEEP, LANE_EXTRA, sideFrame, type SideFrameInput } from "../src/renderer/src/lib/sideFrame";
import { DRAWER_MARGIN, LANE_WIDTH, MIN_CONVERSATION, MIN_SIDE } from "../src/renderer/src/lib/sideLayout";

const base: SideFrameInput = { areaWidth: 1400, stored: 420, open: true, pages: 1, laneWhenHidden: "keep", pageBar: "tabs", mode: "yield", layered: null };
const frame = (over: Partial<SideFrameInput>) => sideFrame({ ...base, ...over });

describe("sideFrame (右栏布局 = 仅标签页)", () => {
  it("closed: nothing, or the vertical page-button lane with ≥ 2 pages and 保留页按钮 (never the tab row)", () => {
    expect(frame({ open: false })).toEqual({ kind: "closed", narrow: false, lane: false, strip: false, width: 0, inFlow: 0, shift: 0 });
    expect(frame({ open: false, pages: 2 })).toMatchObject({ kind: "closed", lane: true, strip: false, width: LANE_WIDTH, inFlow: LANE_WIDTH });
    expect(frame({ open: false, pages: 2, laneWhenHidden: "hide" })).toMatchObject({ kind: "closed", lane: false, width: 0, inFlow: 0 });
  });

  it("并排 takes its width from the conversation, no shift; 让位 shifts the reading column by the same", () => {
    expect(frame({ mode: "push" })).toEqual({ kind: "flow", narrow: false, lane: false, strip: false, width: 420, inFlow: 420, shift: 0 });
    expect(frame({ mode: "yield" })).toEqual({ kind: "flow", narrow: false, lane: false, strip: false, width: 420, inFlow: 420, shift: 420 });
    // With a kept lane the closed side already took 44 px: the shift is only the difference. The
    // open side's width is the column's alone (the tab row sits inside it).
    expect(frame({ mode: "yield", pages: 3 })).toMatchObject({ lane: false, strip: true, width: 420, inFlow: 420, shift: 420 - LANE_WIDTH });
    expect(frame({ mode: "yield", pages: 3, laneWhenHidden: "hide" })).toMatchObject({ shift: 420 });
  });

  it("in the row the conversation keeps its minimum; the side never goes below its own", () => {
    const area = MIN_CONVERSATION + MIN_SIDE + 100;
    expect(frame({ areaWidth: area, stored: 1600 }).width).toBe(area - MIN_CONVERSATION - 8);
    expect(frame({ areaWidth: area, stored: 100 }).width).toBe(MIN_SIDE);
  });

  it("悬浮: over the conversation (only the lane in the row), never closer than FLOAT_KEEP to covering it all", () => {
    expect(frame({ mode: "float" })).toEqual({ kind: "float", narrow: false, lane: false, strip: false, width: 420, inFlow: 0, shift: 0 });
    // The closed lane's room stays reserved under the open column (opening does not reflow the conversation).
    expect(frame({ mode: "float", pages: 2 })).toMatchObject({ kind: "float", lane: false, strip: true, width: 420, inFlow: LANE_WIDTH });
    expect(frame({ mode: "float", pages: 2, laneWhenHidden: "hide" })).toMatchObject({ strip: true, inFlow: 0 });
    expect(frame({ mode: "float", areaWidth: 700, stored: 1600 }).width).toBe(700 - FLOAT_KEEP);
  });

  it("narrow window: a drawer over the conversation whatever the mode; the lane keeps its place", () => {
    const area = MIN_CONVERSATION + MIN_SIDE - 1;
    for (const mode of ["push", "yield", "float"] as const) {
      expect(frame({ areaWidth: area, mode })).toMatchObject({ kind: "drawer", narrow: true, inFlow: 0, shift: 0 });
    }
    expect(frame({ areaWidth: 400, stored: 1600 }).width).toBe(400 - DRAWER_MARGIN);
    expect(frame({ areaWidth: area, pages: 2 })).toMatchObject({ kind: "drawer", lane: false, strip: true, inFlow: LANE_WIDTH });
    expect(frame({ areaWidth: area, pages: 2, laneWhenHidden: "hide" })).toMatchObject({ kind: "drawer", strip: true, inFlow: 0 });
    // Not measured yet: never narrow.
    expect(frame({ areaWidth: 0 })).toMatchObject({ kind: "flow", narrow: false });
  });

  it("the tab row: only with the column open and ≥ 2 pages, in every open form", () => {
    for (const over of [{}, { mode: "push" }, { mode: "float" }, { areaWidth: 500 }, { layered: "maximised" }, { layered: "fullscreen" }] as Partial<SideFrameInput>[]) {
      expect(frame({ ...over, pages: 1 }).strip).toBe(false);
      expect(frame({ ...over, pages: 2 })).toMatchObject({ strip: true, lane: false });
      expect(frame({ ...over, pages: 2, open: false })).toMatchObject({ strip: false, lane: true });
    }
  });

  it("maximised / full screen: the conversation keeps its open-column width underneath (no reflow)", () => {
    expect(frame({ layered: "maximised" })).toMatchObject({ kind: "maximised", width: 1400, inFlow: 420, shift: 0 });
    expect(frame({ layered: "fullscreen", mode: "float", pages: 2 })).toMatchObject({ kind: "fullscreen", lane: false, strip: true, inFlow: LANE_WIDTH });
    expect(frame({ layered: "maximised", pages: 2 })).toMatchObject({ kind: "maximised", lane: false, strip: true, inFlow: 420 });
    expect(frame({ layered: "maximised", areaWidth: 500 })).toMatchObject({ kind: "maximised", narrow: true, inFlow: 0 });
    // A mode needs the column open.
    expect(frame({ layered: "maximised", open: false }).kind).toBe("closed");
  });
});

describe("sideFrame (右栏布局 = 竖条 + 标签页, ★ owner 2026-10-14)", () => {
  const lane = (over: Partial<SideFrameInput>) => frame({ pageBar: "lane", ...over });

  it("one page: exactly as 仅标签页 (no lane, no tab row)", () => {
    for (const over of [{}, { mode: "push" }, { mode: "float" }, { areaWidth: 500 }, { layered: "maximised" }, { open: false }] as Partial<SideFrameInput>[]) {
      expect(lane(over)).toEqual(frame(over));
    }
  });

  it("≥ 2 pages: the lane in every open form, never the tab row; closed as before", () => {
    for (const over of [{}, { mode: "push" }, { mode: "float" }, { areaWidth: 500 }, { layered: "maximised" }, { layered: "fullscreen" }] as Partial<SideFrameInput>[]) {
      expect(lane({ ...over, pages: 2 })).toMatchObject({ lane: true, strip: false });
      expect(lane({ ...over, pages: 2, laneWhenHidden: "hide" })).toMatchObject({ lane: true, strip: false });
    }
    expect(lane({ pages: 2, open: false })).toEqual(frame({ pages: 2, open: false }));
    expect(lane({ pages: 2, open: false, laneWhenHidden: "hide" })).toMatchObject({ kind: "closed", lane: false, width: 0 });
  });

  it("the open lane takes the seam's place on top of the stored width (cards as wide as with 仅标签页); 让位 shifts by what the closed side did not take", () => {
    expect(lane({ pages: 2, mode: "push" })).toEqual({ kind: "flow", narrow: false, lane: true, strip: false, width: 420 + LANE_EXTRA, inFlow: 420 + LANE_EXTRA, shift: 0 });
    expect(lane({ pages: 2, mode: "yield" })).toMatchObject({ width: 420 + LANE_EXTRA, shift: 420 + LANE_EXTRA - LANE_WIDTH });
    expect(lane({ pages: 2, mode: "yield", laneWhenHidden: "hide" })).toMatchObject({ width: 420 + LANE_EXTRA, shift: 420 + LANE_EXTRA });
    // The conversation still keeps its minimum.
    const area = MIN_CONVERSATION + MIN_SIDE + 100;
    expect(lane({ pages: 2, areaWidth: area, stored: 1600 }).width).toBe(area - MIN_CONVERSATION - 8);
  });

  it("悬浮 / drawer / maximised: the lane's room stays reserved only as the closed lane's; widths include it", () => {
    expect(lane({ pages: 2, mode: "float" })).toMatchObject({ kind: "float", lane: true, width: 420 + LANE_EXTRA, inFlow: LANE_WIDTH });
    expect(lane({ pages: 2, areaWidth: MIN_CONVERSATION + MIN_SIDE - 1 })).toMatchObject({ kind: "drawer", lane: true, width: 420 + LANE_EXTRA, inFlow: LANE_WIDTH });
    expect(lane({ pages: 2, areaWidth: 400, stored: 1600 }).width).toBe(400 - DRAWER_MARGIN);
    expect(lane({ pages: 2, layered: "maximised" })).toMatchObject({ kind: "maximised", lane: true, width: 1400, inFlow: 420 + LANE_EXTRA });
  });

  it("LANE_EXTRA = the lane minus the seam it replaces", () => {
    expect(LANE_EXTRA).toBe(LANE_WIDTH - 8);
  });
});
