// Drag and drop of panes, the pure part (lib/sideDrop.ts + the drop reducers in lib/sideLayout.ts and
// lib/paneLayout.ts; docs/desktop-modules.md §24 step 4): what the pointer is over (a pane and its zone —
// the outer 30 % on a side or the centre / header — a Shelf Rail's page button or ＋, or the work area's far
// edge) → the target (resolveDrop) → the layout (applyToolDrop / applyWorkDrop). §24.12: Shelves ≤ 2 (one
// per side), pages ≤ 9 each, ≤ 3 panes per page, ≤ 4 tool panes on screen; conversations one per column
// (they reorder); a free edge = a new Shelf there, an edge with a Shelf = a new page of it; a Shelf that
// does not allow mixing refuses another kind on a tab bar and offers a pane of its own below instead.
import { describe, expect, it } from "vitest";
import type { SideBinding, SidePlacement } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyToolDrop, applyWorkDrop, EDGE_ZONE, resolveDrop, zoneAt, type DropWorld, type DropZone, type SideDrag, type SideHit, type SideDropTarget } from "../src/renderer/src/lib/sideDrop";
import { defaultLayout, openBeside, conversationPanes, paneBinding, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import {
  applyOpen,
  closeInstances,
  MAX_PAGES,
  DEFAULT_ORDER,
  emptyLayout,
  findCard,
  locate,
  mergePages,
  moveCardTo,
  moveInstance,
  openLauncherPage,
  place,
  placeSpec,
  reorderCard,
  reorderPage,
  addShelf,
  setShelfOptions,
  shelvesOf,
  shelfOfPage,
  shelfOnSide,
  pagesOfShelf,
  addShelfPage,
  MAX_SHELF_PAGES,
  SINGLETON_KEY,
  splitInstanceTo,
  USER_GROUP,
  type PlaceSpec,
  type SideLayout,
} from "../src/renderer/src/lib/sideLayout";

const DECL: Record<string, SidePlacement> = {
  "workspace.files": { home: "workspace", order: 100 },
  "workspace.changes": { home: "workspace", order: 200 },
  "workspace.preview": { home: "workspace", order: 300 },
  "status:jobs.tasks": { home: "workspace", order: 600 },
  "terminal.pty": { home: "workspace", order: 800, share: 0.35 },
  "browser.tab": { home: "browser" },
  "side-chat.chat": { home: "chat" },
};
const SPECS: Record<string, PlaceSpec> = Object.fromEntries(Object.entries(DECL).map(([k, v]) => [k, placeSpec(v)]));
const orderOf = (kind: string): number => SPECS[kind]?.order ?? DEFAULT_ORDER;

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
const ws = (key: string): SideBinding => ({ kind: "workspace", hostId: "local", key });
const BINDING: Record<string, SideBinding> = {
  "workspace.files": FOLLOW,
  "workspace.changes": FOLLOW,
  "status:jobs.tasks": FOLLOW,
  "browser.tab": { kind: "host", hostId: "local" },
};

let clock = 1000;

function open(layout: SideLayout, kind: ItemId, o: { key?: string | null; binding?: SideBinding; page?: string } = {}) {
  const binding = o.binding ?? BINDING[kind] ?? { kind: "agent", hostId: "local", sessionId: "A" };
  const key = o.key === undefined ? SINGLETON_KEY : o.key;
  const decision = place(layout, { kind, binding, key, transient: false, page: o.page ?? layout.pages.find(p => p.groups.includes(SPECS[kind]!.home))?.id, activePage: layout.activePage, columnOpen: layout.open }, SPECS[kind]!, orderOf);
  const applied = applyOpen(layout, decision, { kind, binding, key, state: null, v: 1, pinned: false }, ++clock, { reveal: true, home: SPECS[kind]!.home });
  return { layout: applied.layout, id: applied.instanceId };
}

/**
 * §24.12: two Shelves on screen — the right one with the page 工作区 [files, changes, terminal(t1, t2)] (full:
 * 3 panes), the left one with the page 浏览器 [browser] (MAX_TOOL_PANES = 4 on screen); the workspace page
 * is focused. Both allow mixing (turned on: the step-4 rules below); `noMix` turns it off (every Shelf's default).
 */
function world() {
  let l = emptyLayout();
  const files = open(l, "workspace.files");
  l = files.layout;
  const changes = open(l, "workspace.changes");
  l = changes.layout;
  const t1 = open(l, "terminal.pty", { binding: ws("w1"), key: "t1" });
  l = t1.layout;
  const t2 = open(l, "terminal.pty", { binding: ws("w1"), key: "t2" });
  l = t2.layout;
  l = setShelfOptions(l, shelvesOf(l)[0]!.id, { allowMixing: true });
  // The browser's Shelf on the left: its page is a plain page (not one the owner made), it goes when emptied.
  const made = addShelf(l, "left");
  const launcher = { ...made.layout, pages: made.layout.pages.map((p) => (p.id === made.pageId ? (({ kept: _k, ...rest }) => ({ ...rest, groups: [], launcher: true }))(p) : p)) };
  const browser = open(launcher, "browser.tab", { key: "b1", page: made.pageId! });
  l = setShelfOptions(browser.layout, made.shelfId!, { allowMixing: true });
  const [work, web] = l.pages.map((p) => p.id) as [string, string];
  l = { ...l, activePage: work };
  const card = (id: string) => locate(l, id)!.card.id;
  return {
    layout: l,
    pages: { work, web },
    inst: { files: files.id, changes: changes.id, t1: t1.id, t2: t2.id, browser: browser.id },
    cards: { files: card(files.id), changes: card(changes.id), terminal: card(t1.id), browser: card(browser.id) },
  };
}

/** The world with the workspace column at two panes (changes closed): room to move into it. */
function roomy() {
  const w = world();
  return { ...w, layout: { ...w.layout, ...closeInstances(w.layout, [w.inst.changes]) } };
}

/** The world with mixing off on both Shelves (new Shelves' default, §24.12). */
function noMix() {
  const w = world();
  let l = w.layout;
  for (const x of shelvesOf(l)) l = setShelfOptions(l, x.id, { allowMixing: false });
  return { ...w, layout: l };
}

/** One Shelf: the world without the browser's (the left side is free). */
function oneColumn() {
  const w = world();
  return { ...w, layout: closeInstances(w.layout, [w.inst.browser]) };
}

const kindsOn = (layout: SideLayout, pageId: string) => layout.pages.find((p) => p.id === pageId)!.cards.map((c) => c.kind);
const pageKinds = (layout: SideLayout) => layout.pages.map((p) => p.cards.map((c) => c.kind));

/** Two conversation columns (a1 | b2). */
const twoConversations = (): PaneLayout => openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" }), { hostId: "local", sessionId: "b2" }, 1);
const worldOf = (side: SideLayout, roomForColumn = true): DropWorld => ({ side, work: twoConversations(), roomForColumn });
const tool = (id: string, zone: DropZone | "head", half: "left" | "right" = "left"): SideHit => ({ at: "pane", area: "tools", id, zone, half });
const conv = (id: string, zone: DropZone | "head", half: "left" | "right" = "left"): SideHit => ({ at: "pane", area: "work", id, zone, half });

function drop(side: SideLayout, drag: SideDrag, hit: SideHit, room = true): { target: SideDropTarget | null; after: SideLayout } {
  const target = resolveDrop(worldOf(side, room), drag, hit);
  return { target, after: target ? applyToolDrop(side, drag, target, ++clock, orderOf) : side };
}

describe("zones of a pane (the outer 30 % on a side, else the centre)", () => {
  const box = { left: 100, top: 100, width: 400, height: 300 };
  it("the nearest side within the band wins; the middle is the centre", () => {
    expect(EDGE_ZONE).toBe(0.3);
    expect(zoneAt(box, 110, 250)).toBe("left");
    expect(zoneAt(box, 490, 250)).toBe("right");
    expect(zoneAt(box, 300, 110)).toBe("top");
    expect(zoneAt(box, 300, 390)).toBe("bottom");
    expect(zoneAt(box, 300, 250)).toBe("center");
    // A corner: the nearer side.
    expect(zoneAt(box, 105, 130)).toBe("left");
    expect(zoneAt(box, 140, 104)).toBe("top");
    // Just inside 30 % / just outside.
    expect(zoneAt(box, 100 + 0.29 * 400, 250)).toBe("left");
    expect(zoneAt(box, 100 + 0.31 * 400, 250)).toBe("center");
  });
});

describe("a tool pane / tab onto another tool pane", () => {
  it("header or centre: joins it as a tab, whatever the kind (step 4); the moved tab shows; override follows across columns", () => {
    const w = world();
    for (const zone of ["head", "center"] as const) {
      const { target, after } = drop(w.layout, { type: "card", cardId: w.cards.browser }, tool(w.cards.files, zone));
      expect(target).toEqual({ kind: "merge", cardId: w.cards.files });
      const files = findCard(after, w.cards.files)!.card;
      expect(files.tabs).toEqual([w.inst.files, w.inst.browser]);
      expect(files.active).toBe(w.inst.browser);
      expect(after.pages).toHaveLength(1);
      expect(after.overrides["browser.tab"]?.page).toBe(w.pages.work);
    }
    // One tab of a pane with several: only that tab moves.
    const tab = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, tool(w.cards.browser, "center"));
    expect(findCard(tab.after, w.cards.browser)!.card.tabs).toEqual([w.inst.browser, w.inst.t2]);
    expect(findCard(tab.after, w.cards.terminal)!.card.tabs).toEqual([w.inst.t1]);
  });

  it("top / bottom: splits that column there; a full column refuses; its own place is no target", () => {
    const r = roomy();
    const below = drop(r.layout, { type: "card", cardId: r.cards.browser }, tool(r.cards.files, "bottom"));
    expect(below.target).toEqual({ kind: "split", cardId: r.cards.files, side: "bottom" });
    expect(kindsOn(below.after, r.pages.work)).toEqual(["workspace.files", "browser.tab", "terminal.pty"]);
    const above = drop(r.layout, { type: "tab", instanceId: r.inst.t2 }, tool(r.cards.files, "top"));
    expect(kindsOn(above.after, r.pages.work)).toEqual(["terminal.pty", "workspace.files", "terminal.pty"]);
    // The workspace column of the full world has 3 panes.
    const w = world();
    expect(drop(w.layout, { type: "card", cardId: w.cards.browser }, tool(w.cards.files, "top")).target).toEqual({ kind: "refuse", why: "limit" });
    // Own pane (a pane, or its only tab) / a reorder that changes nothing.
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, tool(w.cards.files, "bottom")).target).toBeNull();
    expect(drop(w.layout, { type: "tab", instanceId: w.inst.files }, tool(w.cards.files, "center")).target).toBeNull();
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, tool(w.cards.changes, "top")).target).toBeNull();
    // A reorder in its own column.
    const re = drop(w.layout, { type: "card", cardId: w.cards.files }, tool(w.cards.changes, "bottom"));
    expect(kindsOn(re.after, w.pages.work)).toEqual(["workspace.changes", "workspace.files", "terminal.pty"]);
    // A tab of a pane with several splits out of it (top / bottom of its own pane).
    const out = drop(r.layout, { type: "tab", instanceId: r.inst.t1 }, tool(r.cards.terminal, "bottom"));
    expect(out.target).toEqual({ kind: "split", cardId: r.cards.terminal, side: "bottom" });
    expect(kindsOn(out.after, r.pages.work)).toEqual(["workspace.files", "terminal.pty", "terminal.pty"]);
  });

  it("left / right of a tool pane: like its centre (a tab) — §24.12: no column beside it; new Shelves come from the work area's edges", () => {
    const w = world();
    for (const zone of ["left", "right"] as const) {
      expect(drop(w.layout, { type: "card", cardId: w.cards.browser }, tool(w.cards.files, zone)).target).toEqual({ kind: "merge", cardId: w.cards.files });
    }
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, tool(w.cards.files, "left")).target).toBeNull();
  });
});

