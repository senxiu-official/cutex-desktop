// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MenuFlyout } from "../src/renderer/src/components/MenuFlyout";
import { placeFlyout } from "../src/renderer/src/lib/flyoutPlacement";
vi.mock("../src/renderer/src/lib/flyoutPlacement", async (load) => {
  const actual = await load<typeof import("../src/renderer/src/lib/flyoutPlacement")>();
  return { ...actual, placeFlyout: vi.fn(actual.placeFlyout) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let callback: ResizeObserverCallback;
const observe = vi.fn(), disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe = observe;
    disconnect = disconnect;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(h("div", null, h(MenuFlyout, null, h("button", null, "Agent")))));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("does not recompute placement on inner or captured ancestor scroll", () => {
  const initial = vi.mocked(placeFlyout).mock.calls.length;
  expect(initial).toBeGreaterThan(0);
  const menu = document.querySelector('[data-flyout] [role=menu]')!;
  act(() => {
    for (let i = 0; i < 30; i++) menu.dispatchEvent(new Event("scroll"));
    host.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("scroll"));
  });
  expect(placeFlyout).toHaveBeenCalledTimes(initial);
});
it("repositions for viewport, content and anchor resize, and cleans up", () => {
  const flyout = document.querySelector<HTMLElement>("[data-flyout]")!;
  const anchor = host.firstElementChild!;
  expect(observe.mock.calls.map(([target]) => target)).toEqual([flyout, anchor]);
  const initial = vi.mocked(placeFlyout).mock.calls.length;
  const rect = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 30, right: 90, top: 70, bottom: 100 } as DOMRect);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(placeFlyout).toHaveBeenCalledTimes(initial + 1);
  expect(flyout.style.left).toBe("90px"); expect(flyout.style.top).toBe("74px");
  rect.mockReturnValue({ left: 30, right: 110, top: 70, bottom: 100 } as DOMRect);
  Object.defineProperty(flyout, "offsetHeight", { configurable: true, value: 250 });
  act(() => callback([], {} as ResizeObserver));
  expect(vi.mocked(placeFlyout).mock.calls.at(-1)?.[1].height).toBe(250);
  expect(placeFlyout).toHaveBeenCalledTimes(initial + 2); expect(flyout.style.left).toBe("110px");
  act(() => root.render(null)); expect(disconnect).toHaveBeenCalledOnce();
  act(() => window.dispatchEvent(new Event("resize")));
  expect(placeFlyout).toHaveBeenCalledTimes(initial + 2);
});

