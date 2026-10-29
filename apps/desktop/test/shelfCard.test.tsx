// @vitest-environment jsdom
// Design 009 (one Shelf card: the Shelf Rail is its tab strip; collapsed = the same card narrowed; 「Rail 直角」
// dev flag) and design 011 (a page newly opened in a Shelf narrower than 640 px widens it once, as a drag of its
// edge: only its own column gives way, stopping at that column's minimum; never narrows).
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
import { applyOpen, CARD_GAP, COLLAPSED_SHELF_WIDTH, collapseShelf, emptyLayout, expandShelf, MIN_CONVERSATION, MIN_SIDE, place, placeSpec, setShelfWidth, SHELF_PANE_GAP, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
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
const { RowSplitter } = await import("../src/renderer/src/components/PaneResizer");
const { rowGive, widenShelf } = await import("../src/renderer/src/lib/sideResize");
const { PAGE_SHELF_WIDTH } = await import("../src/renderer/src/lib/pageShelfWidth");
const corners = await import("../src/renderer/src/lib/shelfCorners");
void rowGive;

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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");

describe("009: a Shelf is one card", () => {
  // Rail look A (owner 2026-10-23): expanded, the box is no card — the rail is a card of its own, each pane one too.
  it("expanded: the rail a card of its own beside the page, each pane a card, the box itself no card", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const cards = liveBox()!.querySelectorAll<HTMLElement>(".shelf-card");
    expect(cards.length).toBe(1);
    const card = cards[0]!;
    expect(card.classList.contains("shell-card")).toBe(false);
    const rail = card.querySelector<HTMLElement>("nav[data-shelf-rail]")!;
    const body = card.querySelector<HTMLElement>("[data-shelf-body]")!;
    expect(rail).toBeTruthy();
    expect(body).toBeTruthy();
    expect(rail.className).toContain("shelf-rail-card");
    // eva's Shelf is at the window's left edge, its rail outer (= left): its panes attach on their left side.
    expect(card.dataset.shelfCard).toBe("rail-left");
    expect(body.className).not.toContain("border");
  });

  it("collapsed: the same card narrowed to the rail (no page), marked collapsed for the corner styles", () => {
    aldenShelf({ collapsed: true });
    twoPanes(0);
    render({ focused: 0 });
    const card = dormant()!.querySelector<HTMLElement>(".shelf-card")!;
    expect(card.hasAttribute("data-shelf-collapsed")).toBe(true);
    expect(card.querySelector("nav[data-shelf-rail]")).toBeTruthy();
    expect(card.querySelector("[data-shelf-body]")).toBeNull();
    expect(px(dormant())).toBe(COLLAPSED_SHELF_WIDTH);
  });

  it("the stand-alone rails (empty Shelf, the other workspace's) are collapsed Shelf cards too", () => {
    expect(read("components/side/ShelfRail.tsx")).toMatch(/data-shelf-collapsed="" className="shelf-card /);
    expect(read("components/side/WorkspaceRail.tsx")).toMatch(/data-shelf-collapsed=""\n\s*className=\{`shelf-card /);
  });

  it("shelfCard.css (Rail look A): rail card square on the page side, panes square and borderless on the rail side, a see-through standard gap", () => {
    const css = read("components/side/shelfCard.css");
    expect(css).toMatch(/\.shelf-card\[data-shelf-card="rail-left"\]:not\(\[data-shelf-collapsed\]\) > \[data-shelf-rail\] \{\s*border-top-right-radius: 0;\s*border-bottom-right-radius: 0;/);
    expect(css).toMatch(/\.shelf-card\[data-shelf-card="rail-left"\] \[data-shelf-body\] \.shell-card \{\s*border-left: 0;\s*border-top-left-radius: 0;\s*border-bottom-left-radius: 0;/);
    expect(css).toMatch(/\.shelf-card\[data-shelf-card="rail-right"\] \[data-shelf-body\] \.shell-card \{\s*border-right: 0;\s*border-top-right-radius: 0;\s*border-bottom-right-radius: 0;/);
    expect(css).toMatch(/\.shelf-card \[data-side-gap\] \{[^}]*background: transparent;/);
    // The panes keep their own material (they used to go transparent inside the one card).
    expect(css).not.toMatch(/\.shell-card \{[^}]*background: transparent;/);
    expect(css).toMatch(/:root\[data-shelf-corners="square"\] \.shelf-card\[data-shelf-collapsed\] \{\s*border-radius: 0;/);
    // The standard gap between two panes (owner 2026-10-23: with a 1 px line a terminal under a web page read as laid over it).
    expect(SHELF_PANE_GAP).toBe(CARD_GAP);
    expect(read("components/side/SidePageView.tsx")).toContain("SHELF_PANE_GAP");
  });

  it("the pane heights leave only the lines between them (cardHeights' gap)", async () => {
    const { cardHeights } = await import("../src/renderer/src/lib/sideLayout");
    const two = [{ size: 1, collapsed: false }, { size: 1, collapsed: false }];
    expect(cardHeights(two, 601, 1).map((b) => b.height)).toEqual([300, 300]);
    expect(cardHeights(two, 608).map((b) => b.height)).toEqual([300, 300]);
  });
});

describe("009: 「Rail 直角」 dev flag", () => {
  it("URL first, then storage, then round", () => {
    expect(corners.readShelfCorners("?shelfcorners=square", "round")).toBe("square");
    expect(corners.readShelfCorners("", "square")).toBe("square");
    expect(corners.readShelfCorners("?shelfcorners=bogus", "nope")).toBe("round");
    expect(corners.DEFAULT_SHELF_CORNERS).toBe("round");
  });
  it("applied on <html>", () => {
    localStorage.setItem(corners.SHELF_CORNERS_KEY, "square");
    const el = document.createElement("html");
    expect(corners.applyShelfCorners(el)).toBe("square");
    expect(el.dataset.shelfCorners).toBe("square");
    localStorage.removeItem(corners.SHELF_CORNERS_KEY);
    expect(corners.applyShelfCorners(el)).toBe("round");
  });
});

describe("011: a page widens its Shelf to 640 once", () => {
  // As its edge's handle: the side it is drawn on (eva's, beside two workspaces 外侧 = the left edge).
  const drawn = () => liveBox()!.querySelector<HTMLElement>("[data-shelf]")!.dataset.shelfAt as "left" | "right";
  it("narrower: widened as a drag of its edge — only its own column gives way; stored once the session rests", () => {
    vi.useFakeTimers();
    try {
      aldenShelf({ collapsed: true });
      twoPanes(0);
      render({ focused: 0 });
      const [a, b] = widths();
      const shelf = evaShelf();
      let got: number | null = null;
      act(() => void (got = widenShelf({ shelfId: shelf.id, side: drawn() }, PAGE_SHELF_WIDTH)));
      expect(got).toBe(PAGE_SHELF_WIDTH);
      const grow = PAGE_SHELF_WIDTH - DEFAULT_APPEARANCE.sidePaneWidth;
      expect(widths()).toEqual([a! - grow, b]);
      act(() => void vi.advanceTimersByTime(glide.KEY_RESIZE_MS + 10));
      render({ focused: 0 });
      expect(evaShelf().width).toBe(PAGE_SHELF_WIDTH);
      expect(widths()).toEqual([a! - grow, b]);
    } finally {
      glide.resetColumnGlide();
      vi.useRealTimers();
    }
  });

  it("not enough room: stops where dragging its edge stops (its column's minimum; never pushes the other column)", () => {
    vi.useFakeTimers();
    try {
      area = 1500;
      aldenShelf({ collapsed: true });
      twoPanes(0);
      render({ focused: 0 });
      const [, b] = widths();
      const shelf = evaShelf();
      act(() => void widenShelf({ shelfId: shelf.id, side: drawn() }, PAGE_SHELF_WIDTH));
      act(() => void vi.advanceTimersByTime(glide.KEY_RESIZE_MS + 10));
      render({ focused: 0 });
      const w = evaShelf().width!;
      expect(w).toBeLessThan(PAGE_SHELF_WIDTH);
      expect(w).toBeGreaterThan(DEFAULT_APPEARANCE.sidePaneWidth);
      // The same limit as dragging that edge (lib/sideResize setRowHooks shelfMax): its column keeps at least its minimum.
      expect(widths()[0]).toBe(WS_CONVERSATION_MIN_W);
      expect(widths()[1]).toBe(b);
    } finally {
      glide.resetColumnGlide();
      vi.useRealTimers();
    }
  });

  it("already as wide or wider: nothing changes", () => {
    act(() => updateLayout((l) => setShelfWidth(l, shelvesOf(l)[0]!.id, 700)));
    const shelf = evaShelf();
    expect(widenShelf({ shelfId: shelf.id, side: shelf.side }, PAGE_SHELF_WIDTH)).toBeNull();
    expect(evaShelf().width).toBe(700);
    expect(widenShelf({ shelfId: "nope", side: "right" }, PAGE_SHELF_WIDTH)).toBeNull();
  });

  it("only a page newly placed in the Shelf (lib/paneServices openPageInShelf), not one shown again", () => {
    expect(read("lib/paneServices.ts")).toMatch(/if \(!r\.reused\) widenForPage\(r\.instanceId\);/);
  });
});

describe("#16: 编辑主页 is a card of the work row", () => {
  it("the .shell-card look with a card header (h-10, hairline, title, ×)", () => {
    const src = read("modules/home/Desktop.tsx");
    expect(src).toMatch(/<aside className="shell-card absolute isolate flex flex-col overflow-hidden"/);
    expect(src).toMatch(/data-home-edithead=""/);
    expect(src).not.toContain("rounded-[16px] border border-border bg-background/95");
  });
});
