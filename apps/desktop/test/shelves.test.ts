// Shelves (docs/desktop-modules.md §24.12; canvas-principles-20261020 §6): the model (lib/sideLayout — pages
// per Shelf ≤ 9, add / rename / icon / reorder / delete with undo, switch, one Shelf per side ≤ 2, collapse
// to the rail and back (page clicks, row widths), move to the other side, mixing on / off), the stored v2 shape and the migrations
// (v1 tool columns → the right Shelf; the step-3 backup's pages back as pages), the `shelf` term, and the
// read API the ⌘K switcher uses (lib/shelves listShelfPages / openShelfPage).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import {
  addShelf,
  addShelfPage,
  applyOpen,
  canJoin,
  collapseCard,
  collapseShelf,
  COLLAPSED_SHELF_WIDTH,
  columnsOnScreen,
  expandShelf,
  emptyLayout,
  findCard,
  findPage,
  focusedShelf,
  locate,
  MAX_SHELF_PAGES,
  movePage,
  moveShelfToOtherSide,
  moveToNewShelf,
  pagesOfShelf,
  place,
  placeSpec,
  prepareForSave,
  removePage,
  removeShelf,
  renamePage,
  restoreLegacyPages,
  restoreRemoved,
  restoreCard,
  pagesOnScreen,
  railPageClick,
  railsOnScreen,
  revealInstance,
  sanitizeLayout,
  setPageIcon,
  setShelfOptions,
  setOpen,
  setShelfWidth,
  setSingleShelf,
  shelfRow,
  shelfLanePages,
  shelfOfPage,
  shelfOnSide,
  shelvesOf,
  SINGLETON_KEY,
  switchPage,
  toggleShelfCollapsed,
  withShelves,
  type SideLayout,
  type SideViewContext,
} from "../src/renderer/src/lib/sideLayout";
import { resolveDrop, applyToolDrop } from "../src/renderer/src/lib/sideDrop";
import { shelfMotionFrom } from "../src/renderer/src/lib/shelfMotion";
import { escChainStep, type EscChainInput } from "../src/renderer/src/lib/escChain";
import { migrateLayoutV1, PANE_LAYOUT_VERSION, splitLayout, toolPartOf, toolRawOf, validateLayout, defaultLayout, joinLayout } from "../src/renderer/src/lib/paneLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
const WS: SideBinding = { kind: "workspace", hostId: "local", key: "w1" };
const HOST: SideBinding = { kind: "host", hostId: "local" };
let clock = 100;

function open(layout: SideLayout, kind: string, binding: SideBinding, key: string | null = SINGLETON_KEY, home = "workspace", page?: string) {
  const input = { kind: kind as ItemId, binding, key, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open, page }, placeSpec({ home }));
  return { ...applyOpen(layout, decision, input, ++clock, { reveal: true, home }), decision };
}

const ctx = (over: Partial<SideViewContext> = {}): SideViewContext => ({ hostId: "local", sessionId: "A", workspaceKey: "w1", available: () => true, ...over });

/** A new right Shelf (mixing off, the default) with one full page: files, changes, terminal. */
function shelf() {
  let l = emptyLayout();
  const files = open(l, "workspace.files", FOLLOW);
  l = files.layout;
  const changes = open(l, "workspace.changes", FOLLOW, SINGLETON_KEY, "workspace", l.activePage!);
  l = changes.layout;
  const term = open(l, "terminal.pty", WS, "t1", "workspace", l.activePage!);
  l = term.layout;
  const right = shelvesOf(l)[0]!;
  return { layout: l, shelf: right.id, page: l.pages[0]!.id, inst: { files: files.instanceId, changes: changes.instanceId, term: term.instanceId } };
}

