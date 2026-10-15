// Drag and drop on the right side, the pure part (lib/sideDrop.ts + the drop reducers in
// lib/sideLayout.ts; RFC right-panel-rfc-20261009 §3.4, §3.7): every row of the §3.7 table as
// resolveDrop (what the pointer is over → target) + applyDrop (target → layout).
import { describe, expect, it } from "vitest";
import type { SideBinding, SidePlacement } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { aloneOnPage, applyDrop, pillInsertion, pillPageOp, resolveDrop, type SideDrag, type SideHit, type SideDropTarget } from "../src/renderer/src/lib/sideDrop";
import {
  applyOpen,
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
  const decision = place(layout, { kind, binding, key, transient: false, page: o.page, activePage: layout.activePage, columnOpen: layout.open }, SPECS[kind]!, orderOf);
  const applied = applyOpen(layout, decision, { kind, binding, key, state: null, v: 1, pinned: false }, ++clock, { reveal: true, home: SPECS[kind]!.home });
  return { layout: applied.layout, id: applied.instanceId };
}

/**
 * Three pages: 工作区 [files, changes, jobs, terminal(t1, t2)], 浏览器 [browser], 侧聊 [chat];
 * the workspace page is in view.
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
  const jobs = open(l, "status:jobs.tasks");
  l = jobs.layout;
  const browser = open(l, "browser.tab", { key: "b1" });
  l = browser.layout;
  const chat = open(l, "side-chat.chat", { key: "c1" });
  l = chat.layout;
  const [work, web, side] = l.pages.map((p) => p.id) as [string, string, string];
  l = { ...l, activePage: work };
  const card = (id: string) => locate(l, id)!.card.id;
  return {
    layout: l,
    pages: { work, web, side },
    inst: { files: files.id, changes: changes.id, t1: t1.id, t2: t2.id, jobs: jobs.id, browser: browser.id, chat: chat.id },
    cards: { files: card(files.id), changes: card(changes.id), terminal: card(t1.id), jobs: card(jobs.id), browser: card(browser.id), chat: card(chat.id) },
  };
}

const kindsOn = (layout: SideLayout, pageId: string) => layout.pages.find((p) => p.id === pageId)!.cards.map((c) => c.kind);
const cardIds = (layout: SideLayout, pageId: string) => layout.pages.find((p) => p.id === pageId)!.cards.map((c) => c.id);

/** A pill hit starting at 0, 24 px per icon from 4 (the DOM probe's shape); the lane's (y) unless `axis`. */
function pill(layout: SideLayout, pageId: string, axis: "x" | "y" = "y"): Extract<SideHit, { at: "pill" }> {
  const cards = cardIds(layout, pageId);
  return { at: "pill", pageId, axis, start: 0, size: 8 + 24 * cards.length, icons: cards.map((cardId, k) => ({ cardId, start: 4 + 24 * k, end: 28 + 24 * k })) };
}
const head = (cardId: string): SideHit => ({ at: "head", cardId, top: 100, height: 36 });
const ARMED = { edgeArmed: true, outside: true };

function drop(layout: SideLayout, drag: SideDrag, hit: SideHit, y = 0, opts = ARMED): { target: SideDropTarget | null; after: SideLayout } {
  const target = resolveDrop(layout, drag, hit, y, opts);
  return { target, after: target ? applyDrop(layout, drag, target, ++clock, orderOf) : layout };
}

describe("card → another page's pill", () => {
  it("inserts the card at the insertion line; the kind's override follows", () => {
    const w = world();
    const p = pill(w.layout, w.pages.web);
    const { target, after } = drop(w.layout, { type: "card", cardId: w.cards.files }, p, 10);
    expect(target).toMatchObject({ kind: "pill", pageId: w.pages.web, op: "insert", before: w.cards.browser, own: false });
    expect(kindsOn(after, w.pages.web)).toEqual(["workspace.files", "browser.tab"]);
    expect(after.overrides["workspace.files"]?.page).toBe(w.pages.web);
    expect(after.activePage).toBe(w.pages.web);
    // Below the last icon → the bottom.
    const low = drop(w.layout, { type: "card", cardId: w.cards.files }, p, 30);
    expect(low.target).toMatchObject({ op: "insert", before: null });
    expect(kindsOn(low.after, w.pages.web)).toEqual(["browser.tab", "workspace.files"]);
  });

  it("joins a same-kind card there (tabs merged)", () => {
    const w = world();
    const moved = moveInstance(w.layout, w.inst.t2, { page: w.pages.web }, ++clock, orderOf);
    const there = locate(moved, w.inst.t2)!.card.id;
    const { target, after } = drop(moved, { type: "card", cardId: w.cards.terminal }, pill(moved, w.pages.web), 10);
    expect(target).toEqual({ kind: "pill", pageId: w.pages.web, op: "join", cardId: there });
    expect(locate(after, w.inst.t1)!.card.id).toBe(there);
    expect(findCard(after, there)!.card.tabs).toEqual([w.inst.t2, w.inst.t1]);
  });
});

