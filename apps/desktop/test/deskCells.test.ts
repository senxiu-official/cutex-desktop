// Contract 1.23 (modules/home/deskCells, owner 2026-10-24): the desktop's grid of whole cells (96 px, 16 px apart),
// the drop rule on cells, derived bands, the default layout (the two clocks side by side in the header), the one-time
// migration of 1.22 layouts (8 px boxes → nearest cells, no overlaps, pushed down when nothing nearer is free) and
// 1.22 declarations mapped to cells (never rejected).
import { describe, expect, it } from "vitest";
import { unitsOfCellBand, anchoredCells, clampSize, colsFor, defaultCells, deriveCells, firstFree, migratePxBand, nearestFree, overlap, place, spanPx, spansOf, toPx, type Cells } from "../src/renderer/src/modules/home/deskCells";
import { cellSizesOf, cellsOfSteps, unitSizesOf, unitsOfSteps } from "../src/renderer/src/modules/widgetTypes";
import { deskOf, withCellBand, withoutItem, type DeskDoc } from "../src/renderer/src/modules/home/desk";

const noOverlap = (at: Record<string, Cells>) => {
  const v = Object.values(at);
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) expect(overlap(v[i]!, v[j]!)).toBe(false);
};
const size = (w: number, h: number) => () => ({ w, h, minW: 1 });

describe("the unit grid (1.24)", () => {
  it("40 px units 16 px apart: columns of a width, spans in px, px to the nearest units; two units = one 1.23 cell", () => {
    expect(colsFor(1300)).toBe(23);
    expect(colsFor(30)).toBe(1);
    expect(spanPx(1)).toBe(40);
    expect(spanPx(2)).toBe(96);
    expect(spanPx(4)).toBe(208);
    expect(spansOf(96)).toBe(2);
    expect(spansOf(200)).toBe(4);
    expect(spansOf(408)).toBe(8);
    expect(spansOf(304)).toBe(6);
    expect(toPx({ x: 2, y: 1, w: 2, h: 1 })).toEqual({ x: 112, y: 56, w: 96, h: 40 });
    // A 1.23 band doubles exactly: same px.
    const big = { cols: 11, at: { a: { x: 3, y: 1, w: 2, h: 1, ax: "r" as const } } };
    const u = unitsOfCellBand(big);
    expect(u).toEqual({ cols: 22, at: { a: { x: 6, y: 2, w: 4, h: 2, ax: "r" } } });
    expect(toPx(u.at.a!)).toEqual({ x: 336, y: 112, w: 208, h: 96 });
  });
  it("the drop rule on cells: same size swaps; else the covered goes to its nearest free place", () => {
    const at = { a: { x: 0, y: 0, w: 1, h: 1 }, b: { x: 1, y: 0, w: 1, h: 1 }, c: { x: 0, y: 1, w: 2, h: 1 } };
    const swap = place(at, "a", { x: 1, y: 0, w: 1, h: 1 }, 4);
    expect(swap.at.b).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(swap.moved).toEqual([{ id: "b", to: { x: 0, y: 0, w: 1, h: 1 }, swap: true }]);
    const push = place(at, "c", { x: 1, y: 0, w: 2, h: 1 }, 4);
    noOverlap(push.at);
    expect(push.moved.map((m) => m.id)).toEqual(["b"]);
    expect(nearestFree({ a: { x: 0, y: 0, w: 4, h: 1 } }, { x: 0, y: 0, w: 2, h: 1 }, 4)).toEqual({ x: 0, y: 1, w: 2, h: 1 });
    expect(firstFree({ a: { x: 0, y: 0, w: 1, h: 1 } }, 2, 1, 4)).toEqual({ x: 1, y: 0, w: 2, h: 1 });
  });
  it("sizes stay within the kind's limits and keep a ratio", () => {
    expect(clampSize(9, 9, { min: [1, 1], max: [4, 3] }, 10)).toEqual({ w: 4, h: 3 });
    expect(clampSize(3, 1, { min: [1, 1], max: [4, 4], ratio: 1 }, 10)).toEqual({ w: 3, h: 3 });
    expect(clampSize(6, 1, { min: [1, 1], max: [8, 2] }, 3)).toEqual({ w: 3, h: 1 });
  });
  it("a band at fewer columns: right-anchored boxes keep the right edge; nothing overlaps; too wide shrinks", () => {
    const src = { cols: 11, at: anchoredCells({ p: { x: 0, y: 0, w: 3, h: 1 }, clock: { x: 9, y: 0, w: 2, h: 1 }, big: { x: 0, y: 1, w: 11, h: 2 } }, 11) };
    expect(src.at.clock!.ax).toBe("r");
    const at = deriveCells(src, 6, ["p", "clock", "big", "new"], (id) => ({ w: id === "new" ? 2 : 1, h: 1, minW: 1 }));
    expect(at.clock).toEqual({ x: 4, y: 0, w: 2, h: 1 });
    expect(at.big!.w).toBe(6);
    expect(at.new).toBeDefined();
    noOverlap(at);
  });
  it("the default layout: header row (profile left, the two clocks side by side on the right), side column, tiles", () => {
    const at = defaultCells(
      [
        { id: "profile", area: "header-left", order: 0, w: 6, h: 2 },
        { id: "clock", area: "header-right", order: 0, w: 4, h: 2 },
        { id: "world", area: "header-right", order: 1, w: 6, h: 2 },
        { id: "needs", area: "side", order: 10, w: 6, h: 8 },
        { id: "stats", area: "side", order: 20, w: 6, h: 2 },
        { id: "t1", area: "main", order: 0, w: 8, h: 4 },
        { id: "t2", area: "main", order: 1, w: 2, h: 2 },
      ],
      22,
    );
    expect(at.clock).toEqual({ x: 18, y: 0, w: 4, h: 2 });
    expect(at.world).toEqual({ x: 12, y: 0, w: 6, h: 2 });
    expect(at.needs).toEqual({ x: 16, y: 2, w: 6, h: 8 });
    expect(at.stats).toEqual({ x: 16, y: 10, w: 6, h: 2 });
    expect(at.t1).toEqual({ x: 0, y: 2, w: 8, h: 4 });
    noOverlap(at);
    // Too few columns: no side column; the header-right entries that do not fit go to free places.
    const narrow = defaultCells([{ id: "profile", area: "header-left", order: 0, w: 6, h: 2 }, { id: "clock", area: "header-right", order: 0, w: 4, h: 2 }, { id: "needs", area: "side", order: 0, w: 6, h: 8 }], 8);
    noOverlap(narrow);
    for (const r of Object.values(narrow)) expect(r.x + r.w).toBeLessThanOrEqual(8);
  });
});

