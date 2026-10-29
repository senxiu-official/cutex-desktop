// @vitest-environment jsdom
// The live drop preview (owner 2026-10-23, lib/dropMorph): the real panes move to where the drop puts them by transform
// and clip-path only, their instance boxes with them; the drag's hit tests use the panes' resting boxes; a drop ends it
// at once, a cancel glides back; prefers-reduced-motion: no morph. And Rail look A: the panes of a Shelf page never
// overlap — the standard gap between them (the owner's terminal-under-a-web-page screenshot, 2026-10-23).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endMorph, inMorphed, morphHit, morphing, morphStyle, morphTo, resetMorph, restRect } from "../src/renderer/src/lib/dropMorph";
import { pageForecast } from "../src/renderer/src/lib/dropForecast";
import { CARD_GAP, SHELF_PANE_GAP } from "../src/renderer/src/lib/sideLayout";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** An element whose box is `b` plus whatever translate its inline transform says (jsdom lays nothing out). */
function boxed(b: { left: number; top: number; width: number; height: number }, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => {
    let dx = 0;
    let dy = 0;
    let at: HTMLElement | null = el;
    while (at) {
      const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(at.style.transform);
      if (m) {
        dx += Number(m[1]);
        dy += Number(m[2]);
      }
      at = at.parentElement;
    }
    return { left: b.left + dx, top: b.top + dy, width: b.width, height: b.height, right: b.left + dx + b.width, bottom: b.top + dy + b.height, x: b.left + dx, y: b.top + dy, toJSON: () => ({}) } as DOMRect;
  };
  return el;
}

beforeEach(() => {
  resetMorph();
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

describe("morphStyle", () => {
  it("a translate to the new place and a clip to the new size (never a scale)", () => {
    expect(morphStyle({ left: 0, top: 40, width: 400, height: 420 }, { left: 0, top: 40, width: 400, height: 276 })).toEqual({ transform: "translate(0px, 0px)", clipPath: "inset(0px 0px 144px 0px round 12px)" });
    expect(morphStyle({ left: 300, top: 40, width: 446, height: 800 }, { left: 760, top: 40, width: 500, height: 800 })).toEqual({ transform: "translate(460px, 0px)", clipPath: "none" });
  });
});

describe("morphTo / endMorph", () => {
  it("moves the pane and its instance boxes; hit tests and boxes stay where the pane rests", () => {
    const card = boxed({ left: 1000, top: 40, width: 400, height: 420 }, { "data-side-card": "c3" });
    const head = boxed({ left: 1000, top: 40, width: 400, height: 36 }, { "data-side-card-head": "c3" });
    card.appendChild(head);
    const inst = boxed({ left: 1000, top: 76, width: 400, height: 384 }, { "data-side-card-of": "c3" });
    document.body.append(card, inst);
    morphTo([{ el: card, to: { left: 1000, top: 470, width: 400, height: 276 }, card: { id: "c3", peer: null } }]);
    expect(morphing()).toBe(true);
    expect(card.style.transform).toBe("translate(0px, 430px)");
    expect(card.style.clipPath).toBe("inset(0px 0px 144px 0px round 12px)");
    expect(inst.style.transform).toBe("translate(0px, 430px)");
    expect(inst.style.clipPath).toBe("inset(0px 0px 144px 0px)");
    // At rest for the drag: the pane's own box and its header's, not where it shows now.
    expect(restRect(card)).toMatchObject({ top: 40, height: 420 });
    expect(restRect(head)).toMatchObject({ top: 40 });
    expect(morphHit(1100, 50)).toBe(head);
    expect(morphHit(1100, 300)).toBe(card);
    expect(morphHit(1100, 600)).toBeNull(); // where it shows now is not where it is hit
    expect(inMorphed(head)).toBe(true);
    // A drop: the transforms go at once (the new layout lands there), the instance layer measures again.
    endMorph(true);
    expect(card.style.transform).toBe("");
    expect(card.style.transition).toBe("none");
    expect(inst.style.transform).toBe("");
    expect(morphing()).toBe(false);
  });

  it("another target: a pane no longer moved glides back; a cancel ends after the glide", () => {
    vi.useFakeTimers();
    const a = boxed({ left: 0, top: 0, width: 400, height: 400 });
    document.body.append(a);
    morphTo([{ el: a, to: { left: 0, top: 200, width: 400, height: 200 } }]);
    morphTo([]);
    expect(a.style.transform).toBe("");
    expect(a.style.transition).toContain("transform");
    expect(morphing()).toBe(true); // still gliding back: the instance layer waits
    vi.advanceTimersByTime(300);
    expect(morphing()).toBe(false);
  });

  it("prefers-reduced-motion: nothing moves", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const a = boxed({ left: 0, top: 0, width: 400, height: 400 });
    document.body.append(a);
    morphTo([{ el: a, to: { left: 0, top: 200, width: 400, height: 200 } }]);
    expect(a.style.transform).toBe("");
    expect(morphing()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("Rail look A: the panes of a page never overlap", () => {
  it("the standard gap between panes; every pane ends before the next one starts", () => {
    expect(SHELF_PANE_GAP).toBe(CARD_GAP);
    const boxes = [...pageForecast(
      [
        { id: "web", size: 0.7, collapsed: false },
        { id: "term", size: 0.3, collapsed: false },
      ],
      { left: 1000, top: 40, width: 900, height: 1600 },
      SHELF_PANE_GAP,
    ).values()];
    expect(boxes[1]!.top - (boxes[0]!.top + boxes[0]!.height)).toBeCloseTo(CARD_GAP);
  });

  it("every pane's instance gets the outer bottom corner (each pane is its own card on the rail)", () => {
    const src = readFileSync(resolve(__dirname, "../src/renderer/src/components/side/SideInstanceLayer.tsx"), "utf8");
    const fn = src.slice(src.indexOf("function bodyCorners"), src.indexOf("function bodyCorners") + 400);
    expect(fn).not.toContain("nextElementSibling");
    expect(fn).toContain('"rounded-bl-inner" : "rounded-br-inner"');
  });
});
