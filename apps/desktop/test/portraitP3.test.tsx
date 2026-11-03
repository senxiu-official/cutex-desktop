// @vitest-environment jsdom
// Portrait P3 (owner 2026-10-30, design .claude/previews/portrait/design.md decisions 9–11; lib/portrait, components/side/
// SideArea's portrait branch): left + right Shelves side by side in the stack's band while each gets 360 px (else the one in
// focus open, the other its upright rail — a view only, a click there shows it); two workspaces side by side while each
// column gets 520 px (a grid: each its conversation over its own part, one row of dividers), else the P2 strip; a
// conversation maximised beside another workspace: that one a strip across the top. Rotating back lands on the landscape
// row exactly as it was. Harness: test/portraitP2.test.tsx.
import { act, createElement as h, Fragment, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every daemon call answers null (the strip's click selects its agent: the store unsubscribes the previous feed).
const api = vi.hoisted(() => new Proxy({}, { get: (_target, method) => (method === "then" ? undefined : () => Promise.resolve(null)) }));
vi.mock("../src/renderer/src/bridge", () => ({ api, apiFor: () => api, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, moveToNewShelf, place, placeSpec, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside, toggleMaximized, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { useFillRatios } from "../src/renderer/src/lib/fillStore";
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import { useStrips } from "../src/renderer/src/lib/convStrips";
import { resetSettingsShelfForTest } from "../src/renderer/src/lib/settingsShelf";
import * as glide from "../src/renderer/src/lib/columnGlide";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { resetPortraitForTest, stackRows, usePortrait, useWindowOrientation } from "../src/renderer/src/lib/portrait";

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
/** The row's width (clientWidth of [data-side-work]) and the window's box (innerWidth / innerHeight). */
let area = 1600;
/** The stack's own width while it is drawn (the sidebar over it, not beside it: wider than the landscape row). */
let stackArea = 0;
const view = { w: 1920, h: 1080 };
/** Every ResizeObserver made, with what it observes (lib/syncResize makes one per window). */
let observers: { cb: (entries?: unknown) => void; targets: Element[] }[] = [];
let animations: { el: Element; frames: Keyframe[] }[] = [];
const widthMotions = () => animations.filter((a) => a.frames.some((f) => "width" in f || "maxWidth" in f));
let mounts = 0;

const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const stackRoot = () => q("[data-portrait-stack]");
const conv = () => q('[data-portrait-part="conversation"]')!;
const shelfPart = () => q('[data-portrait-part="shelf"]');
const divider = () => q("[data-portrait-divider]")!;

/** The conversation inside the row: counts its mounts (a rotation must never remount the conversations). */
function Probe() {
  useEffect(() => void mounts++, []);
  // What the row tells the columns (two workspaces: the split row's widths; the stack: none).
  const row = useContext(WsRowContext);
  return h("i", { "data-probe": "", "data-row": row ? row.widths.join(",") : "none" });
}
/** PaneHost's part in this test: the window follows its own size (lib/portrait). */
function Win() {
  useWindowOrientation();
  return null;
}
let props: { split: { focused: number } | null; covered: boolean; single: string | null } = { split: null, covered: false, single: "main" };
function render() {
  act(() => root.render(h(Fragment, null, h(Win), h(SideWorkArea, { side: true, ...props, children: h(Probe) }))));
}
function twoPanes(): PaneLayout {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  return focusPane(work, conversationPanes(work)[0]!, 2);
}
/** One resize pass of the window (lib/syncResize: the window's root and the row in one synchronous commit). */
function resizeWindow(w: number, h: number, row: number, stackRow = row) {
  view.w = w;
  view.h = h;
  area = row;
  stackArea = stackRow;
  const o = observers.find((x) => x.targets.includes(document.documentElement));
  act(() => o?.cb());
}
/**
 * The markup with each element's attributes in name order: the row's and the conversation card's elements are kept across
 * a rotation (nothing remounts), so attributes they lost and got back serialize in another order — the same DOM otherwise.
 */
function markup(): string {
  const out = (n: Node): string => {
    if (!(n instanceof Element)) return n.textContent ?? "";
    const tag = n.tagName.toLowerCase();
    const attrs = [...n.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(" ");
    return `<${tag} ${attrs}>${[...n.childNodes].map(out).join("")}</${tag}>`;
  };
  return [...container.childNodes].map(out).join("");
}
/** What must come back unchanged: the markup and the landscape layout state. */
function landscape() {
  const s = useSide.getState();
  const d = useRowDrag.getState();
  return {
    markup: markup(),
    narrow: s.narrow,
    layout: JSON.stringify(s.layout),
    rowDrag: JSON.stringify({ lead: d.lead, leadShare: d.leadShare, colW: d.colW }),
    appearance: JSON.stringify(appearance.getAppearance()),
    sidebarRail: getUiPrefs().sidebarRail,
  };
}
const pointer = (el: Element, type: string, clientY: number) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 })));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 1600;
  stackArea = 0;
  view.w = 1920;
  view.h = 1080;
  observers = [];
  animations = [];
  mounts = 0;
  props = { split: null, covered: false, single: "main" };
  localStorage.clear();
  resetSettingsShelfForTest();
  useStrips.setState({ strips: {} });
  resetPortraitForTest();
  glide.resetColumnGlide();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: { cb: (entries?: unknown) => void; targets: Element[] };
      constructor(cb: (entries?: unknown) => void) {
        this.entry = { cb, targets: [] };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.targets.push(el);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(window, "innerWidth", "get").mockImplementation(() => view.w);
  vi.spyOn(window, "innerHeight", "get").mockImplementation(() => view.h);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-portrait-stack")) return stackArea || area;
    return this.hasAttribute("data-side-work") ? area : 0;
  });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = (top: number, height: number, width = area) => ({ left: 0, top, width, height, right: width, bottom: top + height, x: 0, y: top, toJSON() {} }) as DOMRect;
    if (this.hasAttribute("data-side-work")) return box(0, 1000);
    // The stack's two parts: 600 + 400 px (the divider's drag reads them).
    if (this.dataset.portraitPart === "conversation") return box(0, 600);
    if (this.dataset.portraitPart === "shelf") return box(608, 400);
    return rect.call(this);
  });
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
    animations.push({ el: this, frames });
    return { playState: "running", cancel() {}, finished: new Promise(() => {}), currentTime: 0 } as unknown as Animation;
  };
  (HTMLElement.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  act(() => {
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    switchConversation("local|eva");
  });
  useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  useFillRatios.setState({ scopes: {} });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  glide.resetColumnGlide();
  appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  setUiPref("sideNarrow", "overlay");
  resetPortraitForTest();
});

