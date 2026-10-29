// @vitest-environment jsdom
// Two workspaces' Shelf Rails (owner report 2026-10-21; docs/desktop-modules.md §24.13 / §24.15):
// (a) root cause — beside two workspaces the store's `narrow` came from the single workspace's frame (two
//     conversation minimums + a Shelf → "narrow" on an ordinary window), so Esc took the "close the drawer" step
//     and closed the whole tool area (`open: false`, remembered per conversation), and the split row drew
//     nothing for a closed tool area: no Shelf, no rail. Now `narrow` is the single workspace's only and a
//     closed tool area with pages still shows its rails beside two workspaces;
// (b) an empty Shelf shows no rail (Shelf Rail 常驻 off; on: test/shelfRailAlways.test.tsx); the rail shows the owning conversation's avatar;
// 工作区的 Shelf Rail (外侧 / 永远偏右) with one / two workspaces; 按内容 centring; the Shelves fold once when a
// second workspace opens without the room (宽度规则 A, owner 2026-10-21; not when the window narrows); Shelf
// Rail 在 Shelf 的 in Settings sets every Shelf.
import { act, createElement as h, useContext } from "react";
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
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, place, placeSpec, setOpen, shelvesOf, SINGLETON_KEY, collapseShelf, expandShelf, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout, openBeside, focusPane, conversationPanes } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { useSide, updateLayout, setEveryShelfRail, useConvShelfVersion } from "../src/renderer/src/lib/sideLayoutStore";
import { escChainStep } from "../src/renderer/src/lib/escChain";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { writeConvShelf, readConvShelf } from "../src/renderer/src/lib/paneFile";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { WorkspaceRail } = await import("../src/renderer/src/components/side/WorkspaceRail");

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
let area = 1600;
let resize: (() => void) | null = null;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];

/** Two panes: eva (left) and alden (right); `focused` = which one has the focus. */
function twoPanes(focused: 0 | 1) {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  const panes = conversationPanes(work);
  work = focusPane(work, panes[focused]!, 2);
  usePanes.setState({ layout: work });
  return panes;
}

/** A child of the work row reading what it tells the conversation columns (PaneHost's ConversationColumns does). */
function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none", "data-row-rails": row ? row.railAt.join(",") : "none" });
}

function render(split: { focused: number } | null) {
  act(() => root.render(h(SideWorkArea, { side: true, split, single: split ? null : "main", children: h(Columns) })));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 1600;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? area : 0;
  });
  localStorage.clear();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});

describe("(a) the focused workspace's Shelf never vanishes beside another workspace", () => {
  it("root cause: one workspace on this width is 'narrow' (its Shelf would be a drawer) — beside two workspaces nothing is, so Esc never closes the tool area", () => {
    area = 1000;
    twoPanes(0);
    render(null);
    // One workspace: two conversations' minimum + a Shelf do not fit → the drawer's narrow flag (as before).
    expect(useSide.getState().narrow).toBe(true);
    render({ focused: 0 });
    // Before the fix the split row published the same flag; Esc then took "close-drawer" → open: false.
    expect(useSide.getState().narrow).toBe(false);
    const drawer = useSide.getState().narrow && useSide.getState().layout.open;
    expect(escChainStep({ modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: false, drawer, editable: false, inSide: false })).not.toBe("close-drawer");
    expect(useSide.getState().layout.open).toBe(true);
  });

  it("a tool area closed before (stored open: false, as the owner had it) still shows its rail beside two workspaces, with the browser page", () => {
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    twoPanes(0);
    render({ focused: 0 });
    const box = q("[data-ws-shelf-box]");
    expect(box).not.toBeNull();
    expect(box!.querySelector("[data-shelf-rail-collapsed]")).not.toBeNull();
    expect(box!.querySelectorAll("[data-shelf-page]")).toHaveLength(1);
  });
});