describe("card → its own pill", () => {
  it("reorders the page (no override)", () => {
    const w = world();
    const { target, after } = drop(w.layout, { type: "card", cardId: w.cards.terminal }, pill(w.layout, w.pages.work), 5);
    expect(target).toMatchObject({ kind: "pill", op: "insert", before: w.cards.files, own: true });
    expect(kindsOn(after, w.pages.work)).toEqual(["terminal.pty", "workspace.files", "workspace.changes", "status:jobs.tasks"]);
    expect(after.overrides).toEqual(w.layout.overrides);
  });

  it("its own spot is no target", () => {
    const w = world();
    const p = pill(w.layout, w.pages.work);
    // Upper half of its own icon, or the lower half of the icon above it: before itself / after the previous one.
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.changes }, p, 30, ARMED)).toBeNull();
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.changes }, p, 50, ARMED)).toBeNull();
  });
});

describe("card / tab → a new page", () => {
  for (const at of ["lane", "tail", "edge", "outside"] as const) {
    it(`card via ${at}: a page of its own (group user:<page>)`, () => {
      const w = world();
      const { target, after } = drop(w.layout, { type: "card", cardId: w.cards.changes }, { at }, 0);
      expect(target).toEqual({ kind: "new", via: at, unchanged: false });
      expect(after.pages).toHaveLength(4);
      const page = locate(after, w.inst.changes)!.page;
      expect(page.groups).toEqual([`${USER_GROUP}${page.id}`]);
      expect(page.cards.map((c) => c.kind)).toEqual(["workspace.changes"]);
      expect(after.overrides["workspace.changes"]?.page).toBe(page.id);
    });
  }

  it("a tab via the lane / outside: only that instance moves", () => {
    const w = world();
    for (const at of ["lane", "outside"] as const) {
      const { target, after } = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, { at });
      expect(target).toEqual({ kind: "new", via: at, unchanged: false });
      expect(locate(after, w.inst.t2)!.page.cards.map((c) => c.tabs)).toEqual([[w.inst.t2]]);
      expect(locate(after, w.inst.t1)!.page.id).toBe(w.pages.work);
    }
  });

  it("a single-card page stays as it is (D67 ★), shown as unchanged", () => {
    const w = world();
    const drag: SideDrag = { type: "card", cardId: w.cards.browser };
    expect(aloneOnPage(w.layout, drag)).toBe(true);
    for (const at of ["lane", "edge", "outside"] as const) {
      const { target, after } = drop(w.layout, drag, { at });
      expect(target).toEqual({ kind: "new", via: at, unchanged: true });
      expect(after).toBe(w.layout);
    }
    expect(drop(w.layout, { type: "tab", instanceId: w.inst.chat }, { at: "lane" }).target).toMatchObject({ unchanged: true });
  });

  it("the left-edge band counts only once armed (the card icon starts inside it)", () => {
    const w = world();
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, { at: "edge" }, 0, { edgeArmed: false, outside: true })).toBeNull();
  });

  it("no drop outside while maximised / full screen", () => {
    const w = world();
    const opts = { edgeArmed: true, outside: false };
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, { at: "outside" }, 0, opts)).toBeNull();
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, { at: "composer" }, 0, opts)).toBeNull();
  });
});

describe("card / tab → the composer, nothing", () => {
  it("is accepted and does nothing (later: quote into the message)", () => {
    const w = world();
    for (const drag of [{ type: "card", cardId: w.cards.files }, { type: "tab", instanceId: w.inst.t1 }] as SideDrag[]) {
      const { target, after } = drop(w.layout, drag, { at: "composer" });
      expect(target).toEqual({ kind: "noop", why: "composer" });
      expect(after).toBe(w.layout);
    }
  });
});

