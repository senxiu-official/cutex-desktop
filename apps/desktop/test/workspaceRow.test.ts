// The work row by content width and where a workspace's Shelves sit (owner 2026-10-21; lib/workspaceRow,
// docs/desktop-modules.md §24.15): 工作区的 Shelf Rail (外侧 / 永远偏右) with one or two workspaces; 按内容 = each
// workspace at its own width, centred as a group; too narrow = the Shelves fold to their rails first (once,
// stored), then the columns narrow, then a Shelf shows as its rail without being stored; 铺满窗口 = the columns
// fill; a column's content width; the 工作区宽度 setting (窗格铺满时占满整个窗口 merged into 铺满窗口).
import { describe, expect, it } from "vitest";
import { columnHandleShown, oneEdgeWidth, pushEdge, seamPush, columnWant, expandedBox, fillWidths, groupLead, newlyExpanded, pinIndex, rowWidthMode, shelfSideAt, shiftedLead, shouldFoldShelves, STRIP_W, workspaceRow, type RowWorkspace } from "../src/renderer/src/lib/workspaceRow";
import { CARD_GAP, COLLAPSED_SHELF_WIDTH, RAIL_WIDTH } from "../src/renderer/src/lib/sideLayout";
import { CARD_CHROME } from "../src/renderer/src/lib/workSurface";
import { DEFAULT_APPEARANCE, migrateEdgeToEdge, migrateWorkspaceWidth, parseAppearance, WORKSPACE_WIDTH_REV } from "../src/renderer/src/lib/appearanceModel";

const shelf = (id: string, side: "left" | "right", width = 420, collapsed = false) => ({ id, side, width, collapsed });
const focusedWs = (want: number | null, shelves = [shelf("s1", "right")]): RowWorkspace => ({ want, min: 300, rail: false, shelves });
const otherWs = (want: number | null, rail = true): RowWorkspace => ({ want, min: 300, rail, shelves: [] });

