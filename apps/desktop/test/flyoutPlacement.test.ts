// Menu flyout placement (renderer lib/flyoutPlacement): placed once, then the side and the anchored
// edge stay while the content changes size.
import { describe, expect, it } from "vitest";
import { placeFlyout } from "../src/renderer/src/lib/flyoutPlacement";

const view = { width: 1280, height: 800 };
const row = { top: 505, bottom: 537, right: 243 };
const size = (height: number, width = 330) => ({ width, height });

describe("placeFlyout", () => {
  it("opens beside its row when it fits", () => {
    expect(placeFlyout(row, size(273), view)).toEqual({ side: "right", anchor: "top", offset: -4 });
  });
  it("opens left when there is no room on the right", () => {
    expect(placeFlyout({ ...row, right: 1100 }, size(273), view).side).toBe("left");
  });
  it("lifts to the window's bottom edge when it would run past it", () => {
    const p = placeFlyout(row, size(373), view);
    expect(p).toEqual({ side: "right", anchor: "bottom", offset: 537 - 796 });
  });
  it("clamps a flyout taller than the window to the top margin", () => {
    expect(placeFlyout(row, size(900), view)).toEqual({ side: "right", anchor: "top", offset: 4 - 505 });
  });
  it("keeps its side on a resize", () => {
    const p = placeFlyout({ ...row, right: 1100 }, size(273), view);
    expect(placeFlyout({ ...row, right: 1100 }, size(273, 100), view, p).side).toBe("left");
  });
  it("a flyout beside its row grows downwards", () => {
    const p = placeFlyout(row, size(100), view);
    expect(placeFlyout(row, size(250), view, p)).toEqual(p);
    expect(placeFlyout(row, size(60), view, p)).toEqual(p);
  });
  it("moves up only once growing would run past the window", () => {
    const p = placeFlyout(row, size(100), view);
    expect(placeFlyout(row, size(400), view, p)).toEqual({ side: "right", anchor: "bottom", offset: 537 - 796 });
  });
  it("a lifted flyout keeps its bottom edge when it grows or shrinks", () => {
    const p = placeFlyout(row, size(373), view);
    expect(placeFlyout(row, size(500), view, p)).toEqual(p);
    expect(placeFlyout(row, size(273), view, p)).toEqual(p);
  });
  it("a lifted flyout that shrinks away from its row goes back beside it", () => {
    const p = placeFlyout(row, size(373), view);
    expect(placeFlyout(row, size(200), view, p)).toEqual({ side: "right", anchor: "top", offset: -4 });
  });
});