describe("工作区的 Shelf Rail: placement with one / two workspaces", () => {
  it("one workspace: the right Shelf on the right as today (the frame's box), whatever the setting", () => {
    for (const wsRailPlacement of ["outer", "right"] as const) {
      act(() => appearance.setAppearance({ wsRailPlacement }, false));
      twoPanes(0);
      usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
      render(null);
      expect(q("[data-side-box]")).not.toBeNull();
      expect(q("[data-ws-shelf-box]")).toBeNull();
    }
  });

  it("外侧 (default): the focused left workspace's Shelf at the window's left edge; focused right: at the right edge; the other's rail on its outer side", () => {
    twoPanes(0);
    render({ focused: 0 });
    let box = q("[data-ws-shelf-box]")!;
    expect(box.dataset.shelfBox).toBe("left");
    expect(box.style.order).toBe("1");
    expect(q("[data-row-rails]")!.dataset.rowRails).toBe("left,right");
    twoPanes(1);
    render({ focused: 1 });
    box = q("[data-ws-shelf-box]")!;
    expect(box.dataset.shelfBox).toBe("right");
    expect(box.style.order).toBe("6");
  });

  it("永远偏右: each workspace's Shelf and rail on its own right", () => {
    act(() => appearance.setAppearance({ wsRailPlacement: "right" }, false));
    twoPanes(0);
    render({ focused: 0 });
    const box = q("[data-ws-shelf-box]")!;
    expect(box.dataset.shelfBox).toBe("right");
    expect(box.style.order).toBe("3");
    expect(q("[data-row-rails]")!.dataset.rowRails).toBe("right,right");
  });

  it("the rail shows the owning conversation's avatar at its top", () => {
    twoPanes(0);
    render({ focused: 0 });
    const rail = q("[data-ws-shelf-box] [data-shelf-rail]")!;
    expect(rail.firstElementChild?.getAttribute("data-shelf-owner")).toBe("eva");
  });
});

describe("(b) another workspace's rail", () => {
  it("an empty Shelf shows no rail; one with pages shows its avatar and pages on the side it is given", () => {
    act(() => root.render(h(WorkspaceRail, { paneId: "c2", hostId: "local", sessionId: "alden", name: "Alden", order: 6, at: "right" })));
    expect(q("[data-ws-rail]")).toBeNull();
    const own = withBrowser();
    writeConvShelf("host:local", "local|alden", own, {}, null);
    expect(readConvShelf("host:local", "local|alden").own?.pages).toHaveLength(1);
    act(() => useConvShelfVersion.setState((v) => ({ n: v.n + 1 })));
    act(() => root.render(h(WorkspaceRail, { paneId: "c2", hostId: "local", sessionId: "alden", name: "Alden", order: 1, at: "left" })));
    const rail = q("[data-ws-rail]")!;
    expect(rail.dataset.wsRailAt).toBe("left");
    expect(rail.querySelector("[data-shelf-owner]")?.getAttribute("data-shelf-owner")).toBe("alden");
    expect(rail.querySelectorAll("[data-ws-rail-page]")).toHaveLength(1);
  });
});

describe("按内容 / folding when too narrow", () => {
  // 按内容 chosen (智能, the default, fills with two workspaces: tested below).
  beforeEach(() => appearance.setAppearance({ workspaceWidth: "content" }, false));
  it("two workspaces by content: centred, each column at its width (the other's empty Shelf takes no room)", () => {
    // Shelf Rail 常驻 off (the behaviour before it; on, the empty Shelf's rail takes its strip: test/shelfRailAlways.test.tsx).
    act(() => appearance.setAppearance({ shelfRailAlways: false }, false));
    area = 2600;
    twoPanes(0);
    render({ focused: 0 });
    expect(q("[data-side-work]")!.className).toContain("justify-center");
    expect(q("[data-row-widths]")!.dataset.rowWidths).toBe("770,770");
    act(() => appearance.setAppearance({ workspaceWidth: "fill" }, false));
    expect(q("[data-side-work]")!.className).not.toContain("justify-center");
    // Filling (宽度规则 4): explicit widths by the stored ratio (50/50 here) of what the expanded Shelf (and the gap) leave.
    expect(q("[data-row-widths]")!.dataset.rowWidths).toBe("1062,1062");
  });

  it("the window narrows (宽度规则 A / 4): nothing folds by itself — the Shelf keeps its state; the owner's own collapse / expand stays as set", () => {
    area = 1800;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
    area = 1000;
    act(() => resize!());
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
    act(() => updateLayout((l) => collapseShelf(l, shelvesOf(l)[0]!.id)));
    act(() => updateLayout((l) => expandShelf(l, shelvesOf(l)[0]!.id)));
    act(() => resize!());
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
  });

  it("a second workspace that does not fit beside it folds the live Shelf", () => {
    area = 1330;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    useSide.setState({ layout: collapseShelf(withBrowser(), "x") });
    render(null);
    twoPanes(0);
    render({ focused: 0 });
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBe(true);
    expect(q("[data-ws-shelf-box] [data-shelf-rail-collapsed]")).not.toBeNull();
  });
});

