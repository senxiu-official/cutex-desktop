// @vitest-environment jsdom
// The 8 px gap between the sidebar and a conversation column against it (owner 2026-10-28, ui-batch §B): it held two
// edges — the sidebar's (3 px of it) and the column's own left edge (the rest, the middle included), so a press in the
// middle resized the column and opened desktop instead of resizing the sidebar. Now a column against the expanded
// sidebar (no desktop between) draws no left edge, like the Shelf seam, and the sidebar's edge covers the whole gap.
// The hidden sidebar (no width edge), a column with desktop before it, and the Settings Shelf in its slot are kept.
// The Sidebar's flag itself (expanded / hidden / unmounted): test/sidebarPeek.test.tsx.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import { emptyLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { useSidebarEdge } from "../src/renderer/src/lib/windowSidebar";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { useSettingsShelf, useSettingsShelfSlot } from "../src/renderer/src/lib/settingsShelf";
import * as glide from "../src/renderer/src/lib/columnGlide";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { PaneResizer } = await import("../src/renderer/src/components/PaneResizer");

const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
const area = 1600;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const sidebarEdge = (shown: boolean) => act(() => useSidebarEdge.of(MAIN_WINDOW).setState({ shown }));
/** One conversation alone, by content, no Shelf; `lead`: pinned px of desktop before it (0 = against the sidebar). */
function single(lead: number) {
  act(() => usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) }));
  act(() => root.render(h(SideWorkArea, { side: true, split: null, single: "main", children: h("i") })));
  // After the first layout (opening the workspace forgets a pinned place, lib/rowDrag): left there, as a drag leaves it.
  act(() => useRowDrag.setState({ lead, leadShare: null }));
  expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  glide.resetColumnGlide();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? area : 0;
  });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-side-work")) return rect.call(this);
    return { left: 0, top: 0, width: area, height: 800, right: area, bottom: 800, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
  localStorage.clear();
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: emptyLayout(), mode: null, narrow: false, liveWidth: {} });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE, workspaceWidth: "content" }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useSidebarEdge.of(MAIN_WINDOW).setState({ shown: false });
  useSettingsShelf.setState({ open: false });
  useSettingsShelfSlot.of(MAIN_WINDOW).setState({ left: null });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});

describe("the gap between the sidebar and a column against it is the sidebar's edge", () => {
  it("a column against the expanded sidebar draws no left edge (its right edge stays)", () => {
    sidebarEdge(true);
    single(0);
    expect(q('[data-single-edge="left"]')).toBeNull();
    expect(q('[data-single-edge="right"]')).not.toBeNull();
  });

  it("desktop before the column: both its edges stay (the sidebar's edge is not in that gap)", () => {
    sidebarEdge(true);
    single(120);
    expect(q('[data-single-edge="left"]')).not.toBeNull();
    expect(q('[data-single-edge="right"]')).not.toBeNull();
  });

  it("the hidden sidebar has no width edge: the column keeps its left edge against it", () => {
    sidebarEdge(false);
    single(0);
    expect(q('[data-single-edge="left"]')).not.toBeNull();
  });

  it("the sidebar going hidden / back brings the column's edge back / drops it", () => {
    sidebarEdge(true);
    single(0);
    expect(q('[data-single-edge="left"]')).toBeNull();
    sidebarEdge(false);
    expect(q('[data-single-edge="left"]')).not.toBeNull();
    sidebarEdge(true);
    expect(q('[data-single-edge="left"]')).toBeNull();
  });

  it("the Settings Shelf in its slot (its width edge over the gap) is the card beside the column, also with the sidebar railed", () => {
    sidebarEdge(false);
    act(() => {
      useSettingsShelfSlot.of(MAIN_WINDOW).setState({ left: document.createElement("div") });
      useSettingsShelf.setState({ open: true, win: MAIN_WINDOW, side: "left", maximized: false });
    });
    single(0);
    expect(q('[data-single-edge="left"]')).toBeNull();
    // On the right (or maximised) it is not beside the column's left edge.
    act(() => useSettingsShelf.setState({ side: "right" }));
    expect(q('[data-single-edge="left"]')).not.toBeNull();
  });
});

describe("the sidebar's edge covers the whole gap", () => {
  it("12 px wide: 4 px inside the sidebar and the 8 px gap after it; the tool side's edge stays 8 px centred on its line", () => {
    const pane = document.createElement("aside");
    document.body.append(pane);
    const r = createRoot(pane);
    act(() => r.render(h(PaneResizer, { field: "sidebarWidth", edge: "right" })));
    const cls = pane.querySelector("[role=separator]")!.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["-right-2", "w-3"]));
    expect(cls).not.toContain("w-2");
    act(() => r.render(h(PaneResizer, { field: "sidePaneWidth", edge: "left" })));
    const side = pane.querySelector("[role=separator]")!.className.split(/\s+/);
    expect(side).toEqual(expect.arrayContaining(["-left-1", "w-2"]));
    act(() => r.unmount());
    pane.remove();
  });

});
