// @vitest-environment jsdom
// Shelf Rail page buttons drag their page (owner report 2026-10-22: "page buttons can no longer be dragged" — they
// never could since the Shelves came, 741f5a34; the step-3 page drag went in bb63923b): pointerdown + a move past the
// threshold starts a page drag; a drop on another page button of the same rail reorders it, on the other Shelf's
// button / ＋ moves the page there; a short press stays a click. And (owner 2026-10-22) a click on the page already
// shown leaves the Shelf as it is (it used to collapse it).
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
import { addShelfPage, findPage, moveToNewShelf, movePageTo, MAX_SHELF_PAGES, railPageClick, shelfOnSide, switchPage, applyOpen, CARD_GAP, COLLAPSED_SHELF_WIDTH, collapseShelf, emptyLayout, expandShelf, MIN_CONVERSATION, MIN_SIDE, place, placeSpec, setShelfWidth, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
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
import * as glide from "../src/renderer/src/lib/columnGlide";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { useSideDnd, cancelSideDrag } = await import("../src/renderer/src/lib/sideDnd");

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


// ── The scene: a left Shelf (the browser page) and a right Shelf (two kept pages) ──────────────

function twoShelves(): { left: string; right: string; browser: string; r1: string; r2: string } {
  let l = withBrowser(emptyLayout());
  const right0 = shelvesOf(l)[0]!.id;
  const a = addShelfPage(l, right0, { name: "A" });
  l = a.layout;
  const b = addShelfPage(l, right0, { name: "B" });
  l = b.layout;
  const browser = Object.keys(l.instances)[0]!;
  l = moveToNewShelf(l, { instance: browser }, "left", ++clock);
  l = switchPage(l, a.pageId!);
  act(() => useSide.setState({ layout: l }));
  const left = shelfOnSide(l, "left")!.id;
  const right = shelfOnSide(l, "right")!.id;
  return { left, right, browser: l.pages.find((p) => p.shelf === left)!.id, r1: a.pageId!, r2: b.pageId! };
}

const rail = (shelfId: string) => [...q(`[data-shelf-rail="${shelfId}"]`)!.querySelectorAll<HTMLElement>("[data-shelf-page]")].map((b) => b.dataset.shelfPage);
const button = (pageId: string) => q(`[data-shelf-page="${pageId}"]`)!;
const evt = (type: string, x: number, y: number, buttons = 1) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });

/** Every page button is 30 px tall at y = 100 (top half: y < 115); the probe's topmost element = `under`. */
let under: Element | null = null;
function stubGeometry() {
  const base = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-shelf-page") || this.hasAttribute("data-shelf-add")) return { left: 10, top: 100, width: 34, height: 30, right: 44, bottom: 130, x: 10, y: 100, toJSON() {} } as DOMRect;
    return base.call(this);
  });
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => (under ? [under] : []);
}

/** Press on page `from`'s button, move over `to` (an element), at y; returns the drag state mid-way. */
function dragPage(from: string, to: Element, y: number) {
  under = button(from);
  act(() => void button(from).dispatchEvent(evt("pointerdown", 20, 110)));
  under = to;
  act(() => void window.dispatchEvent(evt("pointermove", 30, y)));
  return useSideDnd.getState();
}
function drop(y: number) {
  act(() => void window.dispatchEvent(evt("pointerup", 30, y, 0)));
}