describe("智能 (the default 工作区宽度): one workspace by content, two fill the window", () => {
  it("one workspace: its column at its width, centred (the desktop around it); a second: the columns share the row, edge to edge", () => {
    expect(appearance.getAppearance().workspaceWidth).toBe("smart");
    // Shelf Rail 常驻 off: alden's empty Shelf takes no room (on: test/shelfRailAlways.test.tsx).
    act(() => appearance.setAppearance({ shelfRailAlways: false }, false));
    area = 2600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    expect(q("[data-side-work]")!.dataset.wsWidth).toBe("content");
    expect(q("[data-side-work]")!.dataset.wsWidthSetting).toBe("smart");
    expect(q("[data-side-work]")!.className).toContain("justify-center");
    expect(q("[data-single-w]")).not.toBeNull();
    twoPanes(0);
    render({ focused: 0 });
    expect(q("[data-side-work]")!.dataset.wsWidth).toBe("fill");
    expect(q("[data-side-work]")!.className).not.toContain("justify-center");
    // Both columns share what the Shelf leaves (the stored ratio, 50/50 here).
    expect(q("[data-row-widths]")!.dataset.rowWidths).toBe("1062,1062");
    // Filling sets widths only: the cards keep their gaps / radii (贴边显示 is its own switch, off by default).
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
    act(() => appearance.setAppearance({ edgeToEdge: true }, false));
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(true);
    // Back to one workspace: by content again.
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    expect(q("[data-side-work]")!.dataset.wsWidth).toBe("content");
    expect(document.documentElement.hasAttribute("data-edge-to-edge")).toBe(false);
  });

  it("a second workspace that fits filling does not fold the live Shelf (按内容 would)", () => {
    area = 1330;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    useSide.setState({ layout: collapseShelf(withBrowser(), "x") });
    render(null);
    twoPanes(0);
    render({ focused: 0 });
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
  });
});

describe("Settings → Shelf Rail 在 Shelf 的", () => {
  it("sets every Shelf: the live one, the stored ones, and new ones", () => {
    writeConvShelf("host:local", "local|alden", withBrowser(), {}, null);
    act(() => setEveryShelfRail("inner"));
    expect(shelvesOf(useSide.getState().layout).map((x) => x.options.railPlacement)).toEqual(["inner"]);
    expect(shelvesOf(readConvShelf("host:local", "local|alden").own!).map((x) => x.options.railPlacement)).toEqual(["inner"]);
    // A new Shelf (a page opened into an empty layout) starts with it.
    expect(shelvesOf(withBrowser())[0]!.options.railPlacement).toBe("inner");
    act(() => setEveryShelfRail("outer"));
    expect(shelvesOf(withBrowser())[0]!.options.railPlacement).toBe("outer");
  });
});

describe("the focus moves visibly between two workspaces (owner 2026-10-21 #6)", () => {
  it("the outline of the column that gets the focus draws in (a ring from further out), the old one fades; still with reduced motion", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
    expect(css).toMatch(/\.ws-col \{[^}]*outline: 1\.5px solid transparent;[^}]*transition:[^}]*outline-color[^}]*\}/);
    expect(css).toMatch(/\.ws-col\[data-ws-focused\] \{[^}]*outline-offset: 2px;[^}]*animation: ws-focus-in/);
    expect(css).toMatch(/@keyframes ws-focus-in \{\s*0% \{[^}]*outline-offset: 12px;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.ws-col \{\s*transition: none;\s*\}\s*\.ws-col\[data-ws-focused\] \{\s*animation: none;/);
    // The columns beside each other carry it; the focus attribute moves with the focused pane.
    const paneHost = readFileSync(join(__dirname, "../src/renderer/src/components/PaneHost.tsx"), "utf8");
    expect(paneHost).toContain("shell-card ws-col");
    expect(paneHost).toContain('data-ws-focused={split && focused ? "" : undefined}');
    // A page on the other workspace's rail: that workspace gets the focus and the page shows (its Shelf expanded).
    const rail = readFileSync(join(__dirname, "../src/renderer/src/components/side/WorkspaceRail.tsx"), "utf8");
    expect(rail).toMatch(/focus\(\);\s*openShelfPage\(page\.id\);/);
  });
});
