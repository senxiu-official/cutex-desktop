// @vitest-environment jsdom
// 宽度规则 (owner decisions 2026-10-21; docs/desktop-modules.md §24.15, lib/workspaceRow):
// A. the focus never changes the layout — each workspace's Shelf keeps its own expanded / collapsed state and
//    width on screen; short of width the Shelves fold once, when the second workspace opens; an explicit
//    expand that does not fit folds the other workspace's Shelf;
// B. 铺满窗口 / 智能 set widths only, 贴边显示 is its own switch (tests: workspaceRow / wsRails / deskGaps);
// C. resizing: an edge between two panels changes only those two (the other column keeps its width), nothing
//    re-centres during or after a drag (by content), a minimum stops the edge, a window resize keeps the
//    Shelves' pixels and the owner's ratio, a double-click resets the two panels beside the edge.
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
import { applyOpen, CARD_GAP, COLLAPSED_SHELF_WIDTH, collapseShelf, emptyLayout, expandShelf, MIN_CONVERSATION, MIN_SIDE, place, placeSpec, setShelfWidth, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { FOLD_HYSTERESIS } from "../src/renderer/src/lib/foldHysteresis";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { resizePaneColumns, usePanes } from "../src/renderer/src/lib/paneStore";
import { peekConvView, resetConvShelves, switchConversation, updateLayout, useConvShelfVersion, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { renumber } from "../src/renderer/src/lib/convShelves";
import { writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import { expandedBox } from "../src/renderer/src/lib/workspaceRow";
import { resetRowDrag, useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { WS_CONVERSATION_MIN_W } from "../src/renderer/src/lib/workspaces";
import { FILL_SLACK, SINGLE_MIN_W } from "../src/renderer/src/lib/workSurface";
import * as glide from "../src/renderer/src/lib/columnGlide";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { RowSplitter } = await import("../src/renderer/src/components/PaneResizer");
const { rowGive } = await import("../src/renderer/src/lib/sideResize");

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
let area = 2000;
let rowLeft = 0;
let resize: (() => void) | null = null;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const px = (el: HTMLElement | null) => Number.parseFloat(el!.style.width);

function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none" });
}
const widths = () => q("[data-row-widths]")!.dataset.rowWidths!.split(",").map(Number);

function render(split: { focused: number } | null) {
  act(() => root.render(h(SideWorkArea, { side: true, split, single: split ? null : "main", children: h(Columns) })));
}

/** Two panes: eva (left) and alden (right); `focused` = which one has the focus (the selection follows, as the app does). */
function twoPanes(focused: 0 | 1) {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  const panes = conversationPanes(work);
  work = focusPane(work, panes[focused]!, 2);
  act(() => {
    usePanes.setState({ layout: work });
    useApp.setState({ selectedId: focused === 0 ? "eva" : "alden" });
    switchConversation(focused === 0 ? "local|eva" : "local|alden");
  });
}

/** alden's own Shelf (stored): a browser page, `width`, collapsed or not. */
function aldenShelf(opts: { width?: number; collapsed?: boolean } = {}) {
  let own = renumber(withBrowser(emptyLayout()), 500).layout;
  const id = shelvesOf(own)[0]!.id;
  if (opts.width) own = setShelfWidth(own, id, opts.width);
  writeConvShelf("host:local", "local|alden", own, { collapsed: { [id]: !!opts.collapsed }, open: true }, null);
  act(() => useConvShelfVersion.setState((v) => ({ n: v.n + 1 })));
  return id;
}

const evaShelf = () => shelvesOf(useSide.getState().layout)[0]!;
// Both workspaces' Shelves are live (§24.13): the focused one's box, and the other workspace's (`data-ws-peer`).
const liveBox = () => q("[data-ws-shelf-box]:not([data-ws-peer])");
const dormant = () => q("[data-ws-shelf-box][data-ws-peer]");
/** The other workspace's Shelf is expanded (its live panes in view) / shown as its rail. */
const otherExpanded = () => !!dormant() && !dormant()!.querySelector("[data-shelf-collapsed]");
const otherRail = () => !!dormant()?.querySelector("[data-shelf-collapsed]");

const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 2000;
  rowLeft = 0;
  glide.resetColumnGlide();
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
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-side-work")) return rect.call(this);
    return { left: rowLeft, top: 0, width: area, height: 800, right: rowLeft + area, bottom: 800, x: rowLeft, y: 0, toJSON() {} } as DOMRect;
  });
  (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  localStorage.clear();
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  glide.resetColumnGlide();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});