describe("migrating a 1.22 layout (8 px boxes) once", () => {
  // A wide desktop arranged on 1.22 (1300 px): profile 352 × 96 left, clock 240 × 96 right, needs 288 × 400 right,
  // two tiles 96 × 96 and 200 × 96 at the left, 12 px apart.
  const old = {
    width: 1300,
    at: {
      profile: { x: 0, y: 0, w: 352, h: 96, ax: "l" as const },
      clock: { x: 1060, y: 0, w: 240, h: 96, ax: "r" as const },
      needs: { x: 1012, y: 108, w: 288, h: 400, ax: "r" as const },
      s: { x: 0, y: 108, w: 96, h: 96, ax: "l" as const },
      m: { x: 108, y: 108, w: 200, h: 96, ax: "l" as const },
    },
  };
  const sizes: Record<string, [number, number]> = { profile: [6, 2], clock: [4, 2], needs: [6, 8], s: [2, 2], m: [4, 2], fresh: [4, 2] };
  const sizeOf = (id: string) => ({ w: sizes[id]![0], h: sizes[id]![1], minW: 1 });
  it("each box to its nearest units, the right edge kept for right-anchored ones; sizes to the nearest unit count", () => {
    const at = migratePxBand(old, 23, Object.keys(sizes), sizeOf);
    expect(at.profile).toEqual({ x: 0, y: 0, w: 7, h: 2 });
    expect(at.clock).toEqual({ x: 18, y: 0, w: 5, h: 2 });
    expect(at.needs).toEqual({ x: 18, y: 2, w: 5, h: 7 });
    expect(at.s).toEqual({ x: 0, y: 2, w: 2, h: 2 });
    expect(at.m).toEqual({ x: 2, y: 2, w: 4, h: 2 });
    expect(at.fresh).toBeDefined();
    noOverlap(at);
  });
  it("boxes that land on the same cells: the later one goes to the nearest free place, below when nothing nearer is free", () => {
    const crowded = { width: 224, at: { a: { x: 0, y: 0, w: 200, h: 96, ax: "l" as const }, b: { x: 20, y: 10, w: 200, h: 96, ax: "l" as const } } };
    const at = migratePxBand(crowded, 4, ["a", "b"], size(4, 2));
    expect(at.a).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(at.b).toEqual({ x: 0, y: 2, w: 4, h: 2 });
  });
  it("is not written: the 1.22 boxes stay in `bands` (the backup); the arranged cells go to `cells`", () => {
    const doc = { desk: { v: 1, items: [{ id: "home.profile", kind: "home.profile" }], bands: { w: old } } };
    const desk = deskOf(doc as never)!;
    expect(desk.cells).toBeUndefined();
    const next = withCellBand(desk, "w", { cols: 11, at: { "home.profile": { x: 0, y: 2, w: 3, h: 1, ax: "l" } } });
    expect(next.bands.w).toEqual(old);
    const back = deskOf({ desk: JSON.parse(JSON.stringify(next)) } as never)!;
    expect(back.cells?.w?.at["home.profile"]).toEqual({ x: 0, y: 2, w: 3, h: 1, ax: "l" });
    // Malformed cells are dropped on read; removing an instance takes its cells too.
    const bad = deskOf({ desk: { ...JSON.parse(JSON.stringify(next)), cells: { w: { cols: 11, at: { x: { x: -1, y: 0, w: 1, h: 1, ax: "l" }, y: { x: 0, y: 0, w: 0.5, h: 1, ax: "l" } } } } } } as never)!;
    expect(bad.cells?.w?.at).toEqual({});
    expect((withoutItem(back, "home.profile") as DeskDoc).cells?.w?.at).toEqual({});
  });
});