describe("card → another card's header", () => {
  it("same page: above / below by the half (no override)", () => {
    const w = world();
    const drag: SideDrag = { type: "card", cardId: w.cards.terminal };
    const above = drop(w.layout, drag, head(w.cards.changes), 105);
    expect(above.target).toEqual({ kind: "head", cardId: w.cards.changes, op: "above" });
    expect(kindsOn(above.after, w.pages.work)).toEqual(["workspace.files", "terminal.pty", "workspace.changes", "status:jobs.tasks"]);
    const below = drop(w.layout, drag, head(w.cards.files), 130);
    expect(below.target).toEqual({ kind: "head", cardId: w.cards.files, op: "below" });
    expect(kindsOn(below.after, w.pages.work)).toEqual(["workspace.files", "terminal.pty", "workspace.changes", "status:jobs.tasks"]);
    expect(below.after.overrides).toEqual(w.layout.overrides);
  });

  it("a spot that changes nothing / its own header is no target", () => {
    const w = world();
    const drag: SideDrag = { type: "card", cardId: w.cards.files };
    expect(resolveDrop(w.layout, drag, head(w.cards.changes), 105, ARMED)).toBeNull(); // above changes = where it is
    expect(resolveDrop(w.layout, drag, head(w.cards.files), 105, ARMED)).toBeNull();
  });

  it("another page: moved there at that spot, override remembered", () => {
    const w = world();
    const { target, after } = drop(w.layout, { type: "card", cardId: w.cards.files }, head(w.cards.browser), 130);
    expect(target).toEqual({ kind: "head", cardId: w.cards.browser, op: "below" });
    expect(kindsOn(after, w.pages.web)).toEqual(["browser.tab", "workspace.files"]);
    expect(after.overrides["workspace.files"]?.page).toBe(w.pages.web);
  });
});

describe("page grip → another pill", () => {
  it("middle = merge (cards appended, overrides re-pointed)", () => {
    const w = world();
    const moved = moveInstance(w.layout, w.inst.changes, { page: w.pages.side }, ++clock, orderOf); // override → side page
    const p = pill(moved, w.pages.web);
    const { target, after } = drop(moved, { type: "page", pageId: w.pages.side }, p, p.size / 2);
    expect(target).toEqual({ kind: "pill", pageId: w.pages.web, op: "merge" });
    expect(after.pages.map((x) => x.id)).toEqual([w.pages.work, w.pages.web]);
    expect(kindsOn(after, w.pages.web)).toEqual(["browser.tab", "workspace.changes", "side-chat.chat"]);
    expect(after.overrides["workspace.changes"]?.page).toBe(w.pages.web);
  });

  it("top / bottom edge = reorder; a reorder that changes nothing is no target", () => {
    const w = world();
    const p = pill(w.layout, w.pages.work);
    const before = drop(w.layout, { type: "page", pageId: w.pages.side }, p, 1);
    expect(before.target).toEqual({ kind: "pill", pageId: w.pages.work, op: "before" });
    expect(before.after.pages.map((x) => x.id)).toEqual([w.pages.side, w.pages.work, w.pages.web]);
    expect(before.after.overrides).toEqual(w.layout.overrides);
    // side is already right after web: its bottom edge changes nothing; its top edge does.
    const q = pill(w.layout, w.pages.web);
    expect(resolveDrop(w.layout, { type: "page", pageId: w.pages.side }, q, q.size - 1, ARMED)).toBeNull();
    expect(drop(w.layout, { type: "page", pageId: w.pages.side }, q, 1).after.pages.map((x) => x.id)).toEqual([w.pages.work, w.pages.side, w.pages.web]);
  });

  it("no new-page targets, no own pill, nothing outside", () => {
    const w = world();
    const drag: SideDrag = { type: "page", pageId: w.pages.web };
    for (const hit of [{ at: "lane" }, { at: "tail" }, { at: "edge" }, { at: "outside" }, { at: "composer" }, head(w.cards.files), { at: "gap", pageId: w.pages.work, before: null }] as SideHit[]) {
      expect(resolveDrop(w.layout, drag, hit, 0, ARMED)).toBeNull();
    }
    expect(resolveDrop(w.layout, drag, pill(w.layout, w.pages.web), 10, ARMED)).toBeNull();
  });
});

