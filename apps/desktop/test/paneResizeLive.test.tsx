// @vitest-environment jsdom
// Resize drags commit on release (perf baseline 2026-10-20, fix order 3): the column divider moves the two
// columns' flex-grow directly while dragging and stores the share once when let go; the sidebar / tool
// side width moves only its CSS variable while dragging and stores the appearance (all variables, fonts,
// the zoom IPC) once on release.
import { act, createElement as h, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ setZoom: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {}, shell: { setZoom: fx.setZoom } }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const appearance = await import("../src/renderer/src/lib/appearance");
const { ColumnSplitter, PaneResizer } = await import("../src/renderer/src/components/PaneResizer");
const glide = await import("../src/renderer/src/lib/columnGlide");

const pointer = (el: Element, type: string, clientX: number) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
const width = (el: HTMLElement, px: number) => Object.defineProperty(el, "offsetWidth", { configurable: true, value: px });

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
  (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  localStorage.clear();
  fx.setZoom.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("column divider: live flex-grow, stored on release", () => {
  it("moves the two columns without storing, then stores the last share once", async () => {
    const row = document.createElement("div");
    const left = document.createElement("section");
    const right = document.createElement("section");
    row.append(left, right);
    document.body.append(row);
    width(left, 500);
    width(right, 500);
    const onShare = vi.fn();
    // As the layout would clamp it: shares within [0.2, 0.8] of a pair of 1.
    const preview = vi.fn((share: number): [number, number] => {
      const w = Math.min(0.8, Math.max(0.2, share));
      return [w, 1 - w];
    });
    root = createRoot(right);
    await act(async () => root!.render(h(ColumnSplitter, { share: 0.5, onShare, preview })));
    const handle = right.querySelector("[data-pane-split]")!;
    act(() => void pointer(handle, "pointerdown", 500));
    for (const x of [550, 600, 650, 700]) act(() => void pointer(handle, "pointermove", x));
    expect(onShare).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(4);
    expect(left.style.flexGrow).toBe("0.7");
    expect(right.style.flexGrow).toBe("0.30000000000000004");
    act(() => void pointer(handle, "pointerup", 700));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledWith(0.7);
    // A click without a move stores nothing.
    act(() => void pointer(handle, "pointerdown", 700));
    act(() => void pointer(handle, "pointerup", 700));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});

describe("sidebar width: live CSS variable, appearance stored on release", () => {
  it("drags with --sidebar-w only (on its readers, not <html>), then stores once (zoom IPC once)", async () => {
    const before = appearance.getAppearance().sidebarWidth;
    const rootBefore = document.documentElement.style.getPropertyValue("--sidebar-w");
    const row = document.createElement("div");
    const pane = document.createElement("aside");
    pane.setAttribute("data-live-width", "sidebarWidth");
    row.append(pane);
    document.body.append(row);
    Object.defineProperty(row, "clientWidth", { configurable: true, value: 1600 });
    width(pane, before);
    let renders = 0;
    const Reader = () => {
      renders++;
      appearance.useAppearance();
      return null;
    };
    root = createRoot(pane);
    await act(async () => root!.render(h(Fragment, null, h(PaneResizer, { field: "sidebarWidth", edge: "right" }), h(Reader))));
    const rendered = renders;
    const handle = pane.querySelector("[role=separator]")!;
    act(() => void pointer(handle, "pointerdown", 300));
    for (const x of [320, 340, 360]) act(() => void pointer(handle, "pointermove", x));
    expect(pane.style.getPropertyValue("--sidebar-w")).toBe(`${before + 60}px`);
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(rootBefore);
    expect(appearance.getAppearance().sidebarWidth).toBe(before);
    expect(appearance.getLiveWidth("sidebarWidth")).toBe(before + 60);
    expect(localStorage.getItem("cutex-desktop.appearance")).toBeNull();
    expect(fx.setZoom).not.toHaveBeenCalled();
    // useAppearance readers do not re-render while dragging.
    expect(renders).toBe(rendered);
    act(() => void pointer(handle, "pointerup", 360));
    expect(appearance.getAppearance().sidebarWidth).toBe(before + 60);
    expect(JSON.parse(localStorage.getItem("cutex-desktop.appearance")!).sidebarWidth).toBe(before + 60);
    expect(fx.setZoom).toHaveBeenCalledTimes(1);
    expect(appearance.getLiveWidth("sidebarWidth")).toBe(before + 60);
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(`${before + 60}px`);
    expect(pane.style.getPropertyValue("--sidebar-w")).toBe("");
  });

  it("keys are a short drag (宽度规则 1): live at once in a drag session, stored once when the keys rest", async () => {
    vi.useFakeTimers();
    try {
      const before = appearance.getAppearance().sidebarWidth;
      const row = document.createElement("div");
      const pane = document.createElement("aside");
      row.append(pane);
      document.body.append(row);
      Object.defineProperty(row, "clientWidth", { configurable: true, value: 1600 });
      width(pane, before);
      root = createRoot(pane);
      await act(async () => root!.render(h(PaneResizer, { field: "sidebarWidth", edge: "right" })));
      const handle = pane.querySelector("[role=separator]")!;
      const sessions: boolean[] = [];
      const off = glide.onResizeDrag((active) => sessions.push(active));
      act(() => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      // Live (the CSS variable), nothing stored yet; the work row sees a drag (it keeps what the edge does not touch).
      expect(appearance.getLiveWidth("sidebarWidth")).toBe(before + 16);
      expect(appearance.getAppearance().sidebarWidth).toBe(before);
      expect(glide.resizing()).toBe(true);
      width(pane, before + 16);
      act(() => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(appearance.getLiveWidth("sidebarWidth")).toBe(before + 32);
      act(() => void vi.advanceTimersByTime(glide.KEY_RESIZE_MS + 10));
      // One session for the held key; stored once (all variables, the zoom IPC once), like a release.
      expect(sessions).toEqual([true, false]);
      expect(appearance.getAppearance().sidebarWidth).toBe(before + 32);
      expect(fx.setZoom).toHaveBeenCalledTimes(1);
      off();
    } finally {
      glide.resetColumnGlide();
      vi.useRealTimers();
    }
  });
});
