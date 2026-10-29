// Shelf page groups (docs/design/038-shelf-page-groups.md, owner 2026-10-23): a page's panes merge into another page
// (≤ 3), split out to a page of their own (≤ 9 pages), the drop targets of a dragged page / pane on a capsule
// (middle = merge, top / bottom quarter = reorder) and on the 「新页」 slot. Pure (lib/sideLayout, lib/sideDrop).
import { describe, expect, it } from "vitest";
import type { ItemId } from "../src/renderer/src/modules/types";
import { canMergePage, findCard, findPage, MAX_SHELF_PAGES, mergePageInto, pagesOfShelf, shelvesOf, splitCardOut, withShelves, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { applyToolDrop, resolveDrop, type DropWorld } from "../src/renderer/src/lib/sideDrop";
import { conversationPanes, defaultLayout, focusedConversation, openEmptyBeside, paneBinding } from "../src/renderer/src/lib/paneLayout";

/** One right Shelf; each page = the kinds of its panes (one tab each). The first page shows. */
function shelf(pages: string[][]): SideLayout {
  let seq = 0;
  const l: SideLayout = { open: true, activePage: null, pages: [], instances: {}, overrides: {}, seq: 0, shelves: [] };
  const sid = `s${++seq}`;
  for (const kinds of pages) {
    const pid = `p${++seq}`;
    const cards = kinds.map((kind) => {
      const iid = `i${++seq}`;
      l.instances[iid] = { kind: kind as ItemId, binding: { kind: "host", hostId: "local" }, key: iid, state: null, v: 1, pinned: false, lastActiveAt: seq };
      return { id: `c${++seq}`, kind: kind as ItemId, tabs: [iid], active: iid, size: 1 / kinds.length, collapsed: false };
    });
    l.pages.push({ id: pid, groups: [kinds[0]!], cards, shelf: sid });
  }
  l.shelves = [{ id: sid, side: "right", active: l.pages[0]!.id, options: { allowMixing: false, railPlacement: "outer" } }];
  l.activePage = l.pages[0]!.id;
  l.seq = seq;
  return withShelves(l);
}

const kindsOf = (l: SideLayout) => l.pages.map((p) => p.cards.map((c) => c.kind as string));
const world = (side: SideLayout): DropWorld => ({ side, work: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" }), roomForColumn: true });
const orderOf = () => 500;

describe("merge a page into another (design 038)", () => {
  it("the target gains the panes below its own, shows, and the dragged page goes", () => {
    const l = shelf([["files"], ["preview"], ["term"]]);
    const [files, preview] = l.pages;
    const merged = mergePageInto(l, preview!.id, files!.id);
    expect(kindsOf(merged)).toEqual([["files", "preview"], ["term"]]);
    expect(findPage(merged, preview!.id)).toBeNull();
    expect(shelvesOf(merged)[0]!.active).toBe(files!.id);
    expect(merged.activePage).toBe(files!.id);
    expect(merged.pages[0]!.cards.reduce((a, c) => a + c.size, 0)).toBeCloseTo(1);
  });

  it("more than 3 panes together, the page itself or an unknown page: unchanged", () => {
    const l = shelf([["files", "preview"], ["term", "proj"], ["deleg"]]);
    expect(canMergePage(l, l.pages[1]!.id, l.pages[0]!.id)).toBe(false);
    expect(mergePageInto(l, l.pages[1]!.id, l.pages[0]!.id)).toBe(l);
    expect(mergePageInto(l, l.pages[0]!.id, l.pages[0]!.id)).toBe(l);
    expect(mergePageInto(l, "nope", l.pages[0]!.id)).toBe(l);
    expect(kindsOf(mergePageInto(l, l.pages[2]!.id, l.pages[0]!.id))).toEqual([["files", "preview", "deleg"], ["term", "proj"]]);
  });
});

describe("split a pane out (design 038)", () => {
  it("a pane of a page with several becomes a page of its own right after it, in view", () => {
    const l = shelf([["files", "preview"], ["term"]]);
    const card = l.pages[0]!.cards[1]!.id;
    const split = splitCardOut(l, card, 1);
    expect(kindsOf(split)).toEqual([["files"], ["preview"], ["term"]]);
    const page = findCard(split, card)!.page;
    expect(page.kept).toBe(true);
    expect(shelvesOf(split)[0]!.active).toBe(page.id);
    expect(page.cards[0]!.size).toBe(1);
  });

  it(`a page's only pane, or a Shelf with ${MAX_SHELF_PAGES} pages: unchanged`, () => {
    const one = shelf([["files"], ["term"]]);
    expect(splitCardOut(one, one.pages[0]!.cards[0]!.id, 1)).toBe(one);
    const full = shelf([["files", "preview"], ...Array.from({ length: MAX_SHELF_PAGES - 1 }, (_, k) => [`k${k}`])]);
    expect(pagesOfShelf(full, shelvesOf(full)[0]!.id)).toHaveLength(MAX_SHELF_PAGES);
    expect(splitCardOut(full, full.pages[0]!.cards[1]!.id, 1)).toBe(full);
  });
});

describe("drops on a capsule / the 新页 slot (design 038)", () => {
  it("a dragged page: the middle of another page = merge; its top / bottom quarter = before / after; too many panes = refused", () => {
    const l = shelf([["files"], ["preview"], ["term", "proj", "deleg"]]);
    const [files, preview, full] = l.pages;
    const drag = { type: "page" as const, pageId: preview!.id };
    expect(resolveDrop(world(l), drag, { at: "page", pageId: files!.id, half: "top", zone: "middle" })).toEqual({ kind: "mergePage", pageId: preview!.id, into: files!.id });
    expect(resolveDrop(world(l), drag, { at: "page", pageId: files!.id, half: "top", zone: "top" })).toMatchObject({ kind: "movePage", before: files!.id });
    expect(resolveDrop(world(l), drag, { at: "page", pageId: full!.id, half: "bottom", zone: "bottom" })).toMatchObject({ kind: "movePage", before: null });
    expect(resolveDrop(world(l), drag, { at: "page", pageId: full!.id, half: "top", zone: "middle" })).toEqual({ kind: "refuse", why: "pageFull" });
    // its own capsule: nothing
    expect(resolveDrop(world(l), drag, { at: "page", pageId: preview!.id, zone: "middle" })).toEqual({ kind: "noop", why: "origin" });
    // without a zone (an older probe): reorder as before
    expect(resolveDrop(world(l), drag, { at: "page", pageId: files!.id, half: "top" })).toMatchObject({ kind: "movePage" });
  });

  it("a pane icon dragged onto another capsule joins that page; onto the 新页 slot it becomes a page of its own", () => {
    const l = shelf([["files", "preview"], ["term"]]);
    const preview = l.pages[0]!.cards[1]!;
    const drag = { type: "card" as const, cardId: preview.id };
    const into = resolveDrop(world(l), drag, { at: "page", pageId: l.pages[1]!.id, zone: "middle" });
    expect(into).toEqual({ kind: "page", pageId: l.pages[1]!.id });
    expect(kindsOf(applyToolDrop(l, drag, into!, 1, orderOf))).toEqual([["files"], ["term", "preview"]]);
    const own = resolveDrop(world(l), drag, { at: "newPage", shelfId: shelvesOf(l)[0]!.id });
    expect(own).toEqual({ kind: "newPage", shelfId: shelvesOf(l)[0]!.id });
    expect(kindsOf(applyToolDrop(l, drag, own!, 1, orderOf))).toEqual([["files"], ["term"], ["preview"]]);
    // a full page refuses it
    const full = shelf([["files", "preview"], ["term", "proj", "deleg"]]);
    expect(resolveDrop(world(full), { type: "card", cardId: full.pages[0]!.cards[1]!.id }, { at: "page", pageId: full.pages[1]!.id, zone: "middle" })).toEqual({ kind: "refuse", why: "pageFull" });
  });
});

describe("新建{{agent}} with Ctrl/⌘: an empty column beside (design 038)", () => {
  it("a new focused column without an agent right of the focused one; none at two columns or without room", () => {
    const one = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
    const two = openEmptyBeside(one, "local", 1);
    expect(conversationPanes(two)).toHaveLength(2);
    const fresh = focusedConversation(two)!;
    expect(paneBinding(two, fresh)).toEqual({ hostId: "local", sessionId: null });
    expect(conversationPanes(two).indexOf(fresh)).toBe(1);
    expect(openEmptyBeside(two, "local", 2)).toBe(two);
    expect(openEmptyBeside(one, "local", 1, false)).toBe(one);
  });
});