describe("A. the focus never changes the layout", () => {
  it("both workspaces' Shelves show as they are (the other one expanded at its own width); switching the focus moves only the focus", () => {
    const aldenId = aldenShelf({ width: 360 });
    twoPanes(0);
    render({ focused: 0 });
    // eva (focused, left): live, expanded at the default width, at the window's left edge (外侧).
    expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    expect(liveBox()!.style.order).toBe("1");
    // alden (no focus): its Shelf expanded at its own 360 px, on the right edge — not folded to a rail.
    expect(otherExpanded()).toBe(true);
    expect(px(dormant())).toBe(expandedBox(360));
    expect(dormant()!.style.order).toBe("6");
    const before = widths();
    // The focus moves to alden: the same boxes, the same widths, the same places; only which one is live.
    twoPanes(1);
    render({ focused: 1 });
    expect(q("[data-side-work]")!.dataset.wsSplit).toBe("1");
    expect(shelvesOf(useSide.getState().layout)[0]!.id).toBe(aldenId);
    expect(px(liveBox())).toBe(expandedBox(360));
    expect(liveBox()!.style.order).toBe("6");
    expect(otherExpanded()).toBe(true);
    expect(px(dormant())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    expect(dormant()!.style.order).toBe("1");
    expect(widths()).toEqual(before);
    // Neither Shelf's stored state changed.
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
    expect(shelvesOf(peekConvView("local|eva")!)[0]!.collapsed).toBeFalsy();
    // And back: still the same.
    twoPanes(0);
    render({ focused: 0 });
    expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    expect(px(dormant())).toBe(expandedBox(360));
    expect(widths()).toEqual(before);
  });

  it("a collapsed Shelf stays collapsed and an expanded one expanded whichever workspace has the focus", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    expect(otherRail()).toBe(true);
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
    twoPanes(1);
    render({ focused: 1 });
    expect(px(liveBox())).toBe(COLLAPSED_SHELF_WIDTH);
    expect(evaShelf().collapsed).toBe(true);
    expect(otherExpanded()).toBe(true);
    expect(px(dormant())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
  });

  it("short of width the Shelves fold once, when the second workspace opens; afterwards the focus changes nothing", () => {
    area = 1400;
    aldenShelf();
    act(() => switchConversation("local|eva"));
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    expect(evaShelf().collapsed).toBeFalsy();
    // Two expanded Shelves (468 + 468) and two columns' minimum do not fit in 1400: both fold, stored.
    twoPanes(0);
    render({ focused: 0 });
    expect(evaShelf().collapsed).toBe(true);
    expect(shelvesOf(peekConvView("local|alden")!)[0]!.collapsed).toBe(true);
    expect(px(liveBox())).toBe(COLLAPSED_SHELF_WIDTH);
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
    // The focus moves: nothing folds or unfolds.
    twoPanes(1);
    render({ focused: 1 });
    expect(px(liveBox())).toBe(COLLAPSED_SHELF_WIDTH);
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
  });

  it("the owner expands a Shelf that does not fit: then (and only then) the other workspace's Shelf folds", () => {
    area = 1400;
    aldenShelf();
    act(() => updateLayout((l) => collapseShelf(l, shelvesOf(l)[0]!.id)));
    twoPanes(0);
    render({ focused: 0 });
    // eva's rail + alden expanded fit: nothing changes by itself.
    expect(otherExpanded()).toBe(true);
    act(() => updateLayout((l) => expandShelf(l, shelvesOf(l)[0]!.id)));
    render({ focused: 0 });
    expect(evaShelf().collapsed).toBeFalsy();
    expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    expect(shelvesOf(peekConvView("local|alden")!)[0]!.collapsed).toBe(true);
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
  });

  it("an expand that fits folds nothing", () => {
    area = 2400;
    aldenShelf();
    act(() => updateLayout((l) => collapseShelf(l, shelvesOf(l)[0]!.id)));
    twoPanes(0);
    render({ focused: 0 });
    act(() => updateLayout((l) => expandShelf(l, shelvesOf(l)[0]!.id)));
    render({ focused: 0 });
    expect(otherExpanded()).toBe(true);
  });
});

describe("C. resizing", () => {
  const seam = () => liveBox()!.querySelector<HTMLElement>('[role="separator"]')!;

  it("1 + 3. a Shelf's edge beside two filling workspaces: its own column gives way, the other keeps its width; the edge stops at the column's minimum", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const [a, b] = widths();
    // eva's Shelf is at the left edge: its seam is on its right; dragging right grows it.
    act(() => seam().dispatchEvent(pointer("pointerdown", 1000)));
    act(() => seam().dispatchEvent(pointer("pointermove", 1100)));
    expect(widths()).toEqual([a! - 100, b]);
    // Far past the column's minimum: the edge stops there, nothing else is pushed.
    act(() => seam().dispatchEvent(pointer("pointermove", 4000)));
    expect(widths()).toEqual([WS_CONVERSATION_MIN_W, b]);
    act(() => seam().dispatchEvent(pointer("pointerup", 4000)));
    // Released: no jump — the same widths, stored (the Shelf's width, the columns' ratio).
    expect(widths()).toEqual([WS_CONVERSATION_MIN_W, b]);
    expect(evaShelf().width).toBe(DEFAULT_APPEARANCE.sidePaneWidth + a! - WS_CONVERSATION_MIN_W);
  });

  it("5. a double-click on the Shelf's edge: the Shelf and its column back to their defaults, the other column untouched", () => {
    aldenShelf({ collapsed: true });
    act(() => updateLayout((l) => setShelfWidth(l, shelvesOf(l)[0]!.id, 620)));
    twoPanes(0);
    render({ focused: 0 });
    const [a, b] = widths();
    act(() => seam().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    render({ focused: 0 });
    expect(evaShelf().width).toBeUndefined();
    expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    const [a2, b2] = widths();
    expect(Math.abs(b2! - b!)).toBeLessThanOrEqual(1);
    expect(Math.abs(a2! - (a! + 620 - DEFAULT_APPEARANCE.sidePaneWidth))).toBeLessThanOrEqual(1);
  });

  it("1 + 4. 推挤 (owner 2026-10-23): the sidebar's edge takes only from the panel beside it — eva's Shelf, not the column behind it; the window resizing keeps the Shelves' pixels and the columns' ratio", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const [a, b] = widths();
    const shelf0 = DEFAULT_APPEARANCE.sidePaneWidth;
    // What the row can give the sidebar's edge: the Shelf beside it down to its minimum (the columns give nothing).
    expect(rowGive("left")).toBe(shelf0 - appearance.RANGES.sidePaneWidth[0]);
    // The sidebar grows by 60 while dragged: the row starts 60 px further right and is 60 px narrower.
    act(() => glide.resizeDrag(true));
    rowLeft = 60;
    area = 1940;
    act(() => resize!());
    expect(px(liveBox())).toBe(expandedBox(shelf0 - 60));
    expect(widths()).toEqual([a, b]);
    act(() => glide.resizeDrag(false));
    render({ focused: 0 });
    // The release keeps it: the Shelf's width stored, the columns as they were.
    expect(evaShelf().width).toBe(shelf0 - 60);
    expect(widths()).toEqual([a, b]);
    const ratio = a! / (a! + b!);
    // The window resizes: the Shelves keep their pixels, the columns scale by the owner's ratio (not 50/50).
    area = 2600;
    act(() => resize!());
    expect(px(liveBox())).toBe(expandedBox(shelf0 - 60));
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
    const [c, d] = widths();
    expect(c! + d!).toBe(2600 - expandedBox(shelf0 - 60) - COLLAPSED_SHELF_WIDTH - CARD_GAP);
    expect(Math.abs(c! / (c! + d!) - ratio)).toBeLessThan(0.002);
  });

  it("1 + 3 + 5. the handle between two filling columns: only those two change, live; the minimum stops it; double-click = half and half", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const [a, b] = widths();
    // The row lays the pair out by the stored share (what the splitter's release stores).
    const pairCol = () => {
      const l = usePanes.getState().layout;
      return l.cols.findIndex((c) => c.rows.some((r) => r.pane === conversationPanes(l)[0]));
    };
    act(() => resizePaneColumns(pairCol(), 0.3));
    const [c, d] = widths();
    expect(c! + d!).toBe(a! + b!);
    expect(c).toBe(Math.round((a! + b!) * 0.3));
    act(() => resizePaneColumns(pairCol(), 0.01));
    expect(widths()[0]).toBe(WS_CONVERSATION_MIN_W);
    act(() => resizePaneColumns(pairCol(), 0.5));
    // The splitter itself (perf re-run 2026-10-21 §7.3 N1): a drag moves only the two columns' elements — no
    // store write, nothing re-rendered — with the row's rule (the minimum stops it); the release stores the share
    // once and the columns take the row's widths again; a double-click stores 0.5.
    const shares: number[] = [];
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const r2 = createRoot(host2);
    const col = (props: Record<string, unknown>, ...kids: unknown[]) => h("section", { "data-ws-width": 600, style: { width: 600 }, ...props }, ...(kids as never[]));
    act(() => r2.render(h("div", null, col({ id: "c0" }), col({ id: "c1" }, h(RowSplitter, { widths: [600, 600], onShare: (s: number) => shares.push(s) })))));
    const handle = host2.querySelector<HTMLElement>("[data-pane-split]")!;
    const [c0, c1] = [host2.querySelector<HTMLElement>("#c0")!, host2.querySelector<HTMLElement>("#c1")!];
    const before = useRowDrag.getState();
    act(() => handle.dispatchEvent(pointer("pointerdown", 600)));
    act(() => handle.dispatchEvent(pointer("pointermove", 480)));
    expect([c0.style.width, c1.style.width]).toEqual(["480px", "720px"]);
    expect(shares).toEqual([]);
    expect(useRowDrag.getState()).toBe(before);
    act(() => handle.dispatchEvent(pointer("pointermove", 100)));
    expect([c0.style.width, c1.style.width]).toEqual([`${WS_CONVERSATION_MIN_W}px`, `${1200 - WS_CONVERSATION_MIN_W}px`]);
    act(() => handle.dispatchEvent(pointer("pointermove", 480)));
    act(() => handle.dispatchEvent(pointer("pointerup", 480)));
    expect(shares).toHaveLength(1);
    expect(shares.at(-1)).toBeCloseTo(0.4, 5);
    // Back to what the row rendered (here: the fixed 600 / 600 of this stand-in).
    expect([c0.style.width, c1.style.width]).toEqual(["600px", "600px"]);
    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(shares.at(-1)).toBe(0.5);
    act(() => r2.unmount());
    host2.remove();
  });

  it("2. by content a single column's edge moves alone (docs/design/007: no symmetric exception), the other edge stays; after the release no re-centring; the window resizing keeps its relative place (no re-centring jump)", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const shelfBox = px(q("[data-side-box]"));
    const w = Number(card().dataset.singleW);
    const lead = (1600 - w - shelfBox) / 2;
    const centre = lead + w / 2;
    // The Shelf on its right: that side's gap is the Shelf's seam (no column edge there); its left edge is the column's.
    expect(q('[data-single-edge="right"]')).toBeNull();
    const edge = q('[data-single-edge="left"]')!;
    act(() => edge.dispatchEvent(pointer("pointerdown", 400)));
    act(() => edge.dispatchEvent(pointer("pointermove", 360)));
    // Only the left edge moved 40 px: the right edge (and the Shelf beside it) stayed where it was.
    expect(card().style.width).toBe(`${w + 40}px`);
    expect(q("[data-side-work]")!.style.paddingLeft).toBe(`${Math.round(lead) - 40}px`);
    act(() => edge.dispatchEvent(pointer("pointerup", 360)));
    expect(appearance.getAppearance().singleColumnW).toBe(w + 40);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(Math.round(lead) - 40);
    render(null);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(Math.round(lead) - 40);
    // A while later (past the release's settle) the window resizes: the group keeps its place as a share of the
    // free space (owner 2026-10-21: re-centring here was a jump of up to half the free space for a 1 px resize).
    glide.resetColumnGlide();
    const pinned = Math.round(lead) - 40;
    const total = w + 40 + shelfBox;
    area = 1700;
    act(() => resize!());
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(Math.round((pinned / (1600 - total)) * (1700 - total)));
    area = 1710;
    act(() => resize!());
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(Math.round((pinned / (1600 - total)) * (1710 - total)));
    // Opening / closing a workspace or changing 工作区宽度 still lays it out again, centred (lib/rowDrag resetRowDrag).
    act(() => resetRowDrag());
    expect(q("[data-side-work]")!.dataset.wsLead).toBeUndefined();
    expect(q("[data-side-work]")!.className).toContain("justify-center");
  });

  it("1 + 2. by content a Shelf's edge beside the single column: the column gives exactly what the Shelf takes, nothing moves elsewhere; stored on release", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const w = Number(card().dataset.singleW);
    const box0 = px(q("[data-side-box]"));
    const handle = q('[data-side-box] [role="separator"]')!;
    act(() => handle.dispatchEvent(pointer("pointerdown", 1200)));
    act(() => handle.dispatchEvent(pointer("pointermove", 1100)));
    expect(Number(card().dataset.singleW)).toBe(w - 100);
    expect(px(q("[data-side-box]"))).toBe(box0 + 100);
    act(() => handle.dispatchEvent(pointer("pointerup", 1100)));
    expect(appearance.getAppearance().singleColumnW).toBe(w - 100);
    expect(Number(card().dataset.singleW)).toBe(w - 100);
    // 5. double-click: both back to their defaults.
    act(() => q('[data-side-box] [role="separator"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(appearance.getAppearance().singleColumnW).toBe(0);
    expect(evaShelf().width).toBeUndefined();
  });

  it("1. by content the gap between the single column and its Shelf is the Shelf's seam: the Shelf's far side and the column's far side stay — no jump on press, none past the column's fill snap (owner 2026-10-23)", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    // The Shelf's box as laid out (jsdom has no layout): the seam handle measures it on press.
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-side-box") ? Number.parseFloat(this.style.width) || 0 : 0;
    });
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const w = Number(card().dataset.singleW);
    const box0 = px(q("[data-side-box]"));
    const total = w + box0;
    // The column's own edge is drawn only on its free side: none over the seam (it slid the whole Shelf along).
    expect(q('[data-single-edge="right"]')).toBeNull();
    expect(q('[data-single-edge="left"]')).not.toBeNull();
    const seam = () => q('[data-side-box] [role="separator"]')!;
    act(() => seam().dispatchEvent(pointer("pointerdown", 1200)));
    // 1 px is 1 px: the drag starts from the box as shown (it started 8 px narrow — a jump on press).
    act(() => seam().dispatchEvent(pointer("pointermove", 1199)));
    expect(px(q("[data-side-box]"))).toBe(box0 + 1);
    expect(Number(card().dataset.singleW)).toBe(w - 1);
    // Past the point where the column's width would leave less than FILL_SLACK of its room free: it keeps giving
    // exactly what the Shelf takes — the group keeps its width and stays centred, so neither far side moves.
    const d = 1600 - box0 - w - FILL_SLACK + 20;
    expect(w - d).toBeGreaterThan(SINGLE_MIN_W);
    act(() => seam().dispatchEvent(pointer("pointermove", 1200 - d)));
    expect(px(q("[data-side-box]"))).toBe(box0 + d);
    expect(Number(card().dataset.singleW)).toBe(w - d);
    expect(q("[data-side-work]")!.className).toContain("justify-center");
    expect(Number(card().dataset.singleW) + px(q("[data-side-box]"))).toBe(total);
    // 推挤 (owner 2026-10-23): at its minimum the column slides on into the desktop on its left; the Shelf's far side stays.
    const lead0 = Math.round((1600 - total) / 2);
    act(() => seam().dispatchEvent(pointer("pointermove", 1200 - (w - SINGLE_MIN_W) - 50)));
    expect(Number(card().dataset.singleW)).toBe(SINGLE_MIN_W);
    expect(px(q("[data-side-box]"))).toBe(total - SINGLE_MIN_W + 50);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead0 - 50);
    // No desktop left on that side: the seam stops.
    act(() => seam().dispatchEvent(pointer("pointermove", 0)));
    expect(Number(card().dataset.singleW)).toBe(SINGLE_MIN_W);
    expect(px(q("[data-side-box]"))).toBe(total - SINGLE_MIN_W + lead0);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(0);
    act(() => seam().dispatchEvent(pointer("pointerup", 0)));
    // The release keeps what the drag showed (the group stays where the push left it).
    expect(Number(card().dataset.singleW)).toBe(SINGLE_MIN_W);
    expect(px(q("[data-side-box]"))).toBe(total - SINGLE_MIN_W + lead0);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(0);
    offset.mockRestore();
  });

  it("a collapsed Shelf keeps both conversation edges usable; resizing from the opposite edge keeps the rail in place", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    act(() => updateLayout((l) => collapseShelf(l, evaShelf().id)));
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const rail = () => q('[data-shelf-box="right"]')!;
    const w = Number(card().dataset.singleW);
    const railW = px(rail());
    expect(rail()).not.toBeNull();
    // The rail has no Shelf handle; the conversation supplies its edge at the seam.
    expect(q('[data-single-edge="right"]')).not.toBeNull();
    const edge = q('[data-single-edge="left"]')!;
    const lead = Math.round((1600 - w - railW) / 2);
    // Where the rail starts: the group's lead + the column (the rail is joined to it, in flow right after it).
    const railLeft = () => Number.parseFloat(q("[data-side-work]")!.style.paddingLeft || String(lead)) + Number.parseFloat(card().style.width);
    expect(railLeft()).toBe(lead + w);
    for (const x of [300, 460, 380]) {
      act(() => edge.dispatchEvent(pointer("pointerdown", 400)));
      act(() => edge.dispatchEvent(pointer("pointermove", x)));
      expect(railLeft()).toBe(lead + w);
      act(() => edge.dispatchEvent(pointer("pointerup", x)));
      render(null);
      expect(railLeft()).toBe(lead + w);
    }
    expect(rail().style.marginLeft).toBe("");
  });

  it("2. by content the sidebar's edge moves the row under the group: the group keeps its place on screen, also after the release", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    const w = Number(q('[data-focus-region="main"]')!.dataset.singleW);
    const shelfBox = px(q("[data-side-box]"));
    const lead = Math.round((1600 - w - shelfBox) / 2);
    act(() => glide.resizeDrag(true));
    rowLeft = 40;
    area = 1560;
    act(() => resize!());
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead - 40);
    act(() => glide.resizeDrag(false));
    render(null);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead - 40);
  });

  it("1 + 2. by content beside two workspaces: a Shelf's edge narrows only its own column, the group does not move; kept after the release", () => {
    appearance.setAppearance({ workspaceWidth: "content" }, false);
    area = 2600;
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    expect(widths()).toEqual([770, 770]);
    expect(q("[data-side-work]")!.className).toContain("justify-center");
    act(() => seam().dispatchEvent(pointer("pointerdown", 500)));
    act(() => seam().dispatchEvent(pointer("pointermove", 600)));
    expect(widths()).toEqual([670, 770]);
    // The group's total is the same: still centred exactly where it was (no re-centring step).
    expect(q("[data-side-work]")!.dataset.wsLead).toBeUndefined();
    act(() => seam().dispatchEvent(pointer("pointerup", 600)));
    render({ focused: 0 });
    expect(widths()).toEqual([670, 770]);
    expect(useRowDrag.getState().colW[0]).toBe(670);
  });

  // Two workspaces by content, eva's Shelf expanded on the left, alden's collapsed (its rail on the right).
  const rowTotal = expandedBox(DEFAULT_APPEARANCE.sidePaneWidth) + 770 + CARD_GAP + 770 + COLLAPSED_SHELF_WIDTH;

  it("推挤 (owner 2026-10-23): by content beside two workspaces with no free desktop, the edges outside the row stop — no column narrows", () => {
    appearance.setAppearance({ workspaceWidth: "content" }, false);
    area = rowTotal;
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    expect(widths()).toEqual([770, 770]);
    // The sidebar's edge and the Settings Shelf's: the row has nothing to give them (only the desktop gives).
    expect(rowGive("left")).toBe(0);
    expect(rowGive("right")).toBe(0);
  });

  it("推挤 (owner 2026-10-23): by content the sidebar's edge takes the free desktop on its side, then the group slides into the other side's; the columns keep their widths", () => {
    appearance.setAppearance({ workspaceWidth: "content" }, false);
    area = rowTotal + 50;
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    expect(widths()).toEqual([770, 770]);
    // Both sides' desktop (25 + 25).
    expect(rowGive("left")).toBe(50);
    act(() => glide.resizeDrag(true));
    rowLeft = 40;
    area = rowTotal + 10;
    act(() => resize!());
    // 25 px on the left went first, then the group slid 15 px into the right's: the columns did not change.
    expect(widths()).toEqual([770, 770]);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(0);
    act(() => glide.resizeDrag(false));
    render({ focused: 0 });
    expect(widths()).toEqual([770, 770]);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(0);
  });

  it("推挤 (owner 2026-10-23): two filling workspaces, 永远偏右 — the left workspace's Shelf sits between the columns: its far edge is the handle there; only the Shelf and the right column change (the columns' handle moved the column behind the Shelf)", () => {
    appearance.setAppearance({ wsRailPlacement: "right" }, false);
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const [a, b] = widths();
    const shelf0 = DEFAULT_APPEARANCE.sidePaneWidth;
    const edge = q('[data-shelf-outer-edge="between"]')!;
    expect(edge).not.toBeNull();
    act(() => edge.dispatchEvent(pointer("pointerdown", 1000)));
    act(() => edge.dispatchEvent(pointer("pointermove", 1100)));
    expect(widths()).toEqual([a, b! - 100]);
    expect(px(liveBox())).toBe(expandedBox(shelf0 + 100));
    // The right column's minimum stops it (filling: no desktop to push into); the left column never moves.
    act(() => edge.dispatchEvent(pointer("pointermove", 5000)));
    expect(widths()).toEqual([a, WS_CONVERSATION_MIN_W]);
    act(() => edge.dispatchEvent(pointer("pointerup", 5000)));
    render({ focused: 0 });
    expect(widths()).toEqual([a, WS_CONVERSATION_MIN_W]);
    expect(evaShelf().width).toBe(shelf0 + b! - WS_CONVERSATION_MIN_W);
  });

  it("推挤 (owner 2026-10-23): by content a Shelf dragged past its minimum is pushed into the desktop on its side; the column takes that too, the group's left side stays; kept after the release", () => {
    area = 1600;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-side-box") ? Number.parseFloat(this.style.width) || 0 : 0;
    });
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const w = Number(card().dataset.singleW);
    const box0 = px(q("[data-side-box]"));
    const lead0 = Math.round((1600 - w - box0) / 2);
    const give = DEFAULT_APPEARANCE.sidePaneWidth - appearance.RANGES.sidePaneWidth[0];
    const seam = () => q('[data-side-box] [role="separator"]')!;
    act(() => seam().dispatchEvent(pointer("pointerdown", 1200)));
    // To its minimum: the column takes it all.
    act(() => seam().dispatchEvent(pointer("pointermove", 1200 + give)));
    expect(px(q("[data-side-box]"))).toBe(box0 - give);
    expect(Number(card().dataset.singleW)).toBe(w + give);
    // 30 px on: the Shelf at its minimum slides right into the desktop there, the column takes the 30 px; the left side stays.
    act(() => seam().dispatchEvent(pointer("pointermove", 1200 + give + 30)));
    expect(px(q("[data-side-box]"))).toBe(box0 - give);
    expect(Number(card().dataset.singleW)).toBe(w + give + 30);
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead0);
    // No desktop left on the right: it stops there.
    act(() => seam().dispatchEvent(pointer("pointermove", 5000)));
    expect(Number(card().dataset.singleW)).toBe(1600 - lead0 - (box0 - give));
    act(() => seam().dispatchEvent(pointer("pointerup", 5000)));
    expect(Number(card().dataset.singleW)).toBe(1600 - lead0 - (box0 - give));
    expect(Number(q("[data-side-work]")!.dataset.wsLead)).toBe(lead0);
    expect(useRowDrag.getState().push).toBe(0);
    offset.mockRestore();
  });

  it("a Shelf wider than the range's top (最大化 stores it): a drag toward its column grows it — the column gives down to its minimum —, away shrinks it; the press never snaps it to the range", () => {
    area = 3800;
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    const wide = appearance.RANGES.sidePaneWidth[1] + 400;
    act(() => updateLayout((l) => setShelfWidth(l, evaShelf().id, wide)));
    const offset = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-side-box") ? Number.parseFloat(this.style.width) || 0 : 0;
    });
    render(null);
    const card = () => q('[data-focus-region="main"]')!;
    const w = Number(card().dataset.singleW);
    const box0 = px(q("[data-side-box]"));
    const seam = () => q('[data-side-box] [role="separator"]')!;
    act(() => seam().dispatchEvent(pointer("pointerdown", 2000)));
    expect(px(q("[data-side-box]"))).toBe(box0);
    // Toward the column: the Shelf grows past its start, the column gives.
    act(() => seam().dispatchEvent(pointer("pointermove", 1900)));
    expect(px(q("[data-side-box]"))).toBe(box0 + 100);
    expect(Number(card().dataset.singleW)).toBe(w - 100);
    // Far on: the column stops at its minimum (no desktop on its left here: the group is at the row's left).
    act(() => seam().dispatchEvent(pointer("pointermove", 0)));
    expect(Number(card().dataset.singleW)).toBe(SINGLE_MIN_W);
    // Away from the column: it shrinks.
    act(() => seam().dispatchEvent(pointer("pointermove", 2200)));
    expect(px(q("[data-side-box]"))).toBe(box0 - 200);
    act(() => seam().dispatchEvent(pointer("pointerup", 2200)));
    expect(evaShelf().width).toBe(wide - 200);
    offset.mockRestore();
  });

  it("owner 2026-10-23: a Shelf's outer edge only where free desktop borders it (it overlapped the sidebar's edge and did nothing)", () => {
    appearance.setAppearance({ workspaceWidth: "content" }, false);
    area = rowTotal + 200;
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    expect(q('[data-shelf-outer-edge="left"]')).not.toBeNull();
    area = rowTotal;
    act(() => resize!());
    expect(q("[data-shelf-outer-edge]")).toBeNull();
  });
});

