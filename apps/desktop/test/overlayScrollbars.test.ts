import { describe, expect, it } from "vitest";
import {
  type Axis,
  type BoxStyle,
  INTENT_WINDOW,
  THUMB,
  clippingAncestors,
  coverSamples,
  longestUncovered,
  innermostScrollers,
  intersect,
  overflowing,
  scrollForDrag,
  scrollKey,
  scrollsOn,
  thumbGeometry,
  thumbRect,
  trackRect,
  userScroll,
} from "../src/renderer/src/lib/overlayScrollbars";

describe("overlay scrollbars: thumb maths", () => {
  it("sizes the thumb by view / content and places it by scroll position", () => {
    expect(thumbGeometry({ view: 100, content: 400, pos: 0, track: 200 })).toEqual({ size: 50, offset: 0 });
    expect(thumbGeometry({ view: 100, content: 400, pos: 300, track: 200 })).toEqual({ size: 50, offset: 150 });
    expect(thumbGeometry({ view: 100, content: 400, pos: 150, track: 200 })).toEqual({ size: 50, offset: 75 });
  });

  it("keeps a minimum length, never longer than the track", () => {
    expect(thumbGeometry({ view: 100, content: 100_000, pos: 0, track: 200 })?.size).toBe(THUMB.min);
    expect(thumbGeometry({ view: 100, content: 100_000, pos: 0, track: 10 })?.size).toBe(10);
    expect(thumbGeometry({ view: 100, content: 101_000, pos: 100_900, track: 200 })).toEqual({ size: THUMB.min, offset: 200 - THUMB.min });
  });

  it("has no thumb without overflow (rounding slack included) or without a track", () => {
    expect(thumbGeometry({ view: 100, content: 100, pos: 0, track: 200 })).toBeNull();
    expect(thumbGeometry({ view: 100, content: 101, pos: 0, track: 200 })).toBeNull();
    expect(thumbGeometry({ view: 100, content: 102, pos: 0, track: 200 })).not.toBeNull();
    expect(thumbGeometry({ view: 100, content: 400, pos: 0, track: 0 })).toBeNull();
    expect(thumbGeometry({ view: 0, content: 400, pos: 0, track: 200 })).toBeNull();
  });

  it("clamps overscroll and maps an RTL scrollLeft (0 … -range) from the right", () => {
    expect(thumbGeometry({ view: 100, content: 400, pos: -50, track: 200 })?.offset).toBe(0);
    expect(thumbGeometry({ view: 100, content: 400, pos: 999, track: 200 })?.offset).toBe(150);
    expect(thumbGeometry({ view: 100, content: 400, pos: 0, track: 200, rtl: true })?.offset).toBe(150);
    expect(thumbGeometry({ view: 100, content: 400, pos: -50, track: 200, rtl: true })?.offset).toBe(125);
    expect(thumbGeometry({ view: 100, content: 400, pos: -300, track: 200, rtl: true })?.offset).toBe(0);
  });

  it("drags as the inverse of the geometry, under any scale", () => {
    const g = thumbGeometry({ view: 100, content: 400, pos: 0, track: 200 })!;
    // Moving the thumb across its free track scrolls the whole range.
    expect(scrollForDrag(200 - g.size, { view: 100, content: 400, track: 200, size: g.size })).toBe(300);
    expect(scrollForDrag(-15, { view: 100, content: 400, track: 200, size: g.size })).toBe(-30);
    // Track measured in zoomed screen px (×2), scroll units unzoomed: same proportion.
    expect(scrollForDrag(150, { view: 100, content: 400, track: 400, size: 100 })).toBe(150);
    expect(scrollForDrag(10, { view: 100, content: 400, track: 50, size: 50 })).toBe(0);
  });

  it("lays the strip along the edge, short of the corner when both axes scroll", () => {
    const box = { left: 10, top: 20, width: 300, height: 200 };
    expect(trackRect(box, "y", false)).toEqual({ left: 310 - THUMB.hit, top: 20 + THUMB.inset, width: THUMB.hit, height: 200 - 2 * THUMB.inset });
    expect(trackRect(box, "y", true).height).toBe(200 - 2 * THUMB.inset - THUMB.hit);
    expect(trackRect(box, "x", false)).toEqual({ left: 10 + THUMB.inset, top: 220 - THUMB.hit, width: 300 - 2 * THUMB.inset, height: THUMB.hit });
    expect(trackRect({ left: 0, top: 0, width: 4, height: 2 }, "y", true).height).toBe(0);
    const track = trackRect(box, "y", false);
    expect(thumbRect(track, "y", { size: 30, offset: 12 })).toEqual({ left: track.left, top: track.top + 12, width: THUMB.hit, height: 30 });
    const xTrack = trackRect(box, "x", false);
    expect(thumbRect(xTrack, "x", { size: 30, offset: 12 })).toEqual({ left: xTrack.left + 12, top: xTrack.top, width: 30, height: THUMB.hit });
  });

  it("intersects rects", () => {
    expect(intersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 })).toEqual({ left: 5, top: 5, width: 5, height: 5 });
    expect(intersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 10, height: 10 })).toBeNull();
  });

  it("knows which overflow values scroll", () => {
    expect(["auto", "scroll", "overlay"].map(scrollsOn)).toEqual([true, true, true]);
    expect(["visible", "hidden", "clip"].map(scrollsOn)).toEqual([false, false, false]);
    expect(overflowing(101, 100)).toBe(false);
    expect(overflowing(102, 100)).toBe(true);
  });
});

