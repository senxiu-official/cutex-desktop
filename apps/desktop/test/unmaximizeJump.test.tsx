// @vitest-environment jsdom
// unmaximize-jump (owner 2026-10-30): sidebar + one conversation + one Shelf, ⤢ 最大化保持 then 关闭最大化保持 — the
// conversation went 792 → 858 (sliding) → 768 before it settled. The legacy row mounting again laid its first commit out
// unmeasured (`areaWidth` 0: the column filling the row) and glided the column from its box before fill mode toward that
// layout (lib/columnGlide); the measured commit right after (a still one) never stopped that glide, so its keyframed width
// covered the real one until it ended, then snapped. Now: an unmeasured row never glides, a still commit ends the column
// glides still running, and a window restore (big → small in one step) lands on the final widths in one observer pass.
import { act, createElement as h } from "react";
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
import { applyOpen, emptyLayout, place, placeSpec, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { useFillRatios } from "../src/renderer/src/lib/fillStore";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { resetConvShelves, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
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
let area = 1640;
let resize: (() => void) | null = null;
/** Every `animate` call made on an element of the work row: what moved and its keyframes. */
let animations: { el: Element; frames: Keyframe[]; cancel: ReturnType<typeof vi.fn> }[] = [];
const widthMotions = () => animations.filter((a) => a.frames.some((f) => "width" in f));

const card = () => container.querySelector<HTMLElement>("[data-conv-card]");
/** The row as drawn: its measured width, the column's width (inline; null = filling) and the Shelf box. */
const geometry = () => ({
  area: container.querySelector<HTMLElement>("[data-side-work]")?.dataset.wsArea,
  column: card()?.style.width ?? null,
  shelf: container.querySelector<HTMLElement>("[data-shelf-box]")?.style.width ?? null,
});

function render() {
  act(() => root.render(h(SideWorkArea, { side: true, split: null, single: "main", children: h("i") })));
}
function resizeTo(width: number) {
  area = width;
  act(() => resize?.());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  area = 1640;
  animations = [];
  useFillRatios.setState({ scopes: {} });
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
  // The column's box: its inline width where it has one (centred in the row), else it fills what the Shelf leaves.
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = (left: number, width: number) => ({ left, top: 0, width, height: 800, right: left + width, bottom: 800, x: left, y: 0, toJSON() {} }) as DOMRect;
    if (this.hasAttribute("data-side-work")) return box(0, area);
    if (this.hasAttribute("data-conv-card")) {
      const w = Number.parseFloat(this.style.width);
      return Number.isFinite(w) ? box(Math.round((area - w - 460) / 2), w) : box(0, Math.max(0, area - 460));
    }
    return rect.call(this);
  });
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
    const cancel = vi.fn();
    animations.push({ el: this, frames, cancel });
    return { playState: "running", cancel, finished: new Promise(() => {}), currentTime: 0 } as unknown as Animation;
  };
  (HTMLElement.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
  localStorage.clear();
  resetConvShelves();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva")], retired: [], hostRows: {}, projects: null } as never });
  act(() => {
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    switchConversation("local|eva");
  });
  useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
  useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] });
  appearance.setAppearance({ ...DEFAULT_APPEARANCE, fillMode: false }, false);
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
});

describe("关闭最大化保持 (the row mounting again)", () => {
  it("lands on the measured widths at once: no glide toward the unmeasured first layout", async () => {
    render();
    const settled = geometry();
    expect(settled.column).not.toBeNull();
    // The row has been painted a while: its boxes are remembered (lib/columnGlide noteLater: a frame, then a task).
    await act(() => new Promise((r) => setTimeout(r, 60)));
    act(() => appearance.setAppearance({ fillMode: true }, false));
    expect(container.querySelector("[data-fill-work]")).not.toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 60)));
    animations = [];
    act(() => appearance.setAppearance({ fillMode: false }, false));
    expect(container.querySelector("[data-fill-work]")).toBeNull();
    // One step: the same widths as before 最大化保持, and nothing eased the column's width or position meanwhile.
    expect(geometry()).toEqual(settled);
    expect(widthMotions().filter((a) => a.el.hasAttribute("data-glide"))).toEqual([]);
  });
});

describe("window restore (big → small in one step)", () => {
  it("one observer pass draws the final widths (the same as a fresh mount at the small size), with no width motion", () => {
    render();
    const big = geometry();
    resizeTo(1100);
    const restored = geometry();
    expect(restored).not.toEqual(big);
    expect(widthMotions()).toEqual([]);
    act(() => root.unmount());
    root = createRoot(container);
    glide.resetColumnGlide();
    render();
    expect(geometry()).toEqual(restored);
  });

  it("fill mode: one observer pass draws the final ratio solve, with no width motion", () => {
    appearance.setAppearance({ fillMode: true }, false);
    render();
    const shelfW = () => container.querySelector<HTMLElement>("[data-fill-shelf]")?.style.width;
    const big = shelfW();
    resizeTo(1100);
    const restored = shelfW();
    expect(restored).not.toBe(big);
    expect(widthMotions()).toEqual([]);
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(shelfW()).toBe(restored);
  });
});

describe("column glides and still commits (lib/columnGlide)", () => {
  function row() {
    const work = document.createElement("div");
    const col = document.createElement("div");
    col.dataset.glide = "main";
    work.appendChild(col);
    document.body.appendChild(work);
    return { work, col };
  }

  it("a still commit (the row changed width) ends the column glides still running", () => {
    const { work, col } = row();
    let box = { left: 175, width: 770 };
    col.getBoundingClientRect = () => ({ ...box, top: 0, height: 100, right: box.left + box.width, bottom: 100, x: box.left, y: 0, toJSON() {} }) as DOMRect;
    glide.noteColumns(work);
    box = { left: 0, width: 860 };
    glide.glideColumns(work);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.cancel).not.toHaveBeenCalled();
    box = { left: 100, width: 768 };
    glide.glideColumns(work, true);
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(animations).toHaveLength(1);
  });

  it("the 最大化 row slide is not a column glide: a still commit leaves it running", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const { work, col } = row();
    let grown = false;
    work.getBoundingClientRect = () => ({ left: 0, width: 1600, top: 0, height: 100, right: 1600, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    col.getBoundingClientRect = () => {
      const b = grown ? { left: 0, width: 1132 } : { left: 317, width: 770 };
      return { ...b, top: 0, height: 100, right: b.left + b.width, bottom: 100, x: b.left, y: 0, toJSON() {} } as DOMRect;
    };
    glide.armRowGlide(work);
    grown = true;
    glide.glideColumns(work);
    expect(animations.length).toBeGreaterThan(0);
    glide.glideColumns(work, true);
    for (const a of animations) expect(a.cancel).not.toHaveBeenCalled();
  });
});