describe("Shelves (§24.12): page buttons, ＋, mixing", () => {
  it("a page button: into that page (a new pane), the page in view; a full page refuses; the drag's own page is no target", () => {
    const w = world();
    const r = roomy();
    const into = drop(r.layout, { type: "card", cardId: r.cards.browser }, { at: "page", pageId: r.pages.work });
    expect(into.target).toEqual({ kind: "page", pageId: r.pages.work });
    // (a pane goes in at its declared order)
    expect(kindsOn(into.after, r.pages.work)).toEqual(["workspace.files", "browser.tab", "terminal.pty"]);
    expect(into.after.activePage).toBe(r.pages.work);
    // a tab joins a pane of its kind there
    const tab = drop(r.layout, { type: "tab", instanceId: r.inst.browser }, { at: "page", pageId: r.pages.work });
    expect(tab.target).toEqual({ kind: "page", pageId: r.pages.work });
    expect(drop(w.layout, { type: "card", cardId: w.cards.browser }, { at: "page", pageId: w.pages.work }).target).toEqual({ kind: "refuse", why: "pageFull" });
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, { at: "page", pageId: w.pages.work }).target).toBeNull();
    // a hidden page of the same Shelf (only its page in view is on screen)
    const more = addShelfPage(w.layout, shelfOfPage(w.layout, w.pages.work)!.id);
    const hidden = more.pageId!;
    const back = { ...more.layout, shelves: more.layout.shelves!.map((x) => (x.active === hidden ? { ...x, active: w.pages.work } : x)), activePage: w.pages.work };
    const toHidden = drop(back, { type: "card", cardId: w.cards.files }, { at: "page", pageId: hidden });
    expect(toHidden.target).toEqual({ kind: "page", pageId: hidden });
    expect(kindsOn(toHidden.after, hidden)).toEqual(["workspace.files"]);
    expect(shelfOfPage(toHidden.after, hidden)!.active).toBe(hidden);
  });

  it("＋ in a rail: a new page (kept, at the end of the rail) holding it; refused at 9 pages; the only pane of a page onto its own Shelf's ＋: nothing", () => {
    const w = world();
    const right = shelfOfPage(w.layout, w.pages.work)!.id;
    const { target, after } = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, { at: "newPage", shelfId: right });
    expect(target).toEqual({ kind: "newPage", shelfId: right });
    const pages = pagesOfShelf(after, right);
    expect(pages).toHaveLength(2);
    expect(pages[1]!.kept).toBe(true);
    expect(pages[1]!.cards.map((c) => c.tabs)).toEqual([[w.inst.t2]]);
    expect(after.activePage).toBe(pages[1]!.id);
    const left = shelfOfPage(w.layout, w.pages.web)!.id;
    expect(drop(w.layout, { type: "card", cardId: w.cards.browser }, { at: "newPage", shelfId: left }).target).toBeNull();
    let full = w.layout;
    while (pagesOfShelf(full, right).length < MAX_SHELF_PAGES) full = addShelfPage(full, right).layout;
    expect(drop(full, { type: "card", cardId: w.cards.browser }, { at: "newPage", shelfId: right }).target).toEqual({ kind: "refuse", why: "limit" });
  });

  it("允许混排 off: another kind on a tab bar is refused and offered as a pane of its own below; a full page refuses it; the same kind still joins", () => {
    const n = noMix();
    // the workspace page is full: no pane of its own either
    expect(drop(n.layout, { type: "card", cardId: n.cards.browser }, tool(n.cards.files, "head")).target).toEqual({ kind: "refuse", why: "mixing" });
    const r = { ...n, layout: closeInstances(n.layout, [n.inst.changes]) };
    const offered = drop(r.layout, { type: "card", cardId: r.cards.browser }, tool(r.cards.files, "head"));
    expect(offered.target).toEqual({ kind: "split", cardId: r.cards.files, side: "bottom", unmixed: { kinds: ["workspace.files"] } });
    expect(kindsOn(offered.after, r.pages.work)).toEqual(["workspace.files", "browser.tab", "terminal.pty"]);
    expect(findCard(offered.after, r.cards.files)!.card.tabs).toEqual([r.inst.files]);
    // the same kind still joins: a terminal tab split out first, then back onto the terminal pane
    const split = drop(r.layout, { type: "tab", instanceId: r.inst.t2 }, tool(r.cards.files, "bottom")).after;
    const back = drop(split, { type: "tab", instanceId: r.inst.t2 }, tool(r.cards.terminal, "head"));
    expect(back.target).toEqual({ kind: "merge", cardId: r.cards.terminal });
    // mixing on (the same world): the drop joins as a tab
    const m = world();
    expect(drop(m.layout, { type: "card", cardId: m.cards.browser }, tool(m.cards.files, "head")).target).toEqual({ kind: "merge", cardId: m.cards.files });
  });
});

