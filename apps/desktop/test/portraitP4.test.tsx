// @vitest-environment jsdom
// Portrait P4 (polish; owner 2026-10-30, design .claude/previews/portrait/design.md): the handle between the band's left
// and right Shelf (per window, portrait only — landscape widths never written), a rail folded for lack of room previews
// showing its Shelf (not 「收成 Rail」), the stack's parts gliding on a discrete rearrangement (never on a drag's release,
// a rotation or with reduced motion; rotating back cancels them), the first-use tip on the divider. Harness:
// test/portraitP3.test.tsx (copied).
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
import { bandWeights, clampBand, DEFAULT_PORTRAIT, parsePortrait, resetPortraitForTest, setPortraitPrefs, swapPortrait, usePortrait, useWindowOrientation } from "../src/renderer/src/lib/portrait";
import { noteStackNow, resetStackMotion } from "../src/renderer/src/lib/portraitMotion";
import { useForetellStore } from "../src/renderer/src/lib/foretell";
import { guideById } from "../src/renderer/src/lib/guides";

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

/** The stack's parts as the split / swap place them (992 px for both, the 8 px divider between); the band's boxes 500 + 548. */
beforeEach(() => {
  const zero = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    const { split, swapped } = usePortrait.of(MAIN_WINDOW).getState().prefs;
    const convH = Math.round(992 * split);
    if (this.hasAttribute("data-side-work")) return at(0, 0, area, 1000);
    if (this.dataset.portraitPart === "conversation") return at(0, swapped ? 1000 - convH : 0, area, convH);
    if (this.dataset.portraitPart === "shelf") return at(0, swapped ? 0 : convH + 8, area, 992 - convH);
    if (this.dataset.sideFrame === "portrait") return this.matches("[data-shelf-box=left]") ? at(0, 0, 500, 300) : at(508, 0, 548, 300);
    return zero;
  });
  resetStackMotion();
});
afterEach(() => {
  resetStackMotion();
});

/** Only the stack's glides (lib/portraitMotion): a size eased (min/max height or width) or a 2-D move / move + scale. */
const stackMotions = () =>
  animations.filter((a) => a.frames.some((f) => "minHeight" in f || "transformOrigin" in f || (typeof f.transform === "string" && /^translate\(/.test(f.transform))));
const handle = () => q("[data-portrait-band-handle]")!;
const mouse = (el: Element, type: string, init: MouseEventInit) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })));
const key = (el: Element, k: string, shiftKey = false) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true })));

describe("pure (P4)", () => {
  it("the band's weights: the owner's share, else the landscape widths; a share keeps both Shelves at 360 px", () => {
    expect(bandWeights(undefined, [460, 520])).toEqual([460, 520]);
    expect(bandWeights(0.3, [460, 520])).toEqual([0.3, 0.7]);
    expect(clampBand(0.1, 1048)).toBeCloseTo(360 / 1048, 3);
    expect(clampBand(0.95, 1048)).toBeCloseTo(1 - 360 / 1048, 3);
    expect(clampBand(0.6, 1048)).toBe(0.6);
    expect(clampBand(0.2, 700)).toBe(0.5);
    expect(clampBand(Number.NaN, 1048)).toBe(0.5);
  });

  it("the stored share is read back per window; anything odd is dropped", () => {
    expect(parsePortrait(JSON.stringify({ windows: { main: { split: 0.5, band: 0.3 } } })).windows.main).toEqual({ split: 0.5, swapped: false, sidebarShown: false, band: 0.3 });
    expect(parsePortrait(JSON.stringify({ windows: { main: { split: 0.5, band: 2 } } })).windows.main).toEqual({ split: 0.5, swapped: false, sidebarShown: false });
  });
});

describe("the handle between the band's left and right Shelf (P4)", () => {
  it("a drag sets the left one's share live and stores it per window on release; nothing of landscape is written; back is landscape as before", async () => {
    useSide.setState({ layout: withLeftRight() });
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    expect(handle().getAttribute("role")).toBe("separator");
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-valuenow")).toBe("50");
    const stored = JSON.stringify(useSide.getState().layout);
    const look = JSON.stringify(appearance.getAppearance());
    noteStackNow(stackRoot()!);
    mouse(handle(), "pointerdown", { clientX: 500 });
    expect(handle().hasAttribute("data-dragging")).toBe(true);
    mouse(handle(), "pointermove", { clientX: 600 });
    // (500 + 100) / 1048, live on the boxes' own style.
    expect(box("left").style.flex).toBe("0.573 1 0px");
    expect(box("right").style.flex).toBe("0.427 1 0px");
    mouse(handle(), "pointerup", { clientX: 600 });
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.band).toBe(0.573);
    expect(JSON.parse(localStorage.getItem("cutex-desktop.portrait.v1")!).windows.main.band).toBe(0.573);
    expect(handle().getAttribute("aria-valuenow")).toBe("57");
    expect(box("left").style.flex).toBe("0.573 1 0px");
    // The release only stores what the drag shows: no glide.
    expect(stackMotions()).toEqual([]);
    expect(JSON.stringify(useSide.getState().layout)).toBe(stored);
    expect(JSON.stringify(appearance.getAppearance())).toBe(look);
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
  });

  it("← / → step it (Shift: bigger) within the minimum; a double-click goes back to the landscape widths' ratio", () => {
    useSide.setState({ layout: withLeftRight() });
    render();
    resizeWindow(1080, 1920, 1064);
    const landscapeFlex = box("left").style.flex;
    key(handle(), "ArrowLeft");
    // From the share shown (the landscape widths: even).
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.band).toBe(0.48);
    key(handle(), "ArrowLeft", true);
    key(handle(), "ArrowLeft", true);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.band).toBe(clampBand(0, 1048));
    expect(box("left").style.flex).toBe(`${clampBand(0, 1048)} 1 0px`);
    mouse(handle(), "dblclick", {});
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.band).toBeUndefined();
    expect(box("left").style.flex).toBe(landscapeFlex);
  });

  it("only between two open Shelves (none beside a rail folded for lack of room)", () => {
    useSide.setState({ layout: withLeftRight() });
    render();
    resizeWindow(720, 1280, 704);
    expect(roomRail()).not.toBeNull();
    expect(q("[data-portrait-band-handle]")).toBeNull();
  });
});

