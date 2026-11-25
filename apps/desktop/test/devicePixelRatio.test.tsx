// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ceilToDevicePixel, roundToDevicePixel, useDevicePixelRatio } from "../src/renderer/src/lib/pixelRatio";
import { OwnerDocumentContext } from "../src/renderer/src/lib/ownerContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
function Value() { return h("output", null, String(useDevicePixelRatio())); }
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("devicePixelRatio", 1.25);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("shares its resolution listener and follows successive zoom/display changes", () => {
  const queries: { query: string; change: () => void; remove: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const entry = { query, change: () => {}, remove: vi.fn() }; queries.push(entry);
    return { addEventListener: (_type: string, fn: () => void) => { entry.change = fn; }, removeEventListener: entry.remove };
  }));
  act(() => root.render(h("div", null, h(Value), h(Value))));
  expect(queries.map(q => q.query)).toEqual(["(resolution: 1.25dppx)"]);
  expect([...host.querySelectorAll("output")].map(el => el.textContent)).toEqual(["1.25", "1.25"]);
  vi.stubGlobal("devicePixelRatio", 1.5);
  act(() => queries[0]!.change());
  expect(queries[0]!.remove).toHaveBeenCalledOnce();
  expect(queries[1]!.query).toBe("(resolution: 1.5dppx)");
  expect(host.textContent).toBe("1.51.5");
  vi.stubGlobal("devicePixelRatio", 2);
  act(() => queries[1]!.change());
  expect(host.textContent).toBe("22");
  expect(queries[2]!.query).toBe("(resolution: 2dppx)");
  act(() => root.render(null));
  expect(queries[2]!.remove).toHaveBeenCalledOnce();
});

it("uses the desk's display ratio rather than the main window's", () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const desk = frame.contentDocument!, win = frame.contentWindow!;
  Object.defineProperty(win, "devicePixelRatio", { configurable: true, value: 1.5, writable: true });
  try {
    act(() => root.render(h(OwnerDocumentContext.Provider, { value: desk }, h(Value))));
    expect(host.textContent).toBe("1.5");
    vi.stubGlobal("devicePixelRatio", 2);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(host.textContent).toBe("1.5");
    Object.defineProperty(win, "devicePixelRatio", { configurable: true, value: 1.25 });
    act(() => win.dispatchEvent(new Event("resize")));
    expect(host.textContent).toBe("1.25");
    act(() => root.render(null));
  } finally { frame.remove(); }
});

// The timeline's bottom-follow room and its column padding / lead (components/Conversation) sit on whole device pixels:
// at 1.875 a part-pixel length moved what follows by a part of a pixel, and some lines jumped while others stayed.
it("puts lengths on the device pixel grid (1.875: whole multiples of 8/15 px)", () => {
  const onGrid = (px: number, ratio: number) => Math.abs(px * ratio - Math.round(px * ratio)) < 1e-9;
  for (const v of [2.1, 46, 76.27, 0.4, 13.7]) {
    expect(onGrid(roundToDevicePixel(v, 1.875), 1.875)).toBe(true);
    expect(onGrid(ceilToDevicePixel(v, 1.875), 1.875)).toBe(true);
    expect(Math.abs(roundToDevicePixel(v, 1.875) - v)).toBeLessThanOrEqual(0.5 / 1.875 + 1e-9);
    expect(ceilToDevicePixel(v, 1.875)).toBeGreaterThanOrEqual(v - 0.02 / 1.875);
  }
  expect(ceilToDevicePixel(46, 1.875)).toBeCloseTo(46.4, 9); // the lead in the 1.875 check: 86.25 -> 87 device px
  expect(roundToDevicePixel(2.13336, 1.875)).toBeCloseTo(32 / 15, 9); // already 4 device px: unchanged
  expect(roundToDevicePixel(24, 2)).toBe(24);
  expect(ceilToDevicePixel(16, 1.25)).toBe(16);
  // A hair over a boundary (layout float noise) does not add a pixel; a bad ratio falls back to 1.
  expect(ceilToDevicePixel(32 / 15 + 1e-6, 1.875)).toBeCloseTo(32 / 15, 9);
  expect(roundToDevicePixel(3.4, 0)).toBe(3);
  expect(ceilToDevicePixel(3.4, Number.NaN)).toBe(4);
});
