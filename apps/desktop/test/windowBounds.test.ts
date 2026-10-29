import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_SIZE, parseWindowState, restoreWindowBounds, settleWindowBounds, type BoundsWindow, type Rect } from "../src/shared/windowBounds";

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

// The main window grew 2–4 DIP per start at 150 % (dual-screen run 2026-10-28: 1282 → 1284 → 1287 → 1291 → 1295 → 1299):
// on Windows a hidden-title-bar window reads back a little larger than it was created / set with, and that was saved.
// A model of it: DIP → device px rounded, plus a border the size forgets (more at creation), read back rounding up.
// (The real thing, Electron 44 at 150 % on local-host: unsettled 1282 → … → 1303 over six starts; settled 1282 every time.)
function driftingWindow(scale: number, created: Rect, opts: { createInset?: number; setInset?: number } = {}): BoundsWindow & { sets: number } {
  const px = (dip: number, inset: number) => Math.round(dip * scale) + inset;
  const dip = (p: number) => Math.ceil(p / scale - 1e-9);
  const read = (r: Rect, inset: number): Rect => ({ x: r.x, y: r.y, width: dip(px(r.width, inset)), height: dip(px(r.height, inset)) });
  let now = read(created, opts.createInset ?? 2);
  return {
    sets: 0,
    getNormalBounds: () => ({ ...now }),
    setBounds(r: Rect) {
      this.sets++;
      now = read(r, opts.setInset ?? 1);
    },
  };
}

/** Six starts: create at the saved bounds (settled or not), save what it reads back. */
function restarts(scale: number, start: Rect, settle: boolean): Rect[] {
  const saved: Rect[] = [];
  let bounds = start;
  for (let i = 0; i < 6; i++) {
    const win = driftingWindow(scale, bounds);
    if (settle) settleWindowBounds(win, bounds);
    bounds = win.getNormalBounds();
    saved.push(bounds);
  }
  return saved;
}

describe("settleWindowBounds: restoring a window does not grow it", () => {
  const start = { x: 200, y: 100, width: 1282, height: 820 };

  it.each([1, 1.25, 1.5])("at %s× the unsettled window grows on every start (the bug, in the model)", (scale) => {
    const widths = restarts(scale, start, false).map((b) => b.width);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]!);
  });

  it.each([1, 1.25, 1.5])("at %s× the settled bounds round-trip: saved = restored on every start", (scale) => {
    const saved = restarts(scale, start, true);
    // The first start may move to the nearest size whole device pixels can give (±1 DIP); from then on nothing changes.
    expect(Math.abs(saved[0]!.width - start.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(saved[0]!.height - start.height)).toBeLessThanOrEqual(1);
    expect(saved[0]).toMatchObject({ x: start.x, y: start.y });
    for (const b of saved) expect(b).toEqual(saved[0]);
  });

  it.each([
    [1, { x: 0, y: 0, width: 1280, height: 820 }],
    [1.25, { x: 40, y: 32, width: 1280, height: 820 }],
    [1.5, { x: 200, y: 100, width: 1282, height: 822 }],
  ] as const)("at %s× a size device pixels can give comes back exactly", (scale, want) => {
    const win = driftingWindow(scale, want);
    expect(settleWindowBounds(win, want)).toEqual(want);
    expect(win.getNormalBounds()).toEqual(want);
    expect(win.sets).toBeLessThanOrEqual(3);
  });

  it("no setBounds when the window already has its bounds; the default size keeps the position it was given", () => {
    const exact = driftingWindow(1, { x: 5, y: 6, width: 1000, height: 700 }, { createInset: 0, setInset: 0 });
    settleWindowBounds(exact, { x: 5, y: 6, width: 1000, height: 700 });
    expect(exact.sets).toBe(0);
    const centred = driftingWindow(1.5, { x: 320, y: 110, width: 1280, height: 820 });
    expect(settleWindowBounds(centred, { width: 1280, height: 820 })).toEqual({ x: 320, y: 110, width: 1280, height: 820 });
  });

  it("gives up after `tries` sets (a window that never takes the size is left as it is)", () => {
    const stuck: BoundsWindow & { sets: number } = { sets: 0, getNormalBounds: () => ({ x: 0, y: 0, width: 900, height: 600 }), setBounds() { this.sets++; } };
    expect(settleWindowBounds(stuck, { x: 0, y: 0, width: 1000, height: 700 })).toEqual({ x: 0, y: 0, width: 900, height: 600 });
    expect(stuck.sets).toBe(3);
  });
});
