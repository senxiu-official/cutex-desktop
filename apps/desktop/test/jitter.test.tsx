// @vitest-environment jsdom
// The window's resize / motion plumbing after the perf re-run of 2026-10-21 (docs/research/perf-baseline-20261020.md
// §7.3 / §8): one synchronous layout pass per resize notification (lib/syncResize: the "layout" callbacks of all
// elements in one flushSync, then the "follow" ones), and the instance layer asks `getAnimations({ subtree: true })`
// only after a motion signal (lib/sideSlots slotsMotion, a box transition / animation starting) — a DOM change alone
// (a streamed delta) measures once and never polls.
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { observeSync, syncPass } = await import("../src/renderer/src/lib/syncResize");
const { registerSideAnchor, slotsMotion, onSlotsMotion, moving, animationMovesBoxes } = await import("../src/renderer/src/lib/sideSlots");
const { SideInstanceLayer } = await import("../src/renderer/src/components/side/SideInstanceLayer");
const { ColumnOutlet } = await import("../src/renderer/src/components/PaneHost");

/** A ResizeObserver stand-in: `fire(els)` notifies for those elements (all observed ones without an argument). */
const ro = vi.hoisted(() => ({ instances: [] as { cb: ResizeObserverCallback; els: Set<Element> }[] }));
class FakeResizeObserver {
  private rec: { cb: ResizeObserverCallback; els: Set<Element> };
  constructor(cb: ResizeObserverCallback) {
    this.rec = { cb, els: new Set() };
    ro.instances.push(this.rec);
  }
  observe(el: Element) {
    this.rec.els.add(el);
  }
  unobserve(el: Element) {
    this.rec.els.delete(el);
  }
  disconnect() {
    this.rec.els.clear();
  }
}
function fire(els?: Element[]) {
  for (const r of ro.instances) {
    const targets = (els ?? [...r.els]).filter((el) => r.els.has(el));
    if (targets.length) r.cb(targets.map((target) => ({ target }) as ResizeObserverEntry), {} as ResizeObserver);
  }
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  ro.instances.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lib/syncResize: one synchronous pass per resize notification", () => {
  it("every element's layout callbacks commit together (one React commit), then the follow callbacks see it", async () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const order: string[] = [];
    let commits = 0;
    let setA: (n: number) => void = () => {};
    let setB: (n: number) => void = () => {};
    function View() {
      const [x, sx] = useState(0);
      const [y, sy] = useState(0);
      setA = sx;
      setB = sy;
      commits++;
      return h("i", { "data-v": `${x}/${y}` });
    }
    act(() => root.render(h(View)));
    commits = 0;
    let n = 0;
    const offs = [
      observeSync(a, () => {
        order.push("layout a");
        setA(++n);
      }),
      observeSync(b, () => {
        order.push("layout b");
        setB(++n);
      }),
      observeSync(a, () => order.push(`follow sees ${container.querySelector("i")!.dataset.v} pass ${syncPass()}`), "follow"),
    ];
    // One observer for all of them.
    expect(ro.instances).toHaveLength(1);
    act(() => fire([a, b]));
    // Both layout callbacks ran inside one flushSync: one commit, already on screen when the follow callback runs.
    expect(commits).toBe(1);
    expect(order).toEqual(["layout a", "layout b", `follow sees 1/2 pass ${syncPass()}`]);
    // Only the changed element's callbacks.
    order.length = 0;
    act(() => fire([b]));
    expect(order).toEqual(["layout b"]);
    for (const off of offs) off();
    expect(ro.instances[0]!.els.size).toBe(0);
  });
});