describe("Shelf Rail page buttons drag their page", () => {
  afterEach(() => {
    act(() => cancelSideDrag());
    under = null;
  });

  it("pointerdown + a move past the threshold starts a page drag (with its ghost)", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    expect(rail(s.right)).toEqual([s.r1, s.r2]);
    const st = dragPage(s.r1, button(s.r2), 125);
    expect(st.drag).toEqual({ type: "page", pageId: s.r1 });
    expect(st.ghost).not.toBeNull();
    expect(document.documentElement.dataset.sideDragging).toBe("page");
  });

  it("a short press stays a click (no drag)", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    under = button(s.r2);
    act(() => void button(s.r2).dispatchEvent(evt("pointerdown", 20, 110)));
    act(() => void window.dispatchEvent(evt("pointermove", 21, 111)));
    expect(useSideDnd.getState().drag).toBeNull();
    act(() => void window.dispatchEvent(evt("pointerup", 21, 111, 0)));
  });

  it("dropped on the bottom half of the next page button: the rail order changes, what shows stays", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    const st = dragPage(s.r1, button(s.r2), 125);
    expect(st.target).toEqual({ kind: "movePage", pageId: s.r1, shelfId: s.right, before: null });
    drop(125);
    render(null);
    expect(rail(s.right)).toEqual([s.r2, s.r1]);
    expect(shelfOnSide(useSide.getState().layout, "right")!.active).toBe(s.r1);
    expect(shelfOnSide(useSide.getState().layout, "right")!.collapsed).toBeUndefined();
  });

  it("dropped on its own button: nothing (原位置)", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    const before = useSide.getState().layout;
    const st = dragPage(s.r1, button(s.r1), 125);
    expect(st.target).toEqual({ kind: "noop", why: "origin" });
    drop(125);
    expect(useSide.getState().layout).toBe(before);
  });

  it("dropped on the other Shelf's page button: the page moves there (before it, top half) and shows there", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    const st = dragPage(s.r2, button(s.browser), 105);
    expect(st.target).toEqual({ kind: "movePage", pageId: s.r2, shelfId: s.left, before: s.browser });
    drop(105);
    render(null);
    expect(rail(s.left)).toEqual([s.r2, s.browser]);
    expect(rail(s.right)).toEqual([s.r1]);
    expect(shelfOnSide(useSide.getState().layout, "left")!.active).toBe(s.r2);
  });

  it("dropped on the other Shelf's ＋: at the end of that rail", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    const add = q(`[data-shelf-add="${s.left}"]`)!;
    const st = dragPage(s.r1, add, 110);
    expect(st.target).toEqual({ kind: "movePage", pageId: s.r1, shelfId: s.left, before: null });
    drop(110);
    render(null);
    expect(rail(s.left)).toEqual([s.browser, s.r1]);
  });

  it("over a pane: no target (a page goes into a rail only)", () => {
    stubGeometry();
    const s = twoShelves();
    render(null);
    const st = dragPage(s.r1, q("[data-side-work]")!, 400);
    expect(st.target).toBeNull();
  });
});

describe("movePageTo (pure)", () => {
  it("moves within a rail and across; refuses a full Shelf; the last page leaving a Shelf takes it away", () => {
    const s = twoShelves();
    const l = useSide.getState().layout;
    expect(movePageTo(l, s.r1, s.right, s.r1)).toBe(l);
    expect(movePageTo(l, s.r2, s.right, null)).toBe(l); // already last
    const moved = movePageTo(l, s.browser, s.right, s.r2);
    expect(shelvesOf(moved).map((x) => x.id)).toEqual([s.right]);
    expect(moved.pages.filter((p) => p.shelf === s.right).map((p) => p.id)).toEqual([s.r1, s.browser, s.r2]);
    expect(findPage(moved, s.browser)!.cards.length).toBe(1);
    let full = l;
    while (full.pages.filter((p) => p.shelf === s.right).length < MAX_SHELF_PAGES) full = addShelfPage(full, s.right).layout;
    expect(movePageTo(full, s.browser, s.right, null)).toBe(full);
  });
});

describe("a click on the page already shown (owner 2026-10-22)", () => {
  it("keeps the Shelf expanded — once, twice, and the double-click", () => {
    const s = twoShelves();
    render(null);
    act(() => void button(s.r1).click());
    act(() => void button(s.r1).click());
    act(() => void button(s.r1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const right = shelfOnSide(useSide.getState().layout, "right")!;
    expect(right.collapsed).toBeUndefined();
    expect(right.active).toBe(s.r1);
    expect(q(`[data-shelf="${s.right}"]`)!.hasAttribute("data-shelf-collapsed")).toBe(false);
    // Another page still comes into view; the avatar (the Shelf's toggle) still collapses.
    act(() => void button(s.r2).click());
    expect(shelfOnSide(useSide.getState().layout, "right")!.active).toBe(s.r2);
    act(() => void q(`[data-shelf-avatar="${s.right}"]`)!.click());
    expect(shelfOnSide(useSide.getState().layout, "right")!.collapsed).toBe(true);
    expect(railPageClick(useSide.getState().layout, s.r2).pages).toBeDefined();
  });
});