describe("tab → a pill", () => {
  it("a page without that kind: a new card at the insertion line; override follows", () => {
    const w = world();
    const { target, after } = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, pill(w.layout, w.pages.web), 5);
    expect(target).toMatchObject({ kind: "pill", op: "insert", before: w.cards.browser });
    expect(kindsOn(after, w.pages.web)).toEqual(["terminal.pty", "browser.tab"]);
    expect(findCard(after, w.cards.terminal)!.card.tabs).toEqual([w.inst.t1]);
    expect(after.overrides["terminal.pty"]?.page).toBe(w.pages.web);
  });

  it("a page with that kind: joins that card", () => {
    const w = world();
    const moved = moveInstance(w.layout, w.inst.t2, { page: w.pages.web }, ++clock, orderOf);
    const there = locate(moved, w.inst.t2)!.card.id;
    const { target, after } = drop(moved, { type: "tab", instanceId: w.inst.t1 }, pill(moved, w.pages.web), 5);
    expect(target).toEqual({ kind: "pill", pageId: w.pages.web, op: "join", cardId: there });
    expect(findCard(after, there)!.card.tabs).toEqual([w.inst.t2, w.inst.t1]);
    expect(findCard(after, w.cards.terminal)).toBeNull();
  });

  it("its own pill with no other card of its kind: no target", () => {
    const w = world();
    expect(resolveDrop(w.layout, { type: "tab", instanceId: w.inst.t2 }, pill(w.layout, w.pages.work), 5, ARMED)).toBeNull();
  });
});

describe("tab → a card header / tab row", () => {
  it("same kind: moves into that card (cross page remembers)", () => {
    const w = world();
    const moved = moveInstance(w.layout, w.inst.t2, { newPage: true }, ++clock, orderOf);
    const other = locate(moved, w.inst.t2)!.card.id;
    const { target, after } = drop(moved, { type: "tab", instanceId: w.inst.t1 }, head(other), 110);
    expect(target).toEqual({ kind: "head", cardId: other, op: "join" });
    expect(findCard(after, other)!.card.tabs).toEqual([w.inst.t2, w.inst.t1]);
    expect(after.overrides["terminal.pty"]?.page).toBe(locate(after, w.inst.t1)!.page.id);
  });

  it("another kind: refused (one kind per tab bar); its own card: nothing", () => {
    const w = world();
    const refuse = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, head(w.cards.files), 110);
    expect(refuse.target).toEqual({ kind: "refuse" });
    expect(refuse.after).toBe(w.layout);
    expect(resolveDrop(w.layout, { type: "tab", instanceId: w.inst.t2 }, head(w.cards.terminal), 110, ARMED)).toBeNull();
  });
});

