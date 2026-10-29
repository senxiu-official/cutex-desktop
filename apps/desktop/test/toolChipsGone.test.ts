// #7 (owner 2026-10-21): tool panes no longer go to the tray as chips. Stored chips are resolved once
// (lib/sideLayout resolveChips, lib/paneFile migrateToolChips): back into their Shelf, else closed and counted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { toolPartOf } from "../src/renderer/src/lib/paneLayout";
import {
  addShelfPage,
  applyOpen,
  collapseCard,
  emptyLayout,
  findCard,
  locate,
  MAX_SHELF_PAGES,
  place,
  placeSpec,
  resolveChips,
  shelvesOf,
  SINGLETON_KEY,
  type SideLayout,
} from "../src/renderer/src/lib/sideLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
let clock = 100;

function open(layout: SideLayout, kind: string, key: string | null = SINGLETON_KEY) {
  const input = { kind: kind as ItemId, binding: FOLLOW, key, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open }, placeSpec({ home: "workspace" }));
  return applyOpen(layout, decision, input, ++clock, { reveal: true, home: "workspace" });
}

/** One page: files, changes, preview. */
function three() {
  let l = emptyLayout();
  const ids: string[] = [];
  for (const kind of ["workspace.files", "workspace.changes", "workspace.preview"]) {
    const o = open(l, kind);
    l = o.layout;
    ids.push(locate(l, o.instanceId!)!.card.id);
  }
  return { layout: l, cards: ids };
}

describe("resolveChips (#7)", () => {
  it("nothing to do without chips", () => {
    const t = three();
    expect(resolveChips(t.layout, 1)).toEqual({ layout: t.layout, closed: 0 });
  });

  it("a chip goes back into its page between its old neighbours; the view does not change", () => {
    const t = three();
    const c = collapseCard(t.layout, t.cards[1]!, 200);
    const { layout, closed } = resolveChips(c, 300);
    expect(closed).toBe(0);
    expect(layout.chips).toBeUndefined();
    expect(layout.pages[0]!.cards.map((x) => x.id)).toEqual(t.cards);
    expect(layout.activePage).toBe(c.activePage);
  });

  it("its page full again: a new page of its Shelf (not in view); its page gone: re-made in its Shelf", () => {
    const t = three();
    const c = collapseCard(t.layout, t.cards[1]!, 200);
    const filled = open(c, "terminal.pty", "x").layout;
    expect(filled.pages[0]!.cards).toHaveLength(3);
    const { layout, closed } = resolveChips(filled, 300);
    expect(closed).toBe(0);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[1]!.cards.map((x) => x.id)).toEqual([t.cards[1]]);
    expect(layout.pages[1]!.shelf).toBe(layout.pages[0]!.shelf);
    expect(shelvesOf(layout)[0]!.active).toBe(layout.pages[0]!.id);
    // Every pane of the page in the tray (the page and its Shelf went): all back, in their old order.
    let all = t.layout;
    for (const [k, id] of t.cards.entries()) all = collapseCard(all, id, 400 + (2 - k));
    expect(all.pages).toEqual([]);
    const back = resolveChips(all, 500);
    expect(back.closed).toBe(0);
    expect(back.layout.pages.map((p) => p.cards.map((x) => x.id))).toEqual([t.cards]);
  });

  it("its Shelf at MAX_SHELF_PAGES and its page full: closed with its instances, counted", () => {
    const t = three();
    const c = collapseCard(t.layout, t.cards[1]!, 200);
    let l = open(c, "terminal.pty", "x").layout;
    const shelf = shelvesOf(l)[0]!.id;
    while (l.pages.length < MAX_SHELF_PAGES) l = addShelfPage(l, shelf).layout;
    const tabs = c.chips![0]!.card.tabs;
    const { layout, closed } = resolveChips(l, 300);
    expect(closed).toBe(1);
    expect(layout.chips).toBeUndefined();
    expect(findCard(layout, t.cards[1]!)).toBeNull();
    for (const id of tabs) expect(layout.instances[id]).toBeUndefined();
  });
});

describe("migrateToolChips (lib/paneFile, #7)", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  it("stored chips go back into their Shelves once; the closed ones are counted for one notice", async () => {
    const file = await import("../src/renderer/src/lib/paneFile");
    const t = three();
    const back = collapseCard(t.layout, t.cards[1]!, 200);
    // A conversation's Shelf whose chip cannot go back (its Shelf has 9 pages, its page full).
    let full = open(back, "terminal.pty", "x").layout;
    const shelf = shelvesOf(full)[0]!.id;
    while (full.pages.length < MAX_SHELF_PAGES) full = addShelfPage(full, shelf).layout;
    storage.set(
      file.PANES_STORAGE_KEY,
      JSON.stringify({ v: file.PANES_FILE_VERSION, layouts: {}, convShelves: { "host:local": { template: toolPartOf(back), shared: null, conv: { "local:a1": { part: toolPartOf(full), meta: {}, at: 1 } } } } }),
    );
    expect(file.migrateToolChips(300)).toBe(1);
    expect(file.takeClosedToolChips()).toBe(1);
    expect(file.takeClosedToolChips()).toBe(0);
    const read = file.readConvShelf("host:local", "local:a1");
    expect(read.template!.chips).toBeUndefined();
    expect(read.template!.pages[0]!.cards.map((x) => x.id)).toEqual(t.cards);
    expect(read.own!.chips).toBeUndefined();
    expect(findCard(read.own!, t.cards[1]!)).toBeNull();
    // Once: nothing left to do.
    const stored = storage.get(file.PANES_STORAGE_KEY);
    expect(file.migrateToolChips(400)).toBe(0);
    expect(storage.get(file.PANES_STORAGE_KEY)).toBe(stored);
  });
});
