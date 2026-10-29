// @vitest-environment jsdom
// #14: the acrylic blur drawn once (components/AcrylicFrost): the blurred desktop copy is clipped to the cards
// that paint (rounded like them), never to a card that lets the desktop through.
import { describe, expect, it } from "vitest";
import { cardsClip, roundedRect, transparent } from "../src/renderer/src/components/AcrylicFrost";

const box = (el: Element, left: number, top: number, width: number, height: number) =>
  (el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect);

describe("acrylic frost clip", () => {
  it("rounded rectangles, radii clamped to the box", () => {
    expect(roundedRect(10, 20, 100, 50, 0)).toBe("M10,20H110V70H10Z");
    expect(roundedRect(0, 0, 100, 50, 12)).toBe("M12,0H88A12,12 0 0 1 100,12V38A12,12 0 0 1 88,50H12A12,12 0 0 1 0,38V12A12,12 0 0 1 12,0Z");
    expect(roundedRect(0, 0, 10, 10, 40)).toContain("A5,5");
    // Each corner its own (a Shelf pane, Rail look A: square on the rail's side); equal radii = the one-radius path.
    expect(roundedRect(0, 0, 100, 50, [0, 14, 14, 0])).toBe("M0,0H86A14,14 0 0 1 100,14V36A14,14 0 0 1 86,50H0V0Z");
    expect(roundedRect(0, 0, 100, 50, [12, 12, 12, 12])).toBe(roundedRect(0, 0, 100, 50, 12));
  });
  it("one part per painting card, relative to the layer; transparent and empty cards skipped", () => {
    document.body.innerHTML = `<div id="a" style="background-color: rgba(250, 249, 245, 0.7); border-top-left-radius: 12px"></div><div id="b" style="background-color: transparent"></div><div id="c" style="background-color: rgb(1, 2, 3)"></div><div id="d" style="background-color: rgb(1, 2, 3)"></div>`;
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => document.getElementById(id)!);
    box(a!, 18, 48, 240, 800);
    box(b!, 300, 48, 600, 800);
    box(c!, 1000, 48, 300, 800);
    box(d!, 0, 0, 0, 0);
    const origin = { left: 8, top: 8 } as DOMRect;
    const clip = cardsClip(origin, [a!, b!, c!, d!]);
    expect(clip.startsWith('path("M22,40H')).toBe(true);
    expect(clip).toContain("M992,40H1292V840H992Z");
    expect(clip.match(/M/g)!.length).toBe(2);
    expect(cardsClip(origin, [b!])).toBe("inset(50%)");
  });
  it("transparent colours", () => {
    expect(transparent("transparent")).toBe(true);
    expect(transparent("rgba(0, 0, 0, 0)")).toBe(true);
    expect(transparent("rgb(0 0 0 / 0)")).toBe(true);
    expect(transparent("rgba(250, 249, 245, 0.7)")).toBe(false);
    expect(transparent("rgb(1, 2, 3)")).toBe(false);
  });
});
