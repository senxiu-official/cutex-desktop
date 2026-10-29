// @vitest-environment jsdom
// Always-filled work rows: real side/pane stores with measured window sizes.
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
import { useStrips } from "../src/renderer/src/lib/convStrips";
import { STRIP_W } from "../src/renderer/src/lib/workspaceRow";
import { useFillRatios } from "../src/renderer/src/lib/fillStore";
import { emptyFillRatios, fillColumnCount, fillWidths, parseFillRatios } from "../src/renderer/src/lib/fillLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside, setAllowThreeColumns } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, switchConversation, updateLayout, useConvShelfVersion, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { renumber } from "../src/renderer/src/lib/convShelves";
import { writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import * as glide from "../src/renderer/src/lib/columnGlide";

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
const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 2400;
  useFillRatios.setState({ scopes: {} });
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
  setAllowThreeColumns(false);
  useStrips.setState({strips:{}});
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE, fillMode: true }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  glide.resetColumnGlide();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});


describe("keep maximized", () => {
  it("keeps each column budget when its Shelf closes and restores its ratio", () => {
    aldenShelf(); twoPanes(0); render({ focused: 0 });
    const before = widths();
    const boxes = () => [...container.querySelectorAll<HTMLElement>("[data-fill-shelf]")].map(x => parseFloat(x.style.width));
    const old = boxes();
    expect(old.length).toBe(2);
    const first = evaShelf().id;
    act(() => updateLayout(l => collapseShelf(l, first)));
    expect(widths()[1]).toBeCloseTo(before[1]!);
    expect(widths()[0]! + boxes()[0]!).toBeCloseTo(before[0]! + old[0]!);
    act(() => updateLayout(l => expandShelf(l, first)));
    expect(widths()).toEqual(before);
    expect(boxes()).toEqual(old);
  });
  it("a Shelf divider changes only its conversation and keeps the release geometry", () => {
    aldenShelf(); twoPanes(0); render({ focused: 0 });
    const before = widths();
    const edge = q("[data-fill-edge]")!;
    act(() => edge.dispatchEvent(pointer("pointerdown", 1000)));
    act(() => edge.dispatchEvent(pointer("pointermove", 1060)));
    const during = widths();
    expect(Math.abs(during[0]! - before[0]!)).toBeCloseTo(60);
    expect(during[1]).toBeCloseTo(before[1]!);
    act(() => edge.dispatchEvent(pointer("pointerup", 1060)));
    expect(widths()).toEqual(during);
  });
  it("uses drawers when the saved columns cannot hold an inline Shelf", () => {
    area = 1000; aldenShelf(); twoPanes(0); render({ focused: 0 });
    expect(q("[data-fill-drawer]")).not.toBeNull();
    expect(useSide.getState().narrow).toBe(true);
    expect(widths().reduce((a,b)=>a+b,0)).toBeCloseTo(1000 - 8 - 96);
    const before = widths();
    act(() => q("[data-drawer-scrim]")!.dispatchEvent(pointer("pointerdown", 200)));
    expect(q("[data-fill-drawer]")).toBeNull();
    expect(useSide.getState().layout.open).toBe(false);
    expect(widths()).toEqual(before);
  });
  it("three columns keep the third width when a divider equalizes its adjacent conversations", () => {
    area=2400;
    appearance.setAppearance({ shelfRailAlways: false }, false);
    twoPanes(0);
    act(()=>{useSide.setState({layout:emptyLayout()});setAllowThreeColumns(true);usePanes.setState({layout:openBeside(usePanes.getState().layout,{hostId:"local",sessionId:"third"},3)});});
    render({focused:0});
    const edges=()=>[...container.querySelectorAll<HTMLElement>("[data-fill-edge]")];
    expect(widths()).toHaveLength(3);
    const third=widths()[2];
    const edge=edges()[0]!;
    act(()=>edge.dispatchEvent(pointer("pointerdown",800)));
    act(()=>edge.dispatchEvent(pointer("pointermove",860)));
    act(()=>edge.dispatchEvent(pointer("pointerup",860)));
    expect(widths()[2]).toBeCloseTo(third!);
    expect(widths()[0]).not.toBeCloseTo(widths()[1]!);
    act(()=>edges()[0]!.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})));
    expect(widths()[0]).toBeCloseTo(widths()[1]!);
    expect(widths()[2]).toBeCloseTo(third!);
  });
  it("resizing beside a folded column preserves that position's normal share", () => {
    aldenShelf(); twoPanes(1); render({focused:1});
    const before=widths()[0];
    act(()=>useStrips.setState({strips:{"local|eva":{at:1}}}));
    expect(widths()[0]).toBe(STRIP_W);
    const edge=q("[data-fill-edge]")!;
    act(()=>edge.dispatchEvent(pointer("pointerdown",1000)));
    act(()=>edge.dispatchEvent(pointer("pointermove",1040)));
    act(()=>edge.dispatchEvent(pointer("pointerup",1040)));
    expect(Object.values(useFillRatios.getState().scopes)[0]!.columns).toEqual([.5,.5]);
    act(()=>useStrips.setState({strips:{}}));
    expect(widths()[0]).toBeCloseTo(before!);
  });
  it("focus does not change geometry", () => {
    aldenShelf(); twoPanes(0); render({ focused: 0 });
    const before=widths(); twoPanes(1); render({ focused: 1 });
    expect(widths()).toEqual(before);
  });
});

describe("saved proportions", () => {
  it("gives a fresh column its equal share, then restores the closed position", () => {
    const two = fillColumnCount(emptyFillRatios(), 2);
    expect(two.columns).toEqual([.5,.5]);
    const three = fillColumnCount({ ...two, columns: [.7,.3] },3);
    expect(three.columns[2]).toBeCloseTo(1/3);
    expect(three.columns[0]!/three.columns[1]!).toBeCloseTo(7/3);
    const changed = {...three,columns:[.2,.3,.5]};
    expect(fillColumnCount(fillColumnCount(changed,2),3).columns).toEqual(changed.columns);
  });
  it("conserves width under minimum constraints without mutating saved ratios", () => {
    const weights=[.1,.3,.6];
    expect(fillWidths(1000,weights,[200,200,200])).toEqual([200,800/3,1600/3]);
    expect(fillWidths(300,weights,[200,200,200])).toEqual([100,100,100]);
    expect(weights).toEqual([.1,.3,.6]);
  });
  it("invalid persisted ratios cannot introduce NaN widths", () => {
    const parsed=parseFillRatios({columns:[0,null,Infinity],shelves:[null]});
    expect(parsed.columns).toEqual([1/3,1/3,1/3]);
    expect(parsed.shelves).toEqual([{left:.3,right:.4}]);
  });
});
