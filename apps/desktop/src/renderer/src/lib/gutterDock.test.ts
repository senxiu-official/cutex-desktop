import { describe, expect, it } from "vitest";
import { clampDockPref, DOCK_WIDTH_DEFAULT, DOCK_WIDTH_RANGE, dockWidth, dragDockWidth } from "./gutterDock";

describe("gutter dock width", () => {
  it("defaults to a narrow list, not the whole gutter", () => {
    expect(DOCK_WIDTH_DEFAULT).toBeGreaterThanOrEqual(240);
    expect(DOCK_WIDTH_DEFAULT).toBeLessThanOrEqual(280);
    expect(dockWidth(undefined, 900)).toBe(DOCK_WIDTH_DEFAULT);
  });
  it("clamps stored values to the range", () => {
    expect(clampDockPref(50)).toBe(DOCK_WIDTH_RANGE[0]);
    expect(clampDockPref(5000)).toBe(DOCK_WIDTH_RANGE[1]);
    expect(clampDockPref("300")).toBe(DOCK_WIDTH_DEFAULT);
    expect(clampDockPref(Number.NaN)).toBe(DOCK_WIDTH_DEFAULT);
    expect(clampDockPref(301.6)).toBe(302);
  });
  it("never exceeds the gutter's room", () => {
    expect(dockWidth(400, 320)).toBe(320);
    expect(dockWidth(260, 259.7)).toBe(259);
    expect(dockWidth(260, -5)).toBe(0);
  });
  it("drags towards the conversation to widen, per side", () => {
    expect(dragDockWidth("left", 260, 40)).toBe(300);
    expect(dragDockWidth("right", 260, 40)).toBe(220);
    expect(dragDockWidth("left", 260, -500)).toBe(DOCK_WIDTH_RANGE[0]);
  });
});
