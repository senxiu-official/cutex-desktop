// @vitest-environment jsdom
// Short pane (lib/shortPane, owner 2026-10-26 option B): 「接下来」 folds to its header line where it would leave the
// history under max(120 px, 30 % of the pane); it unfolds only with a margin (no flapping); a list kept in place by the
// owner still reports whether the pane is short.
import { describe, expect, it, vi } from "vitest";
import { createShortPaneStore, historyMin, historyUnfolded, measureShortPane, overlayMax, shortPaneFold, UNFOLD_MARGIN_PX, type ShortPaneMeasure } from "../src/renderer/src/lib/shortPane";

const m = (over: Partial<ShortPaneMeasure>): ShortPaneMeasure => ({ pane: 349, history: 200, tray: 0, trayUnfolded: 0, list: false, folded: false, ...over });

describe("historyMin", () => {
  it("is 120 px or 30 % of the pane, whichever is more", () => {
    expect(historyMin(349)).toBe(120); // 900×520: 30 % is 105
    expect(historyMin(400)).toBe(120);
    expect(historyMin(789)).toBe(237); // 1440×960
    expect(historyMin(1000)).toBe(300);
  });
});

describe("shortPaneFold", () => {
  it("folds when unfolded the panel would leave the history under its minimum (900×520, 8 queued)", () => {
    // Unfolded: 「接下来」 247 px, history 0 (what the owner saw before).
    const unfolded = m({ history: 0, tray: 247, trayUnfolded: 247, list: true });
    expect(shortPaneFold(unfolded)).toBe(true);
    // Folded: 31 px header, the history gets the rest — and stays folded (unfolded it would be under 0 again).
    const folded = m({ history: 143, tray: 31, trayUnfolded: 247, list: true, folded: true });
    expect(historyUnfolded(folded)).toBe(-73);
    expect(shortPaneFold(folded)).toBe(true);
    expect(folded.history).toBeGreaterThanOrEqual(historyMin(folded.pane));
  });
  it("does not fold when the history keeps its minimum (a tall pane)", () => {
    expect(shortPaneFold(m({ pane: 789, history: 511, tray: 103, trayUnfolded: 103, list: true }))).toBe(false);
    // Exactly at the minimum: kept.
    expect(shortPaneFold(m({ history: 120, tray: 60, trayUnfolded: 60, list: true }))).toBe(false);
    expect(shortPaneFold(m({ history: 119, tray: 60, trayUnfolded: 60, list: true }))).toBe(true);
  });
  it("unfolds only when the history would keep UNFOLD_MARGIN_PX more than its minimum", () => {
    // Folded; unfolded the history would be min + margin − 1 → stays folded; min + margin → unfolds.
    const at = (unfoldedHistory: number) => m({ history: unfoldedHistory + 200 - 31, tray: 31, trayUnfolded: 200, list: true, folded: true });
    expect(shortPaneFold(at(120 + UNFOLD_MARGIN_PX - 1))).toBe(true);
    expect(shortPaneFold(at(120 + UNFOLD_MARGIN_PX))).toBe(false);
    // Unfolded in the band between: no fold either (hysteresis both ways).
    expect(shortPaneFold(m({ history: 130, tray: 100, trayUnfolded: 100, list: true }))).toBe(false);
  });
  it("never folds a panel with no list (none, collapsed by the owner, compact)", () => {
    expect(shortPaneFold(m({ history: 10 }))).toBe(false);
    expect(shortPaneFold(m({ history: 10, tray: 31, trayUnfolded: 31, list: false }))).toBe(false);
  });
});

describe("overlayMax", () => {
  it("leaves a gap above the overlay, never under 80 px", () => {
    expect(overlayMax(143)).toBe(131);
    expect(overlayMax(40)).toBe(80);
  });
});

describe("measureShortPane", () => {
  const box = (el: HTMLElement, v: Partial<Record<"clientHeight" | "offsetHeight" | "scrollHeight", number>>) => {
    for (const [k, n] of Object.entries(v)) Object.defineProperty(el, k, { configurable: true, value: n });
  };
  function pane(opts: { folded: boolean; body: boolean }) {
    const main = document.createElement("main");
    const scroller = document.createElement("div");
    const tray = document.createElement("div");
    tray.setAttribute("data-queue-tray", "");
    if (opts.folded) tray.setAttribute("data-short-fold", "");
    main.append(scroller, tray);
    Object.defineProperty(tray, "offsetParent", { configurable: true, value: main });
    box(main, { clientHeight: 349 });
    box(scroller, { clientHeight: 143 });
    box(tray, { offsetHeight: opts.folded ? 31 : 247 });
    if (opts.body) {
      const body = document.createElement("div");
      body.setAttribute("data-queue-body", "");
      body.style.paddingTop = "4px";
      box(body, { scrollHeight: 220 });
      tray.append(body);
    }
    return { main, scroller };
  }
  it("folded: adds the overlay's rows without its padding", () => {
    const { main, scroller } = pane({ folded: true, body: true });
    expect(measureShortPane(main, scroller)).toEqual({ pane: 349, history: 143, tray: 31, trayUnfolded: 247, list: true, folded: true });
  });
  it("in place: the tray as laid out; collapsed (no list): list false", () => {
    const a = pane({ folded: false, body: true });
    expect(measureShortPane(a.main, a.scroller)).toMatchObject({ tray: 247, trayUnfolded: 247, list: true, folded: false });
    const b = pane({ folded: false, body: false });
    expect(measureShortPane(b.main, b.scroller)).toMatchObject({ list: false });
  });
});

describe("createShortPaneStore", () => {
  it("notifies only on a change; recheck goes to the pane", () => {
    const s = createShortPaneStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set(false);
    expect(fn).not.toHaveBeenCalled();
    s.set(true);
    expect(fn).toHaveBeenCalledTimes(1);
    const measure = vi.fn(() => s.set(false));
    s.onRecheck = measure;
    s.recheck();
    expect(measure).toHaveBeenCalled();
    expect(s.get()).toBe(false);
    off();
  });
});
