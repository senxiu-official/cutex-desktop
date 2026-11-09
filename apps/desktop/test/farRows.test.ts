// @vitest-environment jsdom
// #19 (docs/research/perf-baseline-20261020.md §10): far timeline rows keep the exact gaps they had to their neighbours
// (their children's margins stop collapsing while skipped), and a jump into a far row draws it first.
import { describe, expect, it, vi } from "vitest";
import { drawRow, FAR_ATTR, farGaps, watchFarRowsScroll } from "../src/renderer/src/lib/farRows";

const rect = (el: Element, top: number, bottom: number) => (el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect);

describe("far rows", () => {
  it("measure each row's gap to the previous / next sibling, and to the list's padding box at the ends", () => {
    document.body.innerHTML = `<div id="list" style="padding-top: 10px; padding-bottom: 6px"><div id="a"></div><div id="b"></div><div id="c"></div></div>`;
    const list = document.getElementById("list")!;
    const [a, b, c] = ["a", "b", "c"].map((id) => document.getElementById(id)!);
    rect(list, 0, 200);
    rect(a!, 18, 60); // 8 px below the padding (a child's margin-top)
    rect(b!, 72, 120); // 12 px collapsed margin between a and b
    rect(c!, 128, 190); // 8 px; 4 px above the bottom padding
    expect(farGaps(list, [a!, b!, c!])).toEqual([[8, 12], [12, 8], [8, 4]]);
    expect(farGaps(list, [])).toEqual([]);
  });

  it("measures past siblings without a box (an empty attachments list), never to their all-zero rect", () => {
    document.body.innerHTML = `<div id="list"><div id="a"></div><div id="none1" style="display: none"></div><div id="b"></div><div id="none2" style="display: none"></div></div>`;
    const list = document.getElementById("list")!;
    const [a, none1, b, none2] = ["a", "none1", "b", "none2"].map((id) => document.getElementById(id)!);
    // The column is scrolled far down: rows sit at large negative viewport offsets, a hidden sibling reports 0.
    rect(list, -9000, 200);
    rect(a!, -8000, -7976);
    rect(none1!, 0, 0);
    rect(b!, -7968, -7900);
    rect(none2!, 0, 0);
    expect(farGaps(list, [a!, b!])).toEqual([[1000, 8], [8, 8100]]);
  });

  it("drawRow undoes a far row (attribute and the kept margins)", () => {
    document.body.innerHTML = `<div id="list"><div id="r" data-tl-row ${FAR_ATTR} style="margin-top: 8px; margin-bottom: 12px; contain-intrinsic-block-size: 351px"><p><button id="btn">x</button></p></div></div>`;
    drawRow(document.getElementById("btn")!);
    const r = document.getElementById("r")!;
    expect(r.hasAttribute(FAR_ATTR)).toBe(false);
    expect(r.style.marginTop).toBe("");
    expect(r.style.marginBottom).toBe("");
    expect(r.style.containIntrinsicBlockSize).toBe("");
  });

  it("draws hidden rows before the wheel default, keeps them drawn through momentum, and rechecks only after idle", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="scroller"><div id="list"><div data-tl-row ${FAR_ATTR}><p>older history</p></div></div></div>`;
    const root = document.getElementById("scroller")!;
    const list = document.getElementById("list")!;
    const recheck = vi.fn();
    const watch = watchFarRowsScroll(root, list, recheck);
    try {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -4500 }));
      expect(list.querySelector(`[${FAR_ATTR}]`)).toBeNull();
      expect(watch.active()).toBe(true);
      vi.advanceTimersByTime(200);
      root.dispatchEvent(new Event("scroll")); // compositor momentum, after the wheel ended
      vi.advanceTimersByTime(200);
      expect(watch.active()).toBe(true);
      expect(recheck).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(watch.active()).toBe(false);
      expect(recheck).toHaveBeenCalledOnce();
      list.firstElementChild!.setAttribute(FAR_ATTR, "");
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
      expect(list.querySelector(`[${FAR_ATTR}]`)).toBeNull();
      watch.stop();
      vi.runAllTimers();
      expect(recheck).toHaveBeenCalledOnce(); // cleanup cancels the pending re-hide
    } finally {
      watch.stop();
      vi.useRealTimers();
    }
  });
});