describe("工作区的 Shelf Rail: where a workspace's Shelves are drawn", () => {
  it("one workspace: each Shelf keeps its own side, whatever the setting", () => {
    for (const placement of ["outer", "right"] as const) {
      expect(shelfSideAt(0, 1, placement, "right")).toBe("right");
      expect(shelfSideAt(0, 1, placement, "left")).toBe("left");
      const row = workspaceRow({ area: 2000, mode: "content", placement, workspaces: [focusedWs(770, [shelf("a", "left"), shelf("b", "right")])] });
      expect(row.workspaces[0]!.shelves.map((x) => x.at)).toEqual(["left", "right"]);
    }
  });

  it("two workspaces, 外侧 (default): the left workspace's Shelves at the window's left edge, the right one's at the right edge — never between the conversations", () => {
    expect(DEFAULT_APPEARANCE.wsRailPlacement).toBe("outer");
    expect([shelfSideAt(0, 2, "outer", "right"), shelfSideAt(0, 2, "outer", "left")]).toEqual(["left", "left"]);
    expect([shelfSideAt(1, 2, "outer", "right"), shelfSideAt(1, 2, "outer", "left")]).toEqual(["right", "right"]);
    // Focused on the left: its Shelf on its left; the other's rail on the right workspace's right.
    const left = workspaceRow({ area: 2400, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(left.workspaces[0]!.shelves[0]!.at).toBe("left");
    expect(left.workspaces.map((w) => w.railAt)).toEqual(["left", "right"]);
    // Focused on the right (the owner's report (c)): the left workspace's rail stays at the far left.
    const right = workspaceRow({ area: 2400, mode: "content", placement: "outer", workspaces: [otherWs(770), focusedWs(770)] });
    expect(right.workspaces[0]!.railAt).toBe("left");
    expect(right.workspaces[1]!.shelves[0]!.at).toBe("right");
  });

  it("two workspaces, 永远偏右: each workspace's Shelves and rail on its own right", () => {
    const row = workspaceRow({ area: 2400, mode: "content", placement: "right", workspaces: [focusedWs(770, [shelf("a", "left"), shelf("b", "right")]), otherWs(770)] });
    expect(row.workspaces[0]!.shelves.map((x) => x.at)).toEqual(["right", "right"]);
    expect(row.workspaces.map((w) => w.railAt)).toEqual(["right", "right"]);
  });
});

describe("按内容: the workspaces at their own widths, centred as a group", () => {
  it("one workspace that fits: its column at its width, its Shelf at its width, centred", () => {
    const row = workspaceRow({ area: 1600, mode: "content", placement: "outer", workspaces: [focusedWs(770)] });
    expect(row).toMatchObject({ centred: true, fits: true });
    expect(row.workspaces[0]).toMatchObject({ width: 770, shelves: [{ expanded: true, box: 420 + RAIL_WIDTH + CARD_GAP, forced: false }] });
  });

  it("two workspaces each keep their own width (and the other's rail) and are centred together; the free space is the desktop's", () => {
    const row = workspaceRow({ area: 2600, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(row.workspaces.map((w) => w.width)).toEqual([770, 770]);
    expect(row.centred).toBe(true);
    expect(row.fits).toBe(true);
    const used = 770 * 2 + expandedBox(420) + COLLAPSED_SHELF_WIDTH + CARD_GAP;
    expect(used).toBeLessThan(2600);
    // An empty Shelf of the other workspace shows no rail and takes no room.
    expect(workspaceRow({ area: used - COLLAPSED_SHELF_WIDTH, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770, false)] }).fits).toBe(true);
  });

  it("too narrow: the row says it stopped fitting (the Shelves fold once), the columns narrow toward their minimum", () => {
    const row = workspaceRow({ area: 1330, mode: "content", placement: "outer", workspaces: [focusedWs(770, [shelf("s1", "right", 420, true)]), otherWs(770)] });
    expect(row.fits).toBe(false);
    const [a, b] = row.workspaces.map((w) => w.width!);
    expect(a).toBe(b);
    expect(a).toBeLessThan(770);
    expect(a).toBeGreaterThanOrEqual(300);
    expect(a! + b! + 2 * COLLAPSED_SHELF_WIDTH + CARD_GAP).toBeLessThanOrEqual(1330);
    expect(row.workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: false });
  });

  it("an expanded Shelf the owner opened stays expanded while the columns can narrow; below their minimum it shows as its rail (not stored)", () => {
    const opened = workspaceRow({ area: 1330, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(opened.workspaces[0]!.shelves[0]).toMatchObject({ expanded: true, forced: false });
    expect(opened.workspaces[0]!.width).toBeGreaterThanOrEqual(300);
    const tiny = workspaceRow({ area: 900, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(tiny.workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: true, box: COLLAPSED_SHELF_WIDTH });
    expect(tiny.workspaces[0]!.width! + tiny.workspaces[1]!.width! + 2 * COLLAPSED_SHELF_WIDTH + CARD_GAP).toBeLessThanOrEqual(900);
  });

  it("not measured yet: everything as wanted", () => {
    expect(workspaceRow({ area: 0, mode: "content", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] })).toMatchObject({ fits: true, workspaces: [{ width: 770 }, { width: 770 }] });
  });

  it("铺满窗口 (or 全宽): the columns fill their shares (not centred); the Shelves give way only below the columns' minimum", () => {
    const fill = workspaceRow({ area: 1600, mode: "fill", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(fill).toMatchObject({ centred: false, fits: true });
    expect(fill.workspaces.map((w) => w.width)).toEqual([null, null]);
    expect(workspaceRow({ area: 1600, mode: "content", placement: "outer", workspaces: [focusedWs(null), otherWs(null)] }).centred).toBe(false);
  });
});

describe("folding the Shelves (宽度规则 A, owner 2026-10-21): once when the second workspace opens, never by itself otherwise", () => {
  it("only when a second workspace came and the row does not fit; not the window narrowing, not the owner's own expand, not the focus", () => {
    const fit = { area: 1600, count: 1, fits: true };
    expect(shouldFoldShelves(null, { area: 1600, count: 2, fits: false })).toBe(false);
    // The window narrowing: the columns narrow, a Shelf shows as its rail unstored — nothing folds.
    expect(shouldFoldShelves(fit, { area: 1200, count: 1, fits: false })).toBe(false);
    expect(shouldFoldShelves({ area: 1600, count: 2, fits: true }, { area: 1200, count: 2, fits: false })).toBe(false);
    // The owner expanded a Shelf that does not fit (same width, same count): not this rule (the other workspace's folds).
    expect(shouldFoldShelves(fit, { area: 1600, count: 1, fits: false })).toBe(false);
    // A second workspace that does not fit beside it: folds once; one that fits: nothing.
    expect(shouldFoldShelves({ area: 1600, count: 1, fits: true }, { area: 1600, count: 2, fits: false })).toBe(true);
    expect(shouldFoldShelves({ area: 1600, count: 1, fits: true }, { area: 1600, count: 2, fits: true })).toBe(false);
    // Afterwards (still two): never again.
    expect(shouldFoldShelves({ area: 1600, count: 2, fits: false }, { area: 1600, count: 2, fits: false })).toBe(false);
    // Not measured: nothing.
    expect(shouldFoldShelves({ area: 0, count: 1, fits: true }, { area: 1200, count: 2, fits: false })).toBe(false);
  });

  it("an explicit expand: the conversation one of whose Shelves went from collapsed to expanded; a focus change shows nothing", () => {
    expect(newlyExpanded(null, { a: ["s1"] })).toEqual([]);
    expect(newlyExpanded({ a: [], b: ["s9"] }, { a: ["s1"], b: ["s9"] })).toEqual(["a"]);
    // The same states under the other focus (each Shelf's state is its conversation's): nothing.
    expect(newlyExpanded({ a: ["s1"], b: [] }, { b: [], a: ["s1"] })).toEqual([]);
    // Folding is not expanding; a conversation new on screen is not an expand.
    expect(newlyExpanded({ a: ["s1"] }, { a: [] })).toEqual([]);
    expect(newlyExpanded({ a: ["s1"] }, { a: ["s1"], c: ["s3"] })).toEqual([]);
  });
});

describe("a column's content width and the setting", () => {
  it("the dragged width, else 单个对话的默认宽度 (the reading width + border, a share of the row, or 全宽 = fills)", () => {
    const base = { area: 1600, count: 2, readingWidth: 768, mode: "reading" as const, pct: 70, dragged: 0 };
    expect(columnWant(base)).toBe(768 + CARD_CHROME);
    expect(columnWant({ ...base, dragged: 900 })).toBe(900);
    expect(columnWant({ ...base, mode: "full" })).toBeNull();
    expect(columnWant({ ...base, readingWidth: 0 })).toBeNull();
    expect(columnWant({ ...base, mode: "custom", pct: 50 })).toBe(400);
    expect(columnWant({ ...base, mode: "custom", pct: 50, count: 1 })).toBe(800);
  });

  it("工作区宽度: 智能 by default; the old 窗格铺满时占满整个窗口 on = 铺满窗口; the rails' placements parse", () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ workspaceWidth: "smart", wsRailPlacement: "outer", shelfRailPlacement: "outer" });
    expect(parseAppearance({ fillWindow: true })).toMatchObject({ workspaceWidth: "fill" });
    expect(parseAppearance({ workspaceWidth: "fill" }).workspaceWidth).toBe("fill");
    expect(parseAppearance({ workspaceWidth: "wide" }).workspaceWidth).toBe("smart");
    expect(parseAppearance({ wsRailPlacement: "right", shelfRailPlacement: "inner" })).toMatchObject({ wsRailPlacement: "right", shelfRailPlacement: "inner" });
    expect(parseAppearance({ wsRailPlacement: "middle", shelfRailPlacement: "x" })).toMatchObject({ wsRailPlacement: "outer", shelfRailPlacement: "outer" });
  });
});

describe("智能 (owner 2026-10-21, the default): one workspace by content, two fill the window", () => {
  it("resolves by the number of workspaces; 按内容 / 铺满窗口 stay as chosen", () => {
    expect([rowWidthMode("smart", 1), rowWidthMode("smart", 2)]).toEqual(["content", "fill"]);
    expect([rowWidthMode("content", 1), rowWidthMode("content", 2)]).toEqual(["content", "content"]);
    expect([rowWidthMode("fill", 1), rowWidthMode("fill", 2)]).toEqual(["fill", "fill"]);
  });

  it("one workspace: its column at its default / dragged width, centred, the desktop around it", () => {
    const row = workspaceRow({ area: 1600, mode: "smart", placement: "outer", workspaces: [focusedWs(770)] });
    expect(row).toMatchObject({ mode: "content", centred: true, fits: true });
    expect(row.workspaces[0]!.width).toBe(770);
    expect(workspaceRow({ area: 1600, mode: "smart", placement: "outer", workspaces: [focusedWs(900)] }).workspaces[0]!.width).toBe(900);
  });

  it("two workspaces: both columns flex (equal shares of what the Shelf and the rail leave), not centred — as 铺满窗口", () => {
    const row = workspaceRow({ area: 2600, mode: "smart", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(row).toMatchObject({ mode: "fill", centred: false, fits: true });
    expect(row.workspaces.map((w) => w.width)).toEqual([null, null]);
    const fill = workspaceRow({ area: 2600, mode: "fill", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] });
    expect(row.workspaces).toEqual(fill.workspaces);
    // The Shelf stays expanded while the columns keep their minimum beside it; below that it shows as its rail.
    expect(row.workspaces[0]!.shelves[0]).toMatchObject({ expanded: true, forced: false });
    expect(workspaceRow({ area: 800, mode: "smart", placement: "outer", workspaces: [focusedWs(770), otherWs(770)] }).workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: true });
  });

  it("the column drag handle between two workspaces: under 智能 and 铺满窗口, never by content", () => {
    expect(columnHandleShown("smart", 2)).toBe(true);
    expect(columnHandleShown("fill", 2)).toBe(true);
    expect(columnHandleShown("content", 2)).toBe(false);
    expect(columnHandleShown("smart", 1)).toBe(false);
  });

  it("migration: the old default 按内容 becomes 智能 once; 铺满窗口 and a 按内容 chosen since stay", () => {
    expect(WORKSPACE_WIDTH_REV).toBe(1);
    // Stored before 智能 existed (no revision): 按内容 was the default.
    expect(parseAppearance({ workspaceWidth: "content" }).workspaceWidth).toBe("smart");
    expect(parseAppearance({}).workspaceWidth).toBe("smart");
    expect(parseAppearance({ workspaceWidth: "fill" }).workspaceWidth).toBe("fill");
    expect(parseAppearance({ fillWindow: true, workspaceWidth: "content" }).workspaceWidth).toBe("smart");
    expect(parseAppearance({ fillWindow: true }).workspaceWidth).toBe("fill");
    // Written at revision 1: 按内容 is a choice.
    expect(parseAppearance({ workspaceWidth: "content", workspaceWidthRev: 1 }).workspaceWidth).toBe("content");
    expect(migrateWorkspaceWidth("smart", undefined, false)).toBe("smart");
    // Every parse writes the revision, so a choice made after it survives the next load.
    const chosen = parseAppearance({ ...parseAppearance({ workspaceWidth: "content" }), workspaceWidth: "content" });
    expect(chosen).toMatchObject({ workspaceWidth: "content", workspaceWidthRev: 1 });
    expect(parseAppearance(JSON.parse(JSON.stringify(chosen))).workspaceWidth).toBe("content");
  });
});

describe("宽度规则 (owner 2026-10-21): filling widths, pins, no re-centring", () => {
  const two = (split?: number, pin: { index: number; width: number } | null = null, area = 2000) =>
    workspaceRow({ area, mode: "fill", placement: "outer", split, pin, workspaces: [focusedWs(770), { want: 770, min: 300, rail: false, shelves: [shelf("o1", "right", 300, true)] }] });
  const avail = (area = 2000) => area - expandedBox(420) - COLLAPSED_SHELF_WIDTH - CARD_GAP;

  it("filling: the columns share what is left by the stored ratio (explicit widths), 50/50 by default, each at least its minimum", () => {
    expect(two(0.5).workspaces.map((w) => w.width)).toEqual([avail() / 2, avail() / 2]);
    const r = two(0.3).workspaces.map((w) => w.width!);
    expect(r[0]).toBe(Math.round(avail() * 0.3));
    expect(r[0]! + r[1]!).toBe(avail());
    // 3. the minimum stops it (the other column is not pushed below its own either).
    expect(two(0.01).workspaces[0]!.width).toBe(300);
    expect(two(0.99).workspaces[1]!.width).toBe(300);
    // No ratio given: flex (null), as before.
    expect(two().workspaces.map((w) => w.width)).toEqual([null, null]);
  });

  it("4. the window resizes: the Shelves keep their pixel widths, the columns scale and keep the owner's ratio (not 50/50)", () => {
    for (const area of [1600, 2000, 2600, 3400]) {
      const out = two(0.35, null, area);
      expect(out.workspaces[0]!.shelves[0]!.box).toBe(expandedBox(420));
      expect(out.workspaces[1]!.shelves[0]!.box).toBe(COLLAPSED_SHELF_WIDTH);
      const [a, b] = out.workspaces.map((w) => w.width!);
      expect(a! + b!).toBe(avail(area));
      expect(Math.abs(a! / (a! + b!) - 0.35)).toBeLessThan(0.002);
    }
  });

  it("1. a Shelf's edge dragged: its own column takes the change, the other keeps its width (pin); stops at the minimum", () => {
    const before = two(0.5).workspaces.map((w) => w.width!);
    // The focused (left) workspace's Shelf grows by 100: the right column is pinned.
    const grown = workspaceRow({ area: 2000, mode: "fill", placement: "outer", split: 0.5, pin: { index: pinIndex({ shelfOf: 0 }), width: before[1]! }, workspaces: [focusedWs(770, [shelf("s1", "right", 520)]), { want: 770, min: 300, rail: false, shelves: [shelf("o1", "right", 300, true)] }] });
    expect(grown.workspaces[1]!.width).toBe(before[1]);
    expect(grown.workspaces[0]!.width).toBe(before[0]! - 100);
    expect(fillWidths({ avail: 1000, split: 0.5, mins: [300, 300], pin: { index: 1, width: 900 } })).toEqual([300, 700]);
    expect(fillWidths({ avail: 1000, split: 0.5, mins: [300, 300], pin: { index: 0, width: 420 } })).toEqual([420, 580]);
  });

  it("an edge outside the row: the sidebar's (left) keeps the far right column, the right Settings Shelf's keeps the left one", () => {
    expect(pinIndex({ edge: "left" })).toBe(1);
    expect(pinIndex({ edge: "right" })).toBe(0);
    expect(pinIndex({ shelfOf: 1 })).toBe(0);
  });

  it("2. by content nothing re-centres: a pinned lead stays (inside the row), the sidebar's drag keeps the group on screen", () => {
    expect(groupLead({ area: 1600, total: 1000, pinned: null })).toBe(300);
    expect(groupLead({ area: 1600, total: 1000, pinned: 120 })).toBe(120);
    expect(groupLead({ area: 1600, total: 1000, pinned: 900 })).toBe(600);
    expect(groupLead({ area: 900, total: 1000, pinned: 50 })).toBe(0);
    // The sidebar grew by 40: the row's left edge moved right by 40, the group's lead shrinks by 40.
    expect(shiftedLead(300, 264, 304)).toBe(260);
  });

  it("007: a single column's edge moves alone (no symmetric exception); it grows up to the panels beside it, shrinks to its minimum, then slides (推挤)", () => {
    // Column 400..1000 (600 px), a Shelf of 468 px right of it in a 1600 px row: 400 px of desktop left, 132 right.
    const base = { start: 600, left: 400, before: 0, after: 468, area: 1600, min: 400 };
    // The right edge: only it moves; the left edge stays.
    expect(oneEdgeWidth({ ...base, edge: "right", dx: 50 })).toEqual({ width: 650, left: 400 });
    // ...up to the Shelf (1600 − 468 − 400 = 732).
    expect(oneEdgeWidth({ ...base, edge: "right", dx: 500 })).toEqual({ width: 732, left: 400 });
    // Down to the minimum (200 px), then the column slides left with the edge into the desktop there (300 px more).
    expect(oneEdgeWidth({ ...base, edge: "right", dx: -200 })).toEqual({ width: 400, left: 400 });
    expect(oneEdgeWidth({ ...base, edge: "right", dx: -500 })).toEqual({ width: 400, left: 100 });
    // ...no further than the desktop goes.
    expect(oneEdgeWidth({ ...base, edge: "right", dx: -900 })).toEqual({ width: 400, left: 0 });
    // The left edge: the right edge (1000) stays.
    expect(oneEdgeWidth({ ...base, edge: "left", dx: -100 })).toEqual({ width: 700, left: 300 });
    expect(oneEdgeWidth({ ...base, edge: "left", dx: -900 })).toEqual({ width: 1000, left: 0 });
    // To the right: down to the minimum, then the column and the Shelf slide into the 132 px of desktop on the right.
    expect(oneEdgeWidth({ ...base, edge: "left", dx: 200 })).toEqual({ width: 400, left: 600 });
    expect(oneEdgeWidth({ ...base, edge: "left", dx: 400 })).toEqual({ width: 400, left: 732 });
    // A left Shelf of 300 px: the left edge stops there.
    expect(oneEdgeWidth({ ...base, before: 300, edge: "left", dx: -300 })).toEqual({ width: 700, left: 300 });
  });

  describe("推挤 (owner 2026-10-23): an edge moves alone; the panel it moves toward gives, then slides into the desktop", () => {
    // [desktop 100][A 500][B 600 (min 400)][C 300 (min 260)][desktop 200]
    const row = () => [
      { w: 100, gap: true },
      { w: 500, min: 400 },
      { w: 600, min: 400 },
      { w: 300, min: 260 },
      { w: 200, gap: true },
    ];
    const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

    it("A|B to the right: B gives down to its minimum; on, B and C slide into the desktop on the right; then it stops", () => {
      expect(pushEdge(row(), 1, 150)).toEqual({ w: [100, 650, 450, 300, 200], moved: 150 });
      // B at 400 after 200; 100 more: B and C slide (C keeps 300), the right desktop 200 → 100.
      expect(pushEdge(row(), 1, 300)).toEqual({ w: [100, 800, 400, 300, 100], moved: 300 });
      // No desktop left: the edge stops at 400.
      expect(pushEdge(row(), 1, 900)).toEqual({ w: [100, 900, 400, 300, 0], moved: 400 });
      for (const d of [150, 300, 900]) expect(sum(pushEdge(row(), 1, d).w)).toBe(1700);
    });

    it("A|B to the left: A gives down to its minimum, then A slides into the desktop on the left; C never changes", () => {
      expect(pushEdge(row(), 1, -80)).toEqual({ w: [100, 420, 680, 300, 200], moved: -80 });
      expect(pushEdge(row(), 1, -150)).toEqual({ w: [50, 400, 750, 300, 200], moved: -150 });
      expect(pushEdge(row(), 1, -500)).toEqual({ w: [0, 400, 800, 300, 200], moved: -200 });
    });

    it("the edge beside the desktop: a panel grows into it up to the panels beyond, never shrinks them", () => {
      // C|desktop to the right: C takes the desktop, stops at the window.
      expect(pushEdge(row(), 3, 500)).toEqual({ w: [100, 500, 600, 500, 0], moved: 200 });
      // desktop|A to the left: A takes the desktop on the left.
      expect(pushEdge(row(), 0, -40)).toEqual({ w: [60, 540, 600, 300, 200], moved: -40 });
      // desktop|A to the right: A gives down to 400, then the whole group slides right.
      expect(pushEdge(row(), 0, 160)).toEqual({ w: [260, 400, 600, 300, 140], moved: 160 });
    });

    it("something that only slides (a rail, the seam between columns) is skipped: the panel behind it gives", () => {
      const r = [{ w: 0, gap: true }, { w: 700, min: 400 }, { w: 48, fixed: true }, { w: 700, min: 400 }, { w: 0, gap: true }];
      expect(pushEdge(r, 1, 100)).toEqual({ w: [0, 800, 48, 600, 0], moved: 100 });
      expect(pushEdge(r, 2, -100)).toEqual({ w: [0, 600, 48, 800, 0], moved: -100 });
      // Filling (no desktop): both stop at their minimum.
      expect(pushEdge(r, 1, 900).moved).toBe(300);
      expect(pushEdge(r, 2, -900).moved).toBe(-300);
    });

    it("a panel's widest stops the edge too; a zero drag changes nothing", () => {
      const r = row();
      r[1] = { w: 500, min: 400, max: 560 } as (typeof r)[number];
      expect(pushEdge(r, 1, 300).moved).toBe(60);
      expect(pushEdge(row(), 1, 0)).toEqual({ w: [100, 500, 600, 300, 200], moved: 0 });
    });

    it("a Shelf's edge toward its column: the column gives to its minimum, then slides; the Shelf pushed at its own takes the column along", () => {
      // A right Shelf grew 150: the 600 px column gives it.
      expect(seamPush({ start: 600, min: 400, delta: 150, push: 0, shelfAt: "right" })).toEqual({ width: 450, shift: 0 });
      // 300: the column at 400, then it slides left 100 px (the group's left edge with it).
      expect(seamPush({ start: 600, min: 400, delta: 300, push: 0, shelfAt: "right" })).toEqual({ width: 400, shift: -100 });
      // A left Shelf: the column slides right — the group's left edge stays.
      expect(seamPush({ start: 600, min: 400, delta: 300, push: 0, shelfAt: "left" })).toEqual({ width: 400, shift: 0 });
      // The other way: the Shelf at its minimum pushed 80 px on: the column takes that too.
      expect(seamPush({ start: 600, min: 400, delta: -200, push: 80, shelfAt: "right" })).toEqual({ width: 880, shift: 0 });
      // A left Shelf pushed out to the left takes the group's left edge along.
      expect(seamPush({ start: 600, min: 400, delta: -200, push: 80, shelfAt: "left" })).toEqual({ width: 880, shift: -80 });
    });
  });

  it("贴边显示 is its own switch: off by default; on when edge to edge was explicitly on before (窗格铺满时占满整个窗口 / 铺满窗口)", () => {
    expect(DEFAULT_APPEARANCE.edgeToEdge).toBe(false);
    expect(parseAppearance({}).edgeToEdge).toBe(false);
    expect(parseAppearance({ fillWindow: true })).toMatchObject({ workspaceWidth: "fill", edgeToEdge: true });
    expect(parseAppearance({ workspaceWidth: "fill" })).toMatchObject({ workspaceWidth: "fill", edgeToEdge: true });
    expect(parseAppearance({ workspaceWidth: "smart" }).edgeToEdge).toBe(false);
    // Written once: as chosen (铺满窗口 without edge to edge stays so).
    expect(parseAppearance({ workspaceWidth: "fill", edgeToEdge: false }).edgeToEdge).toBe(false);
    expect(parseAppearance({ workspaceWidth: "content", edgeToEdge: true, workspaceWidthRev: 1 })).toMatchObject({ workspaceWidth: "content", edgeToEdge: true });
    expect(migrateEdgeToEdge(undefined, "content", false)).toBe(false);
    const saved = parseAppearance(JSON.parse(JSON.stringify(parseAppearance({ fillWindow: true }))));
    expect(saved).toMatchObject({ workspaceWidth: "fill", edgeToEdge: true });
  });
});

describe("收起一个会话 (docs/design/002): a workspace folded to its strip", () => {
  const strip = (shelves = [shelf("s9", "right")]): RowWorkspace => ({ want: 770, min: 300, rail: true, shelves, strip: true });

  it("the strip is exactly STRIP_W, with no Shelf and no rail (its Shelves go with it)", () => {
    for (const mode of ["smart", "fill", "content"] as const) {
      const row = workspaceRow({ area: 2400, mode, placement: "outer", split: 0.3, workspaces: [strip(), focusedWs(770)] });
      expect(row.workspaces[0]).toEqual({ width: STRIP_W, shelves: [], railAt: "left" });
    }
  });

  it("filling (智能 / 铺满窗口): the other column takes the rest — the share is ignored", () => {
    const row = workspaceRow({ area: 2400, mode: "smart", placement: "outer", split: 0.3, workspaces: [strip(), focusedWs(770)] });
    expect(row).toMatchObject({ mode: "fill", centred: false, fits: true });
    const box = row.workspaces[1]!.shelves[0]!.box;
    expect(box).toBe(expandedBox(420));
    expect(row.workspaces[1]!.width).toBe(2400 - STRIP_W - CARD_GAP - box);
    // The other workspace's Shelf stays on its outer side (the right).
    expect(row.workspaces[1]!.shelves[0]!.at).toBe("right");
    // The strip on the right: the same.
    const right = workspaceRow({ area: 2400, mode: "fill", placement: "outer", workspaces: [focusedWs(770), strip()] });
    expect(right.workspaces[0]!.width).toBe(2400 - STRIP_W - CARD_GAP - box);
    expect(right.workspaces[0]!.shelves[0]!.at).toBe("left");
    expect(right.workspaces[1]!.width).toBe(STRIP_W);
  });

  it("by content: the other column keeps its width, the group (strip included) is centred, the desktop shows", () => {
    const row = workspaceRow({ area: 2400, mode: "content", placement: "outer", workspaces: [focusedWs(770), strip()] });
    expect(row).toMatchObject({ mode: "content", centred: true, fits: true });
    expect(row.workspaces.map((w) => w.width)).toEqual([770, STRIP_W]);
    expect(row.workspaces[0]!.shelves[0]).toMatchObject({ expanded: true, at: "left" });
  });

  it("short of width beside a strip: the other column narrows, then its Shelf shows as its rail (as alone)", () => {
    const row = workspaceRow({ area: 700, mode: "fill", placement: "outer", workspaces: [focusedWs(770), strip()] });
    expect(row.workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: true });
    expect(row.workspaces[0]!.width).toBe(700 - STRIP_W - CARD_GAP - COLLAPSED_SHELF_WIDTH);
    expect(row.fits).toBe(false);
  });

  it("both strips (never drawn: lib/convStrips keeps one expanded): laid out as usual", () => {
    const both = workspaceRow({ area: 2400, mode: "fill", placement: "outer", workspaces: [strip([]), strip([])] });
    expect(both.workspaces.map((w) => w.width)).toEqual([null, null]);
  });
});