describe("the model", () => {
  it("the first tool makes the right Shelf (mixing off, rail outer); every page belongs to one Shelf with its page in view", () => {
    const { layout, shelf: id, page } = shelf();
    expect(shelvesOf(layout)).toEqual([{ id, side: "right", active: page, options: { allowMixing: false, railPlacement: "outer" } }]);
    expect(layout.pages.every((p) => p.shelf === id)).toBe(true);
    expect(focusedShelf(layout)!.id).toBe(id);
    expect(withShelves(layout)).toBe(layout);
  });

  it("pages: add (kept, empty, in view; ≤ 9), rename, icon, reorder within the rail, switch", () => {
    const s = shelf();
    let l = s.layout;
    const added = addShelfPage(l, s.shelf, { name: "  资料 ", icon: "book" });
    l = added.layout;
    const p2 = findPage(l, added.pageId)!;
    expect(p2).toMatchObject({ kept: true, name: "资料", icon: "book", cards: [], shelf: s.shelf });
    expect(shelfOfPage(l, p2.id)!.active).toBe(p2.id);
    expect(l.activePage).toBe(p2.id);
    // an empty kept page stays in the rail and on screen (its Shelf shows it: the drop target)
    expect(shelfLanePages(l, s.shelf, ctx()).map((p) => p.id)).toEqual([s.page, p2.id]);
    expect(columnsOnScreen(l, ctx(), null).map((x) => x.page.id)).toEqual([p2.id]);
    l = renamePage(l, p2.id, "Docs");
    l = setPageIcon(l, p2.id, "globe");
    expect(findPage(l, p2.id)).toMatchObject({ name: "Docs", icon: "globe" });
    expect(setPageIcon(l, p2.id, "globe")).toBe(l);
    l = movePage(l, p2.id, -1);
    expect(pagesOfShelf(l, s.shelf).map((p) => p.id)).toEqual([p2.id, s.page]);
    expect(movePage(l, p2.id, -1)).toBe(l);
    l = switchPage(l, s.page);
    expect(shelfOfPage(l, s.page)!.active).toBe(s.page);
    // ≤ 9 pages
    for (let n = pagesOfShelf(l, s.shelf).length; n < MAX_SHELF_PAGES; n++) l = addShelfPage(l, s.shelf).layout;
    expect(pagesOfShelf(l, s.shelf)).toHaveLength(MAX_SHELF_PAGES);
    expect(addShelfPage(l, s.shelf).pageId).toBeNull();
  });

  it("delete a page (its panes go; the neighbour shows) and undo it: pages, panes, instances back where they were", () => {
    const s = shelf();
    let l = addShelfPage(s.layout, s.shelf, { name: "2" }).layout;
    l = switchPage(l, s.page);
    const { layout: gone, removed } = removePage(l, s.page);
    expect(removed!.pages.map((p) => p.page.id)).toEqual([s.page]);
    expect(Object.keys(removed!.instances).sort()).toEqual([s.inst.files, s.inst.changes, s.inst.term].sort());
    expect(findPage(gone, s.page)).toBeNull();
    expect(gone.instances[s.inst.files]).toBeUndefined();
    expect(shelfOfPage(gone, gone.pages[0]!.id)!.active).toBe(gone.pages[0]!.id);
    const back = restoreRemoved(gone, removed!);
    expect(pagesOfShelf(back, s.shelf).map((p) => p.id)).toEqual(pagesOfShelf(l, s.shelf).map((p) => p.id));
    expect(findPage(back, s.page)!.cards).toEqual(findPage(l, s.page)!.cards);
    expect(back.instances[s.inst.term]).toEqual(l.instances[s.inst.term]);
    expect(back.activePage).toBe(s.page);
    // the last page of a Shelf: the Shelf goes with it (and comes back)
    const only = removePage(s.layout, s.page);
    expect(only.removed!.whole).toBe(true);
    expect(shelvesOf(only.layout)).toEqual([]);
    expect(only.layout.open).toBe(false);
    expect(shelvesOf(restoreRemoved(only.layout, only.removed!))).toEqual(shelvesOf(s.layout));
  });

  it("two Shelves at most, one per side: a new Shelf from the edge; move to the other side; close (undoable)", () => {
    const s = shelf();
    const left = moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock);
    expect(shelvesOf(left).map((x) => [x.side, x.options.allowMixing])).toEqual([["left", false], ["right", false]]);
    expect(shelfOfPage(left, locate(left, s.inst.term)!.page.id)!.side).toBe("left");
    expect(moveToNewShelf(left, { instance: s.inst.files }, "left", ++clock)).toBe(left);
    expect(addShelf(left, "left").shelfId).toBeNull();
    // moving to a side that has a Shelf: unchanged; alone: it moves
    const leftId = shelfOnSide(left, "left")!.id;
    expect(moveShelfToOtherSide(left, leftId)).toBe(left);
    const alone = removeShelf(left, s.shelf).layout;
    const moved = moveShelfToOtherSide(alone, leftId);
    expect(shelvesOf(moved).map((x) => x.side)).toEqual(["right"]);
    // close the left Shelf, undo: it is back on the left with its page and pane
    const closed = removeShelf(left, leftId);
    expect(shelvesOf(closed.layout).map((x) => x.side)).toEqual(["right"]);
    expect(closed.layout.instances[s.inst.term]).toBeUndefined();
    const undone = restoreRemoved(closed.layout, closed.removed!);
    expect(shelvesOf(undone).map((x) => x.side)).toEqual(["left", "right"]);
    expect(shelfOfPage(undone, locate(undone, s.inst.term)!.page.id)!.id).toBe(leftId);
  });

  it("collapse a Shelf to its rail (owner 2026-10-21): its page off screen, its rail stays; the focus moves to the other one; expand / a page / revealing its content brings it back", () => {
    const s = shelf();
    const two = moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock);
    const leftId = shelfOnSide(two, "left")!.id;
    const leftPage = shelfOnSide(two, "left")!.active!;
    const col = collapseShelf(two, leftId);
    expect(shelfOnSide(col, "left")!.collapsed).toBe(true);
    expect(columnsOnScreen(col, ctx(), null).map((x) => x.shelf.side)).toEqual(["right"]);
    // its rail is still on screen, with its page in view (not drawn)
    expect(railsOnScreen(col, ctx()).map((x) => [x.shelf.side, x.page.id])).toEqual([["left", leftPage]]);
    expect(railsOnScreen(setOpen(col, false), ctx())).toEqual([]);
    expect(railsOnScreen(two, ctx())).toEqual([]);
    expect(shelfOfPage(col, col.activePage)!.side).toBe("right");
    // the tool panes on screen no longer count its page
    expect(pagesOnScreen(col).map((p) => p.id)).toEqual([shelfOnSide(col, "right")!.active]);
    expect(collapseShelf(col, leftId)).toBe(col);
    const back = expandShelf(col, leftId);
    expect(shelfOnSide(back, "left")!.collapsed).toBeUndefined();
    expect(columnsOnScreen(back, ctx(), null).map((x) => x.shelf.side)).toEqual(["left", "right"]);
    expect(shelfOfPage(back, back.activePage)!.side).toBe("left");
    expect(toggleShelfCollapsed(toggleShelfCollapsed(back, leftId), leftId)).toEqual(back);
    expect(shelfOnSide(toggleShelfCollapsed(back, leftId), "left")!.collapsed).toBe(true);
    const revealed = revealInstance(col, s.inst.term, 600);
    expect(shelfOnSide(revealed, "left")!.collapsed).toBeUndefined();
    // Alt+n (switchPage) on a collapsed Shelf expands it to that page
    expect(shelfOnSide(switchPage(col, leftPage), "left")!.collapsed).toBeUndefined();
    // collapsed is stored with the layout
    const stored = sanitizeLayout(toolRawOf(JSON.parse(JSON.stringify(toolPartOf(prepareForSave(col, { persist: () => true }))))));
    expect(shelfOnSide(stored, "left")!.collapsed).toBe(true);
    expect(toolPartOf(col).shelves.find((x) => x.side === "left")).toMatchObject({ collapsed: true });
    expect(toolPartOf(col).shelves.find((x) => x.side === "left")!.chip).toBeUndefined();
    // a v3 Shelf chip (`chip`: in the tray since) reads as collapsed to its rail
    const legacy = toolPartOf(two);
    legacy.shelves = legacy.shelves.map((x) => (x.side === "left" ? { ...x, chip: 500 } : x));
    expect(shelfOnSide(sanitizeLayout(toolRawOf(legacy)), "left")!.collapsed).toBe(true);
  });

  it("Esc with the focus in an expanded Shelf (not typing) collapses it — after popups, handlers, a maximised pane and the drawer", () => {
    const esc = (over: Partial<EscChainInput>): EscChainInput => ({ modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: false, drawer: false, editable: false, inSide: true, shelf: true, ...over });
    expect(escChainStep(esc({}))).toBe("collapse-shelf");
    expect(escChainStep(esc({ editable: true }))).toBe("side");
    expect(escChainStep(esc({ handled: true }))).toBe("handled");
    expect(escChainStep(esc({ overlay: true }))).toBe("overlay");
    expect(escChainStep(esc({ mode: true }))).toBe("restore");
    expect(escChainStep(esc({ drawer: true }))).toBe("close-drawer");
    expect(escChainStep(esc({ shelf: false }))).toBe("side");
  });

  it("a rail's page button (owner 2026-10-21): collapsed → expands to that page; the page in view → collapses; another page → switches", () => {
    const s = shelf();
    const added = addShelfPage(s.layout, s.shelf, { name: "资料" });
    const p2 = added.pageId!;
    let l = added.layout;
    expect(shelfOnSide(l, "right")!.active).toBe(p2);
    // the page in view again: nothing (owner 2026-10-22: it used to collapse the Shelf, too easy by accident)
    expect(railPageClick(l, p2)).toBe(l);
    expect(railPageClick(railPageClick(l, p2), p2)).toBe(l);
    l = collapseShelf(l, shelfOnSide(l, "right")!.id);
    expect(columnsOnScreen(l, ctx(), null)).toEqual([]);
    // collapsed: the first page expands the Shelf to it
    l = railPageClick(l, s.page);
    expect(shelfOnSide(l, "right")).toMatchObject({ active: s.page });
    expect(shelfOnSide(l, "right")!.collapsed).toBeUndefined();
    expect(l.activePage).toBe(s.page);
    // expanded, another page: it comes into view (still expanded)
    l = railPageClick(l, p2);
    expect(shelfOnSide(l, "right")!.active).toBe(p2);
    expect(shelfOnSide(l, "right")!.collapsed).toBeUndefined();
    // the page in view clicked twice: still expanded at it
    l = railPageClick(railPageClick(l, p2), p2);
    expect(columnsOnScreen(l, ctx(), null).map((x) => x.page.id)).toEqual([p2]);
    expect(shelfOnSide(l, "right")!.collapsed).toBeUndefined();
    expect(railPageClick(l, "p404")).toBe(l);
  });

  it("the row's widths (owner 2026-10-21): a collapsed Shelf takes its rail only, the conversations get the rest", () => {
    const area = 1600;
    const expanded = shelfRow({ areaWidth: area, left: { collapsed: false, width: 400 }, right: "expanded", conversationMin: 360, layered: false });
    expect(expanded).toEqual({ leftFits: true, leftTaken: 408, rightRail: 0, rightRoom: 1192 });
    const both = shelfRow({ areaWidth: area, left: { collapsed: true }, right: "collapsed", conversationMin: 360, layered: false });
    expect(both).toEqual({ leftFits: false, leftTaken: COLLAPSED_SHELF_WIDTH, rightRail: COLLAPSED_SHELF_WIDTH, rightRoom: area - 2 * COLLAPSED_SHELF_WIDTH });
    expect(COLLAPSED_SHELF_WIDTH).toBe(48);
    // the right one collapsed: the left one fits beside the conversations and the rail
    const right = shelfRow({ areaWidth: area, left: { collapsed: false, width: 400 }, right: "collapsed", conversationMin: 360, layered: false });
    expect(right).toMatchObject({ leftFits: true, leftTaken: 408, rightRail: 48, rightRoom: 1600 - 408 - 48 });
    // too narrow for the expanded left Shelf: it leaves the row (a collapsed one stays)
    expect(shelfRow({ areaWidth: 800, left: { collapsed: false, width: 400 }, right: "expanded", conversationMin: 360, layered: false }).leftFits).toBe(false);
    expect(shelfRow({ areaWidth: 800, left: { collapsed: true }, right: "expanded", conversationMin: 360, layered: false }).leftTaken).toBe(48);
    // maximised / full screen: no left Shelf in the row
    expect(shelfRow({ areaWidth: area, left: { collapsed: true }, right: null, conversationMin: 360, layered: true }).leftTaken).toBe(0);
    // the motion only moves a collapse / expand
    expect(shelfMotionFrom(undefined, 48, true)).toBeNull();
    expect(shelfMotionFrom({ width: 408, collapsed: false }, 48, true)).toBe(408);
    expect(shelfMotionFrom({ width: 48, collapsed: true }, 408, false)).toBe(48);
    expect(shelfMotionFrom({ width: 400, collapsed: false }, 420, false)).toBeNull();
  });

  it("widths and options are per Shelf and stored", () => {
    const s = shelf();
    let l = setShelfWidth(s.layout, s.shelf, 512.4);
    l = setShelfOptions(l, s.shelf, { allowMixing: true, railPlacement: "inner" });
    expect(setShelfOptions(l, s.shelf, { allowMixing: true })).toBe(l);
    const stored = sanitizeLayout(toolRawOf(JSON.parse(JSON.stringify(toolPartOf(l)))));
    expect(shelvesOf(stored)[0]).toMatchObject({ width: 512, options: { allowMixing: true, railPlacement: "inner" } });
    expect(shelvesOf(setShelfWidth(stored, s.shelf, null))[0]!.width).toBeUndefined();
  });
});

