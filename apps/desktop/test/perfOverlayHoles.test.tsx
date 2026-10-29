// @vitest-environment jsdom
// 0.2.0 beta perf audit (2026-10-24): a preview layer (drop preview, foretell) looked for open popovers with a
// whole-document querySelectorAll on every frame while it showed — ~20 % of the main thread during a tray / sidebar /
// pane drag. With no popover open it now looks every HOLE_SEARCH_MS; while one is open, every frame (as before).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLE_SEARCH_MS, useOverlayHoles } from "../src/renderer/src/lib/overlayHoles";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let frames: FrameRequestCallback[] = [];
let clock = 0;
let queries = 0;
const clips: (string | undefined)[] = [];

function Layer({ active }: { active: boolean }) {
  clips.push(useOverlayHoles(active));
  return null;
}

/** One animation frame, `ms` after the last. */
function frame(ms = 16) {
  clock += ms;
  const run = frames;
  frames = [];
  act(() => {
    for (const f of run) f(clock);
  });
}

beforeEach(() => {
  frames = [];
  clock = 1000;
  queries = 0;
  clips.length = 0;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.push(f), frames.length));
  vi.stubGlobal("cancelAnimationFrame", () => (frames = []));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const qsa = Document.prototype.querySelectorAll;
  vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(function (this: Document, sel: string) {
    queries++;
    return qsa.call(this, sel);
  } as typeof qsa);
  // jsdom has no layout: a popover reports a fixed box.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ left: 100, top: 100, width: 200, height: 80, right: 300, bottom: 180, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-popover]").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useOverlayHoles (lib/overlayHoles)", () => {
  it("with no popover open, a showing layer searches the document every HOLE_SEARCH_MS, not every frame", () => {
    act(() => root.render(h(Layer, { active: true })));
    for (let i = 0; i < 60; i++) frame(16); // ~1 s of a drag
    expect(queries).toBeLessThanOrEqual(Math.ceil((60 * 16) / HOLE_SEARCH_MS) + 1);
    expect(queries).toBeGreaterThan(1);
    expect(clips.at(-1)).toBeUndefined();
  });

  it("a menu opening mid-drag gets its hole within HOLE_SEARCH_MS, then is followed every frame", () => {
    act(() => root.render(h(Layer, { active: true })));
    frame(16);
    const menu = document.createElement("div");
    menu.setAttribute("data-popover", "");
    document.body.append(menu);
    let waited = 0;
    while (clips.at(-1) === undefined && waited < HOLE_SEARCH_MS + 32) {
      frame(16);
      waited += 16;
    }
    expect(clips.at(-1)).toContain("evenodd");
    expect(waited).toBeLessThanOrEqual(HOLE_SEARCH_MS + 16);
    // Open: searched on every frame (a submenu, the menu closing).
    const before = queries;
    for (let i = 0; i < 5; i++) frame(16);
    expect(queries - before).toBe(5);
    menu.remove();
    frame(16);
    expect(clips.at(-1)).toBeUndefined();
  });

  it("does nothing while the layer shows nothing", () => {
    act(() => root.render(h(Layer, { active: false })));
    for (let i = 0; i < 10; i++) frame(16);
    expect(queries).toBe(0);
    expect(frames).toHaveLength(0);
  });
});
