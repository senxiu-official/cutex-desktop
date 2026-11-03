// @vitest-environment jsdom
// Portrait P1 (owner 2026-10-30, design .claude/previews/portrait/design.md; lib/portrait, components/side/SideArea's
// portrait branch): a tall window draws the work row as a stack — the conversation on top, the divider, its Shelf with the
// Rail across the Shelf's top edge — or swapped; the divider sets the split (per window), ⇅ / the ⋯ menu swap; no Shelf:
// the empty Rail as a 40 px bar; 最大化保持 is ignored there. Rotating back lands on the landscape row exactly as it was:
// the same markup, nothing remounted, nothing glided, nothing of the landscape layout written meanwhile, and no commit ever
// laid the landscape row out at the stack's width. Harness: test/unmaximizeJump.test.tsx.
import { act, createElement as h, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, collapseShelf, emptyLayout, place, placeSpec, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { useFillRatios } from "../src/renderer/src/lib/fillStore";
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import { shelfMenu } from "../src/renderer/src/lib/shelfMenus";
import * as glide from "../src/renderer/src/lib/columnGlide";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { DEFAULT_PORTRAIT, PORTRAIT_KEY, resetPortraitForTest, STACK_CONVERSATION_MIN, usePortrait, useWindowOrientation } from "../src/renderer/src/lib/portrait";

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
  return h("i", { "data-probe": "" });
}
/** PaneHost's part in this test: the window follows its own size (lib/portrait). */
function Win() {
  useWindowOrientation();
  return null;
}
function render() {
  act(() => root.render(h(Fragment, null, h(Win), h(SideWorkArea, { side: true, split: null, single: "main", children: h(Probe) }))));
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
  localStorage.clear();
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
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
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

describe("the stack", () => {
  it("a tall window: the conversation on top, the divider, its Shelf with the Rail across the Shelf's top; no width handles", () => {
    render();
    expect(stackRoot()).toBeNull();
    resizeWindow(1080, 1920, 1064);
    expect(stackRoot()).not.toBeNull();
    expect(conv().style.flex).toBe(`${DEFAULT_PORTRAIT.split} 1 0px`);
    expect(conv().style.order).toBe("0");
    // Above its Shelf the conversation leaves no tray room (the Shelf at the stack's bottom does, components/tray.css).
    expect(conv().style.marginBottom).toBe("0px");
    expect(conv().style.minHeight).toBe(`${STACK_CONVERSATION_MIN}px`);
    expect(divider().style.order).toBe("1");
    expect(shelfPart()!.style.order).toBe("2");
    expect(shelfPart()!.style.marginBottom).toBe("");
    expect(q('[data-portrait-part="shelf"] [data-shelf-card="rail-top"]')).not.toBeNull();
    expect(q("[data-shelf-rail]")!.dataset.shelfRailEdge).toBe("top");
    expect(q("[data-shelf-rail]")!.className).toContain("flex-row");
    expect(q("[data-single-edge], .side-handle-v")).toBeNull();
    // The conversation was not remounted by the flip.
    expect(mounts).toBe(1);
  });

  it("the window's setting: always landscape keeps a tall window landscape (unchanged), always portrait stacks a wide one", async () => {
    const { setOrientationSetting } = await import("../src/renderer/src/lib/portrait");
    render();
    const before = landscape();
    act(() => setOrientationSetting("landscape"));
    resizeWindow(1080, 1920, 1600);
    expect(stackRoot()).toBeNull();
    expect(landscape().markup).toBe(before.markup);
    act(() => setOrientationSetting("portrait"));
    expect(stackRoot()).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(PORTRAIT_KEY)!).setting).toBe("portrait");
  });

  it("the divider: a drag sets the share (live, then stored for this window), clamped at the minimums; double-click resets; ↑ / ↓ step", () => {
    render();
    resizeWindow(1080, 1920, 1064);
    pointer(divider(), "pointerdown", 604);
    pointer(divider(), "pointermove", 404);
    // 600 − 200 of 1000 px.
    expect(conv().style.flex).toBe("0.4 1 0px");
    expect(shelfPart()!.style.flex).toBe("0.6 1 0px");
    pointer(divider(), "pointerup", 404);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.4);
    expect(JSON.parse(localStorage.getItem(PORTRAIT_KEY)!).windows.main.split).toBe(0.4);
    // Far up: the conversation keeps its minimum (280 of 1000 px).
    pointer(divider(), "pointerdown", 604);
    pointer(divider(), "pointermove", 0);
    pointer(divider(), "pointerup", 0);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.28);
    act(() => void divider().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(DEFAULT_PORTRAIT.split);
    act(() => void divider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.56);
    act(() => void divider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true })));
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.66);
  });

  it("⇅ swaps: the Shelf on top with its Rail on its bottom edge, the conversation last (it keeps the tray room); a drag follows", () => {
    render();
    resizeWindow(1080, 1920, 1064);
    act(() => q("[data-portrait-swap]")!.click());
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.swapped).toBe(true);
    expect(stackRoot()!.hasAttribute("data-portrait-swapped")).toBe(true);
    expect(conv().style.order).toBe("2");
    expect(conv().style.marginBottom).toBe("");
    expect(shelfPart()!.style.order).toBe("0");
    // (The band's Shelf boxes keep the tray room, P3: at the top, none.)
    expect(shelfPart()!.querySelector<HTMLElement>("[data-side-box]")!.style.marginBottom).toBe("0px");
    expect(q('[data-shelf-card="rail-bottom"]')).not.toBeNull();
    expect(q("[data-shelf-rail]")!.dataset.shelfRailEdge).toBe("bottom");
    // Swapped, dragging the divider down shrinks the conversation below it.
    pointer(divider(), "pointerdown", 404);
    pointer(divider(), "pointermove", 504);
    pointer(divider(), "pointerup", 504);
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.split).toBe(0.5);
    // Nothing remounted by the swap (the parts are placed by `order`).
    expect(mounts).toBe(1);
  });

  it("the Shelf's ⋯ menu offers the swap in portrait only", () => {
    render();
    const id = shelvesOf(useSide.getState().layout)[0]!.id;
    const labelOf = (e: unknown): string => (e && typeof e === "object" && "label" in e ? String((e as { label: unknown }).label) : "");
    const labels = () => shelfMenu(id).map(labelOf);
    expect(labels()).not.toContain("orientation.shelfOnTop");
    resizeWindow(1080, 1920, 1064);
    expect(labels()).toContain("orientation.shelfOnTop");
    const entry = shelfMenu(id).find((e) => labelOf(e) === "orientation.shelfOnTop") as unknown as { onSelect(): void };
    act(() => entry.onSelect());
    expect(usePortrait.of(MAIN_WINDOW).getState().prefs.swapped).toBe(true);
    expect(labels()).toContain("orientation.convOnTop");
  });

  it("no Shelf: the conversation takes the stack, the empty Rail a 40 px bar at its end; a folded Shelf: its rail as that bar", () => {
    useSide.setState({ layout: emptyLayout() });
    render();
    resizeWindow(1080, 1920, 1064);
    expect(conv().style.flex).toBe("1 1 0px");
    expect(divider()).toBeNull();
    const empty = q("[data-shelf-rail-empty]")!;
    expect(empty.style.height).toBe("40px");
    expect(empty.querySelector("nav")!.dataset.shelfRailEdge).toBe("top");
    act(() => {
      const l = withBrowser();
      useSide.setState({ layout: collapseShelf(l, shelvesOf(l)[0]!.id) });
    });
    expect(q("[data-shelf-rail-empty]")).toBeNull();
    const rail = q('[data-portrait-part="rail"]')!;
    expect(rail.style.height).toBe("40px");
    expect(rail.querySelector("[data-shelf-rail]")!.hasAttribute("data-shelf-rail-collapsed")).toBe(true);
    expect(rail.querySelector("[data-shelf-rail]")!.className).toContain("flex-row");
  });

  it("最大化保持 is ignored in portrait (its value kept for landscape)", () => {
    appearance.setAppearance({ fillMode: true }, false);
    render();
    expect(q("[data-fill-work]")).not.toBeNull();
    resizeWindow(1080, 1920, 1064);
    expect(q("[data-fill-work]")).toBeNull();
    expect(stackRoot()).not.toBeNull();
    expect(appearance.getAppearance().fillMode).toBe(true);
    resizeWindow(1920, 1080, 1600);
    expect(q("[data-fill-work]")).not.toBeNull();
  });
});