describe("a rail folded for lack of room (P3 leftover)", () => {
  it("its avatar previews showing that Shelf, not folding it; an open Shelf's avatar still previews folding", async () => {
    useSide.setState({ layout: withLeftRight() });
    render();
    resizeWindow(720, 1280, 704);
    const hover = async (el: Element) => {
      act(() => void el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
      await act(() => new Promise((r) => setTimeout(r, 200)));
      const text = useForetellStore.getState().shown?.text ?? null;
      act(() => void el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
      return text;
    };
    expect(await hover(roomRail()!.querySelector("[data-shelf-avatar]")!)).toBe("foretell.shelfExpand");
    expect(await hover(box("left").querySelector("[data-shelf-avatar]")!)).toBe("foretell.shelfCollapse");
  });
});

describe("motion (P4)", () => {
  it("a swap slides both parts to their new place; rotating back cancels the glide and lands on landscape as before", async () => {
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    // Rotating into portrait: nothing glides.
    expect(stackMotions()).toEqual([]);
    noteStackNow(stackRoot()!);
    const cancelled: Element[] = [];
    const animate = (HTMLElement.prototype as unknown as { animate: (this: Element, f: Keyframe[]) => Animation }).animate;
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
      const a = animate.call(this, frames);
      const el = this;
      return Object.assign(a, { cancel: () => void cancelled.push(el) });
    };
    act(() => swapPortrait(MAIN_WINDOW));
    const moved = stackMotions();
    expect(moved.map((a) => a.el)).toEqual(expect.arrayContaining([conv(), shelfPart()]));
    // Same sizes, other places: a 2-D move only (nothing scaled, no size held).
    const convH = Math.round(992 * DEFAULT_PORTRAIT.split);
    expect(moved.find((a) => a.el === conv())!.frames).toEqual([{ transform: `translate(0px, ${-(1000 - convH)}px)` }, { transform: "none" }]);
    resizeWindow(1920, 1080, 1600);
    expect(cancelled).toEqual(expect.arrayContaining(moved.map((a) => a.el)));
    act(() => swapPortrait(MAIN_WINDOW));
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
  });

  it("an arrow-key step eases the parts' heights; a drag's release does not glide", () => {
    render();
    resizeWindow(1080, 1920, 1064);
    noteStackNow(stackRoot()!);
    key(divider(), "ArrowDown");
    const eased = stackMotions();
    const from = Math.round(992 * 0.58);
    const to = Math.round(992 * 0.6);
    expect(eased.find((a) => a.el === conv())!.frames).toEqual([
      { minHeight: `${from}px`, maxHeight: `${from}px` },
      { minHeight: `${to}px`, maxHeight: `${to}px` },
    ]);
    animations = [];
    noteStackNow(stackRoot()!);
    pointer(divider(), "pointerdown", 600);
    pointer(divider(), "pointermove", 700);
    pointer(divider(), "pointerup", 700);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).not.toBe(0.6);
    expect(stackMotions()).toEqual([]);
  });

  it("reduced motion: nothing glides", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    render();
    resizeWindow(1080, 1920, 1064);
    noteStackNow(stackRoot()!);
    act(() => swapPortrait(MAIN_WINDOW));
    act(() => setPortraitPrefs(MAIN_WINDOW, { split: 0.4 }));
    expect(stackMotions()).toEqual([]);
  });
});

describe("guides (P4)", () => {
  it("the portrait tip points at the stack's divider", () => {
    render();
    resizeWindow(1080, 1920, 1064);
    const tip = guideById("tip.portrait")!;
    expect(tip.kind).toBe("tip");
    expect(tip.settings).toBe("appearance");
    expect(container.querySelector(tip.anchor!)).toBe(divider());
  });
});

describe("Settings → 外观 (P4)", () => {
  it("shows this window's split and resets it with the band share; the hint says where the sidebar went", async () => {
    const { WorkSurfaceSection } = await import("../src/renderer/src/components/WorkSurfaceSettings");
    act(() => setPortraitPrefs(MAIN_WINDOW, { split: 0.4, band: 0.3 }));
    act(() => root.render(h(WorkSurfaceSection)));
    const value = q("[data-orientation-split]")!;
    expect(value.textContent).toBe("orientation.splitValue");
    expect(container.textContent).toContain("orientation.sidebarNote");
    const reset = value.closest("[data-setting-row], div")!.parentElement!.querySelector<HTMLButtonElement>("button[aria-label='appearance.reset']:not([disabled])");
    expect(reset).not.toBeNull();
    act(() => reset!.click());
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs).toEqual({ split: DEFAULT_PORTRAIT.split, swapped: false, sidebarShown: false });
  });
});