describe("the instance layer polls animations only while something it was told about moves", () => {
  it("a DOM change in the work area measures once without getAnimations; a motion signal follows it frame by frame", async () => {
    vi.useFakeTimers();
    try {
      const subtree = vi.fn(() => [] as Animation[]);
      // jsdom has no Web Animations: count the subtree queries (lib/sideSlots `moving`).
      (HTMLElement.prototype as unknown as { getAnimations: (o?: { subtree?: boolean }) => Animation[] }).getAnimations = function (o?: { subtree?: boolean }) {
        return o?.subtree ? subtree() : [];
      };
      const anchor = document.createElement("div");
      document.body.appendChild(anchor);
      act(() => root.render(h(SideInstanceLayer)));
      const off = registerSideAnchor(anchor);
      await act(async () => void vi.advanceTimersByTime(50));
      subtree.mockClear();
      // A streamed delta (DOM change inside the work area): no animation query.
      for (let i = 0; i < 5; i++) {
        anchor.appendChild(document.createElement("p"));
        await act(async () => void vi.advanceTimersByTime(40));
      }
      expect(subtree).not.toHaveBeenCalled();
      // A focus outline easing in (a CSS animation of the outline only): still nothing to follow.
      const outline = new Event("animationstart", { bubbles: true }) as Event & { animationName: string };
      Object.defineProperty(outline, "animationName", { value: "ws-focus-in" });
      const col = document.createElement("section");
      (col as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [{ animationName: "ws-focus-in", effect: { getKeyframes: () => [{ outlineOffset: "12px", outlineColor: "transparent", offset: 0 }] } }];
      anchor.appendChild(col);
      act(() => void col.dispatchEvent(outline));
      await act(async () => void vi.advanceTimersByTime(80));
      expect(subtree).not.toHaveBeenCalled();
      // A Shelf's box starting to move (lib/shelfMotion / columnGlide call slotsMotion): followed until it stops.
      act(() => slotsMotion());
      await act(async () => void vi.advanceTimersByTime(40));
      expect(subtree).toHaveBeenCalled();
      const calls = subtree.mock.calls.length;
      await act(async () => void vi.advanceTimersByTime(200));
      // Nothing was moving: the follow stopped after its first check.
      expect(subtree.mock.calls.length).toBe(calls);
      off();
      anchor.remove();
    } finally {
      vi.useRealTimers();
      delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });
});

describe("lib/sideSlots moving(): only motions of box properties count", () => {
  it("waits for an unstarted box animation without polling, then follows when it becomes ready", async () => {
    vi.useFakeTimers();
    let ready!: (a: Animation) => void;
    const animation = {
      playState: "running", pending: true, startTime: null as number | null,
      transitionProperty: "translate", ready: new Promise<Animation>((resolve) => { ready = resolve; }),
      effect: { getComputedTiming: () => ({ endTime: 200 }) },
    };
    const subtree = vi.fn(() => [animation as unknown as Animation]);
    const anchor = document.createElement("div");
    document.body.append(anchor);
    (HTMLElement.prototype as unknown as { getAnimations: () => Animation[] }).getAnimations = function () { return this === anchor ? subtree() : []; };
    let off = () => {};
    try {
      act(() => root.render(h(SideInstanceLayer)));
      off = registerSideAnchor(anchor);
      await act(async () => void vi.advanceTimersByTime(40));
      subtree.mockClear();
      act(() => slotsMotion());
      await act(async () => void vi.advanceTimersByTime(40));
      const waiting = subtree.mock.calls.length;
      expect(waiting).toBeGreaterThan(0);
      // A clipped tooltip can remain pending for seconds; its animation has
      // not started and does not need a layout scan on every renderer frame.
      await act(async () => void vi.advanceTimersByTime(8000));
      expect(subtree.mock.calls.length).toBe(waiting);
      animation.pending = false;
      animation.startTime = 8040;
      await act(async () => { ready(animation as unknown as Animation); await Promise.resolve(); });
      await act(async () => void vi.advanceTimersByTime(40));
      expect(subtree.mock.calls.length).toBeGreaterThan(waiting);
      animation.playState = "finished";
      await act(async () => void vi.advanceTimersByTime(40));
      const finished = subtree.mock.calls.length;
      await act(async () => void vi.advanceTimersByTime(200));
      expect(subtree.mock.calls.length).toBe(finished);
    } finally {
      off(); anchor.remove();
      vi.useRealTimers();
      delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });

  it.each([false, true])("coalesces readiness notifications and handles cancellation (cancel: %s)", async (cancel) => {
    let reject!: (reason: Error) => void;
    let resolve!: (a: Animation) => void;
    const animation = {
      playState: "running", pending: true, startTime: null as number | null,
      transitionProperty: "width", ready: new Promise<Animation>((ready, fail) => { resolve = ready; reject = fail; }),
      effect: { getComputedTiming: () => ({ endTime: 200 }) },
    };
    const root = document.createElement("div");
    (root as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [animation as unknown as Animation];
    const wake = vi.fn();
    const off = onSlotsMotion(wake);
    try {
      expect(moving(root)).toBe(false);
      expect(moving(root)).toBe(false);
      if (cancel) reject(new Error("animation cancelled"));
      else { animation.pending = false; animation.startTime = 0; resolve(animation as unknown as Animation); }
      await Promise.resolve();
      expect(wake).toHaveBeenCalledTimes(cancel ? 0 : 1);
    } finally { off(); }
  });

  it("a progress ring's stroke transition or a fade does not keep the layer following; a width / transform motion does", async () => {
    const finite = { getComputedTiming: () => ({ endTime: 300 }) };
    const transition = (prop: string) => ({ playState: "running", transitionProperty: prop, effect: finite }) as unknown as Animation;
    const waapi = (frames: Record<string, string>[]) => ({ playState: "running", effect: { ...finite, getKeyframes: () => frames } }) as unknown as Animation;
    expect(animationMovesBoxes(transition("stroke-dashoffset"))).toBe(false);
    expect(animationMovesBoxes(transition("outline-offset"))).toBe(false);
    expect(animationMovesBoxes(transition("width"))).toBe(true);
    expect(animationMovesBoxes(waapi([{ opacity: "0" }, { opacity: "1" }]))).toBe(false);
    expect(animationMovesBoxes(waapi([{ transform: "translateX(40px)", width: "300px" }, { transform: "none", width: "340px" }]))).toBe(true);
    const root = document.createElement("div");
    let anims: Animation[] = [transition("stroke-dashoffset"), waapi([{ opacity: "0" }])];
    (root as unknown as { getAnimations: () => Animation[] }).getAnimations = () => anims;
    expect(moving(root)).toBe(false);
    anims = [...anims, waapi([{ width: "48px" }, { width: "468px" }])];
    expect(moving(root)).toBe(true);
  });
});

describe("a focus switch between two conversation columns remounts nothing", () => {
  it("the conversation stays the same element whichever column has the focus (no page over it)", async () => {
    let mounts = 0;
    function Conversation() {
      const [id] = useState(() => ++mounts);
      return h("p", { "data-conv": id });
    }
    act(() => root.render(h(ColumnOutlet, { focused: true, page: null, children: h(Conversation) })));
    const el = container.querySelector("p");
    act(() => root.render(h(ColumnOutlet, { focused: false, page: null, children: h(Conversation) })));
    act(() => root.render(h(ColumnOutlet, { focused: true, page: null, children: h(Conversation) })));
    // Before: MainOutlet (focused) and PaneOutlet (not) wrapped it — every switch mounted a new conversation.
    expect(mounts).toBe(1);
    expect(container.querySelector("p")).toBe(el);
  });
});
