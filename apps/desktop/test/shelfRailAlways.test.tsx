// @vitest-environment jsdom
// Shelf Rail 常驻 (owner 2026-10-21: "the Shelf Rail could be always present — no need to hide it; make it
// configurable, shown by default"; docs/desktop-modules.md §24.12.3, appearance.shelfRailAlways): on, every
// conversation's Shelf Rail stays at its place — a closed tool area (open: false) shows its Shelves as rails, an
// empty Shelf shows a rail of its own (the owner's avatar + ＋ = the launchers, no pages), the other workspace's too;
// a page on a closed Shelf's rail opens it to that page; the header's Shelf button still expands / folds (the rail
// stays). Off: the behaviour before (empty → no rail; one workspace closed → nothing). Widths: the rails are counted
// in the row (lib/workspaceRow `rail`, lib/sideLayout shelfRow), nothing overlaps.
import { act, createElement as h, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ menus: [] as { anchor: Element; entries: unknown[] }[], launched: [] as string[] }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
  translate: (key: string) => key,
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
vi.mock("../src/renderer/src/lib/contextMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openMenuFrom: (anchor: Element, entries: unknown[]) => void fx.menus.push({ anchor, entries }),
}));
vi.mock("../src/renderer/src/lib/sideMenus", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  launchable: () => [{ kind: "workspace.files", label: "Files", icon: null, Icon: () => null, params: {} }],
  launch: (kind: string) => void fx.launched.push(kind),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, CARD_GAP, COLLAPSED_SHELF_WIDTH, emptyLayout, place, placeSpec, setOpen, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout, openBeside, focusPane, conversationPanes } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import * as sideStore from "../src/renderer/src/lib/sideLayoutStore";
import { useSide, useConvShelfVersion } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE, parseAppearance } from "../src/renderer/src/lib/appearanceModel";
import { writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { metaOf } from "../src/renderer/src/lib/convShelves";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import { liveShelfState, toggleConvShelf } from "../src/renderer/src/lib/convPaneControls";
import { workspaceRow, type RowInput, type WorkspaceWidthMode } from "../src/renderer/src/lib/workspaceRow";
import { WS_CONVERSATION_MIN_W } from "../src/renderer/src/lib/workspaces";
import { setPinnedLead } from "../src/renderer/src/lib/rowDrag";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");

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

function onePane() {
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
}
/** Two panes: eva (left) and alden (right); `focused` = which one has the focus. */
function twoPanes(focused: 0 | 1) {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  const panes = conversationPanes(work);
  work = focusPane(work, panes[focused]!, 2);
  usePanes.setState({ layout: work });
  return panes;
}
function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none" });
}
function render(split: { focused: number } | null) {
  act(() => root.render(h(SideWorkArea, { side: true, split, single: split ? null : "main", children: h(Columns) })));
}
const setAlways = (on: boolean) => act(() => appearance.setAppearance({ shelfRailAlways: on }, false));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 1600;
  fx.menus = [];
  fx.launched = [];
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

describe("the setting", () => {
  it("is on by default; stored off stays off; anything else reads as on", () => {
    expect(DEFAULT_APPEARANCE.shelfRailAlways).toBe(true);
    expect(parseAppearance({}).shelfRailAlways).toBe(true);
    expect(parseAppearance({ shelfRailAlways: false }).shelfRailAlways).toBe(false);
    expect(parseAppearance({ shelfRailAlways: "x" }).shelfRailAlways).toBe(true);
  });
});

