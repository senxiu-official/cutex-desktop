// 最大化 = rule 2 (docs/design/003-maximize.md, lib/panelGrow): every gap of the row to the maximised panel, the
// rest keeps its width; filling, the other columns narrow to the reading width; a pane fills its page; the store's
// toggle / end (a collapsed Shelf expands first and folds back). 恢复默认布局 (docs/design/015, lib/layoutReset):
// the Shelves' default and their way back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, collapseShelf, emptyLayout, expandShelf, place, placeSpec, setOpen, setShelfWidth, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { canGrow, dropRestorePoint, endGrow, markGrowBaked, foldedForGrow, growStoredLayout, growStoredMeta, unexpand, growRow, resetGrow, rowGrowRoom, setGrowHooks, setGrowRoom, singleGrowRoom, toggleGrow, useGrow, openIds, openedSince } from "../src/renderer/src/lib/panelGrow";
import { defaultShelves, restoreShelves, shelvesShot } from "../src/renderer/src/lib/layoutReset";
import type { RowOut } from "../src/renderer/src/lib/workspaceRow";
import { CARD_GAP } from "../src/renderer/src/lib/sideLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
let clock = 100;
function open(layout: SideLayout, kind: string): SideLayout {
  const input = { kind: kind as ItemId, binding: FOLLOW, key: SINGLETON_KEY, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open }, placeSpec({ home: "workspace" }));
  return applyOpen(layout, decision, input, ++clock, { reveal: true, home: "workspace" }).layout;
}

const ws = (width: number, shelves: { id: string; at: "left" | "right"; box: number; expanded?: boolean }[] = []) => ({
  width,
  railAt: "right" as const,
  shelves: shelves.map((x) => ({ id: x.id, at: x.at, expanded: x.expanded ?? true, box: x.box, forced: false })),
});
const row = (mode: "content" | "fill", workspaces: ReturnType<typeof ws>[]): RowOut => ({ mode, centred: mode === "content", fits: true, workspaces });

describe("最大化 (rule 2): the row's gaps", () => {
  it("by content: the maximised column takes the whole free row, the others keep their width", () => {
    // [S0 468][C0 600] 8 [C1 600] in 2000: free = 2000 − 1676 = 324.
    const r = row("content", [ws(600, [{ id: "s", at: "left", box: 468 }]), ws(600)]);
    expect(rowGrowRoom({ row: r, area: 2000, empties: [0, 0], shrinkTo: null, target: { ws: 1, shelfId: null } })).toBe(2000 - 468 - 600 - 600 - CARD_GAP);
    const g = growRow({ row: r, area: 2000, empties: [0, 0], shrinkTo: null, target: { ws: 1, shelfId: null } });
    expect(g.workspaces.map((w) => w.width)).toEqual([600, 924]);
    expect(g.workspaces[0]!.shelves[0]!.box).toBe(468);
    expect(g.centred).toBe(false);
    // A Shelf: its box takes it.
    const s = growRow({ row: r, area: 2000, empties: [0, 0], shrinkTo: null, target: { ws: 0, shelfId: "s" } });
    expect(s.workspaces[0]!.shelves[0]!.box).toBe(468 + 324);
    expect(s.workspaces.map((w) => w.width)).toEqual([600, 600]);
  });

  it("filling: the other columns narrow to the reading width; no gap and nothing above it = nothing to take (greyed)", () => {
    const r = row("fill", [ws(900, [{ id: "s", at: "left", box: 300 }]), ws(792)]);
    const area = 300 + 900 + 792 + CARD_GAP;
    expect(rowGrowRoom({ row: r, area, empties: [0, 0], shrinkTo: 770, target: { ws: 0, shelfId: null } })).toBe(22);
    expect(growRow({ row: r, area, empties: [0, 0], shrinkTo: 770, target: { ws: 0, shelfId: null } }).workspaces.map((w) => w.width)).toEqual([922, 770]);
    // A Shelf: both columns give what they have above the reading width.
    const s = growRow({ row: r, area, empties: [0, 0], shrinkTo: 770, target: { ws: 0, shelfId: "s" } });
    expect(s.workspaces.map((w) => w.width)).toEqual([770, 770]);
    expect(s.workspaces[0]!.shelves[0]!.box).toBe(300 + 130 + 22);
    // Columns at the reading width already, no free row: nothing.
    const tight = row("fill", [ws(770), ws(770)]);
    expect(rowGrowRoom({ row: tight, area: 1548, empties: [0, 0], shrinkTo: 770, target: { ws: 0, shelfId: null } })).toBe(0);
    expect(growRow({ row: tight, area: 1548, empties: [0, 0], shrinkTo: 770, target: { ws: 0, shelfId: null } })).toBe(tight);
    // Flexing columns (no width of their own): nothing to compute.
    expect(rowGrowRoom({ row: row("fill", [{ ...ws(0), width: null as unknown as number }, ws(500)]), area: 2000, empties: [0, 0], shrinkTo: 770, target: { ws: 1, shelfId: null } })).toBe(0);
  });

  it("one workspace: the free row; filling, a Shelf gets what the column has above the reading width", () => {
    expect(singleGrowRoom({ kind: "conv", area: 1600, groupTotal: 1230, byContent: true, column: 770, readingW: 770 })).toBe(370);
    expect(singleGrowRoom({ kind: "conv", area: 1600, groupTotal: 1600, byContent: false, column: 1100, readingW: 770 })).toBe(0);
    expect(singleGrowRoom({ kind: "shelf", area: 1600, groupTotal: 1600, byContent: false, column: 1100, readingW: 770 })).toBe(330);
    expect(singleGrowRoom({ kind: "shelf", area: 1600, groupTotal: 1230, byContent: true, column: 770, readingW: 770 })).toBe(370);
  });

  it("a pane fills its page: the others show as their title bars", () => {
    expect(foldedForGrow(["a", "b", "c"], "b")).toEqual([true, false, true]);
    expect(foldedForGrow(["a", "b"], null)).toEqual([false, false]);
    expect(foldedForGrow(["a", "b"], "x")).toEqual([false, false]);
  });

  it("something new opening is noticed; a closing is not", () => {
    let l = open(emptyLayout(), "workspace.files");
    const before = openIds(["p1"], l);
    l = open(l, "workspace.changes");
    expect(openedSince(before, openIds(["p1"], l))).toBe(true);
    expect(openedSince(openIds(["p1", "p2"], l), openIds(["p1"], l))).toBe(false);
  });
});

