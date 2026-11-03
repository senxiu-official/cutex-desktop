// @vitest-environment jsdom
// Portrait P1 (owner 2026-10-30, design .claude/previews/portrait/design.md; lib/portrait, components/side/SideArea's
// portrait branch): a tall window draws the work row as a stack — the conversation on top, the divider, its Shelf with the
// Rail across the Shelf's top edge — or swapped; the divider sets the split (per window), ⇅ / the ⋯ menu swap; no Shelf:
// the empty Rail as a 40 px bar; 最大化保持 is ignored there. Rotating back lands on the landscape row exactly as it was:
// the same markup, nothing remounted, nothing glided, nothing of the landscape layout written meanwhile, and no commit ever
// laid the landscape row out at the stack's width. Harness: test/unmaximizeJump.test.tsx.
import { act, createElement as h, Fragment, useContext, useEffect } from "react";
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
import { conversationPanes, defaultLayout, focusPane, openBeside, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
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
import { useGrow } from "../src/renderer/src/lib/panelGrow";
import { toggleExclusive, toggleMaximize } from "../src/renderer/src/lib/paneActions";
import { roomForColumn } from "../src/renderer/src/lib/paneRoom";
import { resetSettingsShelfForTest, settingsShelfCovers, settingsShelfMaximizedNow, useSettingsShelf } from "../src/renderer/src/lib/settingsShelf";
import { DeskContext } from "../src/renderer/src/lib/deskContext";
import * as glide from "../src/renderer/src/lib/columnGlide";
import { MAIN_WINDOW } from "../src/renderer/src/lib/windowScope";
import { noteWindowBox, resetPortraitForTest, STACK_CONVERSATION_MIN, usePortrait, useWindowOrientation } from "../src/renderer/src/lib/portrait";

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

const DESK = "d0123456789ab";
const cardId = () => useSide.getState().layout.pages.flatMap((p) => p.cards)[0]!.id;
/** Waits a painted while (lib/columnGlide remembers the columns' boxes). */
const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));

describe("two workspaces in portrait", () => {
  it("the focused workspace is the stack (its Shelf, the divider; no row widths for the columns); back is the split row as before, nothing remounted or folded", async () => {
    act(() => usePanes.setState({ layout: twoPanes() }));
    props = { split: { focused: 0 }, covered: false, single: null };
    render();
    await settle();
    expect(q("[data-probe]")!.dataset.row).not.toBe("none");
    const before = landscape();
    // (Narrower than two columns side by side, P3: 2 × 520 + 8 px.)
    resizeWindow(900, 1920, 884);
    const stack = stackRoot()!;
    expect(stack.hasAttribute("data-portrait-split")).toBe(true);
    expect(shelfPart()).not.toBeNull();
    expect(divider()).not.toBeNull();
    // The columns get no row widths: ConversationColumns lays the focused one out from the stack's variables.
    expect(q("[data-probe]")!.dataset.row).toBe("none");
    expect(stack.style.getPropertyValue("--stack-conv-flex")).toBe("0.58 1 0px");
    expect(stack.style.getPropertyValue("--stack-conv-min")).toBe(`${STACK_CONVERSATION_MIN}px`);
    expect(stack.style.getPropertyValue("--stack-conv-order")).toBe("0");
    expect(stack.hasAttribute("data-portrait-conv-last")).toBe(false);
    // Swapped: the conversation last (it keeps the tray room).
    act(() => q("[data-portrait-swap]")!.click());
    expect(stack.style.getPropertyValue("--stack-conv-order")).toBe("2");
    expect(stack.hasAttribute("data-portrait-conv-last")).toBe(true);
    act(() => q("[data-portrait-swap]")!.click());
    expect({ ...landscape(), markup: "" }).toEqual({ ...before, markup: "" });
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(stackRoot()).toBeNull();
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
    expect(useStrips.getState().strips).toEqual({});
  });

  it("a focused workspace without a Shelf: the empty Rail as the stack's end bar", () => {
    act(() => usePanes.setState({ layout: twoPanes() }));
    useSide.setState({ layout: emptyLayout() });
    props = { split: { focused: 0 }, covered: false, single: null };
    render();
    resizeWindow(900, 1920, 884);
    expect(divider()).toBeNull();
    expect(q("[data-shelf-rail-empty]")!.style.height).toBe("40px");
    expect(stackRoot()!.style.getPropertyValue("--stack-conv-flex")).toBe("1 1 0px");
    expect(stackRoot()!.hasAttribute("data-portrait-conv-last")).toBe(false);
  });
});

