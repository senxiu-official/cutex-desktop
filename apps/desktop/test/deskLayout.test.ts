// Design 030 v2 (the desktop's free layout, modules/home/deskLayout): the 8 px step, smart guides and Alt, the drop
// rule among widgets, three width bands with anchored boxes, the default layout (today's look).
import { describe, expect, it } from "vitest";
import { anchorOf, anchored, bandOf, defaultLayout, deriveBand, firstFree, GAP, isFree, nearestFree, overlap, place, snapMove, snapResize, STEP } from "../src/renderer/src/modules/home/deskLayout";

const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("grid, guides, Alt", () => {
  it("no guide near: the box lands on the 8 px step", () => {
    const { box, guides } = snapMove([], b(101, 203, 96, 96), 1200, false);
    expect([box.x % STEP, box.y % STEP]).toEqual([0, 0]);
    expect(box).toMatchObject({ x: 104, y: 200 });
    expect(guides).toEqual([]);
  });
  it("snaps to another box's edge, to one GAP beside it (labelled), to the desktop's centre", () => {
    const other = b(100, 100, 200, 96);
    const edge = snapMove([other], b(103, 400, 96, 96), 1200, false);
    expect(edge.box.x).toBe(100);
    expect(edge.guides[0]).toMatchObject({ dir: "v", at: 100 });
    const gap = snapMove([other], b(100 + 200 + GAP + 4, 100, 96, 96), 1200, false);
    expect(gap.box.x).toBe(312);
    expect(gap.guides.find((g) => g.dir === "v")).toMatchObject({ label: "gap" });
    const centre = snapMove([], b(600 - 48 + 3, 500, 96, 96), 1200, false);
    expect(centre.box.x).toBe(552);
    expect(centre.guides[0]).toMatchObject({ label: "centre" });
  });
  it("Alt: no guides and no step (1 px), still inside the width", () => {
    const { box, guides } = snapMove([b(100, 100, 200, 96)], b(103.4, 401.6, 96, 96), 1200, true);
    expect(box).toMatchObject({ x: 103, y: 402 });
    expect(guides).toEqual([]);
    expect(snapMove([], b(1190, 0, 96, 96), 1200, true).box.x).toBe(1104);
  });
  it("resize: the right edge snaps to another box's edge, then limits and the ratio", () => {
    const other = b(400, 0, 100, 100);
    expect(snapResize([other], b(0, 200, 396, 100), 1200, false, { min: [80, 80], max: [800, 800] }).box.w).toBe(400);
    expect(snapResize([], b(0, 0, 30, 30), 1200, false, { min: [80, 80], max: [800, 800] }).box).toMatchObject({ w: 80, h: 80 });
    expect(snapResize([], b(0, 0, 203, 150), 1200, false, { min: [80, 80], max: [800, 800], ratio: 1 }).box).toMatchObject({ w: 200, h: 200 });
  });
});

describe("the drop rule (Q2)", () => {
  const at = { a: b(0, 0, 96, 96), c: b(108, 0, 96, 96), w: b(0, 108, 200, 96) };
  it("one covered box of the same size swaps", () => {
    const res = place(at, "a", b(108, 0, 96, 96), 1200);
    expect(res.at.c).toEqual(b(0, 0, 96, 96));
    expect(res.moved).toEqual([{ id: "c", to: b(0, 0, 96, 96), swap: true }]);
  });
  it("a covered box of another size goes to its nearest free place; nothing else moves; never refused", () => {
    const res = place(at, "a", b(0, 108, 96, 96), 1200);
    expect(res.at.a).toEqual(b(0, 108, 96, 96));
    expect(res.moved.map((m) => m.id)).toEqual(["w"]);
    expect(res.at.c).toEqual(at.c);
    const others = Object.entries(res.at).filter(([k]) => k !== "w");
    for (const [, r] of others) expect(overlap(res.at.w!, r)).toBe(false);
  });
  it("free places keep a GAP; nearest / first free", () => {
    expect(isFree(at, b(96 + 8, 0, 4, 4), 1200)).toBe(false);
    expect(isFree(at, b(216, 0, 96, 96), 1200)).toBe(true);
    expect(nearestFree(at, b(0, 0, 96, 96), 1200)).not.toEqual(b(0, 0, 96, 96));
    expect(firstFree(at, 96, 96, 1200)).toEqual(b(216, 0, 96, 96));
    expect(isFree(at, b(108 + 96 + GAP, 0, 96, 96), 1200)).toBe(true);
  });
});

describe("bands and anchors (Q3)", () => {
  it("narrow < 760 ≤ medium < 1280 ≤ wide", () => {
    expect([bandOf(600), bandOf(760), bandOf(1279), bandOf(1280)]).toEqual(["n", "m", "m", "w"]);
  });
  it("anchors: the nearer edge, or the centre", () => {
    expect(anchorOf(b(0, 0, 100, 10), 1000)).toBe("l");
    expect(anchorOf(b(880, 0, 100, 10), 1000)).toBe("r");
    expect(anchorOf(b(450, 0, 100, 10), 1000)).toBe("c");
  });
  it("derives a narrower band: right-anchored boxes stay right, overlaps go to free places, shrink to fit", () => {
    const wide = { width: 1400, at: anchored({ p: b(0, 0, 352, 96), clock: b(1160, 0, 240, 96), side: b(1112, 108, 288, 400), big: b(0, 108, 1300, 96) }, 1400) };
    const out = deriveBand(wide, 800, ["p", "clock", "side", "big", "new"], (id) => ({ w: 96, h: 96, minW: id === "big" ? 200 : 96 }));
    expect(out.clock!.x + out.clock!.w).toBe(800);
    expect(out.side!.x + out.side!.w).toBe(800);
    expect(out.big!.w).toBe(800);
    const ids = Object.keys(out);
    for (const a of ids) for (const c of ids) if (a < c) expect(overlap(out[a]!, out[c]!)).toBe(false);
    expect(out.new).toBeDefined();
  });
});

describe("the default layout (today's look)", () => {
  it("header left / right, a side column, the tiles packed left of it; narrow: no side column", () => {
    const entries = [
      { id: "profile", area: "header-left" as const, order: 0, w: 352, h: 96 },
      { id: "clock", area: "header-right" as const, order: 0, w: 240, h: 96 },
      { id: "world", area: "side" as const, order: 5, w: 288, h: 144 },
      { id: "needs", area: "side" as const, order: 10, w: 288, h: 400 },
      { id: "t1", area: "main" as const, order: 0, w: 96, h: 96 },
      { id: "t2", area: "main" as const, order: 1, w: 200, h: 96 },
    ];
    const wide = defaultLayout(entries, 1200);
    expect(wide.profile).toEqual(b(0, 0, 352, 96));
    expect(wide.clock!.x + wide.clock!.w).toBe(1200);
    expect(wide.world!.x).toBe(1200 - 288);
    expect(wide.needs!.y).toBe(wide.world!.y + 144 + GAP);
    expect(wide.t1!.x + wide.t1!.w).toBeLessThanOrEqual(1200 - 288 - GAP);
    expect(wide.t2!.x).toBe(96 + GAP);
    const narrow = defaultLayout(entries, 600);
    expect(narrow.needs!.y).toBeGreaterThan(narrow.t2!.y);
    const ids = Object.keys(narrow);
    for (const a of ids) for (const c of ids) if (a < c) expect(overlap(narrow[a]!, narrow[c]!)).toBe(false);
  });
});
