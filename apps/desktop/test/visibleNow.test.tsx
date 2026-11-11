// @vitest-environment jsdom
import { act, createElement as h, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisibleNow } from "../src/renderer/src/lib/visibleNow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let seen: number[];
let observed: IntersectionObserverCallback | null;
function Probe({ active }: { active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  seen.push(useVisibleNow(ref, active));
  return h("span", { ref });
}
const show = (active: boolean) => act(() => root.render(h(Probe, { active })));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  seen = [];
  observed = null;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback) { observed = cb; }
    observe() {}
    disconnect() { observed = null; }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const onScreen = (yes: boolean) => act(() => observed?.([{ isIntersecting: yes } as IntersectionObserverEntry], {} as IntersectionObserver));

describe("useVisibleNow", () => {
  it("ticks once a second while active and on screen", () => {
    show(true);
    const before = seen.length;
    // One tick per act (act batches the updates of one call into one render).
    for (let i = 0; i < 3; i++) tick(1000);
    expect(seen.length - before).toBeGreaterThanOrEqual(3);
    expect(seen.at(-1)).toBe(1_003_000);
  });

  it("holds no timer when inactive or off screen, and reads the time at once when it shows again", () => {
    show(false);
    const idle = seen.length;
    tick(5000);
    expect(seen.length).toBe(idle);
    show(true);
    onScreen(false);
    const off = seen.length;
    tick(5000);
    expect(seen.length).toBe(off);
    onScreen(true);
    expect(seen.at(-1)).toBe(1_010_000);
  });
});