describe("a maximised panel in portrait", () => {
  it("a maximised conversation fills the stack: no divider, every Shelf its rail in the end bar (a click there restores first); back as before", async () => {
    props = { split: null, covered: true, single: null };
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    expect(stackRoot()!.dataset.panelMax).toBe("conversation");
    expect(conv().style.flex).toBe("1 1 0px");
    expect(divider()).toBeNull();
    expect(shelfPart()).toBeNull();
    const rail = q('[data-portrait-part="rail"]')!;
    expect(rail.hasAttribute("data-panel-folded")).toBe(true);
    expect(rail.style.height).toBe("40px");
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
  });

  it("a maximised Shelf pane fills the stack, the conversations a 40 px strip of avatars (still mounted, hidden); back as before", async () => {
    useSide.setState({ mode: { kind: "maximised", card: cardId() } });
    render();
    await settle();
    const before = landscape();
    resizeWindow(1080, 1920, 1064);
    expect(stackRoot()!.dataset.panelMax).toBe("pane");
    expect(conv().style.height).toBe("40px");
    // flex: none (jsdom spells it out).
    expect(["none", "0 0 auto"]).toContain(conv().style.flex);
    expect(conv().hasAttribute("data-conv-folded")).toBe(true);
    expect(conv().querySelector<HTMLElement>(".contents")!.hidden).toBe(true);
    expect(conv().querySelector("[data-conv-strip]")!.className).toContain("flex-row");
    expect(divider()).toBeNull();
    expect(shelfPart()!.hasAttribute("data-panel-maxed")).toBe(true);
    expect(shelfPart()!.style.flex).toBe("1 1 0px");
    expect(shelfPart()!.style.minHeight).toBe("0px");
    await settle();
    resizeWindow(1920, 1080, 1600);
    expect(landscape()).toEqual(before);
    expect(mounts).toBe(1);
  });

  it("最大化 (Ctrl+Shift+M, ⤢, a header double-click) fills the stack instead of growing; again = back, the other workspace never folded", () => {
    act(() => usePanes.setState({ layout: twoPanes() }));
    const id = conversationPanes(usePanes.getState().layout)[0]!;
    noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 });
    act(() => toggleMaximize({ area: "work", id }));
    expect(usePanes.getState().layout.max).toBe(id);
    expect(useGrow.of(MAIN_WINDOW).getState().target).toBeNull();
    // ⤢ / ⋯ 独占 on the maximised column: back as it was — 独占's two-workspace fold is not used for it.
    act(() => toggleExclusive({ area: "work", id }));
    expect(usePanes.getState().layout.max ?? null).toBeNull();
    expect(useStrips.getState().strips).toEqual({});
    act(() => toggleMaximize({ area: "tools", id: cardId() }));
    expect(useSide.getState().mode).toMatchObject({ kind: "maximised", card: cardId() });
    act(() => toggleMaximize({ area: "tools", id: cardId() }));
    expect(useSide.getState().mode).toBeNull();
    // Landscape: 最大化 is the grow again (no room here: nothing happens), never the layout's max.
    noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 });
    act(() => toggleMaximize({ area: "work", id }));
    expect(usePanes.getState().layout.max ?? null).toBeNull();
  });
});

describe("other edge cases", () => {
  it("the Settings Shelf is drawn maximised in a portrait window; its stored choice is untouched, landscape draws it as stored", () => {
    useSettingsShelf.setState({ open: true, win: MAIN_WINDOW, maximized: false });
    expect(settingsShelfMaximizedNow()).toBe(false);
    expect(settingsShelfCovers()).toBe(false);
    noteWindowBox(MAIN_WINDOW, { width: 1080, height: 1920 });
    expect(settingsShelfMaximizedNow()).toBe(true);
    expect(settingsShelfCovers()).toBe(true);
    expect(useSettingsShelf.getState().maximized).toBe(false);
    // Opened in a landscape desk: that window's own orientation counts.
    useSettingsShelf.setState({ win: DESK });
    noteWindowBox(DESK, { width: 1920, height: 1080 });
    expect(settingsShelfMaximizedNow()).toBe(false);
    useSettingsShelf.setState({ win: MAIN_WINDOW });
    noteWindowBox(MAIN_WINDOW, { width: 1920, height: 1080 });
    expect(settingsShelfMaximizedNow()).toBe(false);
  });

  it("in the stack another conversation always has room (it folds to a strip); the landscape row keeps the minimum widths", () => {
    render();
    resizeWindow(720, 1280, 704);
    expect(stackRoot()).not.toBeNull();
    expect(roomForColumn("conversation")).toBe(true);
    resizeWindow(1920, 1080, 704);
    expect(stackRoot()).toBeNull();
    expect(roomForColumn("conversation")).toBe(false);
  });

  it("very narrow portrait (720 × 1280 = 1080 × 1920 at 150 %) is a stack with both parts at their minimums or more", () => {
    render();
    resizeWindow(720, 1280, 704);
    expect(stackRoot()).not.toBeNull();
    expect(conv().style.minHeight).toBe(`${STACK_CONVERSATION_MIN}px`);
    expect(shelfPart()!.style.minHeight).toBe("200px");
    expect(q("[data-shelf-rail]")!.className).toContain("flex-row");
  });

  it("a desk decides for itself: a tall desk is a stack while the main window's row stays landscape", () => {
    act(() =>
      root.render(
        h(
          Fragment,
          null,
          h(Win),
          h(SideWorkArea, { side: true, split: null, single: "main", children: h(Probe) }),
          h(DeskContext.Provider, { value: DESK }, h(SideWorkArea, { side: true, split: null, single: null, children: h("b", { "data-desk-probe": "" }) })),
        ),
      ),
    );
    act(() => void noteWindowBox(DESK, { width: 1080, height: 1920 }));
    const stacks = container.querySelectorAll("[data-portrait-stack]");
    expect(stacks.length).toBe(1);
    expect(stacks[0]!.querySelector("[data-desk-probe]")).not.toBeNull();
    expect(q("[data-probe]")!.closest("[data-portrait-stack]")).toBeNull();
    expect(usePortrait.of(MAIN_WINDOW).getState().orientation).toBe("landscape");
  });
});