// The owner (2026-10-21): "when the whole WINDOW is resized, panels often fly around". A window resize lays the
// row out in the same frame, folds for lack of room keep a slack (no flapping) and never move frame by frame, and
// the arrow keys follow 宽度规则 1 like a pointer drag.
describe("D. the window resized, keys", () => {
  const seam = () => liveBox()!.querySelector<HTMLElement>('[role="separator"]')!;
  const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  /** The Shelf boxes' width animations (lib/shelfMotion) started since the spy was set. */
  function spyAnimate() {
    const animate = vi.fn((_keyframes: Keyframe[], _options?: unknown) => ({ cancel() {}, onfinish: null, oncancel: null }) as unknown as Animation);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    const widthMoves = () => animate.mock.calls.filter((c) => JSON.stringify(c[0]).includes("width")).length;
    return { animate, widthMoves, restore: () => delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate };
  }

  it("1. arrow keys on a Shelf's edge beside two filling workspaces: only its own column gives way, the other keeps its pixels; stored once the keys rest", () => {
    vi.useFakeTimers();
    try {
      aldenShelf({ collapsed: true });
      twoPanes(0);
      render({ focused: 0 });
      const [a, b] = widths();
      // eva's Shelf is at the left edge: ArrowRight grows it (16 px a step, Shift ×4).
      act(() => void key(seam(), "ArrowRight"));
      expect(widths()).toEqual([a! - 16, b]);
      expect(evaShelf().width).toBeUndefined();
      act(() => void seam().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
      expect(widths()).toEqual([a! - 80, b]);
      act(() => void vi.advanceTimersByTime(glide.KEY_RESIZE_MS + 10));
      render({ focused: 0 });
      // Stored like a release: the Shelf's width and the columns' ratio — the other column still has its pixels.
      expect(evaShelf().width).toBe(DEFAULT_APPEARANCE.sidePaneWidth + 80);
      expect(widths()).toEqual([a! - 80, b]);
      expect(glide.resizing()).toBe(true); // the release's settle
      act(() => void vi.advanceTimersByTime(400));
      render({ focused: 0 });
      expect(widths()).toEqual([a! - 80, b]);
    } finally {
      glide.resetColumnGlide();
      vi.useRealTimers();
    }
  });

  it("1. arrow keys by content beside two workspaces: only the Shelf's own column changes (kept), the group does not move", () => {
    vi.useFakeTimers();
    try {
      appearance.setAppearance({ workspaceWidth: "content" }, false);
      area = 2600;
      aldenShelf({ collapsed: true });
      twoPanes(0);
      render({ focused: 0 });
      expect(widths()).toEqual([770, 770]);
      act(() => void key(seam(), "ArrowRight"));
      expect(widths()).toEqual([754, 770]);
      act(() => void vi.advanceTimersByTime(glide.KEY_RESIZE_MS + 10));
      render({ focused: 0 });
      expect(widths()).toEqual([754, 770]);
      expect(useRowDrag.getState().colW[0]).toBe(754);
      expect(q("[data-side-work]")!.dataset.wsLead).toBeUndefined();
    } finally {
      glide.resetColumnGlide();
      vi.useRealTimers();
    }
  });

  it("a window narrowing below the columns' minimum shows the Shelves as their rails at once (not stored, no width animation); they come back only past the slack", () => {
    const { widthMoves, restore } = spyAnimate();
    try {
      aldenShelf({ collapsed: true });
      twoPanes(0);
      render({ focused: 0 });
      // The threshold: both columns' minimum beside the expanded Shelf, the other's rail and the gap.
      const at = expandedBox(DEFAULT_APPEARANCE.sidePaneWidth) + COLLAPSED_SHELF_WIDTH + CARD_GAP + 2 * WS_CONVERSATION_MIN_W;
      const moves = widthMoves();
      area = at - 1;
      act(() => resize!());
      expect(px(liveBox())).toBe(COLLAPSED_SHELF_WIDTH);
      expect(evaShelf().collapsed).toBeFalsy();
      // Back over the threshold, within the slack: still its rail (no flapping at the edge).
      for (const w of [at, at + 10, at + 1, at + FOLD_HYSTERESIS - 1]) {
        area = w;
        act(() => resize!());
        expect(px(liveBox())).toBe(COLLAPSED_SHELF_WIDTH);
      }
      area = at + FOLD_HYSTERESIS;
      act(() => resize!());
      expect(px(liveBox())).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
      // Nothing moved frame by frame on the way (the columns would have followed every frame).
      expect(widthMoves()).toBe(moves);
      // The owner's own collapse still moves (a discrete change).
      act(() => updateLayout((l) => collapseShelf(l, shelvesOf(l)[0]!.id)));
      expect(widthMoves()).toBe(moves + 1);
    } finally {
      restore();
    }
  });

  it("one workspace: the Shelf becomes a drawer below the threshold and comes back only past the slack", () => {
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    const frame = () => q("[data-side-frame]")!.dataset.sideFrame;
    const at = MIN_CONVERSATION + MIN_SIDE;
    area = at - 1;
    act(() => resize!());
    expect(frame()).toBe("drawer");
    area = at + FOLD_HYSTERESIS - 1;
    act(() => resize!());
    expect(frame()).toBe("drawer");
    area = at + FOLD_HYSTERESIS;
    act(() => resize!());
    expect(frame()).toBe("flow");
    // Going down again it flips at the threshold itself.
    area = at;
    act(() => resize!());
    expect(frame()).toBe("flow");
  });

  it("a window resize is laid out in the same frame: the ResizeObserver's update is flushed synchronously, not painted a frame late", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    g.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      area = 2400;
      // Outside act(): a plain state update would only be scheduled here.
      resize!();
      expect(q("[data-side-work]")!.dataset.wsArea).toBe("2400");
      const [c, d] = widths();
      expect(c! + d!).toBe(2400 - expandedBox(DEFAULT_APPEARANCE.sidePaneWidth) - COLLAPSED_SHELF_WIDTH - CARD_GAP);
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });
});