describe("one workspace", () => {
  it.each([true, false])("resizes beside a closed Shelf with keep-page-buttons=%s without opening it", (keep) => {
    setPinnedLead(null);
    setAlways(keep);
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    appearance.setAppearance({ workspaceWidth: "content", singleColumnW: 700 }, false);
    onePane();
    render(null);
    const edge = q('[data-single-edge="right"]')!;
    expect(edge).not.toBeNull();
    expect(edge.title).toBe("workSurface.columnWidthHint");
    expect(!!q("[data-shelf-rail-collapsed]")).toBe(keep);
    const card = q("[data-conv-card]")!;
    const from = Number.parseFloat(card.style.width);
    const pointer = (type: string, clientX: number) => act(() => { edge.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 })); });
    pointer("pointerdown", 900);
    pointer("pointermove", 800);
    expect(Number.parseFloat(card.style.width)).toBe(from - 100);
    pointer("pointerup", 800);
    expect(appearance.getAppearance().singleColumnW).toBe(from - 100);
    expect(useSide.getState().layout.open).toBe(false);
    expect(q("[data-side-box]")).toBeNull();
    // Keyboard access uses the same edge and retains the closed Shelf.
    act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(appearance.getAppearance().singleColumnW).toBe(from - 84);
    setPinnedLead(null);
  });

  it.each([true, false])("keeps the edge usable when a narrow conversation starts filled, keep-page-buttons=%s", (keep) => {
    setPinnedLead(null);
    setAlways(keep);
    area = 650;
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    appearance.setAppearance({ workspaceWidth: "content", singleColumnW: 0 }, false);
    onePane();
    render(null);
    const card = q("[data-conv-card]")!;
    expect(card.style.width).toBe(""); // The conversation initially fills the room left by the rail.
    const edge = q('[data-single-edge="right"]')!;
    expect(edge).not.toBeNull();
    const from = Number(edge.getAttribute("aria-valuenow"));
    expect(from).toBe(area - (keep ? COLLAPSED_SHELF_WIDTH : 0));
    const pointer = (type: string, clientX: number) => act(() => { edge.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 })); });
    pointer("pointerdown", 600);
    pointer("pointermove", 520);
    expect(card.style.flex).toBe("0 1 auto");
    expect(Number.parseFloat(card.style.width)).toBe(from - 80);
    pointer("pointerup", 520);
    expect(appearance.getAppearance().singleColumnW).toBe(from - 80);
    expect(Number.parseFloat(card.style.width)).toBe(from - 80); // No fill snap on release.
    expect(useSide.getState().layout.open).toBe(false);
    // A large outward drag stops before the page-button lane / window edge.
    pointer("pointerdown", 520);
    pointer("pointermove", 2000);
    pointer("pointerup", 2000);
    expect(appearance.getAppearance().singleColumnW).toBeLessThanOrEqual(from);
    setPinnedLead(null);
  });

  it("a closed tool area (open: false) shows its Shelf as its rail (pages, not marked); a page on it opens the Shelf to that page", () => {
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    onePane();
    render(null);
    // Nothing expanded (the frame stays closed), the rail on the right.
    expect(q("[data-side-box]")).toBeNull();
    const rail = q('[data-shelf-box="right"] [data-shelf-rail-collapsed]')!;
    expect(rail).not.toBeNull();
    const page = rail.querySelector<HTMLElement>("[data-shelf-page]")!;
    expect(page.hasAttribute("data-shelf-page-on")).toBe(false);
    expect(rail.querySelector("[data-shelf-owner]")?.getAttribute("data-shelf-owner")).toBe("eva");
    act(() => page.click());
    const layout = useSide.getState().layout;
    expect(layout.open).toBe(true);
    expect(shelvesOf(layout)[0]!.collapsed).toBeFalsy();
    expect(shelvesOf(layout)[0]!.active).toBe(page.dataset.shelfPage);
    expect(q("[data-side-box]")).not.toBeNull();
  });

  it("the avatar (the Shelf toggle) of a closed tool area's rail expands it (it does not just mark it collapsed)", () => {
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    onePane();
    render(null);
    act(() => q("[data-shelf-avatar]")!.click());
    const layout = useSide.getState().layout;
    expect(layout.open).toBe(true);
    expect(shelvesOf(layout)[0]!.collapsed).toBeFalsy();
  });

  it("an empty Shelf shows the empty rail: the owner's avatar and ＋ (the launchers into this Shelf), no pages, counted in the row", () => {
    useSide.setState({ layout: emptyLayout() });
    onePane();
    area = 2600;
    render(null);
    const rail = q("[data-shelf-rail-empty]")!;
    expect(rail).not.toBeNull();
    expect(rail.dataset.shelfRailEmpty).toBe("right");
    expect(rail.style.width).toBe(`${COLLAPSED_SHELF_WIDTH}px`);
    expect(rail.querySelector("[data-shelf-owner]")?.getAttribute("data-shelf-owner")).toBe("eva");
    expect(rail.querySelectorAll("[data-shelf-page]")).toHaveLength(0);
    expect(rail.querySelector("[data-shelf-menu], [data-shelf-toggle]")).toBeNull();
    act(() => rail.querySelector<HTMLElement>("[data-shelf-rail-launch]")!.click());
    const entries = fx.menus.at(-1)!.entries as ({ label?: string; disabled?: boolean; onSelect: () => void } | "separator")[];
    const label = (e: (typeof entries)[number]) => (e === "separator" ? e : e.label);
    expect(entries.map(label)).toEqual(["convHeader.shelfLaunch", "Files", "separator", "side.newPage", "separator", "onboarding.panel.menu"]);
    act(() => (entries[1] as { onSelect: () => void }).onSelect());
    expect(fx.launched).toEqual(["workspace.files"]);
    // The empty rail has no Shelf handle of its own: expose the conversation's edge beside it.
    expect(q('[data-single-edge="right"]')).not.toBeNull();
    expect(q('[data-single-edge="left"]')).not.toBeNull();
  });

  it("the empty rail's ＋ → 新建空页 makes the first page: an empty launcher page in view in this Shelf (owner 2026-10-24)", () => {
    useSide.setState({ layout: emptyLayout() });
    onePane();
    area = 2600;
    render(null);
    act(() => q("[data-shelf-rail-empty] [data-shelf-rail-launch]")!.click());
    const entries = fx.menus.at(-1)!.entries as ({ label?: string; onSelect: () => void } | "separator")[];
    const make = entries.find((e) => e !== "separator" && e.label === "side.newPage") as { onSelect: () => void };
    act(() => make.onSelect());
    const layout = useSide.getState().layout;
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.cards).toHaveLength(0);
    expect(layout.pages[0]!.launcher).toBe(true);
    expect(layout.activePage).toBe(layout.pages[0]!.id);
    expect(layout.open).toBe(true);
    expect(shelvesOf(layout)).toHaveLength(1);
    expect(q("[data-shelf-rail-empty]")).toBeNull();
    // A second one from the same menu of the Shelf with pages: the empty page is reused, not doubled.
    act(() => make.onSelect());
    expect(useSide.getState().layout.pages).toHaveLength(1);
  });

  it("no agent in front (the desktop): no empty rail", () => {
    useSide.setState({ layout: emptyLayout() });
    useApp.setState({ selectedId: null });
    onePane();
    render(null);
    expect(q("[data-shelf-rail-empty]")).toBeNull();
  });

  it("off: the behaviour before — empty → no rail, closed → nothing", () => {
    setAlways(false);
    useSide.setState({ layout: emptyLayout() });
    onePane();
    render(null);
    expect(q("[data-shelf-rail-empty]")).toBeNull();
    expect(q("[data-shelf-rail]")).toBeNull();
    act(() => useSide.setState({ layout: setOpen(withBrowser(), false) }));
    render(null);
    expect(q("[data-shelf-rail]")).toBeNull();
    expect(q("[data-shelf-box]")).toBeNull();
    // Turned on again: the rail is there at once.
    setAlways(true);
    expect(q('[data-shelf-box="right"] [data-shelf-rail-collapsed]')).not.toBeNull();
  });

  it("a conversation maximised: the closed Shelf's rail folds beside it like the others (§24.16), the empty rail is not drawn", () => {
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    onePane();
    act(() => root.render(h(SideWorkArea, { side: true, covered: true, split: null, single: null, children: h(Columns) })));
    expect(q("[data-panel-folded] [data-shelf-rail]")).not.toBeNull();
    act(() => useSide.setState({ layout: emptyLayout() }));
    act(() => root.render(h(SideWorkArea, { side: true, covered: true, split: null, single: null, children: h(Columns) })));
    expect(q("[data-shelf-rail-empty]")).toBeNull();
  });
});