describe("允许混排 (mixing)", () => {
  it("off (a new Shelf): a full page (opened into explicitly; design 038: otherwise a page of its own anyway) takes another kind as a new page of the Shelf, not as a tab; the same kind still joins its pane", () => {
    const s = shelf();
    const b = open(s.layout, "browser.tab", HOST, "u", "browser", s.page);
    expect(b.decision).toMatchObject({ op: "insert", via: "limit", page: { new: { shelf: s.shelf } } });
    const bp = locate(b.layout, b.instanceId)!.page.id;
    expect(bp).not.toBe(s.page);
    expect(pagesOfShelf(b.layout, s.shelf)).toHaveLength(2);
    expect(shelfOfPage(b.layout, bp)!.active).toBe(bp);
    const t2 = open(b.layout, "terminal.pty", WS, "t2");
    expect(locate(t2.layout, t2.instanceId)!.card.id).toBe(locate(t2.layout, s.inst.term)!.card.id);
    // canJoin: a tab bar of one kind refuses another kind, takes its own kind
    const termCard = locate(s.layout, s.inst.term)!.card.id;
    expect(canJoin(s.layout, termCard, ["browser.tab" as ItemId])).toBe(false);
    expect(canJoin(s.layout, termCard, ["terminal.pty" as ItemId])).toBe(true);
  });

  it("on (a migrated Shelf): a full page takes another kind as a tab of its bottom pane (today's behaviour); panes that mix stay when it is turned off", () => {
    const s = shelf();
    const mixed = setShelfOptions(s.layout, s.shelf, { allowMixing: true });
    const b = open(mixed, "browser.tab", HOST, "u", "browser", s.page);
    const termCard = locate(mixed, s.inst.term)!.card.id;
    expect(b.decision).toMatchObject({ via: "limit", page: { id: s.page }, card: { id: termCard } });
    expect(canJoin(mixed, termCard, ["browser.tab" as ItemId])).toBe(true);
    const off = setShelfOptions(b.layout, s.shelf, { allowMixing: false });
    expect(locate(off, b.instanceId)!.card.id).toBe(termCard); // nothing regroups
  });
});

