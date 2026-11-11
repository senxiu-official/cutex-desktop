// @vitest-environment jsdom
// perf/shelf-divider-drag (owner 2026-11-01: dragging the edge between a conversation and its Shelf was very slow): a width
// drag renders the work row once per step and nothing of the Shelves' views (their box takes the width, lib/sideLayoutStore
// liveWidth); the stored width is written once, on release. The instance layer moves its boxes by style during a drag
// session (lib/columnGlide resizeDrag) and takes them into its state once, in the release's commit.
// Measured in the mock preview (1920 × 1080, long timeline, two Shelves): docs in PROGRESS.md 2026-11-01.
import { act, createElement as h, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const hoisted = vi.hoisted(() => ({ registry: new Map(), rails: 0 }));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => hoisted.registry,
  sideRegistry: () => hoisted.registry,
}));
// Every render of a Shelf's view renders its rail: counted here.
vi.mock("../src/renderer/src/components/side/ShelfRail", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/renderer/src/components/side/ShelfRail")>();
  const { createElement } = await import("react");
  return { ...real, ShelfRail: (props: Parameters<typeof real.ShelfRail>[0]) => (hoisted.rails++, createElement(real.ShelfRail, props)) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, place, placeSpec, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { useRowDrag } from "../src/renderer/src/lib/rowDrag";
import { registerSideSlot, slotsRelayout } from "../src/renderer/src/lib/sideSlots";
import * as glide from "../src/renderer/src/lib/columnGlide";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { SideInstanceLayer } = await import("../src/renderer/src/components/side/SideInstanceLayer");

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;
const rectOf = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

let root: Root;
let container: HTMLElement;
let commits = 0;
const area = 1600;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const pointer = (type: string, x: number) => new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
const counted = (child: ReturnType<typeof h>) => h(Profiler, { id: "probe", onRender: () => void commits++ }, child);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  commits = 0;
  hoisted.rails = 0;
  hoisted.registry = new Map();
  glide.resetColumnGlide();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? area : 0;
  });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? rectOf(0, 0, area, 800) : rect.call(this);
  });
  (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  localStorage.clear();
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
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

describe("the seam between the conversation and its Shelf", () => {
  function mount() {
    act(() => usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) }));
    act(() => root.render(counted(h(SideWorkArea, { side: true, split: null, single: "main", children: h("i") }))));
  }
  const seam = () => q("[data-side-box] [role=separator], [data-ws-shelf-box] [role=separator]")!;
  const shelf = () => shelvesOf(useSide.getState().layout)[0]!;

  it("a drag renders the row at most once per step, never the Shelf's view, and stores the width once, on release", () => {
    mount();
    expect(hoisted.rails).toBeGreaterThan(0);
    const width = shelf().width;
    const layout = useSide.getState().layout;
    const set = vi.spyOn(Storage.prototype, "setItem");
    let layouts = 0;
    const off = useSide.subscribe((s, prev) => void (s.layout !== prev.layout && layouts++));
    try {
      act(() => seam().dispatchEvent(pointer("pointerdown", 1000)));
      expect(glide.resizeDragActive()).toBe(true);
      const before = { commits, rails: hoisted.rails };
      const STEPS = 20;
      for (let k = 1; k <= STEPS; k++) act(() => seam().dispatchEvent(pointer("pointermove", 1000 - 4 * k)));
      // At most one commit per step (the row: the Shelf's box takes the live width) and no render of the Shelf's view.
      expect(commits - before.commits).toBeGreaterThan(0);
      expect(commits - before.commits).toBeLessThanOrEqual(STEPS);
      expect(hoisted.rails - before.rails).toBe(0);
      // Live only: nothing stored, nothing persisted meanwhile.
      const live = useSide.getState().liveWidth[shelf().id];
      expect(live).toBe(DEFAULT_APPEARANCE.sidePaneWidth + 4 * STEPS);
      expect(useSide.getState().layout).toBe(layout);
      expect(shelf().width).toBe(width);
      expect(layouts).toBe(0);
      expect(set).not.toHaveBeenCalled();
      act(() => seam().dispatchEvent(pointer("pointerup", 1000 - 4 * STEPS)));
      // Released: stored once, at what the drag showed; the live width is gone.
      expect(glide.resizeDragActive()).toBe(false);
      expect(layouts).toBe(1);
      expect(shelf().width).toBe(live);
      expect(useSide.getState().liveWidth[shelf().id]).toBeUndefined();
    } finally {
      off();
    }
  });
});

describe("the instance layer during a drag session", () => {
  const Body = () => h("p", null, "page");
  function setup() {
    const id = Object.keys(useSide.getState().layout.instances)[0]!;
    hoisted.registry = new Map([["browser.tab", { moduleId: "browser", item: { Body, useTab: () => ({ title: "page" }) } }]]);
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    let box = rectOf(100, 50, 300, 200);
    Object.defineProperty(slot, "getBoundingClientRect", { configurable: true, value: () => box });
    const off = registerSideSlot(id, { el: slot, cardId: "card", pageId: useSide.getState().layout.activePage ?? "page" });
    act(() => root.render(counted(h(SideInstanceLayer))));
    const el = () => document.querySelector<HTMLElement>(`[data-side-instance="${id}"]`)!;
    const body = () => el().querySelector<HTMLElement>("[data-side-instance-body]")!;
    return { el, body, resize: (w: number) => (box = rectOf(100, 50, w, 200)), done: () => (off(), slot.remove()) };
  }

  it("moves the boxes by style during a drag (no render per step) and commits once on release", () => {
    const s = setup();
    try {
      expect(s.el().style.width).toBe("300px");
      act(() => glide.resizeDrag(true));
      const before = commits;
      for (const w of [320, 340, 360]) {
        s.resize(w);
        act(() => slotsRelayout());
        expect(s.el().style.width).toBe(`${w}px`);
        expect(s.body().style.width).toBe(`${w}px`);
      }
      expect(commits).toBe(before);
      act(() => glide.resizeDrag(false));
      expect(commits).toBe(before + 1);
      expect(s.el().style.width).toBe("360px");
      expect(s.body().style.width).toBe("360px");
    } finally {
      s.done();
    }
  });

  it("outside a drag a moved slot renders the layer as before", () => {
    const s = setup();
    try {
      const before = commits;
      s.resize(320);
      act(() => slotsRelayout());
      expect(commits).toBe(before + 1);
      expect(s.el().style.width).toBe("320px");
    } finally {
      s.done();
    }
  });
});
