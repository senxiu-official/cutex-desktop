// @vitest-environment jsdom
// The tray card's 「… N」 (docs/design/038-shelf-page-groups.md item 5): trailing items that do not fit fold away,
// a group left empty loses its separator, everything fitting shows no 「… N」.
import { describe, expect, it } from "vitest";
import { fitDock, fitTray, foldUnits, groupRows } from "../src/renderer/src/lib/trayFold";

/** A dock of `n` items (32 px each, in two groups) `width` px wide; scrollWidth follows what is not folded. */
function dock(n: number, width: number) {
  const el = document.createElement("div");
  el.innerHTML =
    `<span class="contents"><span class="tray-group">${Array.from({ length: Math.ceil(n / 2) }, (_, i) => `<span class="tray-slot"><button data-tray-item="" id="a${i}"></button><button class="tray-x"></button></span>`).join("")}</span></span>` +
    `<span class="contents"><span class="tray-sep"></span><span class="tray-group">${Array.from({ length: Math.floor(n / 2) }, (_, i) => `<span class="tray-slot"><button data-tray-item="" id="b${i}"></button></span>`).join("")}</span></span>` +
    `<button data-tray-item="" data-tray-more="" hidden></button>`;
  const more = el.querySelector<HTMLElement>("[data-tray-more]")!;
  const box = { width };
  Object.defineProperty(el, "clientWidth", { get: () => box.width });
  Object.defineProperty(el, "scrollWidth", { get: () => foldUnits(el).filter((u) => !u.closest("[data-tray-folded]")).length * 32 + (more.hidden ? 0 : 40) });
  document.body.append(el);
  return { el, more, box };
}

describe("fitDock (design 038)", () => {
  it("everything fits: nothing folds, 「… N」 stays hidden", () => {
    const { el, more } = dock(6, 400);
    expect(fitDock(el, more)).toBe(0);
    expect(more.hidden).toBe(true);
    expect(el.querySelectorAll("[data-tray-folded]")).toHaveLength(0);
  });

  it("too narrow: the trailing items fold (with their × slot) until the rest and 「… N」 fit; an emptied group loses its separator", () => {
    const { el, more, box } = dock(6, 150);
    // 6 × 32 = 192 > 150: with 「… N」 (40) there is room for 3 items
    expect(fitDock(el, more)).toBe(3);
    expect(more.hidden).toBe(false);
    expect(foldUnits(el).map((u) => !!u.closest("[data-tray-folded]"))).toEqual([false, false, false, true, true, true]);
    expect(el.querySelector(".tray-sep")!.closest("[data-tray-folded]")).not.toBeNull();
    // wider again: everything comes back
    box.width = 400;
    expect(fitDock(el, more)).toBe(0);
    expect(el.querySelectorAll("[data-tray-folded]")).toHaveLength(0);
  });
});

/**
 * A dock like the home Dock's: 钉住 (`pins` items), 最近 (`recent`, `data-tray-yield`) and 需要你 at the end, 32 px each, a
 * separator (8 px) before each group after the first; 「… N」 40 px. Two rows (`data-tray-rows="2"`): the items share two
 * rows (the width needed is half, rounded up to whole items); `tops` gives the units' offsetTop for the row count.
 */
function homeDock(pins: number, recent: number, width: number) {
  const el = document.createElement("div");
  const slots = (p: string, n: number) => Array.from({ length: n }, (_, i) => `<span class="tray-slot"><button data-tray-item="" id="${p}${i}"></button></span>`).join("");
  el.innerHTML =
    `<span class="contents"><span class="tray-group" data-tray-group="pinned">${slots("p", pins)}</span></span>` +
    `<span class="contents"><span class="tray-sep"></span><span class="tray-group" data-tray-group="recent" data-tray-yield="">${slots("r", recent)}</span></span>` +
    `<button data-tray-item="" id="needs"></button>` +
    `<button data-tray-item="" data-tray-more="" hidden></button>`;
  const more = el.querySelector<HTMLElement>("[data-tray-more]")!;
  const box = { width };
  const shownUnits = () => foldUnits(el).filter((u) => !u.closest("[data-tray-folded]")).length;
  const seps = () => [...el.querySelectorAll(".tray-sep")].filter((s) => !s.closest("[data-tray-folded]")).length;
  Object.defineProperty(el, "clientWidth", { get: () => box.width });
  Object.defineProperty(el, "scrollWidth", {
    get: () => {
      const items = el.getAttribute("data-tray-rows") === "2" ? Math.ceil(shownUnits() / 2) : shownUnits();
      return items * 32 + seps() * 8 + (more.hidden ? 0 : 40);
    },
  });
  document.body.append(el);
  const ids = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)].filter((b) => !b.closest("[data-tray-folded]")).map((b) => b.id);
  return { el, more, box, shown: () => ids("[data-tray-item]:not([data-tray-more])") };
}

