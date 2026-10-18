// @vitest-environment jsdom
// The launch dock reports its height to the page (`--launch-dock-h`), and LaunchPage.css keeps the
// absolutely placed intro / portraits above it: a create error (`unsupported_profile: …`) at the top
// of the dock was drawn under the provider title / portraits (a friend's Windows install).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { measureLaunchDock } from "../src/renderer/src/components/LaunchPage";

afterEach(() => vi.unstubAllGlobals());

function fakeResizeObserver() {
  const live: { cb: ResizeObserverCallback; el?: Element }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    private entry: { cb: ResizeObserverCallback; el?: Element };
    constructor(cb: ResizeObserverCallback) { this.entry = { cb }; live.push(this.entry); }
    observe(el: Element) { this.entry.el = el; }
    unobserve() {}
    disconnect() { live.splice(live.indexOf(this.entry), 1); }
  });
  return {
    resize: (el: Element, blockSize: number) => {
      for (const o of live) if (o.el === el) o.cb([{ target: el, borderBoxSize: [{ blockSize, inlineSize: 600 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    },
    count: () => live.length,
  };
}

it("publishes the dock height on the page and clears it on unmount", () => {
  const ro = fakeResizeObserver();
  const page = document.createElement("main");
  const dock = document.createElement("div");
  page.append(dock);
  const cleanup = measureLaunchDock(dock)!;
  ro.resize(dock, 312.4);
  expect(page.style.getPropertyValue("--launch-dock-h")).toBe("313px");
  ro.resize(dock, 0); // not laid out (hidden tab): keep the last height
  expect(page.style.getPropertyValue("--launch-dock-h")).toBe("313px");
  cleanup();
  expect(ro.count()).toBe(0);
  expect(page.style.getPropertyValue("--launch-dock-h")).toBe("");
});

it("keeps every intro layout above the measured dock", () => {
  const css = readFileSync(join(__dirname, "../src/renderer/src/components/LaunchPage.css"), "utf8");
  const bottoms = [...css.matchAll(/([^{}]*launch-intro[^{}]*)\{[^}]*\bbottom:\s*([^;]+);/g)].map((m) => [m[1]!.trim(), m[2]!.trim()]);
  // Each rule that anchors an intro's bottom must leave at least the dock's height free.
  expect(bottoms.length).toBeGreaterThanOrEqual(5);
  for (const [selector, value] of bottoms) expect(value, selector).toMatch(/var\(--launch-dock-h/);
});