describe("storage (layout v2) and migrations", () => {
  const work = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });

  it("v2: Shelves with their pages (an empty kept page too) round-trip; hidden pages are not on screen for the limits", () => {
    const s = shelf();
    let l = addShelfPage(s.layout, s.shelf, { name: "Empty" }).layout;
    l = moveToNewShelf(l, { instance: s.inst.files }, "left", ++clock);
    const joined = JSON.parse(JSON.stringify(joinLayout(work(), toolPartOf(prepareForSave(l, { persist: () => true })))));
    expect(joined.v).toBe(PANE_LAYOUT_VERSION);
    expect(validateLayout(joined)).not.toBeNull();
    const back = sanitizeLayout(toolRawOf(splitLayout(validateLayout(joined)!).tools!));
    expect(shelvesOf(back)).toEqual(shelvesOf(l));
    expect(back.pages.find((p) => p.name === "Empty")).toMatchObject({ kept: true, cards: [] });
  });

  it("migrateLayoutV1: tool columns → the right Shelf's pages (mixing off, owner 2026-10-20), the focused column in view; the work area as it was", () => {
    // A v1 layout as step 3–5 stored it: two tool columns.
    const v1 = {
      v: 1,
      dock: { left: null },
      cols: [
        { w: 1, rows: [{ pane: "main", h: 1 }] },
        { w: 0.5, area: "tools", id: "p1", groups: ["workspace"], name: "工作", rows: [{ pane: "t-c2", h: 1 }] },
        { w: 0.5, area: "tools", id: "p3", groups: ["browser"], rows: [{ pane: "t-c4", h: 1 }] },
      ],
      panes: {
        main: { tabs: ["main"], active: "main", at: 0 },
        "t-c2": { tabs: ["t-i5"], active: "t-i5", at: 1, kind: "workspace.files", collapsed: false },
        "t-c4": { tabs: ["t-i6"], active: "t-i6", at: 2, kind: "browser.tab", collapsed: false },
      },
      instances: {
        main: { kind: "core.conversation", binding: { kind: "agent", hostId: "local", sessionId: "a1" }, params: {}, state: null },
        "t-i5": { kind: "workspace.files", binding: FOLLOW, params: {}, state: null, key: "∅", v: 1, pinned: false, at: 1 },
        "t-i6": { kind: "browser.tab", binding: HOST, params: {}, state: { url: "x" }, key: "u", v: 1, pinned: false, at: 2 },
      },
      chips: [],
      focus: "main",
      max: null,
      tools: { open: true, focus: "p3", overrides: {}, seq: 6 },
    };
    const v2 = validateLayout(migrateLayoutV1(v1));
    expect(v2).not.toBeNull();
    expect(v2!.cols).toHaveLength(1);
    expect(v2!.shelves).toEqual([{ id: "s7", side: "right", active: "p3", options: { allowMixing: false, railPlacement: "outer" }, pages: [{ id: "p1", groups: ["workspace"], name: "工作", rows: [{ pane: "t-c2", h: 1 }] }, { id: "p3", groups: ["browser"], rows: [{ pane: "t-c4", h: 1 }] }] }]);
    const engine = sanitizeLayout(toolRawOf(splitLayout(v2!).tools!));
    expect(engine.pages.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(engine.activePage).toBe("p3");
    expect(engine.seq).toBe(7);
    expect(migrateLayoutV1(v2)).toBe(v2);
  });

  it("restoreLegacyPages: the step-3 backup's pages come back (names, panes, tab order) with the instances still there; closed ones stay closed", () => {
    // The v1.16 side: 工作区 [files, changes], 浏览器 [browser (2 tabs)], 笔记 [notes]; step 3 folded it into p1.
    const inst = (kind: string, binding: SideBinding, key: string, at: number) => ({ kind, binding, key, state: null, v: 1, pinned: false, lastActiveAt: at });
    const legacyRaw = {
      open: true,
      activePage: "p1",
      seq: 20,
      pages: [
        { id: "p1", groups: ["workspace"], cards: [{ id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 0.5, collapsed: false }, { id: "c4", kind: "workspace.changes", tabs: ["i5"], active: "i5", size: 0.5, collapsed: false }] },
        { id: "p6", groups: ["browser"], name: "网页", cards: [{ id: "c7", kind: "browser.tab", tabs: ["i8", "i9"], active: "i9", size: 1, collapsed: false }] },
        { id: "p10", groups: ["notes"], cards: [{ id: "c11", kind: "notes.note", tabs: ["i12"], active: "i12", size: 1, collapsed: false }] },
      ],
      instances: { i3: inst("workspace.files", FOLLOW, "∅", 1), i5: inst("workspace.changes", FOLLOW, "∅", 2), i8: inst("browser.tab", HOST, "a", 3), i9: inst("browser.tab", HOST, "b", 4), i12: inst("notes.note", HOST, "n", 5) },
      overrides: { "browser.tab": { page: "p6", groups: ["browser"], at: 1 } },
    };
    const legacy = sanitizeLayout(legacyRaw, "local", { legacy: true });
    // what step 3 made of it: one column p1 (browser + notes folded in), then the owner closed the note
    const asColumn = sanitizeLayout({ ...legacyRaw, pages: [{ id: "p1", groups: ["workspace", "browser", "notes"], cards: [
      { id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 0.34, collapsed: false },
      { id: "c4", kind: "workspace.changes", tabs: ["i5"], active: "i5", size: 0.33, collapsed: false },
      { id: "c7", kind: "browser.tab", tabs: ["i8", "i9"], active: "i9", size: 0.33, collapsed: false },
    ] }], instances: { ...legacyRaw.instances, i12: undefined }, overrides: { "browser.tab": { page: "p1", groups: ["workspace", "browser", "notes"], at: 1 } } });
    const restored = restoreLegacyPages(asColumn, legacy);
    expect(restored.pages.map((p) => p.id)).toEqual(["p1", "p6"]);
    expect(shelvesOf(restored)).toHaveLength(1);
    expect(shelvesOf(restored)[0]!.options.allowMixing).toBe(false);
    expect(restored.pages[0]!.cards.map((c) => c.kind)).toEqual(["workspace.files", "workspace.changes"]);
    expect(restored.pages[1]).toMatchObject({ name: "网页", groups: ["browser"] });
    expect(restored.pages[1]!.cards.map((c) => [c.kind, c.tabs, c.active])).toEqual([["browser.tab", ["i8", "i9"], "i9"]]);
    expect(Object.keys(restored.instances).sort()).toEqual(["i3", "i5", "i8", "i9"]);
    expect(restored.overrides["browser.tab"]!.page).toBe("p6");
    // a scope never folded from this backup: every old page whole, with its instances (new ids)
    const fresh = restoreLegacyPages(emptyLayout(), legacy);
    expect(fresh.pages.map((p) => p.name ?? p.groups[0])).toEqual(["workspace", "网页", "notes"]);
    expect(Object.keys(fresh.instances)).toHaveLength(5);
    expect(restoreLegacyPages(asColumn, sanitizeLayout({}, "local", { legacy: true }))).toBe(asColumn);
  });

  describe("the file (lib/paneFile)", () => {
    let storage: Map<string, string>;
    beforeEach(() => {
      vi.resetModules();
      storage = new Map();
      vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
    });

    it("migrateShelves: once (file v1 → v2); v1 layouts become Shelves; the step-3 backup's pages come back; nothing is lost", async () => {
      const file = await import("../src/renderer/src/lib/paneFile");
      const inst = (kind: string, binding: SideBinding, key: string, at: number) => ({ kind, binding, key, state: { k: key }, v: 1, pinned: false, lastActiveAt: at });
      const backup = {
        v: 1,
        layouts: {
          "host:local": {
            open: true,
            activePage: "p1",
            seq: 9,
            pages: [
              { id: "p1", groups: ["workspace"], cards: [{ id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 1, collapsed: false }] },
              { id: "p4", groups: ["browser"], name: "网页", cards: [{ id: "c5", kind: "browser.tab", tabs: ["i6"], active: "i6", size: 1, collapsed: false }] },
            ],
            instances: { i3: inst("workspace.files", FOLLOW, "∅", 1), i6: inst("browser.tab", HOST, "u", 2) },
            overrides: {},
          },
        },
      };
      // what step 3 stored: one column p1 holding both panes
      const v1 = {
        v: 1,
        dock: { left: null },
        cols: [{ w: 1, rows: [{ pane: "main", h: 1 }] }, { w: 1, area: "tools", id: "p1", groups: ["workspace", "browser"], rows: [{ pane: "t-c2", h: 0.5 }, { pane: "t-c5", h: 0.5 }] }],
        panes: {
          main: { tabs: ["main"], active: "main", at: 0 },
          "t-c2": { tabs: ["t-i3"], active: "t-i3", at: 1, kind: "workspace.files", collapsed: false },
          "t-c5": { tabs: ["t-i6"], active: "t-i6", at: 2, kind: "browser.tab", collapsed: false },
        },
        instances: {
          main: { kind: "core.conversation", binding: { kind: "agent", hostId: "local", sessionId: "a1" }, params: {}, state: null },
          "t-i3": { kind: "workspace.files", binding: FOLLOW, params: {}, state: { k: "∅" }, key: "∅", v: 1, pinned: false, at: 1 },
          "t-i6": { kind: "browser.tab", binding: HOST, params: {}, state: { k: "u" }, key: "u", v: 1, pinned: false, at: 2 },
        },
        chips: [],
        focus: "main",
        max: null,
        tools: { open: true, focus: "p1", overrides: {}, seq: 9 },
      };
      storage.set(file.LEGACY_SIDE_BACKUP_KEY, JSON.stringify(backup));
      storage.set(file.PANES_STORAGE_KEY, JSON.stringify({ v: 1, layouts: { "host:local": v1 } }));
      expect(file.migrateShelves("conversation.agent")).toEqual(["host:local"]);
      expect(JSON.parse(storage.get(file.PANES_STORAGE_KEY)!).v).toBe(2);
      expect(storage.get(file.LEGACY_SIDE_BACKUP_KEY)).toBe(JSON.stringify(backup)); // the backup stays
      expect(file.migrateShelves("conversation.agent")).toBeNull(); // once
      const local = file.readScope("host:local");
      expect(local.tools!.shelves).toHaveLength(1);
      expect(local.tools!.shelves[0]!.pages.map((p) => [p.id, p.name ?? null, p.rows.length])).toEqual([["p1", null, 1], ["p4", "网页", 1]]);
      expect(Object.keys(local.tools!.instances).sort()).toEqual(["t-i3", "t-i6"]);
      expect(local.tools!.instances["t-i6"]!.state).toEqual({ k: "u" });
      expect(local.work).not.toBeNull();
    });

    it("migrateMixingOff (file v2 → v3, owner 2026-10-20): every stored Shelf's 允许混排 off once; mixed panes stay; the 只用一个 Shelf default off", async () => {
      const file = await import("../src/renderer/src/lib/paneFile");
      // a v2 layout as 741f5a34 stored it: the right Shelf migrated with mixing on, a bottom pane holding two kinds
      const s = shelf();
      let l = setShelfOptions(s.layout, s.shelf, { allowMixing: true });
      const note = open(l, "notes.note", HOST, "n", "notes", s.page);
      l = note.layout;
      expect(locate(l, note.instanceId)!.card.id).toBe(locate(l, s.inst.term)!.card.id);
      const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
      const v2 = joinLayout(work, toolPartOf(l));
      expect(v2.shelves![0]!.options.allowMixing).toBe(true);
      storage.set(file.PANES_STORAGE_KEY, JSON.stringify({ v: 2, layouts: { "host:local": v2, "host:other": "junk" } }));
      expect(file.migrateMixingOff(false)).toBe(true);
      const after = JSON.parse(storage.get(file.PANES_STORAGE_KEY)!);
      expect(after).toMatchObject({ v: 3, singleShelf: false });
      expect(after.layouts["host:other"]).toBe("junk");
      const local = file.readScope("host:local");
      expect(local.tools!.shelves[0]!.options).toEqual({ allowMixing: false, railPlacement: "outer" });
      // the pane that mixes kinds stays as it is (nothing regroups)
      const engine = sanitizeLayout(toolRawOf(local.tools!));
      expect(locate(engine, note.instanceId)!.card.tabs).toEqual(locate(l, note.instanceId)!.card.tabs);
      expect(Object.keys(engine.instances).sort()).toEqual(Object.keys(l.instances).sort());
      // once: the owner's own switch after v3 stays on
      storage.set(file.PANES_STORAGE_KEY, JSON.stringify({ ...after, layouts: { "host:local": joinLayout(work, toolPartOf(setShelfOptions(engine, shelvesOf(engine)[0]!.id, { allowMixing: true }))) } }));
      expect(file.migrateMixingOff(true)).toBe(false);
      file.migrateSideOnce();
      expect(file.readScope("host:local").tools!.shelves[0]!.options.allowMixing).toBe(true);
      expect(file.singleShelfDefault()).toBe(false);
    });

    it("migrateShelfRails (file v3 → v4, owner 2026-10-21): a Shelf chip in the tray becomes collapsed to its rail; once", async () => {
      const file = await import("../src/renderer/src/lib/paneFile");
      const s = shelf();
      const two = moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock);
      const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
      const v3 = joinLayout(work, toolPartOf(two)) as unknown as { shelves: Record<string, unknown>[] };
      // as v3 stored a left Shelf collapsed into the tray
      v3.shelves = v3.shelves.map((x) => (x.side === "left" ? { ...x, chip: 1234 } : x));
      storage.set(file.PANES_STORAGE_KEY, JSON.stringify({ v: 3, layouts: { "host:local": v3, "host:other": "junk" }, singleShelf: false }));
      expect(file.migrateShelfRails()).toBe(true);
      const after = JSON.parse(storage.get(file.PANES_STORAGE_KEY)!);
      expect(after).toMatchObject({ v: 4, singleShelf: false });
      expect(after.layouts["host:other"]).toBe("junk");
      const left = after.layouts["host:local"].shelves.find((x: { side: string }) => x.side === "left");
      expect(left.chip).toBeUndefined();
      expect(left.collapsed).toBe(true);
      expect(after.layouts["host:local"].shelves.find((x: { side: string }) => x.side === "right").collapsed).toBeUndefined();
      // read back: the left Shelf is collapsed, its page, pane and instance are all there
      const local = file.readScope("host:local");
      const engine = sanitizeLayout(toolRawOf(local.tools!));
      expect(shelfOnSide(engine, "left")!.collapsed).toBe(true);
      expect(shelfOfPage(engine, locate(engine, s.inst.term)!.page.id)!.side).toBe("left");
      expect(Object.keys(engine.instances).sort()).toEqual(Object.keys(two.instances).sort());
      expect(file.migrateShelfRails()).toBe(false); // once
      file.migrateSideOnce();
      // §24.13: the file moves on to v5 (a Shelf per conversation) on the next start.
      expect(JSON.parse(storage.get(file.PANES_STORAGE_KEY)!).v).toBe(5);
    });

    it("migrateSideOnce on a new install (nothing stored): straight to v5 (§24.13) with 只用一个 Shelf on; once", async () => {
      const file = await import("../src/renderer/src/lib/paneFile");
      expect(file.singleShelfDefault()).toBe(false);
      file.migrateSideOnce();
      expect(JSON.parse(storage.get(file.PANES_STORAGE_KEY)!)).toEqual({ v: 5, layouts: {}, singleShelf: true, convShelves: {} });
      expect(file.singleShelfDefault()).toBe(true);
      file.migrateSideOnce(); // idempotent
      expect(JSON.parse(storage.get(file.PANES_STORAGE_KEY)!)).toEqual({ v: 5, layouts: {}, singleShelf: true, convShelves: {} });
    });

    it("migrateSideOnce on a v1.16 install: the pages are pages right away (the backup is not applied twice)", async () => {
      const file = await import("../src/renderer/src/lib/paneFile");
      const raw = JSON.stringify({
        v: 1,
        layouts: {
          "host:local": {
            open: true,
            activePage: "p4",
            seq: 9,
            pages: [
              { id: "p1", groups: ["workspace"], cards: [{ id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 1, collapsed: false }] },
              { id: "p4", groups: ["browser"], cards: [{ id: "c5", kind: "browser.tab", tabs: ["i6"], active: "i6", size: 1, collapsed: false }] },
            ],
            instances: { i3: { kind: "workspace.files", binding: FOLLOW, key: "∅", state: null, v: 1, pinned: false, lastActiveAt: 1 }, i6: { kind: "browser.tab", binding: HOST, key: "u", state: null, v: 1, pinned: false, lastActiveAt: 2 } },
            overrides: {},
          },
        },
      });
      storage.set(file.LEGACY_SIDE_KEY, raw);
      expect(file.migrateSideOnce()).toEqual(["host:local"]);
      const local = file.readScope("host:local");
      expect(local.tools!.shelves[0]!.pages.map((p) => p.id)).toEqual(["p1", "p4"]);
      expect(local.tools!.shelves[0]!.active).toBe("p4");
      expect(local.tools!.shelves[0]!.options.allowMixing).toBe(false);
      // v3 (允许混排 reset) and v4 (rails) on top; an existing install: 只用一个 Shelf off by default
      expect(JSON.parse(storage.get(file.PANES_STORAGE_KEY)!)).toMatchObject({ v: 5, singleShelf: false });
    });
  });
});