describe("fitTray: pins before 最近 (owner 2026-10-24)", () => {
  it("最近 gives way first, from its end, without 「… N」; the pins stay whole", () => {
    // 4 pins + 4 recent + needs = 9 × 32 + 8 = 296; 230 holds 4 pins, 2 recent, needs (7 × 32 + 8 = 232 → 1 recent: 200)
    const { el, more, shown } = homeDock(4, 4, 240);
    const fit = fitTray(el, more);
    expect(fit).toEqual({ folded: [], yielded: 2, rows: 1 });
    expect(more.hidden).toBe(true);
    expect(shown()).toEqual(["p0", "p1", "p2", "p3", "r0", "r1", "needs"]);
    expect(el.querySelectorAll("[data-tray-yielded]")).toHaveLength(2);
  });

  it("more pins: 最近 shrinks down to none (its separator goes with it), and only then do pins fold behind 「… N」", () => {
    const { el, more, box, shown } = homeDock(6, 3, 6 * 32);
    // 6 pins + needs = 224 > 192: 最近 all gone, then 「… N」 (40) — p4, p5 and needs fold behind it (4 × 32 + 40 = 168)
    let fit = fitTray(el, more);
    expect(fit.yielded).toBe(3);
    expect(el.querySelector(".tray-sep")!.closest("[data-tray-folded]")).not.toBeNull();
    expect(more.hidden).toBe(false);
    expect(shown()).toEqual(["p0", "p1", "p2", "p3"]);
    // 「… N」 lists the folded pins (indices into foldUnits), never the 最近 ones left out
    expect(fit.folded).toEqual([4, 5, 9]);
    // a little wider: the pins come back before 最近 does
    box.width = 7 * 32 + 8;
    fit = fitTray(el, more);
    expect(fit).toEqual({ folded: [], yielded: 3, rows: 1 });
    expect(shown()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "needs"]);
    // wide enough: everything, nothing yielded
    box.width = 400;
    expect(fitTray(el, more)).toEqual({ folded: [], yielded: 0, rows: 1 });
    expect(el.querySelectorAll("[data-tray-folded], [data-tray-yielded]")).toHaveLength(0);
  });

  it("fitDock (one row) still returns N", () => {
    const { el, more } = homeDock(6, 3, 6 * 32);
    expect(fitDock(el, more)).toBe(3);
  });
});

describe("fitTray: 托盘两排", () => {
  it("off: one row (最近 gives way); on: two rows hold everything, nothing yields", () => {
    const { el, more, shown } = homeDock(6, 4, 200);
    expect(fitTray(el, more).rows).toBe(1);
    expect(el.hasAttribute("data-tray-rows")).toBe(false);
    const fit = fitTray(el, more, { twoRows: true });
    expect(fit).toEqual({ folded: [], yielded: 0, rows: 2 });
    expect(el.getAttribute("data-tray-rows")).toBe("2");
    expect(shown()).toHaveLength(11);
  });

  it("one row enough: stays one row even when on", () => {
    const { el, more } = homeDock(2, 2, 400);
    expect(fitTray(el, more, { twoRows: true })).toEqual({ folded: [], yielded: 0, rows: 1 });
    expect(el.hasAttribute("data-tray-rows")).toBe(false);
  });

  it("two rows not enough either: 最近 gives way, then pins fold — in two rows", () => {
    const { el, more, shown } = homeDock(10, 4, 4 * 32);
    // two rows: 15 items → 8 wide + sep = 264 > 128; 最近 gone: 11 → 6 × 32 = 192; 「… N」: 7 items → 4 × 32 + 40 = 168,
    // 5 → 3 × 32 + 40 = 136, 4 → 2 × 32 + 40 = 104 fits
    const fit = fitTray(el, more, { twoRows: true });
    expect(fit.rows).toBe(2);
    expect(fit.yielded).toBe(4);
    expect(shown()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(fit.folded).toEqual([4, 5, 6, 7, 8, 9, 14]);
  });

  it("a group that would need a third row does not fit two", () => {
    const g = document.createElement("span");
    g.className = "tray-group";
    g.innerHTML = Array.from({ length: 5 }, () => `<span class="tray-slot"><button data-tray-item=""></button></span>`).join("");
    const set = (tops: number[]) => [...g.children].forEach((u, i) => Object.defineProperty(u, "offsetTop", { configurable: true, get: () => tops[i] }));
    set([0, 0, 3, 42, 44]); // 34 px 「… N」-like items sit a little lower in their row
    expect(groupRows(g)).toBe(2);
    set([0, 42, 42, 84, 84]);
    expect(groupRows(g)).toBe(3);
    g.children[3]!.setAttribute("data-tray-folded", "");
    g.children[4]!.setAttribute("data-tray-folded", "");
    expect(groupRows(g)).toBe(2);
  });
});
