// @vitest-environment jsdom
// 用量 header (review of fix/usage-stats-header): the stats re-measure when the Token figure widens (the previous
// period arrives late and adds 「较前 30 天」), not only when the strip or a stat does; the owner window's observer.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { StatStrip } from "../src/renderer/src/modules/usage/UsagePage";

/** A ResizeObserver whose callbacks run when a test says an observed element resized. */
const observers = new Set<{ cb: () => void; targets: Set<Element> }>();
class FakeObserver {
  private entry: { cb: () => void; targets: Set<Element> };
  constructor(cb: () => void) { this.entry = { cb, targets: new Set() }; observers.add(this.entry); }
  observe(el: Element) { this.entry.targets.add(el); }
  unobserve(el: Element) { this.entry.targets.delete(el); }
  disconnect() { observers.delete(this.entry); }
}
const resized = (el: Element) => { for (const o of [...observers]) if (o.targets.has(el)) o.cb(); };
const size = (el: Element, prop: "offsetWidth" | "clientWidth" | "scrollWidth", px: number) => Object.defineProperty(el, prop, { configurable: true, get: () => px });

let root: Root | null = null;
let host: HTMLDivElement;
let heroWidth = 150;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeObserver);
  host = document.body.appendChild(document.createElement("div"));
  heroWidth = 150;
  // Sizes for the elements jsdom does not lay out: every stat 100 px wide, the Token figure's box `heroWidth`.
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-usage-stat-body") ? 100 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.firstElementChild?.hasAttribute("data-hero") ? heroWidth : 0; });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-usage-summary") ? 800 : 0; });
});
afterEach(() => { act(() => root?.unmount()); root = null; host.remove(); observers.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const items = ["a", "b", "c", "d"].map((key) => ({ key, label: key, value: "1", sub: "s" }));

describe("the stat strip and the Token figure", () => {
  it("beside the figure while it fits; under it once the figure widens (the figure is observed)", () => {
    act(() => { root = createRoot(host); root.render(h(StatStrip, { hero: h("div", { "data-hero": "" }, "Token"), items })); });
    const strip = host.querySelector("[data-usage-summary]")!;
    // 4 × 117 + 3 × 24 = 540 ≤ 800 − 150 − 40
    expect(strip.hasAttribute("data-beside")).toBe(true);
    heroWidth = 300; // 「较前 30 天」 arrived: 800 − 300 − 40 = 460 < 540
    const heroBox = host.querySelector("[data-hero]")!.parentElement!;
    act(() => resized(heroBox));
    expect(strip.hasAttribute("data-beside")).toBe(false);
    expect(strip.getAttribute("data-cols")).toBe("4");
  });
});