// The 12 locale catalogs, loaded while the file is collected: loading them inside the test cost it ~2 s alone and timed
// it out (5 s) under the full suite's load.
const LOCALES = ["zh-CN", "en", "en-AU", "zh-Hant-CN", "de-DE", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR", "pt-BR", "ru-RU"] as const;
const CATALOG_NAMES: Record<string, string> = { "zh-CN": "zhCN", en: "en", "en-AU": "enAU", "zh-Hant-CN": "zhHantCN", "de-DE": "deDE", "es-ES": "esES", "fr-FR": "frFR", "it-IT": "itIT", "ja-JP": "jaJP", "ko-KR": "koKR", "pt-BR": "ptBR", "ru-RU": "ruRU" };
const CATALOGS: Record<string, Record<string, string>> = Object.fromEntries(
  await Promise.all(LOCALES.map(async (locale) => [locale, ((await import(`../src/renderer/src/i18n/${locale}.ts`)) as Record<string, Record<string, string>>)[CATALOG_NAMES[locale]!]!] as const)),
);

describe("the `shelf` term (§6: Shelf in every language, renamable; presets leave it)", () => {
  it("{{shelf}} / {{Shelf}} / {{shelves}}: Shelf by default everywhere; a custom word; en plural", async () => {
    const { applyTerms, DEFAULT_TERMS, resolveTerms, TERM_IDS, unknownTermTokens } = await import("../src/renderer/src/lib/terms");
    expect(TERM_IDS).toContain("shelf");
    for (const locale of Object.keys(DEFAULT_TERMS) as (keyof typeof DEFAULT_TERMS)[]) expect(DEFAULT_TERMS[locale].shelf).toEqual({ one: "Shelf", many: "Shelf" });
    expect(applyTerms("关闭{{shelf}}", DEFAULT_TERMS["zh-CN"], "zh-CN")).toBe("关闭 Shelf");
    expect(applyTerms("{{Shelf}} options · two {{shelves}}", DEFAULT_TERMS.en, "en")).toBe("Shelf options · two Shelf");
    expect(unknownTermTokens("{{shelf}} {{Shelf}} {{shelves}}")).toEqual([]);
    const drawer = resolveTerms({ en: { shelf: { one: "drawer" } }, "zh-CN": { shelf: { one: "抽屉" } } }, "en");
    expect(applyTerms("Close {{shelf}} · {{Shelf}} · {{shelves}}", drawer, "en")).toBe("Close drawer · Drawer · drawers");
    expect(applyTerms("关闭{{shelf}}", resolveTerms({ "zh-CN": { shelf: { one: "抽屉" } } }, "zh-CN"), "zh-CN")).toBe("关闭抽屉");
  });

  it("every new UI string writes the Shelf through the term, in all 12 locales", () => {
    for (const locale of LOCALES) {
      const cat = CATALOGS[locale]!;
      const keys = Object.keys(cat).filter((k) => k.startsWith("shelf."));
      expect(keys.length, locale).toBeGreaterThanOrEqual(50);
      for (const k of keys) expect(/\bShelf\b/.test(cat[k]!.replace(/\{\{[^}]*\}\}/g, "")), `${locale} ${k}: ${cat[k]}`).toBe(false);
      expect(cat["shelf.close"], locale).toMatch(/\{\{[Ss]helf\}\}/);
    }
  });

  it("wording presets set and clear every term but the Shelf's, and a renamed Shelf does not make the wording custom", async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    const terms = await import("../src/renderer/src/lib/terms");
    const presets = await import("../src/renderer/src/lib/termPresets");
    terms.setTerm("zh-CN", "shelf", "one", "抽屉");
    expect(presets.currentTermPreset("zh-CN")).toBe("default");
    presets.applyTermPreset("zh-CN", "maid");
    expect(terms.getTermOverrides()["zh-CN"]?.shelf?.one).toBe("抽屉");
    expect(presets.currentTermPreset("zh-CN")).toBe("maid");
    presets.applyTermPreset("zh-CN", "default");
    expect(terms.getTermOverrides()["zh-CN"]?.shelf?.one).toBe("抽屉");
    expect(presets.PRESET_TERM_IDS).not.toContain("shelf");
  });
});