describe("tab → the gap between two cards", () => {
  it("same page: split into a new card of its kind there (no override)", () => {
    const w = world();
    const gap: SideHit = { at: "gap", pageId: w.pages.work, before: w.cards.changes };
    const { target, after } = drop(w.layout, { type: "tab", instanceId: w.inst.t2 }, gap);
    expect(target).toEqual({ kind: "gap", pageId: w.pages.work, before: w.cards.changes });
    expect(kindsOn(after, w.pages.work)).toEqual(["workspace.files", "terminal.pty", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(locate(after, w.inst.t2)!.card.tabs).toEqual([w.inst.t2]);
    expect(findCard(after, w.cards.terminal)!.card.tabs).toEqual([w.inst.t1]);
    expect(after.overrides).toEqual(w.layout.overrides);
  });

  it("a single-tab card next to its own spot: no target; elsewhere it moves as a card", () => {
    const w = world();
    const drag: SideDrag = { type: "tab", instanceId: w.inst.changes };
    expect(resolveDrop(w.layout, drag, { at: "gap", pageId: w.pages.work, before: w.cards.changes }, 0, ARMED)).toBeNull();
    expect(resolveDrop(w.layout, drag, { at: "gap", pageId: w.pages.work, before: w.cards.jobs }, 0, ARMED)).toBeNull();
    const { after } = drop(w.layout, drag, { at: "gap", pageId: w.pages.work, before: null });
    expect(kindsOn(after, w.pages.work)).toEqual(["workspace.files", "status:jobs.tasks", "terminal.pty", "workspace.changes"]);
    expect(locate(after, w.inst.changes)!.card.id).toBe(w.cards.changes);
  });

  it("a card dropped into a gap: reorder (same page) or a move at that spot", () => {
    const w = world();
    const same = drop(w.layout, { type: "card", cardId: w.cards.jobs }, { at: "gap", pageId: w.pages.work, before: w.cards.files });
    expect(kindsOn(same.after, w.pages.work)).toEqual(["status:jobs.tasks", "workspace.files", "workspace.changes", "terminal.pty"]);
    const cross = drop(w.layout, { type: "card", cardId: w.cards.browser }, { at: "gap", pageId: w.pages.work, before: w.cards.changes });
    expect(kindsOn(cross.after, w.pages.work)).toEqual(["workspace.files", "browser.tab", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(cross.after.pages).toHaveLength(2); // the browser page emptied
  });
});

describe("external handle (the left gutter's reference card)", () => {
  it("pill = pin into that page; column / header / gap = the page in view; origin = nothing; layout unchanged", () => {
    const w = world();
    const drag: SideDrag = { type: "external" };
    expect(resolveDrop(w.layout, drag, pill(w.layout, w.pages.web), 10, ARMED)).toEqual({ kind: "pill", pageId: w.pages.web, op: "pin" });
    expect(resolveDrop(w.layout, drag, { at: "column", pageId: w.pages.work }, 0, ARMED)).toEqual({ kind: "column", pageId: w.pages.work });
    expect(resolveDrop(w.layout, drag, head(w.cards.files), 110, ARMED)).toEqual({ kind: "column", pageId: w.pages.work });
    expect(resolveDrop(w.layout, drag, { at: "gap", pageId: w.pages.work, before: null }, 0, ARMED)).toEqual({ kind: "column", pageId: w.pages.work });
    expect(resolveDrop(w.layout, drag, { at: "origin" }, 0, ARMED)).toEqual({ kind: "noop", why: "origin" });
    expect(resolveDrop(w.layout, drag, { at: "lane" }, 0, ARMED)).toEqual({ kind: "new", via: "lane", unchanged: false });
    expect(resolveDrop(w.layout, drag, { at: "outside" }, 0, ARMED)).toEqual({ kind: "new", via: "outside", unchanged: false });
    for (const t of [{ kind: "pill", pageId: w.pages.web, op: "pin" }, { kind: "new", via: "outside", unchanged: false }] as SideDropTarget[]) {
      expect(applyDrop(w.layout, drag, t, ++clock, orderOf)).toBe(w.layout);
    }
    // Inside a card / tab drag, "origin" means nothing (only external handles have one).
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, { at: "origin" }, 0, ARMED)).toBeNull();
    // A column hit without a card / gap under the pointer takes only external drags.
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, { at: "column", pageId: w.pages.work }, 0, ARMED)).toBeNull();
  });
});