describe("the header's Shelf button with the rail always there", () => {
  it("closed → expanded → folded to its rail → expanded; the rail stays on screen throughout", () => {
    // The live conversation is the focused one (lib/sideLayoutStore liveConversation; none in this test).
    vi.spyOn(sideStore, "liveConversation").mockReturnValue("local|eva");
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    onePane();
    render(null);
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("folded");
    act(() => toggleConvShelf("main", "local", "eva"));
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("expanded");
    expect(q("[data-side-box] [data-shelf-rail]")).not.toBeNull();
    act(() => toggleConvShelf("main", "local", "eva"));
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("folded");
    expect(q("[data-shelf-rail-collapsed]")).not.toBeNull();
    act(() => toggleConvShelf("main", "local", "eva"));
    expect(liveShelfState(useSide.getState().layout, ctx)).toBe("expanded");
  });
});

describe("two workspaces", () => {
  it("the other workspace's empty Shelf shows its empty rail on its outer side (its avatar; ＋ focuses it first), counted in the row", () => {
    const panes = twoPanes(0);
    area = 2600;
    render({ focused: 0 });
    const rail = q("[data-shelf-rail-empty]")!;
    expect(rail).not.toBeNull();
    expect(rail.dataset.shelfRailEmpty).toBe("right");
    expect(rail.style.order).toBe("6");
    expect(rail.dataset.wsShelf).toBe(panes[1]);
    expect(rail.querySelector("[data-shelf-owner]")?.getAttribute("data-shelf-owner")).toBe("alden");
    // 智能 fills with two: both columns share what the Shelf and the rail leave (1062 each without the rail).
    expect(q("[data-row-widths]")!.dataset.rowWidths).toBe(`${1062 - COLLAPSED_SHELF_WIDTH / 2},${1062 - COLLAPSED_SHELF_WIDTH / 2}`);
    setAlways(false);
    expect(q("[data-shelf-rail-empty]")).toBeNull();
    expect(q("[data-row-widths]")!.dataset.rowWidths).toBe("1062,1062");
  });

  it("the focused workspace's empty Shelf (永远偏右: on its right, between the columns)", () => {
    act(() => appearance.setAppearance({ wsRailPlacement: "right" }, false));
    useSide.setState({ layout: emptyLayout() });
    writeConvShelf("host:local", "local|alden", withBrowser(), metaOf(withBrowser()), null);
    act(() => useConvShelfVersion.setState((v) => ({ n: v.n + 1 })));
    twoPanes(0);
    render({ focused: 0 });
    const rails = all("[data-shelf-rail-empty]");
    expect(rails).toHaveLength(1);
    expect(rails[0]!.style.order).toBe("3");
    expect(rails[0]!.querySelector("[data-shelf-owner]")?.getAttribute("data-shelf-owner")).toBe("eva");
    expect(rails[0]!.hasAttribute("data-ws-shelf")).toBe(false);
  });

  it("the other workspace's closed Shelf (open: false) shows as its rail with its pages", () => {
    const closed = setOpen(withBrowser(), false);
    writeConvShelf("host:local", "local|alden", closed, metaOf(closed), null);
    act(() => useConvShelfVersion.setState((v) => ({ n: v.n + 1 })));
    twoPanes(0);
    render({ focused: 0 });
    const boxes = all("[data-ws-shelf-box]");
    const peer = boxes.find((b) => b.hasAttribute("data-ws-peer"));
    expect(peer).toBeDefined();
    expect(peer!.querySelector("[data-shelf-rail-collapsed]")).not.toBeNull();
    expect(peer!.querySelectorAll("[data-shelf-page]")).toHaveLength(1);
    expect(q("[data-shelf-rail-empty]")).toBeNull();
  });
});