describe("只用一个 Shelf (单一 Shelf 模式, owner 2026-10-20)", () => {
  const single = () => {
    const s = shelf();
    return { ...s, layout: setSingleShelf(s.layout, true) };
  };
  const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });

  it("no second Shelf: addShelf / moveToNewShelf refuse; 移到另一边 still works; off again: a second Shelf can be made", () => {
    const s = single();
    expect(s.layout.singleShelf).toBe(true);
    expect(setSingleShelf(s.layout, true)).toBe(s.layout);
    expect(addShelf(s.layout, "left")).toMatchObject({ layout: s.layout, shelfId: null, pageId: null });
    expect(moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock)).toBe(s.layout);
    const moved = moveShelfToOtherSide(s.layout, s.shelf);
    expect(shelvesOf(moved).map((x) => x.side)).toEqual(["left"]);
    expect(moved.singleShelf).toBe(true);
    // the Shelf on the left now: still no second one on the right
    expect(addShelf(moved, "right").shelfId).toBeNull();
    const off = setSingleShelf(s.layout, false);
    expect(addShelf(off, "left").shelfId).not.toBeNull();
  });

  it("an edge drop on the free side: a new page of the one Shelf (not a new Shelf); the Shelf's own side: a new page too", () => {
    const s = single();
    const card = locate(s.layout, s.inst.term)!.card.id;
    const world = { side: s.layout, work, roomForColumn: true };
    const free = resolveDrop(world, { type: "card", cardId: card }, { at: "edge", side: "left" });
    expect(free).toEqual({ kind: "newPage", shelfId: s.shelf });
    const after = applyToolDrop(s.layout, { type: "card", cardId: card }, free!, ++clock, () => 500);
    expect(shelvesOf(after)).toHaveLength(1);
    expect(pagesOfShelf(after, s.shelf).map((p) => p.cards.map((c) => c.kind))).toEqual([["workspace.files", "workspace.changes"], ["terminal.pty"]]);
    expect(resolveDrop(world, { type: "card", cardId: card }, { at: "edge", side: "right" })).toEqual({ kind: "newPage", shelfId: s.shelf });
    // a full rail: refused (no Shelf to spill into)
    let full = s.layout;
    while (pagesOfShelf(full, s.shelf).length < MAX_SHELF_PAGES) full = addShelfPage(full, s.shelf).layout;
    expect(resolveDrop({ ...world, side: full }, { type: "card", cardId: card }, { at: "edge", side: "left" })).toEqual({ kind: "refuse", why: "limit" });
    // mode off: the free edge makes a Shelf there, as before
    expect(resolveDrop({ ...world, side: setSingleShelf(s.layout, false) }, { type: "card", cardId: card }, { at: "edge", side: "left" })).toEqual({ kind: "edge", side: "left" });
  });

  it("turning it on keeps two Shelves as they are; closing one leaves one, and its undo joins the remaining Shelf", () => {
    const s = shelf();
    const two = moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock);
    const on = setSingleShelf(two, true);
    expect(shelvesOf(on).map((x) => x.side)).toEqual(["left", "right"]);
    const left = shelfOnSide(on, "left")!.id;
    const closed = removeShelf(on, left);
    expect(shelvesOf(closed.layout)).toHaveLength(1);
    const undone = restoreRemoved(closed.layout, closed.removed!);
    expect(shelvesOf(undone).map((x) => x.side)).toEqual(["right"]);
    expect(locate(undone, s.inst.term)!.page.shelf).toBe(s.shelf);
    // mode off: the undo puts the left Shelf back
    const back = restoreRemoved(setSingleShelf(closed.layout, false), closed.removed!);
    expect(shelvesOf(back).map((x) => x.side)).toEqual(["left", "right"]);
  });

  it("a chip whose Shelf is gone comes back into the one Shelf (not a new Shelf on its old side)", () => {
    const s = shelf();
    let l = moveToNewShelf(s.layout, { instance: s.inst.term }, "left", ++clock);
    const cardId = locate(l, s.inst.term)!.card.id;
    l = collapseCard(l, cardId, ++clock);
    expect(shelfOnSide(l, "left")).toBeNull();
    l = setSingleShelf(l, true);
    const back = restoreCard(l, cardId, ++clock);
    expect(shelvesOf(back).map((x) => x.side)).toEqual(["right"]);
    expect(locate(back, s.inst.term)!.page.shelf).toBe(s.shelf);
    expect(findCard(back, cardId)).not.toBeNull();
  });

  it("is stored with the layout (tools.singleShelf) and read back; absent = off", () => {
    const s = single();
    const part = toolPartOf(s.layout);
    expect(part.tools.singleShelf).toBe(true);
    const joined = joinLayout(work, part);
    expect(validateLayout(joined)).not.toBeNull();
    expect(sanitizeLayout(toolRawOf(splitLayout(validateLayout(joined)!).tools!)).singleShelf).toBe(true);
    expect(toolPartOf(shelf().layout).tools.singleShelf).toBeUndefined();
    expect(sanitizeLayout(toolRawOf(toolPartOf(shelf().layout))).singleShelf).toBeUndefined();
    expect(validateLayout({ ...joined, tools: { ...joined.tools!, singleShelf: "yes" } })).toBeNull();
  });
});