/** A second tool moved to a left Shelf of its own: left + right Shelves (the left one's page in focus). */
function withLeftRight(): SideLayout {
  const l = withBrowser();
  const input = { kind: "browser.tab" as ItemId, binding: host, key: "left", state: { url: "https://example.org" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  const next = applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
  const id = Object.keys(next.instances).find((k) => !(k in l.instances))!;
  return moveToNewShelf(next, { instance: id }, "left", ++clock);
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));
const band = () => shelfPart()!;
const box = (side: "left" | "right") => band().querySelector<HTMLElement>(side === "right" ? "[data-side-box], [data-shelf-box=right]" : "[data-shelf-box=left]")!;
const roomRail = () => q('[data-portrait-band-rail="room"]');

beforeEach(() => {
  // The stack's height (the columns' divider reads it: its two rows together are this less the divider).
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-portrait-stack") ? 1008 : 0;
  });
});

describe("left + right Shelves in the band (P3)", () => {
  it("side by side when each gets 360 px, each its own box with its Rail across its top; back is landscape as before", async () => {
    useSide.setState({ layout: withLeftRight() });
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    expect(band().getAttribute("style")).toContain("flex: 0.42 1 0px");
    const left = box("left");
    const right = box("right");
    expect(left.hasAttribute("data-portrait-band-rail")).toBe(false);
    expect(right.hasAttribute("data-side-box")).toBe(true);
    expect(left.style.minWidth).toBe("360px");
    expect(right.style.minWidth).toBe("360px");
    // Left first, the handle between them (P4); each a Shelf with its Rail across its top edge (toward the conversation).
    expect([...band().children]).toEqual([left, q("[data-portrait-band-handle]"), right]);
    expect(band().querySelectorAll('[data-shelf-card="rail-top"]').length).toBe(2);
    expect(roomRail()).toBeNull();
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
  });

  it("narrow (720 × 1280): the one in focus open, the other its upright rail — a view only; a click on that rail shows it instead", () => {
    useSide.setState({ layout: withLeftRight() });
    const stored = JSON.stringify(useSide.getState().layout);
    render();
    resizeWindow(720, 1280, 704);
    // The left Shelf's page is in focus: it is open, the right one its rail at the band's right.
    expect(box("left").hasAttribute("data-portrait-band-rail")).toBe(false);
    const rail = roomRail()!;
    expect(rail.dataset.shelfBox).toBe("right");
    expect(rail.style.width).toBe("40px");
    expect(rail.querySelector('[data-shelf-card="rail-right"], [data-shelf-collapsed]')).not.toBeNull();
    expect(JSON.stringify(useSide.getState().layout)).toBe(stored);
    // Its avatar (the collapse toggle of an expanded Shelf) shows it — never collapses it.
    act(() => rail.querySelector<HTMLElement>("[data-shelf-avatar]")!.click());
    const layout = useSide.getState().layout;
    expect(shelvesOf(layout).every((s) => !s.collapsed)).toBe(true);
    expect(roomRail()!.dataset.shelfBox).toBe("left");
    expect(box("right").hasAttribute("data-portrait-band-rail")).toBe(false);
    // Wide again: both open.
    resizeWindow(1080, 1920, 1064);
    expect(roomRail()).toBeNull();
  });
});

