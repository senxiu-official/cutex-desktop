import { describe, expect, it } from "vitest";
import { adoptInstance, applyOpen, closeInstances, dropEmptyPage, emptyLayout, locate, moveInstance, place, placeSpec, prepareForSave, sanitizeLayout, shelfLanePages, switchPage, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { toolPartOf, toolRawOf } from "../src/renderer/src/lib/paneLayout";
import { PREVIEW_COMPONENT } from "../src/renderer/src/lib/sideKinds";
import { EMPTY_PREVIEW_LAUNCHERS } from "../src/renderer/src/lib/emptyPreviewPages";
import { fromTemplate } from "../src/renderer/src/lib/convShelves";
import type { ItemId } from "../src/renderer/src/modules/types";

function open(layout: SideLayout, kind: ItemId = PREVIEW_COMPONENT, key = "a.md") {
  const input = { kind, key, binding: { kind: "host" as const, hostId: "local" }, state: { path: key }, v: 1, pinned: true };
  return applyOpen(layout, place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: true }, placeSpec({ home: "workspace" })), input, 1, { reveal: true });
}

describe("closing Shelf preview items", () => {
  it.each(Object.keys(EMPTY_PREVIEW_LAUNCHERS))("retains the content preview kind %s", (kind) => {
    const a = open(emptyLayout(), kind as ItemId);
    expect(closeInstances(a.layout, [a.instanceId], Object.keys(EMPTY_PREVIEW_LAUNCHERS)).pages[0]).toMatchObject({ emptyKind: kind, cards: [] });
  });
  it("keeps the last file's page, rail and open Shelf, without keeping its file state", () => {
    const a = open(emptyLayout());
    const l = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    expect(l.pages).toHaveLength(1);
    expect(l.pages[0]).toMatchObject({ id: a.pageId, cards: [], emptyKind: PREVIEW_COMPONENT });
    expect(l.pages[0]!.kept).toBeUndefined();
    expect(l.instances).toEqual({});
    expect(l.open).toBe(true);
    expect(l.shelves![0]!.active).toBe(a.pageId);
    expect(a.layout.pages[0]!.cards).toHaveLength(1);
  });

  it("keeps other file tabs until the last closes", () => {
    const a = open(emptyLayout());
    const b = open(a.layout, PREVIEW_COMPONENT, "b.md");
    const l = closeInstances(b.layout, [b.instanceId], [PREVIEW_COMPONENT]);
    expect(l.pages[0]!.emptyKind).toBeUndefined();
    expect(locate(l, a.instanceId)).not.toBeNull();
    expect(closeInstances(l, [a.instanceId], [PREVIEW_COMPONENT]).pages[0]!.emptyKind).toBe(PREVIEW_COMPONENT);
  });

  it("reuses its empty preview page from another page and keeps unrelated kinds out", () => {
    const a = open(emptyLayout());
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    const other = open(empty, "workspace.files", "tree");
    expect(other.pageId).not.toBe(a.pageId);
    expect(switchPage(other.layout, other.pageId!).pages).toHaveLength(2);
    expect(shelfLanePages(other.layout, other.layout.pages[0]!.shelf!, { hostId: "local", sessionId: null, workspaceKey: null, available: () => true }).map(p => p.id)).toContain(a.pageId);
    const reopened = open(other.layout);
    expect(reopened.pageId).toBe(a.pageId);
    expect(reopened.layout.pages).toHaveLength(2);
    expect(reopened.layout.pages.find((p) => p.id === a.pageId)!.emptyKind).toBeUndefined();
  });

  it("round-trips a typed empty page through both persistence representations", () => {
    const a = open(emptyLayout());
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    const saved = prepareForSave(empty, { persist: () => true });
    const restored = sanitizeLayout(toolRawOf(toolPartOf(sanitizeLayout(saved))));
    expect(restored.pages[0]).toMatchObject({ id: a.pageId, emptyKind: PREVIEW_COMPONENT, cards: [] });
    expect(open(restored).pageId).toBe(a.pageId);
  });

  it("refills a retained preview page when its agent opens content in its background Shelf", () => {
    const a = open(emptyLayout());
    const inst = a.layout.instances[a.instanceId]!;
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    const arrival = adoptInstance(empty, "background", inst, 2);
    expect(arrival.pageId).toBe(a.pageId);
    expect(arrival.layout.pages).toHaveLength(1);
    expect(arrival.layout.pages[0]!.emptyKind).toBeUndefined();
  });

  it("explicit close-page removes the retained page", () => {
    const a = open(emptyLayout());
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    expect(dropEmptyPage(empty, a.pageId!).pages).toEqual([]);
    expect(closeInstances(a.layout, [a.instanceId]).pages).toEqual([]);
  });

  it("does not turn automatic preview pages into owner-created templates for new conversations", () => {
    const a = open(emptyLayout());
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    expect(fromTemplate(empty, 100).pages).toEqual([]);
  });

  it("lets an explicit move repurpose the empty page without leaving a stale preview type", () => {
    const a = open(emptyLayout());
    const empty = closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]);
    const b = open(empty, "browser.tab");
    const moved = moveInstance(b.layout, b.instanceId, { page: a.pageId! }, 2, () => 100);
    expect(locate(moved, b.instanceId)!.page.id).toBe(a.pageId);
    expect(locate(moved, b.instanceId)!.page.emptyKind).toBeUndefined();
    expect(closeInstances(moved, [b.instanceId], [PREVIEW_COMPONENT]).pages).toEqual([]);
  });

  it("does not change other kinds or retain a mixed page", () => {
    const a = open(emptyLayout(), "browser.tab");
    expect(closeInstances(a.layout, [a.instanceId], [PREVIEW_COMPONENT]).pages).toEqual([]);
    const file = open(emptyLayout());
    const mixed = { ...file.layout, instances: { ...file.layout.instances, other: { ...file.layout.instances[file.instanceId]!, kind: "diff.view" as ItemId } } };
    mixed.pages = [{ ...file.layout.pages[0]!, cards: [{ ...file.layout.pages[0]!.cards[0]!, tabs: [file.instanceId, "other"] }] }];
    expect(closeInstances(mixed, [file.instanceId, "other"], [PREVIEW_COMPONENT]).pages).toEqual([]);
  });
});