describe("defaults on load (lib/sideLayoutStore + lib/paneFile)", () => {
  let storage: Map<string, string>;
  const stubs = () => {
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
    if (typeof window === "undefined") vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  };
  // Each test loads a fresh lib/sideLayoutStore (resetModules); the first load also transformed it and all it pulls
  // in — 3.5 s alone, inside the first test's 5 s, which timed out under the full suite's load. Loaded once before
  // all (its own explicit time) to fill the transform cache; each test still gets fresh instances.
  beforeAll(async () => {
    stubs();
    await import("../src/renderer/src/lib/sideLayoutStore");
  }, 60_000);
  beforeEach(() => {
    vi.resetModules();
    stubs();
  });
  const load = async () => {
    const store = await import("../src/renderer/src/lib/sideLayoutStore");
    const stop = store.startSideStore(() => () => {});
    const layout = store.useSide.getState().layout;
    stop();
    return layout;
  };
  const stored = (tools: Record<string, unknown> | null) => {
    const w = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: null });
    return tools ? { ...w, tools: { open: false, focus: null, overrides: {}, seq: 0, ...tools } } : w;
  };

  it("a new install (nothing stored): 只用一个 Shelf on", async () => {
    expect((await load()).singleShelf).toBe(true);
    expect(JSON.parse(storage.get("cutex-desktop.panes")!)).toMatchObject({ v: 5, singleShelf: true });
  });

  it("an existing install (a v2 file): off — with two Shelves or with none; a scope's stored choice wins", async () => {
    storage.set("cutex-desktop.panes", JSON.stringify({ v: 2, layouts: { "host:local": stored(null) } }));
    expect((await load()).singleShelf).toBe(false);
    vi.resetModules();
    storage.set("cutex-desktop.panes", JSON.stringify({ v: 3, layouts: { "host:local": stored({ singleShelf: true }) }, singleShelf: false }));
    expect((await load()).singleShelf).toBe(true);
    vi.resetModules();
    storage.set("cutex-desktop.panes", JSON.stringify({ v: 3, layouts: { "host:local": stored({ singleShelf: false }) }, singleShelf: true }));
    expect((await load()).singleShelf).toBe(false);
  });

  it("an existing install with only the v1.16 side stored is not a new install", async () => {
    storage.set("cutex-desktop.side", JSON.stringify({ v: 1, layouts: {} }));
    expect((await load()).singleShelf).toBe(false);
  });
});