describe("two workspaces side by side (P3)", () => {
  it("with the room: a grid — each column its conversation over its own part, the rows from the split; a drag moves both columns' rows; swapped; back is the split row as before", async () => {
    act(() => usePanes.setState({ layout: twoPanes() }));
    props = { split: { focused: 0 }, covered: false, single: null };
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    const stack = stackRoot()!;
    expect(usePortrait.of(MAIN_WINDOW).getState().columns).toBe(true);
    expect(stack.hasAttribute("data-portrait-cols")).toBe(true);
    expect(stack.dataset.portraitC0).toBe("shelf");
    // Alden's conversation has no Shelf: its empty rail (Shelf Rail 常驻) at the column's end.
    expect(stack.dataset.portraitC1).toBe("bar");
    expect(stack.style.getPropertyValue("--stack-rows")).toBe(stackRows(0.58, false));
    expect(q("[data-probe]")!.dataset.row).toBe("none");
    expect(divider().style.gridColumn).toBe("1");
    expect(divider().style.gridRow).toBe("2");
    expect(band().style.gridColumn).toBe("1");
    expect(band().style.gridRow).toBe("3");
    const bar = q('[data-portrait-part="rails"]')!;
    expect(bar.style.gridColumn).toBe("2");
    expect(bar.style.alignSelf).toBe("end");
    expect(bar.querySelector("[data-shelf-rail-empty]")).not.toBeNull();
    // The divider: the rows follow live, the split is stored on release.
    pointer(divider(), "pointerdown", 600);
    pointer(divider(), "pointermove", 500);
    expect(stack.style.getPropertyValue("--stack-rows")).toBe(stackRows(0.48, false));
    pointer(divider(), "pointerup", 500);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.48);
    expect(stack.style.getPropertyValue("--stack-rows")).toBe(stackRows(0.48, false));
    act(() => void divider().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.58);
    // Swapped: the parts on top, the conversations under them.
    act(() => q("[data-portrait-swap]")!.click());
    expect(stack.hasAttribute("data-portrait-swapped")).toBe(true);
    expect(band().style.gridRow).toBe("1");
    expect(q('[data-portrait-part="rails"]')!.style.alignSelf).toBe("start");
    expect(stack.style.getPropertyValue("--stack-rows")).toBe(stackRows(0.58, true));
    act(() => q("[data-portrait-swap]")!.click());
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(stackRoot()).toBeNull();
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
    expect(useStrips.getState().strips).toEqual({});
  });

  it("without the room (each column under 520 px) the other one is the strip; side by side again only past the slack", () => {
    act(() => usePanes.setState({ layout: twoPanes() }));
    props = { split: { focused: 0 }, covered: false, single: null };
    render();
    resizeWindow(900, 1920, 884);
    expect(stackRoot()!.hasAttribute("data-portrait-cols")).toBe(false);
    expect(stackRoot()!.hasAttribute("data-portrait-split")).toBe(true);
    expect(usePortrait.of(MAIN_WINDOW).getState().columns).toBe(false);
    resizeWindow(1062, 1920, 1046);
    expect(stackRoot()!.hasAttribute("data-portrait-cols")).toBe(false);
    resizeWindow(1080, 1920, 1064);
    expect(stackRoot()!.hasAttribute("data-portrait-cols")).toBe(true);
    // Kept down to 1032 px…
    resizeWindow(1050, 1920, 1034);
    expect(stackRoot()!.hasAttribute("data-portrait-cols")).toBe(true);
    // …then the strip again (its variables back, the grid's gone).
    resizeWindow(1040, 1920, 1024);
    expect(stackRoot()!.hasAttribute("data-portrait-cols")).toBe(false);
    expect(stackRoot()!.style.getPropertyValue("--stack-rows")).toBe("");
    expect(stackRoot()!.style.getPropertyValue("--stack-conv-flex")).toBe("0.58 1 0px");
  });
});

describe("a conversation maximised beside another workspace (P2 leftover)", () => {
  it("the other workspace is a strip across the stack's top (a click focuses it); landscape keeps its rail", async () => {
    const two = twoPanes();
    const [first, second] = conversationPanes(two) as [string, string];
    act(() => usePanes.setState({ layout: toggleMaximized(two, first) }));
    props = { split: null, covered: true, single: null };
    render();
    await settle();
    const before = landscape();
    expect(q("[data-ws-strip]")).not.toBeNull();
    resizeWindow(1080, 1920, 1064);
    const strip = q("[data-portrait-other]")!;
    expect(strip.dataset.portraitOther).toBe(second);
    expect(strip.dataset.portraitPart).toBe("strip");
    expect(strip.style.height).toBe("40px");
    expect(strip.style.order).toBe("-1");
    expect(q("[data-ws-strip]")).toBeNull();
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(q("[data-portrait-other]")).toBeNull();
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
    resizeWindow(1080, 1920, 1064);
    act(() => q("[data-portrait-other] [data-conv-strip-button]")!.click());
    // It focuses that pane (lib/paneActions then puts the maximised one back: the focus left it).
    expect(usePanes.getState().layout.focus).toBe(second);
  });
});
