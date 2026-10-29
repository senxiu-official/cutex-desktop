// Shared portal submenu placement: window coordinates, a viewport-safe side and stable
// vertical anchoring as live content changes size. Measured sizes include pointer padding.
import { describe, expect, it } from "vitest";
import { placeFlyout, samePlace } from "../src/renderer/src/lib/flyoutPlacement";

const view = { width: 1280, height: 800 };
const row = { left: 43, top: 505, bottom: 537, right: 243 };
const size = (height: number, width = 330) => ({ width, height });

describe("placeFlyout", () => {
  it("opens beside its row when it fits", () => {
    expect(placeFlyout(row, size(273), view)).toEqual({ side: "right", anchor: "top", offset: -4, left: 243, top: 501 });
  });
  it("opens left when there is no room on the right", () => {
    expect(placeFlyout({ ...row, left: 900, right: 1100 }, size(273), view)).toEqual({ side: "left", anchor: "top", offset: -4, left: 570, top: 501 });
  });
  it("lifts to the window's bottom edge when it would run past it", () => {
    const p = placeFlyout(row, size(373), view);
    expect(p).toEqual({ side: "right", anchor: "bottom", offset: 537 - 796, left: 243, top: 423 });
  });
  it("clamps a flyout taller than the window to the top margin", () => {
    expect(placeFlyout(row, size(900), view)).toEqual({ side: "right", anchor: "top", offset: 4 - 505, left: 243, top: 4 });
  });
  it("keeps the top edge of an initially oversized list fixed when live content shrinks", () => {
    const initial = placeFlyout(row, size(900), view);
    expect(placeFlyout(row, size(500), view, initial)).toEqual({ side: "right", anchor: "top", offset: 4 - 505, left: 243, top: 4 });
    expect(placeFlyout(row, size(100), view, initial)).toEqual({ side: "right", anchor: "top", offset: 4 - 505, left: 243, top: 4 });
  });
  it("keeps its side on a resize while that side still fits", () => {
    const rightRow = { ...row, left: 900, right: 1100 };
    const p = placeFlyout(rightRow, size(273), view);
    expect(placeFlyout(rightRow, size(273, 100), view, p)).toEqual({ side: "left", anchor: "top", offset: -4, left: 800, top: 501 });
  });
  it("a flyout beside its row grows downwards", () => {
    const p = placeFlyout(row, size(100), view);
    expect(placeFlyout(row, size(250), view, p)).toEqual(p);
    expect(placeFlyout(row, size(60), view, p)).toEqual(p);
  });
  it("moves up only once growing would run past the window", () => {
    const p = placeFlyout(row, size(100), view);
    expect(placeFlyout(row, size(400), view, p)).toEqual({ side: "right", anchor: "bottom", offset: 537 - 796, left: 243, top: 396 });
  });
  it("a lifted flyout keeps its bottom edge when it grows or shrinks", () => {
    const p = placeFlyout(row, size(373), view);
    expect(placeFlyout(row, size(500), view, p)).toEqual({ ...p, top: 296 });
    expect(placeFlyout(row, size(273), view, p)).toEqual({ ...p, top: 523 });
  });
  it("a lifted flyout that shrinks away from its row goes back beside it", () => {
    const p = placeFlyout(row, size(373), view);
    expect(placeFlyout(row, size(200), view, p)).toEqual({ side: "right", anchor: "top", offset: -4, left: 243, top: 501 });
  });

  it("prefers the right when both sides fit on first opening", () => {
    expect(placeFlyout({ ...row, left: 500, right: 700 }, size(100), view)).toEqual({ side: "right", anchor: "top", offset: -4, left: 700, top: 501 });
  });

  it("accepts an exact right fit including the four-pixel pointer bridge", () => {
    // 326px content + 4px bridge ends at the viewport's 4px margin.
    expect(placeFlyout({ ...row, left: 746, right: 946 }, size(100, 326 + 4), view)).toEqual({ side: "right", anchor: "top", offset: -4, left: 946, top: 501 });
  });

  it("uses the left only when its entire measured width fits", () => {
    expect(placeFlyout({ ...row, left: 334, right: 500 }, size(100), { width: 800, height: 800 })).toEqual({ side: "left", anchor: "top", offset: -4, left: 4, top: 501 });
  });

  it("clamps inside the viewport when neither side fits instead of overflowing the left", () => {
    // The parent fits; the model submenu is too wide for either adjacent space.
    expect(placeFlyout({ ...row, left: 120, right: 400 }, size(100), { width: 600, height: 800 })).toEqual({ side: "right", anchor: "top", offset: -4, left: 266, top: 501 });
  });

  it("fits an oversized submenu into a narrow viewport with both margins intact", () => {
    const narrowView = { width: 240, height: 800 };
    const p = placeFlyout({ ...row, left: 20, right: 220 }, size(100, 334), narrowView);
    expect(p).toEqual({ side: "right", anchor: "top", offset: -4, left: 4, top: 501 });
    // MenuFlyout constrains the measured content to this available viewport width.
    expect(p.left + 232).toBe(narrowView.width - 4);
  });

  it("changes side when live content width no longer fits the old side", () => {
    const middleRow = { ...row, left: 700, right: 800 };
    const initial = placeFlyout(middleRow, size(100), view);
    expect(initial.side).toBe("right");
    expect(placeFlyout(middleRow, size(100, 500), view, initial)).toEqual({ side: "left", anchor: "top", offset: -4, left: 200, top: 501 });
  });

  it("abandons the old left side when an anchor move leaves room only on the right", () => {
    const initial = placeFlyout({ ...row, left: 900, right: 1100 }, size(100), view);
    expect(initial.side).toBe("left");
    expect(placeFlyout(row, size(100), view, initial)).toEqual({ side: "right", anchor: "top", offset: -4, left: 243, top: 501 });
  });

  it("reclamps an existing submenu when a viewport resize leaves neither side available", () => {
    const middleRow = { ...row, left: 240, right: 440 };
    const initial = placeFlyout(middleRow, size(100), view);
    expect(placeFlyout(middleRow, size(100), { width: 600, height: 800 }, initial)).toEqual({ side: "right", anchor: "top", offset: -4, left: 266, top: 501 });
  });

  it("clamps a row above the viewport to the top margin", () => {
    expect(placeFlyout({ ...row, top: -20, bottom: 12 }, size(100), view)).toEqual({ side: "right", anchor: "top", offset: 24, left: 243, top: 4 });
  });

  it("keeps a tall scrolling list within a short viewport", () => {
    const shortView = { width: 1280, height: 180 };
    expect(placeFlyout({ ...row, top: 100, bottom: 132 }, size(1000), shortView)).toEqual({ side: "right", anchor: "top", offset: -96, left: 243, top: 4 });
  });

  it("bottom-aligns composer flyouts beside their row and grows upward", () => {
    const initial = placeFlyout(row, size(100), view, undefined, "bottom");
    expect(initial).toEqual({ side: "right", anchor: "bottom", offset: -4, left: 243, top: 441 });
    expect(placeFlyout(row, size(250), view, initial, "bottom")).toEqual({ ...initial, top: 291 });
  });

  it("clamps a bottom-aligned list whose preferred top would be above the viewport", () => {
    expect(placeFlyout({ ...row, top: 10, bottom: 42 }, size(200), view, undefined, "bottom")).toEqual({ side: "right", anchor: "bottom", offset: -162, left: 243, top: 4 });
  });
});

describe("samePlace", () => {
  it("detects absolute movement even when the relative anchor stays unchanged", () => {
    const p = placeFlyout(row, size(100), view);
    expect(samePlace(null, p)).toBe(false);
    expect(samePlace(p, { ...p })).toBe(true);
    expect(samePlace(p, { ...p, left: p.left + 1 })).toBe(false);
    expect(samePlace(p, { ...p, top: p.top + 1 })).toBe(false);
    expect(samePlace(p, { ...p, offset: p.offset + 1 })).toBe(false);
    expect(samePlace(p, { ...p, side: "left" })).toBe(false);
    expect(samePlace(p, { ...p, anchor: "bottom" })).toBe(false);
  });

  it("ignores sub-half-pixel measurement noise", () => {
    const p = placeFlyout(row, size(100), view);
    expect(samePlace(p, { ...p, left: p.left + 0.25, top: p.top - 0.25, offset: p.offset + 0.25 })).toBe(true);
    expect(samePlace(p, { ...p, left: p.left + 0.5 })).toBe(false);
  });
});
