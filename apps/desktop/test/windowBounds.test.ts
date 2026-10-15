import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_SIZE, parseWindowState, restoreWindowBounds } from "../src/shared/windowBounds";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("window bounds memory", () => {
  it("parses the stored record defensively", () => {
    expect(parseWindowState({ bounds: { x: 10.4, y: 20, width: 1000, height: 700 }, maximized: true })).toEqual({ bounds: { x: 10, y: 20, width: 1000, height: 700 }, maximized: true });
    expect(parseWindowState({ bounds: { x: 1, y: 2, width: 3, height: 4 } })?.maximized).toBe(false);
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 0, height: 10 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: "0", y: 0, width: 10, height: 10 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: Infinity, y: 0, width: 10, height: 10 } })).toBeNull();
  });

  it("nothing saved: the default size without a position (centred), fitted to a small primary display", () => {
    expect(restoreWindowBounds(null, [primary])).toEqual({ bounds: { ...DEFAULT_WINDOW_SIZE }, maximized: false });
    expect(restoreWindowBounds(null, [{ x: 0, y: 0, width: 1366, height: 728 }]).bounds).toEqual({ width: 1280, height: 728 });
    expect(restoreWindowBounds(null, []).bounds).toEqual({ ...DEFAULT_WINDOW_SIZE });
  });

  it("restores saved bounds on a connected display, including a secondary one", () => {
    expect(restoreWindowBounds({ bounds: { x: 100, y: 50, width: 1400, height: 900 }, maximized: false }, [primary, right])).toEqual({ bounds: { x: 100, y: 50, width: 1400, height: 900 }, maximized: false });
    expect(restoreWindowBounds({ bounds: { x: 2200, y: 100, width: 1600, height: 1000 }, maximized: true }, [primary, right])).toEqual({ bounds: { x: 2200, y: 100, width: 1600, height: 1000 }, maximized: true });
  });

  it("partly off-screen: moved fully onto the display it overlaps most, shrunk to its work area", () => {
    expect(restoreWindowBounds({ bounds: { x: 1500, y: -40, width: 1000, height: 800 }, maximized: false }, [primary]).bounds).toEqual({ x: 920, y: 0, width: 1000, height: 800 });
    expect(restoreWindowBounds({ bounds: { x: 0, y: 0, width: 3000, height: 2000 }, maximized: false }, [primary]).bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it("off-screen (display disconnected or a sliver left): default size, centred, maximized kept", () => {
    expect(restoreWindowBounds({ bounds: { x: 2200, y: 100, width: 1600, height: 1000 }, maximized: true }, [primary])).toEqual({ bounds: { ...DEFAULT_WINDOW_SIZE }, maximized: true });
    expect(restoreWindowBounds({ bounds: { x: 1900, y: 100, width: 1000, height: 800 }, maximized: false }, [primary]).bounds).toEqual({ ...DEFAULT_WINDOW_SIZE });
  });

  it("never smaller than the minimum unless the display itself is", () => {
    expect(restoreWindowBounds({ bounds: { x: 0, y: 0, width: 300, height: 200 }, maximized: false }, [primary]).bounds).toEqual({ x: 0, y: 0, width: 880, height: 560 });
    expect(restoreWindowBounds({ bounds: { x: 0, y: 0, width: 1000, height: 700 }, maximized: false }, [{ x: 0, y: 0, width: 800, height: 600 }]).bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