describe("no overlap with the rails", () => {
  /** The width the row takes: fixed boxes (Shelves, rails, gaps) + explicit columns + flex columns at least their minimum. */
  function span(input: RowInput): number {
    const out = workspaceRow(input);
    const fixed = out.workspaces.reduce((s, w, i) => s + w.shelves.reduce((a, x) => a + x.box, 0) + (input.workspaces[i]!.rail ? COLLAPSED_SHELF_WIDTH : 0), 0) + (input.workspaces.length - 1) * CARD_GAP;
    const explicit = out.workspaces.reduce((s, w) => s + (w.width ?? 0), 0);
    const flex = out.workspaces.filter((w) => w.width === null).length;
    return fixed + explicit + (flex ? Math.max(flex * WS_CONVERSATION_MIN_W, input.area - fixed - explicit) : 0);
  }
  it("sweeps areas × modes × placements with empty rails on either / both workspaces and closed (rail) Shelves", () => {
    let checked = 0;
    for (let area = 400; area <= 4000; area += 29)
      for (const mode of ["smart", "content", "fill"] as WorkspaceWidthMode[])
        for (const placement of ["outer", "right"] as const)
          for (const shelf of ["none", "closed", "expanded"] as const)
            for (const otherRail of [false, true])
              for (const want of [null, 600, 1400]) {
                const shelves = shelf === "none" ? [] : [{ id: "s1", side: "right" as const, width: 760, collapsed: shelf === "closed" }];
                const input: RowInput = {
                  area,
                  mode,
                  placement,
                  workspaces: [
                    { want, min: WS_CONVERSATION_MIN_W, rail: shelf === "none", shelves },
                    { want, min: WS_CONVERSATION_MIN_W, rail: otherRail, shelves: otherRail ? [] : [{ id: "s1", side: "left", width: 420, collapsed: true }] },
                  ],
                };
                const s = span(input);
                if (s > area && area >= 2 * COLLAPSED_SHELF_WIDTH + CARD_GAP) throw new Error(`overlap at ${JSON.stringify({ area, mode, placement, shelf, otherRail, want })}: ${s} > ${area}`);
                checked++;
              }
    expect(checked).toBeGreaterThan(4000);
  });

  it("rendered: two workspaces, the focused one closed, the other empty — the boxes and columns fit every width", () => {
    useSide.setState({ layout: setOpen(withBrowser(), false) });
    twoPanes(0);
    render({ focused: 0 });
    for (let w = 800; w <= 2600; w += 50) {
      area = w;
      act(() => resize!());
      const boxes = all("[data-shelf-box]").reduce((n, b) => n + Number.parseFloat(b.style.width || "0"), 0);
      expect(boxes).toBe(2 * COLLAPSED_SHELF_WIDTH);
      const widths = q("[data-row-widths]")!.dataset.rowWidths!.split(",").map(Number);
      expect(boxes + widths[0]! + widths[1]! + CARD_GAP).toBeLessThanOrEqual(w);
    }
  });
});