describe("最大化: toggle, end, a collapsed Shelf", () => {
  let layout: SideLayout;
  const expanded: string[] = [];
  const collapsed: string[] = [];
  let exclusive = false;
  beforeEach(() => {
    resetGrow();
    expanded.length = 0;
    collapsed.length = 0;
    exclusive = false;
    layout = open(emptyLayout(), "workspace.files");
    setGrowHooks({
      liveConv: () => "c1",
      layout: () => layout,
      expand: (id) => {
        expanded.push(id);
        layout = expandShelf(layout, id);
      },
      restore: (e) => {
        collapsed.push(e.shelfId);
        layout = unexpand(layout, e);
      },
      exclusiveOn: () => exclusive,
      endExclusive: () => void (exclusive = false),
    });
  });

  it("greyed without a gap; with one it toggles; 独占 ends when it starts", () => {
    expect(canGrow({ kind: "conv", paneId: "p1" })).toBe(false);
    expect(toggleGrow({ kind: "conv", paneId: "p1" })).toBe(false);
    setGrowRoom({ conv: { p1: 120 }, shelf: 0 });
    exclusive = true;
    expect(toggleGrow({ kind: "conv", paneId: "p1" })).toBe(true);
    expect(exclusive).toBe(false);
    expect(useGrow.getState().target).toEqual({ kind: "conv", paneId: "p1" });
    // Again = back.
    toggleGrow({ kind: "conv", paneId: "p1" });
    expect(useGrow.getState().target).toBeNull();
  });

  it("a collapsed Shelf expands first and folds again on restore; an expanded one with no gap is greyed", () => {
    const id = shelvesOf(layout)[0]!.id;
    expect(canGrow({ kind: "shelf", conv: "c1", shelfId: id, card: null })).toBe(false);
    layout = collapseShelf(layout, id);
    expect(toggleGrow({ kind: "shelf", conv: "c1", shelfId: id, card: null })).toBe(true);
    expect(expanded).toEqual([id]);
    endGrow();
    expect(collapsed).toEqual([id]);
    expect(shelvesOf(layout)[0]!.collapsed).toBe(true);
  });

  // Audit 2026-10-23 #2: while the restore point exists the stored collapsed / open do not change; owner 2026-10-23
  // (real widths): the row's set of panes changing drops the restore point and keeps the layout as it is.
  it("while maximised the Shelf is stored collapsed; a dropped restore point keeps it expanded (real now)", () => {
    const id = shelvesOf(layout)[0]!.id;
    layout = collapseShelf(layout, id);
    toggleGrow({ kind: "shelf", conv: "c1", shelfId: id, card: null });
    expect(shelvesOf(layout)[0]!.collapsed).toBeFalsy(); // drawn expanded
    expect(shelvesOf(growStoredLayout(layout, "c1"))[0]!.collapsed).toBe(true); // stored as it was
    expect(growStoredLayout(layout, "c2")).toBe(layout); // another conversation's: untouched
    expect(growStoredMeta({ collapsed: {} }, "c1").collapsed).toEqual({ [id]: true });
    dropRestorePoint();
    expect(useGrow.getState().target).toBeNull();
    expect(useGrow.getState().expanded).toBeNull();
    expect(collapsed).toEqual([]);
    expect(shelvesOf(layout)[0]!.collapsed).toBeFalsy();
    expect(growStoredLayout(layout, "c1")).toBe(layout);
  });

  it("a closed tool area opens for it and closes again on 还原; an expanded Shelf is not touched", () => {
    const id = shelvesOf(layout)[0]!.id;
    layout = setOpen(layout, false);
    toggleGrow({ kind: "shelf", conv: "c1", shelfId: id, card: null });
    expect(layout.open).toBe(true);
    expect(growStoredLayout(layout, "c1").open).toBe(false);
    expect(growStoredMeta({}, "c1").open).toBe(false);
    endGrow();
    expect(layout.open).toBe(false);
    expect(shelvesOf(layout)[0]!.collapsed).toBeFalsy();
  });
});

