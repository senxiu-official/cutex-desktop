import { describe, expect, it } from "vitest";
import { addShelfPage, adoptInstance, applyOpen, emptyLayout, locate, MAX_SHELF_PAGES, moveInstance, place, placeSpec, prepareForSave, sanitizeLayout, shelvesOf, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout, joinLayout, toolPartOf, validateLayout } from "../src/renderer/src/lib/paneLayout";
import type { ItemId } from "../src/renderer/src/modules/types";

const binding = { kind: "host" as const, hostId: "local" };
let clock = 0;
function open(layout: SideLayout, kind: string, key = "one", page?: string) {
  const input = { kind: kind as ItemId, binding, key, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, page, activePage: layout.activePage, columnOpen: layout.open }, placeSpec({ home: "workspace", prefer: ["active"], otherwise: "active-page" }));
  return { ...applyOpen(layout, decision, input, ++clock, { reveal: true, home: "workspace" }), decision };
}

describe("normal Shelf opens (2026-11-03)", () => {
  it("reuses a singleton, adds a multi-instance tab in its existing pane, and gives a different kind a new page despite active/group hints", () => {
    const a = open(emptyLayout(), "files");
    const b = open(a.layout, "terminal", "t1");
    expect(b.layout.pages).toHaveLength(2);
    expect(b.layout.pages.every(p => p.cards.length === 1)).toBe(true);
    const again = open(b.layout, "files");
    expect(again.instanceId).toBe(a.instanceId);
    expect(again.layout.activePage).toBe(locate(a.layout, a.instanceId)!.page.id);
    const tab = open(again.layout, "terminal", "t2");
    expect(tab.layout.pages).toHaveLength(2);
    expect(locate(tab.layout, tab.instanceId)!.card.tabs).toEqual([b.instanceId, tab.instanceId]);
    expect(tab.layout.activePage).toBe(locate(tab.layout, b.instanceId)!.page.id);
  });

  it("fills the active empty page, and explicit page/menu moves still split", () => {
    const a = open(emptyLayout(), "files");
    const shelf = shelvesOf(a.layout)[0]!.id;
    const empty = addShelfPage(a.layout, shelf);
    const b = open(empty.layout, "terminal");
    expect(locate(b.layout, b.instanceId)!.page.id).toBe(empty.pageId);
    const c = open(b.layout, "changes", "one", empty.pageId!);
    expect(locate(c.layout, c.instanceId)!.page.cards).toHaveLength(2);
    const target = locate(c.layout, a.instanceId)!.page.id;
    const moved = moveInstance(c.layout, b.instanceId, { page: target }, ++clock, () => 100);
    expect(locate(moved, a.instanceId)!.page.cards).toHaveLength(2);
  });

  it("round-trips 20 pages through the stored layout, beyond the old nine-page limit", () => {
    let l = emptyLayout();
    for (let i = 0; i < 20; i++) l = open(l, `test.kind-${i}`).layout;
    const saved = prepareForSave(l, { persist: () => true });
    expect(sanitizeLayout(saved).pages).toHaveLength(20);
    const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: null });
    expect(validateLayout(JSON.parse(JSON.stringify(joinLayout(work, toolPartOf(saved)))))).not.toBeNull();
  });

  it("falls back at the sanity limit without refusing, including background agent arrivals", () => {
    let l = emptyLayout();
    for (let i = 0; i < MAX_SHELF_PAGES; i++) l = open(l, `kind-${i}`).layout;
    const next = open(l, "overflow");
    expect(next.layout.pages).toHaveLength(MAX_SHELF_PAGES);
    expect(next.layout.instances[next.instanceId]).toBeTruthy();
    let adopted = next.layout;
    for (let i = 0; i < 6; i++) adopted = adoptInstance(adopted, `agent-${i}`, { kind: `agent-kind-${i}` as ItemId, binding, key: "one", state: null, v: 1, pinned: false, lastActiveAt: ++clock }, clock).layout;
    expect(adopted.pages).toHaveLength(MAX_SHELF_PAGES);
    expect(adopted.pages.every(p => p.cards.length <= 3)).toBe(true);
    expect(adopted.instances["agent-5"]).toBeTruthy();
  });
});