describe("drop reducers", () => {
  it("pillInsertion: between icon midpoints; empty pill = its middle", () => {
    const hit = { start: 0, size: 56, icons: [{ cardId: "a", start: 4, end: 28 }, { cardId: "b", start: 28, end: 52 }] };
    expect(pillInsertion(hit, 0)).toEqual({ before: "a", line: 3.5 });
    expect(pillInsertion(hit, 20)).toEqual({ before: "b", line: 27.5 });
    expect(pillInsertion(hit, 50)).toEqual({ before: null, line: 52.5 });
    expect(pillInsertion({ start: 10, size: 30, icons: [] }, 0)).toEqual({ before: null, line: 25 });
  });

  it("pillInsertion in the tab row: the same rule along x (the line between two icons)", () => {
    // Icons left → right at x 612…636 and 636…660 in a pill starting at 600 (grip on its left).
    const hit = { start: 600, size: 68, icons: [{ cardId: "a", start: 612, end: 636 }, { cardId: "b", start: 636, end: 660 }] };
    expect(pillInsertion(hit, 605)).toEqual({ before: "a", line: 611.5 });
    expect(pillInsertion(hit, 640)).toEqual({ before: "b", line: 635.5 });
    expect(pillInsertion(hit, 655)).toEqual({ before: null, line: 660.5 });
  });

  it("pillPageOp: leading / trailing 28 % reorder, the middle merges (either axis)", () => {
    const hit = { start: 100, size: 100 };
    expect(pillPageOp(hit, 110)).toBe("before");
    expect(pillPageOp(hit, 150)).toBe("merge");
    expect(pillPageOp(hit, 190)).toBe("after");
    expect(pillPageOp({ start: 0, size: 0 }, 5)).toBe("merge");
  });

  it("reorderCard / reorderPage return the same layout when nothing changes", () => {
    const w = world();
    expect(reorderCard(w.layout, w.cards.files, w.cards.changes)).toBe(w.layout);
    expect(reorderCard(w.layout, w.cards.terminal, null)).toBe(w.layout);
    expect(reorderCard(w.layout, w.cards.files, w.cards.browser)).toBe(w.layout); // another page's card
    expect(reorderPage(w.layout, w.pages.work, w.pages.web, false)).toBe(w.layout);
    expect(reorderPage(w.layout, w.pages.side, w.pages.side, true)).toBe(w.layout);
    expect(reorderPage(w.layout, w.pages.work, w.pages.side, true).pages.map((p) => p.id)).toEqual([w.pages.web, w.pages.side, w.pages.work]);
  });

  it("moveCardTo: own page = reorder, another page = at that spot, newPage = moveCard", () => {
    const w = world();
    expect(kindsOn(moveCardTo(w.layout, w.cards.terminal, { page: w.pages.work, before: w.cards.changes }, ++clock, orderOf), w.pages.work)).toEqual([
      "workspace.files",
      "terminal.pty",
      "workspace.changes",
      "status:jobs.tasks",
    ]);
    const moved = moveCardTo(w.layout, w.cards.chat, { page: w.pages.work, before: w.cards.files }, ++clock, orderOf);
    expect(kindsOn(moved, w.pages.work)[0]).toBe("side-chat.chat");
    expect(moved.overrides["side-chat.chat"]?.page).toBe(w.pages.work);
    expect(moveCardTo(w.layout, w.cards.chat, { newPage: true }, ++clock, orderOf)).toBe(w.layout);
  });

  it("splitInstanceTo / moveInstance options", () => {
    const w = world();
    const split = splitInstanceTo(w.layout, w.inst.t1, w.pages.web, null, ++clock, orderOf);
    expect(kindsOn(split, w.pages.web)).toEqual(["browser.tab", "terminal.pty"]);
    expect(split.overrides["terminal.pty"]?.page).toBe(w.pages.web);
    // Into another kind's card: refused.
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf, { card: w.cards.files })).toBe(w.layout);
    // Its own card / same page without options: nothing.
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf, { card: w.cards.terminal })).toBe(w.layout);
    expect(moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf)).toBe(w.layout);
    // newCard on the same page: a second card of the kind, no override.
    const two = moveInstance(w.layout, w.inst.t1, { page: w.pages.work }, ++clock, orderOf, { newCard: true, before: w.cards.files });
    expect(kindsOn(two, w.pages.work)).toEqual(["terminal.pty", "workspace.files", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(two.overrides["terminal.pty"]).toBeUndefined();
  });

  it("merging into a launcher page makes it a normal page", () => {
    const w = world();
    const made = openLauncherPage(w.layout);
    const merged = mergePages(made.layout, w.pages.side, made.pageId!);
    const page = merged.pages.find((p) => p.id === made.pageId)!;
    expect(page.launcher).toBeUndefined();
    expect(page.cards.map((c) => c.kind)).toEqual(["side-chat.chat"]);
  });
});

describe("the tab row (horizontal pills: the pointer's x)", () => {
  it("card → another page's tab: insertion read along x, same reducers", () => {
    const w = world();
    const p = pill(w.layout, w.pages.web, "x");
    expect(resolveDrop(w.layout, { type: "card", cardId: w.cards.files }, p, 10, ARMED)).toMatchObject({ op: "insert", before: w.cards.browser, line: 3.5 });
    const right = drop(w.layout, { type: "card", cardId: w.cards.files }, p, 30);
    expect(right.target).toMatchObject({ op: "insert", before: null, line: 28.5 });
    expect(kindsOn(right.after, w.pages.web)).toEqual(["browser.tab", "workspace.files"]);
  });

  it("page grip → a tab: left / right edge reorder, middle merges", () => {
    const w = world();
    const p = pill(w.layout, w.pages.work, "x");
    expect(resolveDrop(w.layout, { type: "page", pageId: w.pages.side }, p, 1, ARMED)).toEqual({ kind: "pill", pageId: w.pages.work, op: "before" });
    expect(resolveDrop(w.layout, { type: "page", pageId: w.pages.side }, p, p.size / 2, ARMED)).toEqual({ kind: "pill", pageId: w.pages.work, op: "merge" });
    expect(resolveDrop(w.layout, { type: "page", pageId: w.pages.side }, p, p.size - 1, ARMED)).toEqual({ kind: "pill", pageId: w.pages.work, op: "after" });
  });
});