describe("the read API (lib/shelves: the ⌘K switcher reads the pages)", () => {
  it("listShelfPages: every rail page, left Shelf first, with its index, name, icon, in view / focused; openShelfPage shows one", async () => {
    vi.resetModules();
    vi.doMock("../src/renderer/src/lib/sideComponents", async (orig) => ({
      ...((await orig()) as object),
      sideViewNow: () => ctx(),
      sideRegistry: () => new Map(),
    }));
    const shelves = await import("../src/renderer/src/lib/shelves");
    const store = await import("../src/renderer/src/lib/sideLayoutStore");
    const s = shelf();
    let l = addShelfPage(s.layout, s.shelf, { name: "资料", icon: "book" }).layout;
    l = moveToNewShelf(l, { instance: s.inst.term }, "left", ++clock);
    store.useSide.setState({ layout: l });
    const list = shelves.listShelfPages();
    const leftShelf = shelfOnSide(l, "left")!;
    expect(list.map((x) => [x.side, x.index, x.pageId === locate(l, s.inst.term)!.page.id || x.name, x.inView])).toEqual([
      ["left", 1, true, true],
      ["right", 1, list[1]!.name, false],
      ["right", 2, "资料", true],
    ]);
    expect(list[2]).toMatchObject({ icon: "book", panes: 0, focused: false, shelfCollapsed: false, shelfId: s.shelf });
    expect(list[0]).toMatchObject({ shelfId: leftShelf.id, focused: true, firstKind: "terminal.pty", panes: 1 });
    expect(shelves.openShelfPage(list[1]!.pageId)).toBe(true);
    expect(store.useSide.getState().layout.activePage).toBe(list[1]!.pageId);
    expect(shelves.openShelfPage("p404")).toBe(false);
    // Alt+n: the focused Shelf's n-th page
    expect(shelves.switchShelfPage(2)).toBe(true);
    expect(store.useSide.getState().layout.activePage).toBe(list[2]!.pageId);
    expect(shelves.switchShelfPage(5)).toBe(false);
    let many = store.useSide.getState().layout;
    for (let n = 0; n < 18; n++) many = addShelfPage(many, s.shelf).layout;
    store.useSide.setState({ layout: many });
    const rail = shelfLanePages(many, s.shelf, ctx());
    expect(shelves.switchShelfPage(9)).toBe(true);
    expect(store.useSide.getState().layout.activePage).toBe(rail.at(-1)!.id);
    expect(shelves.switchShelfPage(8)).toBe(true);
    expect(store.useSide.getState().layout.activePage).toBe(rail[7]!.id);
    expect(shelves.switchShelfPage(1)).toBe(true);
    expect(store.useSide.getState().layout.activePage).toBe(rail[0]!.id);
    vi.doUnmock("../src/renderer/src/lib/sideComponents");
  });
});

describe("the Shelf shell names no feature (like components/side, test/modules.test.ts)", () => {
  it("lib/shelves, lib/shelfMenus, lib/shelfIcons, components/side/ShelfRail + ShelfToast", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const SRC = join(__dirname, "../src/renderer/src");
    for (const rel of ["lib/shelves.ts", "lib/shelfMenus.tsx", "lib/shelfIcons.ts", "components/side/ShelfRail.tsx", "components/side/ShelfToast.tsx"]) {
      const code = readFileSync(join(SRC, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(/goal|\bplan\b|terminal|subagent|delegation|\bjobs?\b|features\.has|_FEATURE\b|_COMPONENT\b|workspace\.|diff\.view|browser/gi), rel).toBeNull();
    }
  });
});