describe("the work area's far edges", () => {
  it("a tool at a free edge: a new Shelf there (≤ 2; refused without the width for one); at an edge with a Shelf: a new page of it", () => {
    const o = oneColumn();
    const right = shelfOnSide(o.layout, "right")!.id;
    const free = drop(o.layout, { type: "card", cardId: o.cards.files }, { at: "edge", side: "left" });
    expect(free.target).toEqual({ kind: "edge", side: "left" });
    const leftShelf = shelfOnSide(free.after, "left")!;
    expect(leftShelf.options.allowMixing).toBe(false);
    expect(pagesOfShelf(free.after, leftShelf.id).map((p) => p.cards.map((c) => c.kind))).toEqual([["workspace.files"]]);
    expect(pagesOfShelf(free.after, right).map((p) => p.cards.map((c) => c.kind))).toEqual([["workspace.changes", "terminal.pty"]]);
    const taken = drop(o.layout, { type: "card", cardId: o.cards.files }, { at: "edge", side: "right" });
    expect(taken.target).toEqual({ kind: "newPage", shelfId: right });
    expect(pagesOfShelf(taken.after, right)).toHaveLength(2);
    expect(drop(o.layout, { type: "card", cardId: o.cards.files }, { at: "edge", side: "left" }, false).target).toEqual({ kind: "refuse", why: "limit" });
    const w = world();
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, { at: "edge", side: "left" }).target).toEqual({ kind: "newPage", shelfId: shelfOfPage(w.layout, w.pages.web)!.id });
  });

  it("a tool onto a conversation pane: refused (conversation columns hold conversations only)", () => {
    const w = world();
    expect(drop(w.layout, { type: "tab", instanceId: w.inst.t1 }, conv("main", "center")).target).toEqual({ kind: "refuse", why: "tools" });
    expect(drop(w.layout, { type: "card", cardId: w.cards.files }, conv("main", "left")).target).toEqual({ kind: "refuse", why: "tools" });
  });
});