describe("1.22 declarations on the cell grid", () => {
  it("step sizes map to the nearest cells (at least one); a kind's own `cells` wins", () => {
    expect(cellsOfSteps([44, 12])).toEqual([3, 1]);
    expect(cellsOfSteps([12, 12])).toEqual([1, 1]);
    expect(cellsOfSteps([25, 12])).toEqual([2, 1]);
    expect(cellsOfSteps([51, 25])).toEqual([4, 2]);
    expect(cellsOfSteps([51, 38])).toEqual([4, 3]);
    expect(cellsOfSteps([1, 1])).toEqual([1, 1]);
    const old = cellSizesOf({ min: [16, 8], max: [96, 60], default: [36, 12], presets: { s: [12, 12] } });
    expect(old).toEqual({ min: [1, 1], max: [7, 4], default: [3, 1], presets: { s: [1, 1] } });
    // A max that maps below the min is lifted to it (never rejected).
    expect(cellSizesOf({ min: [30, 30], max: [12, 12], default: [30, 30] }).max).toEqual([2, 2]);
    const own = { min: [1, 1], max: [2, 2], default: [2, 1] } as const;
    expect(cellSizesOf({ min: [1, 1], max: [99, 99], default: [9, 9], cells: own })).toBe(own);
  });
});

describe("1.22 / 1.23 declarations on the unit grid (1.24)", () => {
  it("own units win; else 1.23 cells double; else 1.22 steps map; never below 2 × 2; max ≥ min; default between", () => {
    expect(unitSizesOf({ min: [1, 1], max: [9, 9], default: [3, 3], units: { min: [2, 3], max: [8, 8], default: [4, 3] } })).toEqual({ min: [2, 3], max: [8, 8], default: [4, 3] });
    expect(unitSizesOf({ min: [1, 1], max: [9, 9], default: [3, 3], cells: { min: [1, 1], max: [5, 4], default: [1, 1], presets: { s: [1, 1], l: [4, 3] } } })).toEqual({ min: [2, 2], max: [10, 8], default: [2, 2], presets: { s: [2, 2], l: [8, 6] } });
    expect(unitSizesOf({ min: [16, 8], max: [96, 60], default: [36, 12] })).toEqual({ min: [3, 2], max: [14, 9], default: [5, 2] });
    expect(unitsOfSteps([12, 12])).toEqual([2, 2]);
    expect(unitsOfSteps([1, 1])).toEqual([2, 2]);
    expect(unitSizesOf({ min: [1, 1], max: [1, 1], default: [1, 1], units: { min: [1, 1], max: [1, 1], default: [1, 1] } })).toEqual({ min: [2, 2], max: [2, 2], default: [2, 2] });
  });
});
