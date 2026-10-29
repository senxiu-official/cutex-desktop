// Window interaction audit 2026-10-23 (docs/research/window-interaction-audit-20261023.md):
// #1 a page dragged onto the other workspace's Shelf Rail follows the same merge / reorder / new-page rules as on its
//    own rail, acting on that Shelf (lib/sideDrop crossPageTarget / applyCrossPageDrop);
// #6 a Shelf drop's 撤销 puts the arrangement back and keeps the instances as they are (lib/dropUndo).
import { describe, expect, it } from "vitest";
import type { ItemId } from "../src/renderer/src/modules/types";
import { findPage, MAX_SHELF_PAGES, mergePageInto, movePageTo, shelvesOf, withShelves, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { applyCrossPageDrop, crossPageTarget } from "../src/renderer/src/lib/sideDrop";
import { arrangementKey, undoArrangement } from "../src/renderer/src/lib/dropUndo";

/** One right Shelf; each page = the kinds of its panes (one tab each); ids counted from `start` (`tag` in instance ids). */
function shelf(pages: string[][], start = 0, tag = ""): SideLayout {
  let seq = start;
  const l: SideLayout = { open: true, activePage: null, pages: [], instances: {}, overrides: {}, seq: 0, shelves: [] };
  const sid = `s${++seq}`;
  for (const kinds of pages) {
    const pid = `p${++seq}`;
    const cards = kinds.map((kind) => {
      const iid = `i${tag}${++seq}`;
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
const tabsOf = (l: SideLayout) => l.pages.flatMap((p) => p.cards.flatMap((c) => c.tabs));

describe("#1 a page onto the other workspace's Shelf Rail", () => {
  // Both conversations number their ids the same way (ids are unique per conversation only): p2 is in both.
  const live = () => shelf([["files"], ["preview", "term"]], 0, "a");
  const peer = () => shelf([["deleg"], ["proj"]], 0, "b");

  it("middle of a page button = merge (≤ 3 panes); top / bottom quarter = before / after; ＋ = at the end", () => {
    const from = live();
    const to = peer();
    const page = from.pages[1]!.id;
    expect(crossPageTarget(from, to, page, { at: "page", pageId: to.pages[0]!.id, zone: "middle", half: "top" })).toEqual({ kind: "mergePage", pageId: page, into: to.pages[0]!.id });
    expect(crossPageTarget(from, to, page, { at: "page", pageId: to.pages[0]!.id, zone: "top", half: "top" })).toEqual({ kind: "movePage", pageId: page, shelfId: shelvesOf(to)[0]!.id, before: to.pages[0]!.id });
    expect(crossPageTarget(from, to, page, { at: "page", pageId: to.pages[0]!.id, zone: "bottom", half: "bottom" })).toEqual({ kind: "movePage", pageId: page, shelfId: shelvesOf(to)[0]!.id, before: to.pages[1]!.id });
    expect(crossPageTarget(from, to, page, { at: "newPage", shelfId: shelvesOf(to)[0]!.id })).toEqual({ kind: "movePage", pageId: page, shelfId: shelvesOf(to)[0]!.id, before: null });
    // Not a rail: nothing.
    expect(crossPageTarget(from, to, page, { at: "outside" })).toBeNull();
  });

  it("refused: more than 3 panes together, 9 pages, a shared page, an instance the other conversation does not see", () => {
    const from = live();
    const full = shelf([["a", "b"], ["c"]], 0, "b");
    expect(crossPageTarget(from, full, from.pages[1]!.id, { at: "page", pageId: full.pages[0]!.id, zone: "middle", half: "top" })).toEqual({ kind: "refuse", why: "pageFull" });
    const nine = shelf(Array.from({ length: MAX_SHELF_PAGES }, () => ["x"]), 0, "b");
    expect(crossPageTarget(from, nine, from.pages[0]!.id, { at: "newPage", shelfId: shelvesOf(nine)[0]!.id })).toEqual({ kind: "refuse", why: "limit" });
    const shared = { ...from, pages: from.pages.map((p, k) => (k === 0 ? { ...p, shared: true } : p)) };
    expect(crossPageTarget(shared, peer(), shared.pages[0]!.id, { at: "newPage", shelfId: shelvesOf(peer())[0]!.id })).toEqual({ kind: "refuse", why: "shared" });
    expect(crossPageTarget(from, peer(), from.pages[0]!.id, { at: "newPage", shelfId: shelvesOf(peer())[0]!.id }, () => false)).toEqual({ kind: "refuse", why: "bound" });
  });

  it("moving: the page leaves this Shelf with its instances and lands there under fresh ids, shown; same instance ids", () => {
    const from = live();
    const to = peer();
    const page = from.pages[1]!;
    const target = crossPageTarget(from, to, page.id, { at: "page", pageId: to.pages[0]!.id, zone: "top", half: "top" })!;
    const out = applyCrossPageDrop(from, to, target, Math.max(from.seq, to.seq))!;
    expect(kindsOf(out.from)).toEqual([["files"]]);
    expect(Object.keys(out.from.instances)).toEqual(["ia3"]);
    expect(kindsOf(out.to)).toEqual([["preview", "term"], ["deleg"], ["proj"]]);
    const landed = out.to.pages[0]!;
    // Fresh ids: none of the other conversation's page / pane ids is reused.
    expect(to.pages.map((p) => p.id)).not.toContain(landed.id);
    expect(landed.cards.map((c) => c.id).some((id) => to.pages.some((p) => p.cards.some((c) => c.id === id)))).toBe(false);
    expect(landed.cards.flatMap((c) => c.tabs)).toEqual(page.cards.flatMap((c) => c.tabs));
    expect(out.to.instances[landed.cards[0]!.tabs[0]!]).toBe(from.instances[page.cards[0]!.tabs[0]!]);
    expect(shelvesOf(out.to)[0]!.active).toBe(landed.id);
  });

  it("merging: its panes join the page below its own; ＋ puts it last", () => {
    const from = live();
    const to = peer();
    const merged = applyCrossPageDrop(from, to, { kind: "mergePage", pageId: from.pages[0]!.id, into: to.pages[1]!.id }, 20)!;
    expect(kindsOf(merged.to)).toEqual([["deleg"], ["proj", "files"]]);
    expect(kindsOf(merged.from)).toEqual([["preview", "term"]]);
    const last = applyCrossPageDrop(from, to, { kind: "movePage", pageId: from.pages[0]!.id, shelfId: shelvesOf(to)[0]!.id, before: null }, 20)!;
    expect(kindsOf(last.to)).toEqual([["deleg"], ["proj"], ["files"]]);
  });
});

describe("#6 撤销 of a Shelf drop", () => {
  it("the arrangement comes back, the instances stay as they are now", () => {
    const before = shelf([["files"], ["preview"], ["term"]]);
    const after = mergePageInto(before, before.pages[1]!.id, before.pages[0]!.id);
    expect(arrangementKey(after)).not.toBe(arrangementKey(before));
    // Meanwhile the preview's state changed.
    const preview = before.pages[1]!.cards[0]!.tabs[0]!;
    const now = { ...after, instances: { ...after.instances, [preview]: { ...after.instances[preview]!, state: { scrolled: 40 } } } };
    const undone = undoArrangement(now, before);
    expect(arrangementKey(undone)).toBe(arrangementKey(before));
    expect(kindsOf(undone)).toEqual([["files"], ["preview"], ["term"]]);
    expect(undone.instances[preview]!.state).toEqual({ scrolled: 40 });
    expect(undone.seq).toBe(Math.max(now.seq, before.seq));
  });

  it("a reorder changes the arrangement; an instance's state alone does not", () => {
    const l = shelf([["files"], ["preview"]]);
    const moved = movePageTo(l, l.pages[1]!.id, shelvesOf(l)[0]!.id, l.pages[0]!.id);
    expect(arrangementKey(moved)).not.toBe(arrangementKey(l));
    const id = tabsOf(l)[0]!;
    expect(arrangementKey({ ...l, instances: { ...l.instances, [id]: { ...l.instances[id]!, state: 1 } } })).toBe(arrangementKey(l));
  });

  it("across workspaces: each Shelf back as it was, the instances taken from wherever they are now", () => {
    const from = shelf([["files"], ["preview"]], 0, "a");
    const to = shelf([["deleg"]], 0, "b");
    const out = applyCrossPageDrop(from, to, { kind: "movePage", pageId: from.pages[1]!.id, shelfId: shelvesOf(to)[0]!.id, before: null }, 20)!;
    const pool = [out.from, out.to];
    const liveBack = undoArrangement(out.from, from, pool);
    const peerBack = undoArrangement(out.to, to, pool);
    expect(kindsOf(liveBack)).toEqual([["files"], ["preview"]]);
    expect(kindsOf(peerBack)).toEqual([["deleg"]]);
    const preview = from.pages[1]!.cards[0]!.tabs[0]!;
    expect(liveBack.instances[preview]).toBe(out.to.instances[preview]);
    expect(findPage(peerBack, out.to.pages[1]!.id)).toBeNull();
  });
});
