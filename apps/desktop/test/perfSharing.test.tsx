// @vitest-environment jsdom
// Perf pass 2026-10-21 (docs/research/perf-baseline-20261020.md §9): structural sharing of sidebar snapshots
// and derived layouts, the shared ResizeObserver, the shared clocks, and the sidebar rows' own attention
// selection — each keeps what is shown identical and only skips work when nothing a reader sees changed.
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { shareSidebar } = await import("../src/renderer/src/lib/sidebarShare");
const { share } = await import("../src/renderer/src/lib/structuralShare");
const { sharedResizeObserver } = await import("../src/renderer/src/lib/resizeHub");
const { subscribeTick } = await import("../src/renderer/src/lib/ticker");
const { AttentionContext, useAttentionSource, useRowSignal } = await import("../src/renderer/src/lib/attentionView");
const { installAnimationPhase } = await import("../src/renderer/src/lib/animationPhase");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, extra: Record<string, unknown> = {}) => ({ cutexSessionId: id, displayName: id, runtime: { status: "online" }, ...extra }) as unknown as SessionResource;
const snapshot = (active: SessionResource[]): SidebarSnapshot => ({ active, retired: [], projects: { projects: [] } as never, hostRows: { a: { project: null } as never } });
const clone = <T,>(v: T): T => structuredClone(v);

describe("sidebar snapshots (lib/sidebarShare)", () => {
  it("an identical refresh is the previous snapshot; a changed session alone is new", () => {
    const prev = snapshot([session("a"), session("b")]);
    expect(shareSidebar(prev, clone(prev))).toBe(prev);
    const next = clone(prev);
    (next.active[1]!.runtime as { status: string }).status = "offline";
    const out = shareSidebar(prev, next);
    expect(out).not.toBe(prev);
    expect(out.active[0]).toBe(prev.active[0]);
    expect(out.active[1]).toBe(next.active[1]);
    expect(out.hostRows).toBe(prev.hostRows);
    expect(out.projects).toBe(prev.projects);
    expect(out).toEqual(next);
  });
  it("added / removed / reordered sessions and other fields are changes", () => {
    const prev = snapshot([session("a"), session("b")]);
    expect(shareSidebar(prev, snapshot([session("a")])).active.length).toBe(1);
    const swapped = shareSidebar(prev, snapshot([session("b"), session("a")]));
    expect(swapped.active.map((s) => s.cutexSessionId)).toEqual(["b", "a"]);
    expect(swapped.active[0]).toBe(prev.active[1]);
    const runtime = shareSidebar(prev, { ...clone(prev), claudeRuntime: { x: 1 } as never });
    expect(runtime).not.toBe(prev);
    expect(runtime.claudeRuntime).toEqual({ x: 1 });
  });
  it("the very same session object is never taken as unchanged (it may have been patched in place)", () => {
    const a = session("a");
    const prev = snapshot([a]);
    (a as { displayName: string }).displayName = "renamed";
    const out = shareSidebar(prev, { ...prev, active: [a] });
    expect(out).not.toBe(prev);
    expect(out.active[0]!.displayName).toBe("renamed");
  });
});

describe("derived data (lib/structuralShare)", () => {
  it("keeps equal parts, replaces changed ones, compares non-plain values by identity", () => {
    const row = { id: "r", s: { x: 1 } };
    const prev = { main: [{ rows: [row], n: 1 }, { rows: [], n: 2 }], set: new Set([1]) };
    const same = { main: [{ rows: [{ id: "r", s: { x: 1 } }], n: 1 }, { rows: [], n: 2 }], set: prev.set };
    expect(share(prev, same)).toBe(prev);
    const changed = { main: [{ rows: [{ id: "r", s: { x: 1 } }], n: 1 }, { rows: [], n: 3 }], set: prev.set };
    const out = share(prev, changed);
    expect(out).not.toBe(prev);
    expect(out.main[0]).toBe(prev.main[0]);
    expect(out.main[1]).toEqual({ rows: [], n: 3 });
    expect(share(prev, { ...same, set: new Set([1]) })).not.toBe(prev);
  });
});

