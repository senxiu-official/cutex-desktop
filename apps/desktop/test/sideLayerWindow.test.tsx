// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real layer, registries, motion predicate and resize subscriptions. No daemon/module startup.
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const NONE: never[] = [];
const STATUSES = new Map();
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: () => NONE, statuses: () => STATUSES, modules: NONE }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { registerSideAnchor, registerSideSlot, slotsMotion } = await import("../src/renderer/src/lib/sideSlots");
const { SideInstanceLayer } = await import("../src/renderer/src/components/side/SideInstanceLayer");
const { OwnerDocumentContext } = await import("../src/renderer/src/lib/ownerContext");

const observed = new Set<Element>();
class FakeResizeObserver {
  observe(el: Element) { observed.add(el); }
  unobserve(el: Element) { observed.delete(el); }
  disconnect() {}
}

function clock(view: Window) {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((cb: FrameRequestCallback) => { callbacks.set(++id, cb); return id; });
  const cancel = vi.fn((key: number) => { callbacks.delete(key); });
  vi.spyOn(view, "requestAnimationFrame").mockImplementation(request);
  vi.spyOn(view, "cancelAnimationFrame").mockImplementation(cancel);
  return {
    callbacks, request, cancel,
    step() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      act(() => { for (const cb of pending) cb(16); });
    },
  };
}

let root: Root | null;
let frame: HTMLIFrameElement;
let container: HTMLElement;
let cleanups: (() => void)[];
beforeEach(() => {
  observed.clear();
  cleanups = [];
  root = null;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  frame = document.createElement("iframe");
  document.body.appendChild(frame);
  Object.defineProperty(frame.contentWindow!, "ResizeObserver", { configurable: true, value: FakeResizeObserver });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  for (const off of cleanups) off();
  container?.remove();
  frame.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SideInstanceLayer document ownership", () => {
  it.each(["main", "desk"] as const)("%s layer follows only its own slots, anchors and frame clock", (owner) => {
    const desk = frame.contentDocument!;
    const ownDoc = owner === "main" ? document : desk;
    const foreignDoc = owner === "main" ? desk : document;
    const mainClock = clock(window);
    const deskClock = clock(frame.contentWindow!);
    const ownClock = owner === "main" ? mainClock : deskClock;
    const foreignClock = owner === "main" ? deskClock : mainClock;
    const motion = { playState: "running", transitionProperty: "width", effect: { getComputedTiming: () => ({ endTime: 200 }) } } as unknown as Animation;
    const ownAnchor = ownDoc.createElement("section");
    const foreignAnchor = foreignDoc.createElement("section");
    const ownSlot = ownDoc.createElement("div");
    const foreignSlot = foreignDoc.createElement("div");
    ownAnchor.appendChild(ownSlot);
    foreignAnchor.appendChild(foreignSlot);
    ownDoc.body.appendChild(ownAnchor);
    foreignDoc.body.appendChild(foreignAnchor);
    cleanups.push(() => ownAnchor.remove(), () => foreignAnchor.remove());
    const ownAnimations = vi.fn(() => [] as Animation[]);
    const foreignAnimations = vi.fn(() => [motion]);
    Object.defineProperty(ownAnchor, "getAnimations", { value: ownAnimations });
    Object.defineProperty(foreignAnchor, "getAnimations", { value: foreignAnimations });
    const ownRect = vi.spyOn(ownSlot, "getBoundingClientRect");
    const foreignRect = vi.spyOn(foreignSlot, "getBoundingClientRect");
    cleanups.push(registerSideAnchor(ownAnchor), registerSideAnchor(foreignAnchor));
    cleanups.push(registerSideSlot("own", { el: ownSlot, cardId: "own", pageId: "own" }));
    cleanups.push(registerSideSlot("foreign", { el: foreignSlot, cardId: "foreign", pageId: "foreign" }));
    container = ownDoc.createElement("div");
    ownDoc.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(h(OwnerDocumentContext.Provider, { value: ownDoc }, h(SideInstanceLayer))));

    expect(ownRect).toHaveBeenCalled();
    expect(foreignRect).not.toHaveBeenCalled();
    expect(observed).toEqual(new Set([ownSlot, ownAnchor, ownDoc.documentElement]));
    act(() => slotsMotion());
    expect(ownClock.callbacks.size).toBe(1);
    expect(foreignClock.request).not.toHaveBeenCalled();
    ownClock.step();
    expect(ownAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(foreignAnimations).not.toHaveBeenCalled();
    // A moving foreign anchor cannot prolong this window's follow.
    expect(ownClock.callbacks.size).toBe(0);

    ownAnimations.mockReturnValue([motion]);
    act(() => slotsMotion());
    ownClock.step();
    expect(ownClock.callbacks.size).toBe(1);
    expect(foreignRect).not.toHaveBeenCalled();
    expect(foreignAnimations).not.toHaveBeenCalled();
    const pending = [...ownClock.callbacks.keys()][0];
    act(() => root!.unmount());
    root = null;
    expect(ownClock.cancel).toHaveBeenCalledWith(pending);
    expect(ownClock.callbacks.size).toBe(0);
    expect(foreignClock.cancel).not.toHaveBeenCalled();
    expect(observed.size).toBe(0);
  });
});
