// A Shelf over part of the desktop (owner 2026-11-10): the widgets are drawn in the columns left free — a view of the
// saved layout (modules/home/deskCells reflowCells), never written back; when the room comes back the desktop is
// exactly as it was. Boxes wholly inside stay; the others keep the reading order; too wide for the free columns: hidden.
import { describe, expect, it } from "vitest";
import { coverOf, PITCH, reflowCells, spanPx, visibleCols, type Cells } from "../src/renderer/src/modules/home/deskCells";

const deepFreeze = <T>(o: T): T => {
  for (const v of Object.values(o as object)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

// A 12-column desktop: profile (8 wide) + clock on the left half's rows, tiles on the right.
const saved = (): Record<string, Cells> => ({
  profile: { x: 0, y: 0, w: 8, h: 2 },
  clock: { x: 0, y: 2, w: 4, h: 2 },
  world: { x: 4, y: 2, w: 6, h: 2 },
  tileA: { x: 10, y: 0, w: 2, h: 2 },
  tileB: { x: 10, y: 2, w: 2, h: 2 },
  tileC: { x: 4, y: 4, w: 2, h: 2 },
});

describe("which columns are free", () => {
  it("nothing covered: all of them", () => {
    expect(visibleCols(spanPx(12), 12, { left: 0, right: 0 })).toEqual({ from: 0, count: 12 });
  });
  it("a Shelf over the right: the columns that end left of it", () => {
    // 12 columns exactly fill the width; the right 5 columns' px are covered.
    expect(visibleCols(spanPx(12), 12, { left: 0, right: 5 * PITCH })).toEqual({ from: 0, count: 7 });
    expect(visibleCols(spanPx(12), 12, { left: 0, right: 5 * PITCH + 1 })).toEqual({ from: 0, count: 6 });
  });
  it("a Shelf over the left: the columns that start right of it; the grid centred in a wider width counts", () => {
    expect(visibleCols(spanPx(12), 12, { left: 3 * PITCH, right: 0 })).toEqual({ from: 3, count: 9 });
    expect(visibleCols(spanPx(12) + 40, 12, { left: 20 + 2 * PITCH, right: 0 })).toEqual({ from: 2, count: 10 });
  });
  it("covered all over: none", () => {
    expect(visibleCols(spanPx(12), 12, { left: 0, right: spanPx(12) })).toEqual({ from: 0, count: 0 });
  });
});

describe("the reflowed view", () => {
  it("boxes wholly inside keep their place; the others in reading order fill the free columns; too wide: hidden", () => {
    const { at, hidden } = reflowCells(saved(), 0, 6);
    // profile is 8 wide: hidden; world is exactly 6: it fits (moved, not shrunk).
    expect(hidden).toEqual(["profile"]);
    expect(at.clock).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    expect(at.tileC).toEqual({ x: 4, y: 4, w: 2, h: 2 });
    // Reading order profile, tileA, clock, world, tileB, tileC: tileA takes the first free place from row 0; world
    // from clock's row (the first that holds 6 columns: under tileC); tileB from world's row on.
    expect(at.tileA).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(at.world).toEqual({ x: 0, y: 6, w: 6, h: 2 });
    expect(at.tileB).toEqual({ x: 0, y: 8, w: 2, h: 2 });
    for (const r of Object.values(at)) expect(r.x + r.w).toBeLessThanOrEqual(6);
  });

  it("nobody overlaps and nobody is shrunk", () => {
    const full = saved();
    for (const count of [2, 3, 4, 6, 8, 10]) {
      const { at, hidden } = reflowCells(full, 0, count);
      const boxes = Object.entries(at);
      for (const [id, r] of boxes) {
        expect(r.w, id).toBe(full[id]!.w);
        expect(r.h, id).toBe(full[id]!.h);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]![1], boxes[j]![1]];
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${boxes[i]![0]} × ${boxes[j]![0]} at ${count}`).toBe(false);
        }
      expect(boxes.length + hidden.length).toBe(Object.keys(full).length);
      for (const id of hidden) expect(full[id]!.w).toBeGreaterThan(count);
    }
  });

  it("keeps the order: a widget never lands on a row above the one before it in reading order", () => {
    const full = saved();
    const order = Object.keys(full).sort((a, b) => full[a]!.y - full[b]!.y || full[a]!.x - full[b]!.x);
    const { at } = reflowCells(full, 0, 6);
    const shown = order.filter((id) => at[id]);
    const moved = (id: string) => full[id]!.x + full[id]!.w > 6;
    for (let i = 1; i < shown.length; i++) if (moved(shown[i]!)) expect(at[shown[i]!]!.y, shown[i]).toBeGreaterThanOrEqual(at[shown[i - 1]!]!.y);
  });

  it("free columns on the right of a left Shelf: positions stay in the full grid's columns", () => {
    const { at } = reflowCells(saved(), 4, 8);
    expect(at.tileA).toEqual({ x: 10, y: 0, w: 2, h: 2 });
    expect(at.world).toEqual({ x: 4, y: 2, w: 6, h: 2 });
    for (const r of Object.values(at)) expect(r.x).toBeGreaterThanOrEqual(4);
  });
});

describe("restore exactness (owner's condition): the saved layout is never touched", () => {
  it("shrink → grow: the saved boxes are byte-identical and the full view is the saved one again", () => {
    const full = deepFreeze(saved());
    const before = JSON.stringify(full);
    // Shrink step by step (a Shelf sliding in), then grow back (it closes / the window widens).
    for (const count of [11, 9, 7, 5, 3, 1, 3, 5, 7, 9, 11]) reflowCells(full, 0, count);
    expect(JSON.stringify(full)).toBe(before);
    // All columns free: every box exactly where it was saved, nothing hidden.
    const back = reflowCells(full, 0, 12);
    expect(back.hidden).toEqual([]);
    expect(back.at).toEqual(saved());
  });
});

describe("what covers the desk area", () => {
  const area = { left: 300, right: 900, top: 60, bottom: 700 };
  it("a Shelf card on the right / left: its overlap plus a gap; nothing outside counts", () => {
    expect(coverOf(area, [])).toEqual({ left: 0, right: 0 });
    expect(coverOf(area, [{ left: 640, right: 900, top: 50, bottom: 700 }])).toEqual({ left: 0, right: 900 - 640 + 16 });
    expect(coverOf(area, [{ left: 280, right: 420, top: 50, bottom: 700 }])).toEqual({ left: 420 - 300 + 16, right: 0 });
    expect(coverOf(area, [{ left: 910, right: 1000, top: 50, bottom: 700 }])).toEqual({ left: 0, right: 0 });
    expect(coverOf(area, [{ left: 640, right: 900, top: 710, bottom: 800 }])).toEqual({ left: 0, right: 0 });
    expect(coverOf(area, [{ left: 700, right: 700, top: 50, bottom: 700 }])).toEqual({ left: 0, right: 0 });
  });
  it("the widest cover on each side wins", () => {
    expect(coverOf(area, [{ left: 800, right: 900, top: 60, bottom: 700 }, { left: 700, right: 760, top: 60, bottom: 700 }])).toEqual({ left: 0, right: 216 });
  });
});