// Owner 2026-10-23: 「你可以记住旧的方便 restore，但是新的也作为新的参数而不是临时参数」 — the row stores the maximised
// widths as real ones (components/side/SideArea, then markGrowBaked); the widths before are the restore point.
describe("最大化: real widths and the restore point", () => {
  const writes: unknown[] = [];
  let widths = { single: 0 };
  beforeEach(() => {
    resetGrow();
    writes.length = 0;
    widths = { single: 0 };
    setGrowHooks({
      liveConv: () => "c1",
      layout: () => emptyLayout(),
      expand: () => {},
      restore: () => {},
      exclusiveOn: () => false,
      endExclusive: () => {},
      snapshot: () => ({ ...widths }),
      restoreWidths: (r) => void writes.push(r),
    });
    setGrowRoom({ conv: { p1: 300 }, shelf: 0 });
  });

  it("the widths before are taken when it starts; 还原 writes them back — even after the panels were dragged", () => {
    widths.single = 770;
    toggleGrow({ kind: "conv", paneId: "p1" });
    expect(useGrow.getState().restore).toEqual({ single: 770 });
    expect(useGrow.getState().baked).toBe(false);
    // The row stored the maximised geometry; then an edge drag changed it (nothing ends 最大化 for that).
    markGrowBaked();
    widths.single = 1500;
    expect(useGrow.getState().target).toEqual({ kind: "conv", paneId: "p1" });
    // 还原 (a second click / Esc / Ctrl+Shift+M).
    toggleGrow({ kind: "conv", paneId: "p1" });
    expect(writes).toEqual([{ single: 770 }]);
    expect(useGrow.getState()).toMatchObject({ target: null, baked: false, restore: null });
  });

  it("ended before the row stored anything: nothing to write back", () => {
    toggleGrow({ kind: "conv", paneId: "p1" });
    endGrow();
    expect(writes).toEqual([]);
  });

  it("the row's set of panes changed: the restore point goes, nothing is written back", () => {
    toggleGrow({ kind: "conv", paneId: "p1" });
    markGrowBaked();
    dropRestorePoint();
    expect(writes).toEqual([]);
    expect(useGrow.getState().target).toBeNull();
    // The button is no longer pressed: 最大化 again takes a new restore point.
    expect(canGrow({ kind: "conv", paneId: "p1" })).toBe(true);
  });

  it("another panel maximised: the first one's widths come back first, then the new restore point is taken", () => {
    setGrowRoom({ conv: { p1: 300, p2: 300 }, shelf: 0 });
    toggleGrow({ kind: "conv", paneId: "p1" });
    markGrowBaked();
    widths.single = 999;
    toggleGrow({ kind: "conv", paneId: "p2" });
    expect(writes).toEqual([{ single: 0 }]);
    expect(useGrow.getState().restore).toEqual({ single: 999 });
  });
});

describe("恢复默认布局: the Shelves", () => {
  it("back to the default width and expanded; 撤销 puts back exactly what was there", () => {
    let l = open(emptyLayout(), "workspace.files");
    const id = shelvesOf(l)[0]!.id;
    l = collapseShelf(setShelfWidth(l, id, 333), id);
    const shot = shelvesShot(l);
    const reset = defaultShelves(l);
    expect(shelvesOf(reset)[0]!.width).toBeUndefined();
    expect(shelvesOf(reset)[0]!.collapsed).toBeFalsy();
    const back = restoreShelves(reset, shot);
    expect(shelvesOf(back)[0]!.width).toBe(333);
    expect(shelvesOf(back)[0]!.collapsed).toBe(true);
  });
});