describe("one ResizeObserver for the measurers (lib/resizeHub)", () => {
  const made: { cb: ResizeObserverCallback; els: Set<Element>; on: boolean }[] = [];
  beforeEach(() => {
    made.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        rec: { cb: ResizeObserverCallback; els: Set<Element>; on: boolean };
        constructor(cb: ResizeObserverCallback) {
          this.rec = { cb, els: new Set(), on: true };
          made.push(this.rec);
        }
        observe(el: Element) {
          this.rec.els.add(el);
        }
        unobserve(el: Element) {
          this.rec.els.delete(el);
        }
        disconnect() {
          this.rec.on = false;
          this.rec.els.clear();
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  const fire = (...els: Element[]) => {
    for (const r of made) {
      const mine = els.filter((e) => r.els.has(e));
      if (r.on && mine.length) r.cb(mine.map((target) => ({ target }) as ResizeObserverEntry), {} as ResizeObserver);
    }
  };

  it("many observers share one native observer; each gets its own entries once per notification", () => {
    const a = document.createElement("div"), b = document.createElement("div"), c = document.createElement("div");
    const seen: string[] = [];
    const one = sharedResizeObserver((entries) => seen.push(`one:${entries.length}`));
    const two = sharedResizeObserver((entries) => seen.push(`two:${entries.length}`));
    one.observe(a);
    one.observe(b);
    two.observe(c);
    expect(made.filter((r) => r.on)).toHaveLength(1);
    fire(a, b, c);
    expect(seen).toEqual(["one:2", "two:1"]);
    seen.length = 0;
    one.disconnect();
    fire(a, b, c);
    expect(seen).toEqual(["two:1"]);
    two.unobserve(c);
    // Nothing left to watch: the native observer goes too.
    expect(made.filter((r) => r.on)).toHaveLength(0);
  });

  it("a second observer of the same element gets its first report (re-observed); a throwing one does not stop the rest", () => {
    vi.useFakeTimers();
    const a = document.createElement("div");
    const seen: string[] = [];
    sharedResizeObserver(() => {
      seen.push("bad");
      throw new Error("boom");
    }).observe(a);
    const before = made[0]!.els.size;
    sharedResizeObserver(() => seen.push("good")).observe(a);
    expect(before).toBe(1);
    expect(made[0]!.els.has(a)).toBe(true);
    fire(a);
    expect(seen).toEqual(["bad", "good"]);
    expect(() => vi.runAllTimers()).toThrow("boom");
    vi.useRealTimers();
  });
});

describe("shared clocks (lib/ticker)", () => {
  it("one timer per period for every reader, gone with the last one", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    const got: number[] = [];
    const stops = [subscribeTick(1000, () => got.push(1)), subscribeTick(1000, () => got.push(2)), subscribeTick(15_000, () => got.push(3))];
    expect(spy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(got).toEqual([1, 2]);
    for (const s of stops) s();
    got.length = 0;
    vi.advanceTimersByTime(30_000);
    expect(got).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    spy.mockRestore();
    vi.useRealTimers();
  });
});

describe("sidebar rows select their own attention (lib/attentionView)", () => {
  it("a status change re-renders that row only, with the new signal", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const renders: Record<string, number> = { a: 0, b: 0 };
    const shown: Record<string, string> = {};
    const row = (id: string) => ({ id, key: id, name: id, status: "idle", session: session(id) }) as never;
    const rows = { a: row("a"), b: row("b") };
    function Row({ id }: { id: "a" | "b" }) {
      renders[id]!++;
      shown[id] = useRowSignal(rows[id]).signal;
      return null;
    }
    let set: (v: Map<string, string>) => void = () => {};
    // The same element every render: the rows re-render only through their own subscription.
    const Static = h("div", null, h(Row, { id: "a" }), h(Row, { id: "b" }));
    function Provider() {
      const [signals, setSignals] = useState(new Map([["a", "running"], ["b", "idle"]]));
      set = setSignals;
      const source = useAttentionSource({ rows: [], signals, needs: new Map(), marks: {} } as never);
      return h(AttentionContext.Provider, { value: source }, Static);
    }
    act(() => root.render(h(Provider)));
    expect(shown).toEqual({ a: "running", b: "idle" });
    const before = { ...renders };
    act(() => set(new Map([["a", "done"], ["b", "idle"]])));
    expect(shown.a).toBe("done");
    expect(renders.a).toBe(before.a! + 1);
    expect(renders.b).toBe(before.b);
    act(() => root.unmount());
    host.remove();
  });
});

describe("looping animations share one phase (lib/animationPhase)", () => {
  const anim = (name: string, iterations: number, duration: number, startTime = 1234, playState = "running") => ({ animationName: name, startTime, playState, effect: { getTiming: () => ({ iterations, duration }) } });
  it("aligns infinite loops (≤ 4 s) to the timeline origin as they start; leaves finite / long ones alone", () => {
    const listeners: ((e: Event) => void)[] = [];
    const el = document.createElement("span");
    const spin = anim("spin", Infinity, 1000), fade = anim("fade", 1, 300), slow = anim("drift", Infinity, 9000), paused = anim("spin", Infinity, 1000, 50, "paused");
    (el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [spin, fade, slow, paused];
    const early = anim("pulse", Infinity, 2000, 99);
    const doc = { getAnimations: () => [early], addEventListener: (_: string, l: (e: Event) => void) => listeners.push(l), removeEventListener: () => {} } as unknown as Document;
    const off = installAnimationPhase(doc);
    expect(early.startTime).toBe(0);
    const event = Object.assign(new Event("animationstart"), { animationName: "spin" });
    Object.defineProperty(event, "target", { value: el });
    for (const l of listeners) l(event);
    expect(spin.startTime).toBe(0);
    expect(paused.startTime).toBe(50);
    expect(fade.startTime).toBe(1234);
    expect(slow.startTime).toBe(1234);
    off();
  });
});