describe("a conversation pane by its header", () => {
  const work = twoConversations();
  const [left, right] = conversationPanes(work) as [string, string];
  const resolve = (hit: SideHit) => resolveDrop({ side: emptyLayout(), work, roomForColumn: true }, { type: "conversation", paneId: right }, hit);
  const agents = (l: PaneLayout) => conversationPanes(l).map((id) => paneBinding(l, id)?.sessionId);

  it("onto the other conversation: its left / right side (zone, else the pointer's half) — the two reorder", () => {
    const target = resolve(conv(left, "left"));
    expect(target).toEqual({ kind: "conversation", near: left, side: "left" });
    expect(agents(applyWorkDrop(work, { type: "conversation", paneId: right }, target!))).toEqual(["b2", "a1"]);
    expect(resolve(conv(left, "center", "left"))).toEqual({ kind: "conversation", near: left, side: "left" });
    expect(resolve(conv(left, "top", "left"))).toEqual({ kind: "conversation", near: left, side: "left" });
    // Right of the left one = where it is: nothing.
    expect(resolve(conv(left, "right"))).toBeNull();
    expect(resolve(conv(left, "head", "right"))).toBeNull();
    expect(resolve(conv(right, "left"))).toBeNull();
  });

  it("the far left edge: the first column; the far right: the last (where it is: nothing); onto a tool pane: refused", () => {
    const target = resolve({ at: "edge", side: "left" });
    expect(target).toEqual({ kind: "edge", side: "left" });
    expect(agents(applyWorkDrop(work, { type: "conversation", paneId: right }, target!))).toEqual(["b2", "a1"]);
    expect(resolve({ at: "edge", side: "right" })).toBeNull();
    const w = world();
    expect(resolveDrop({ side: w.layout, work, roomForColumn: true }, { type: "conversation", paneId: right }, tool(w.cards.files, "center"))).toEqual({ kind: "refuse", why: "conversation" });
    // A conversation drop never changes the tool area (and a tool drop never the work area).
    expect(applyToolDrop(w.layout, { type: "conversation", paneId: right }, { kind: "edge", side: "left" }, 1, orderOf)).toBe(w.layout);
    expect(applyWorkDrop(work, { type: "card", cardId: w.cards.files }, { kind: "edge", side: "right" })).toBe(work);
  });
});

