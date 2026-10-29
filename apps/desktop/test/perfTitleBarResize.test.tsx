// @vitest-environment jsdom
// Perf audit 2026-10-23 #28 (docs/research/perf-audit-20261023.md): a window resize re-rendered the window bar's
// entries and launchers on every step — they kept the window / title width in state, and only need what follows
// from it (folded or not; how many launchers fit). They render again only when that answer changes.
import { act, createElement as h, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ store: null as unknown as { setState(s: object): void } }));
vi.mock("../src/renderer/src/lib/workspaces", async () => {
  const { create: make } = await import("zustand");
  const useWsUi = make(() => ({ windowWidth: 1500, reserved: 0 }));
  ws.store = useWsUi;
  return { watchWindow: () => {}, useWsUi };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useEntriesCompact } = await import("../src/renderer/src/components/SidebarNav");
const { useLauncherFit, LAUNCHER_SIZE, TITLE_MIN } = await import("../src/renderer/src/lib/sideLauncherView");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("window bar entries (useEntriesCompact)", () => {
  it("re-render only when they fold, not per step of a window resize", () => {
    const seen: boolean[] = [];
    const Probe = () => {
      seen.push(useEntriesCompact());
      return null;
    };
    act(() => root.render(h(Probe)));
    for (let w = 1490; w >= 1000; w -= 10) act(() => ws.store.setState({ windowWidth: w }));
    expect(seen).toEqual([false]);
    act(() => ws.store.setState({ windowWidth: 880 }));
    act(() => ws.store.setState({ windowWidth: 870 }));
    expect(seen).toEqual([false, true]);
  });
});

describe("title bar launchers (useLauncherFit)", () => {
  it("re-render only when the fitted count changes, with the same count as from the room", () => {
    let titleWidth = 600;
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {
          observers.push(() => this.cb());
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const fits: number[] = [];
    const Probe = ({ count }: { count: number }) => {
      const strip = useRef<HTMLDivElement>(null);
      fits.push(useLauncherFit(strip, count));
      return h("header", null, h("div", { "data-titlebar-title": "", ref: (el: HTMLElement | null) => el && (el.getBoundingClientRect = () => ({ width: titleWidth }) as DOMRect) }), h("div", { ref: strip }));
    };
    act(() => root.render(h(Probe, { count: 3 })));
    const renders = fits.length;
    expect(fits.at(-1)).toBe(3);
    // The title shrinks 1 px per step: no render until fewer launchers fit.
    for (titleWidth = 599; titleWidth > TITLE_MIN + 3 * LAUNCHER_SIZE; titleWidth--) act(() => observers.forEach((o) => o()));
    expect(fits.length).toBe(renders);
    titleWidth = TITLE_MIN + 2 * LAUNCHER_SIZE + 5;
    act(() => observers.forEach((o) => o()));
    expect(fits.at(-1)).toBe(2);
    // More pinned launchers than fit: the fit follows the new count before paint.
    act(() => root.render(h(Probe, { count: 1 })));
    expect(fits.at(-1)).toBe(1);
    titleWidth = 2000;
    act(() => root.render(h(Probe, { count: 5 })));
    expect(fits.at(-1)).toBe(5);
  });
});