/** A fake DOM chain: name → which axes it scrolls on, opt-out flag. */
function probe(spec: Record<string, { x?: boolean; y?: boolean; optOut?: boolean }>) {
  return {
    optOut: (el: string) => spec[el]?.optOut === true,
    scrolls: (el: string, axis: Axis) => spec[el]?.[axis] === true,
  };
}

describe("overlay scrollbars: which scroller", () => {
  it("picks the innermost scroller per axis", () => {
    const p = probe({ timeline: { y: true }, pre: { x: true }, list: { y: true } });
    expect(innermostScrollers(["code", "pre", "turn", "timeline", "main", "html"], p)).toEqual({ x: "pre", y: "timeline" });
    // A nested vertical scroller hides the outer one on hover (the outer shows only when it scrolls).
    expect(innermostScrollers(["row", "list", "card", "timeline", "html"], p)).toEqual({ x: null, y: "list" });
    expect(innermostScrollers(["span", "div", "html"], p)).toEqual({ x: null, y: null });
  });

  it("one element scrolling both ways serves both axes", () => {
    const p = probe({ diff: { x: true, y: true } });
    expect(innermostScrollers(["line", "diff", "card"], p)).toEqual({ x: "diff", y: "diff" });
  });

  it("skips everything at or inside an opt-out, but still finds scrollers above it", () => {
    const p = probe({ viewport: { y: true }, terminal: { optOut: true }, card: { y: true }, tabs: { x: true, optOut: true } });
    expect(innermostScrollers(["row", "viewport", "terminal", "card", "html"], p)).toEqual({ x: null, y: "card" });
    // The opt-out element itself is skipped too.
    expect(innermostScrollers(["tab", "tabs", "head", "html"], p)).toEqual({ x: null, y: null });
    // Nested opt-outs: the outermost one bounds the skipped part.
    const nested = probe({ inner: { y: true, optOut: true }, mid: { y: true }, outer: { optOut: true }, page: { y: true } });
    expect(innermostScrollers(["x", "inner", "mid", "outer", "page"], nested)).toEqual({ x: null, y: "page" });
  });
});

describe("overlay scrollbars: clipping ancestors", () => {
  const box = (position: string, clips = false, containsFixed = false): BoxStyle => ({ position, clips, containsFixed });

  it("an in-flow scroller is clipped by every clipping ancestor", () => {
    expect(clippingAncestors([box("static"), box("static", true), box("relative"), box("static", true)])).toEqual([1, 3]);
  });

  it("an absolute scroller skips static ancestors up to its positioned one", () => {
    expect(clippingAncestors([box("absolute"), box("static", true), box("relative", true), box("static", true)])).toEqual([2, 3]);
    // A transformed ancestor is a containing block too.
    expect(clippingAncestors([box("absolute"), box("static", true, true), box("static", true)])).toEqual([1, 2]);
  });

  it("a fixed scroller escapes all but a transformed (or similar) ancestor", () => {
    expect(clippingAncestors([box("fixed"), box("relative", true), box("static", true)])).toEqual([]);
    expect(clippingAncestors([box("fixed"), box("static", true), box("static", true, true), box("static", true)])).toEqual([2, 3]);
  });

  it("follows the chain through an absolute ancestor", () => {
    // scroller (static) → panel (absolute, clips) → static wrapper (clips, skipped) → card (relative, clips)
    expect(clippingAncestors([box("static"), box("absolute", true), box("static", true), box("relative", true)])).toEqual([1, 3]);
  });
});

describe("overlay scrollbars: user scrolls", () => {
  const contains = (outer: string, inner: string) => inner.startsWith(outer);

  it("counts a scroll that follows a wheel / key over the scroller", () => {
    expect(userScroll({ at: 1000, target: "timeline/turn" }, 1100, "timeline", contains)).toBe(true);
    // Chained to an outer scroller: still the user's.
    expect(userScroll({ at: 1000, target: "timeline/card/list" }, 1100, "timeline", contains)).toBe(true);
    // Focus on the page: any scroller.
    expect(userScroll({ at: 1000, target: null }, 1100, "sidebar", contains)).toBe(true);
  });

  it("ignores code scrolls: no recent input, or input elsewhere", () => {
    expect(userScroll(null, 1100, "timeline", contains)).toBe(false);
    expect(userScroll({ at: 1000, target: "timeline/turn" }, 1000 + INTENT_WINDOW + 1, "timeline", contains)).toBe(false);
    // Typing in the composer while the timeline sticks to the bottom.
    expect(userScroll({ at: 1000, target: "composer/textarea" }, 1100, "timeline", contains)).toBe(false);
  });

  it("knows the scrolling keys", () => {
    expect(["PageDown", "End", " ", "ArrowUp"].every(scrollKey)).toBe(true);
    expect(["a", "Enter", "Tab"].some(scrollKey)).toBe(false);
  });
});

describe("thumb cover clipping", () => {
  it("samples about every 12 px, between 3 and 24", () => {
    expect(coverSamples(10)).toBe(3);
    expect(coverSamples(120)).toBe(10);
    expect(coverSamples(2000)).toBe(24);
  });
  it("keeps the longest uncovered run", () => {
    expect(longestUncovered([false, false, false])).toEqual([0, 2]);
    expect(longestUncovered([true, true])).toBeNull();
    // A menu over the lower part of the sidebar: the thumb keeps its upper part.
    expect(longestUncovered([false, false, false, false, true, true])).toEqual([0, 3]);
    expect(longestUncovered([true, false, false, true, false])).toEqual([1, 2]);
    expect(longestUncovered([false, true, false])).toEqual([0, 0]);
  });
});
