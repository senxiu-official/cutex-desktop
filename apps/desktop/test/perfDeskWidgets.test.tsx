// @vitest-environment jsdom
// Perf audit 2026-10-23 #28 (docs/research/perf-audit-20261023.md): with the desktop shown, the desk lays its boxes
// out again on every step of a window resize, and every widget rendered again with it (clocks, stats, tiles
// recomputing). A widget renders again when what it is given changes (its size, settings, theme …), not its place.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopWidgetItem, DesktopWidgetProps } from "../src/renderer/src/modules/widgetTypes";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const i18n = vi.hoisted(() => ({ t: (key: string) => key, locale: "zh-CN" }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => i18n }));
const seen = vi.hoisted(() => ({ widths: [] as number[], kinds: [] as unknown[] }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({ ...(await importOriginal<object>()), useSlot: () => seen.kinds }));
const home = vi.hoisted(() => ({ hostId: "local", entry: null, update: async () => {} }));
vi.mock("../src/renderer/src/modules/home/hooks", async (importOriginal) => ({ ...(await importOriginal<object>()), useHomeSource: () => home }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DeskSurface } = await import("../src/renderer/src/modules/home/DeskSurface");
const worldClock = (await import("../src/renderer/src/modules/world-clock")).default;

let areaWidth = 1300;
const observers: (() => void)[] = [];
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
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
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => areaWidth });
  const clock = (worldClock.contributes!["desktop.widget"] as DesktopWidgetItem[])[0]!;
  seen.kinds = [{ moduleId: "world-clock", mode: "show", missing: [], waiting: false, item: { ...clock, refresh: undefined, Widget: (p: DesktopWidgetProps) => (seen.widths.push(p.width), null) } }];
  seen.widths = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  observers.length = 0;
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe("desktop widgets during a window resize", () => {
  it("a widget whose box only moves is not rendered again", () => {
    act(() => root.render(h(DeskSurface)));
    expect(host.querySelector("[data-desk-widget='world-clock.clock']")).not.toBeNull();
    const renders = seen.widths.length;
    const width = seen.widths.at(-1)!;
    const left = () => (host.querySelector("[data-desk-widget='world-clock.clock']") as HTMLElement).style.left;
    const x0 = left();
    // The cell grid (1.23): the boxes move when the column count changes (11 → 9 columns), not on every px.
    for (areaWidth = 1298; areaWidth >= 1100; areaWidth -= 2) act(() => observers.forEach((o) => o()));
    expect(left()).not.toBe(x0);
    expect(seen.widths.length).toBe(renders);
    expect(seen.widths.at(-1)).toBe(width);
  });
});