describe("external handle (the left gutter's reference card)", () => {
  it("a tool pane / page button = pinned into that page; the work area / an edge = a new page; origin = nothing", () => {
    const w = world();
    const o = oneColumn();
    const ext: SideDrag = { type: "external", source: "peek" };
    expect(resolveDrop(worldOf(w.layout), ext, tool(w.cards.files, "top"))).toEqual({ kind: "pin", pageId: w.pages.work });
    expect(resolveDrop(worldOf(o.layout), ext, conv("main", "center"))).toEqual({ kind: "new" });
    expect(resolveDrop(worldOf(o.layout), ext, { at: "edge", side: "right" })).toEqual({ kind: "new" });
    expect(resolveDrop(worldOf(w.layout), ext, { at: "edge", side: "right" })).toEqual({ kind: "new" });
    expect(resolveDrop(worldOf(w.layout), ext, { at: "page", pageId: w.pages.web })).toEqual({ kind: "pin", pageId: w.pages.web });
    expect(resolveDrop(worldOf(w.layout), ext, { at: "origin" })).toEqual({ kind: "noop", why: "origin" });
    expect(resolveDrop(worldOf(w.layout), ext, { at: "outside" })).toBeNull();
    expect(applyToolDrop(w.layout, ext, { kind: "pin", pageId: w.pages.work }, 1, orderOf)).toBe(w.layout);
  });
});