describe("rotating back", () => {
  it("lands on the landscape row exactly as before: same markup and state, nothing remounted or glided", async () => {
    render();
    // Painted a while: the columns' boxes are remembered (lib/columnGlide).
    await act(() => new Promise((r) => setTimeout(r, 60)));
    const before = landscape();
    const narrows: boolean[] = [];
    const off = useSide.subscribe((s) => void narrows.push(s.narrow));
    resizeWindow(1080, 1920, 1064);
    expect(stackRoot()).not.toBeNull();
    // While portrait: drag the divider, swap and back — portrait prefs only.
    pointer(divider(), "pointerdown", 604);
    pointer(divider(), "pointermove", 504);
    pointer(divider(), "pointerup", 504);
    act(() => q("[data-portrait-swap]")!.click());
    act(() => q("[data-portrait-swap]")!.click());
    const during = landscape();
    expect({ ...during, markup: "" }).toEqual({ ...before, markup: "" });
    await act(() => new Promise((r) => setTimeout(r, 60)));
    animations = [];
    resizeWindow(1920, 1080, 1600);
    off();
    expect(stackRoot()).toBeNull();
    expect(landscape()).toEqual(before);
    expect(widthMotions()).toEqual([]);
    expect(narrows.every((n) => !n)).toBe(true);
    expect(mounts).toBe(1);
  });

  it("one resize pass back lands on the real landscape row in that pass (re-measured in the flip's own commit), though the stack measured wider", () => {
    setUiPref("sideNarrow", "auto-collapse");
    render();
    const before = landscape();
    const narrows: boolean[] = [];
    const frames: string[] = [];
    const off = useSide.subscribe((s) => void narrows.push(s.narrow));
    const watch = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.matches("[data-side-frame]")) frames.push(n.dataset.sideFrame!);
    });
    watch.observe(container, { childList: true, subtree: true });
    // A narrow, tall window (a landscape row that narrow draws the Shelf as a drawer, which 窄窗口时 = 自动收起 closes).
    resizeWindow(500, 1000, 480);
    expect(stackRoot()).not.toBeNull();
    // Back in one resize pass: the pass measures the stack still drawn (1904 px: the sidebar was over it), then the flip
    // commit measures the landscape row (1600 px) before paint — no landscape layout at the stack's width survives the pass.
    resizeWindow(1920, 1080, 1600, 1904);
    off();
    for (const r of watch.takeRecords()) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.matches("[data-side-frame]")) frames.push(n.dataset.sideFrame!);
    watch.disconnect();
    expect(frames).not.toContain("drawer");
    expect(narrows.every((n) => !n)).toBe(true);
    expect(useSide.getState().layout.open).toBe(true);
    expect(landscape()).toEqual(before);
  });
});
