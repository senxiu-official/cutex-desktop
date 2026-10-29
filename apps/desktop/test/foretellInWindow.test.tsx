// @vitest-environment jsdom
// 动作预告 in the window that draws it (lib/foretell, components/ForetellLayer; dual-screen run 2026-10-28): the ⌘K
// 「delta 并排打开」 chip was cut off at a desk window's right edge. The 并排 mark was a fixed box measured from the
// main window's work row (lib/workspaceEffects `halfOfRow` → queryAppWindows, main first), wider than the desk's, so
// its outline and the sentence centred on it ran past the desk. Now the mark names that half of the row and the
// layer measures it in its own window, and every mark is cut to the window's viewport. The desk here is an iframe's
// document, as in test/deskPortals.test.tsx.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForetellLayer } from "../src/renderer/src/components/ForetellLayer";
import { boxInView, clearForetell, halfBox, sameForetell, setForetell, type Foretell } from "../src/renderer/src/lib/foretell";
import { agentForetell } from "../src/renderer/src/lib/workspaceEffects";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Box = { left: number; top: number; width: number; height: number };

function stubRect(el: Element, b: Box): void {
  (el as HTMLElement).getBoundingClientRect = () => ({ ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b }) as DOMRect;
}

function sideWork(doc: Document, b: Box): HTMLElement {
  const el = doc.createElement("div");
  el.setAttribute("data-side-work", "");
  stubRect(el, b);
  doc.body.append(el);
  return el;
}

const markBox = (el: HTMLElement): Box => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) });

describe("pure parts", () => {
  it("halfBox: the left / right half of a row, 4 px apart", () => {
    const row = { left: 100, top: 40, width: 1000, height: 600 };
    expect(halfBox(row, "left")).toEqual({ left: 100, top: 40, width: 496, height: 600 });
    expect(halfBox(row, "right")).toEqual({ left: 604, top: 40, width: 496, height: 600 });
  });

  it("boxInView: kept inside, cut at the window's edges, null when outside", () => {
    const view = { width: 1041, height: 760 };
    expect(boxInView({ left: 10, top: 10, width: 300, height: 200 }, view)).toEqual({ left: 10, top: 10, width: 300, height: 200 });
    expect(boxInView({ left: 774, top: 40, width: 500, height: 900 }, view)).toEqual({ left: 774, top: 40, width: 267, height: 720 });
    expect(boxInView({ left: -20, top: -5, width: 100, height: 100 }, view)).toEqual({ left: 0, top: 0, width: 80, height: 95 });
    expect(boxInView({ left: 1100, top: 40, width: 300, height: 300 }, view)).toBeNull();
  });

  it("sameForetell tells the halves apart", () => {
    const f = (half: "left" | "right"): Foretell => ({ tone: "beside", text: "x", marks: [{ selector: "[data-side-work]", half }] });
    expect(sameForetell(f("right"), f("right"))).toBe(true);
    expect(sameForetell(f("right"), f("left"))).toBe(false);
  });

  it("the 并排 foretell names the row's half instead of a box measured now (in whichever window came first)", () => {
    const main = sideWork(document, { left: 270, top: 40, width: 1500, height: 900 });
    try {
      const f = agentForetell({ kind: "beside", side: "right", restore: false }, "delta")!;
      expect(f.tone).toBe("beside");
      expect(f.marks).toEqual([{ selector: "[data-side-work]", half: "right" }]);
    } finally {
      main.remove();
    }
  });
});

describe("ForetellLayer", () => {
  let host: HTMLDivElement;
  let root: Root;
  let frame: HTMLIFrameElement;
  const owner = {};

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    frame = document.createElement("iframe");
    document.body.append(frame);
  });

  afterEach(() => {
    act(() => clearForetell());
    act(() => root.unmount());
    host.remove();
    frame.remove();
    for (const el of document.querySelectorAll("[data-side-work]")) el.remove();
  });

  it("a 并排 mark shown in a desk outlines the desk's own row half, inside the desk window (not main's wider row)", () => {
    // Main: a wide window; the desk: 1041 px wide, its row narrower and the first [data-side-work] main would find is main's.
    sideWork(document, { left: 270, top: 40, width: 1500, height: 900 });
    const desk = frame.contentDocument!;
    const deskWin = frame.contentWindow!;
    Object.defineProperty(deskWin, "innerWidth", { configurable: true, value: 1041 });
    Object.defineProperty(deskWin, "innerHeight", { configurable: true, value: 760 });
    sideWork(desk, { left: 270, top: 40, width: 760, height: 700 });
    act(() => root.render(h(ForetellLayer)));
    act(() => setForetell(owner, agentForetell({ kind: "beside", side: "right", restore: false }, "delta"), desk));
    const mark = desk.querySelector<HTMLElement>("[data-foretell-mark]")!;
    expect(mark).not.toBeNull();
    expect(document.querySelector("[data-foretell-mark]")).toBeNull();
    // The desk row's right half (270 + 380 + 4 = 654, 376 wide), inset 3 px by the layer.
    expect(markBox(mark)).toEqual({ left: 657, top: 43, width: 370, height: 694 });
    const b = markBox(mark);
    expect(b.left + b.width).toBeLessThanOrEqual(1041);
    expect(mark.querySelector(".foretell-text")?.textContent).toContain("delta");
  });

  it("an area running past the window's right / bottom edge is cut there, so the sentence centred on it stays visible", () => {
    // jsdom's window: 1024 × 768.
    act(() => root.render(h(ForetellLayer)));
    act(() => setForetell(owner, { tone: "beside", text: "delta 并排打开", marks: [{ box: { left: 774, top: 40, width: 800, height: 900 } }] }));
    const b = markBox(host.querySelector<HTMLElement>("[data-foretell-mark]")!);
    expect(b).toEqual({ left: 777, top: 43, width: 1024 - 774 - 6, height: 768 - 40 - 6 });
  });

  it("an area wholly outside the window draws nothing", () => {
    act(() => root.render(h(ForetellLayer)));
    act(() => setForetell(owner, { tone: "open", text: "x", marks: [{ box: { left: 1200, top: 40, width: 300, height: 300 } }] }));
    expect(host.querySelector("[data-foretell-mark]")).toBeNull();
  });
});