describe("drop reducers", () => {
  it("reorderCard / reorderPage return the same layout when nothing changes", () => {
    const w = world();
    expect(reorderCard(w.layout, w.cards.files, w.cards.changes)).toBe(w.layout);
    expect(reorderCard(w.layout, w.cards.terminal, null)).toBe(w.layout);
    expect(reorderCard(w.layout, w.cards.files, w.cards.browser)).toBe(w.layout); // another page's card
    expect(reorderPage(w.layout, w.pages.web, w.pages.web, true)).toBe(w.layout);
    // §24.12: pages of different Shelves never swap; in one Shelf's rail they do
    expect(reorderPage(w.layout, w.pages.work, w.pages.web, true)).toBe(w.layout);
    const right = shelfOfPage(w.layout, w.pages.work)!.id;
    const more = addShelfPage(w.layout, right);
    expect(reorderPage(more.layout, w.pages.work, more.pageId!, false)).toBe(more.layout);
    expect(pagesOfShelf(reorderPage(more.layout, w.pages.work, more.pageId!, true), right).map((p) => p.id)).toEqual([more.pageId, w.pages.work]);
  });

  it("moveCardTo: own page = reorder, another page = at that spot, newPage = moveCard", () => {
    const w = world();
    expect(kindsOn(moveCardTo(w.layout, w.cards.terminal, { page: w.pages.work, before: w.cards.changes }, ++clock, orderOf), w.pages.work)).toEqual(["workspace.files", "terminal.pty", "workspace.changes"]);
    const r = roomy();
    const moved = moveCardTo(r.layout, r.cards.browser, { page: r.pages.work, before: r.cards.files }, ++clock, orderOf);
    expect(kindsOn(moved, r.pages.work)[0]).toBe("browser.tab");
    expect(moved.overrides["browser.tab"]?.page).toBe(r.pages.work);
    expect(moveCardTo(w.layout, w.cards.browser, { newPage: true }, ++clock, orderOf)).toBe(w.layout);
  });

  it("splitInstanceTo / moveInstance options", () => {
    const r = roomy();
    const split = splitInstanceTo(r.layout, r.inst.t1, r.pages.web, null, ++clock, orderOf);
    expect(kindsOn(split, r.pages.web)).toEqual(["browser.tab", "terminal.pty"]);
    expect(split.overrides["terminal.pty"]?.page).toBe(r.pages.web);
    const w = world();
    // Into another kind's card: refused.
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf, { card: w.cards.files })).toBe(w.layout);
    // Its own card / same page without options: nothing.
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf, { card: w.cards.terminal })).toBe(w.layout);
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf)).toBe(w.layout);
    // newCard on the same page: a second card of the kind, no override (room: the roomy world).
    const two = moveInstance(r.layout, r.inst.t1, { page: r.pages.work }, ++clock, orderOf, { newCard: true, before: r.cards.files });
    expect(kindsOn(two, r.pages.work)).toEqual(["terminal.pty", "workspace.files", "terminal.pty"]);
    expect(two.overrides["terminal.pty"]).toBeUndefined();
  });

  it("merging into a launcher page makes it a normal page", () => {
    const w = oneColumn();
    const made = openLauncherPage(w.layout);
    const merged = mergePages(made.layout, w.pages.work, made.pageId!);
    const page = merged.pages.find((p) => p.id === made.pageId)!;
    expect(page.launcher).toBeUndefined();
    expect(page.cards.map((c) => c.kind)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
  });
});
