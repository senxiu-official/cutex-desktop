// @vitest-environment jsdom
// Owner bugs 2026-11-13: a notice repeated its own text as a tooltip, the Shelf toast sat over the tray, and an
// outcome-unknown 插话 put cutex's raw `queue_steer_refused:outcomeUnknown request_outcome_unknown: …` under the composer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTips, tipWanted, TIP_DELAY } from "../src/renderer/src/lib/tips";
import { toastSpot, toastTop } from "../src/renderer/src/lib/toastSpot";
import { markShownInRow, queueActionNotice } from "../src/renderer/src/lib/queueSteer";
import { queueSteerErrorMessage } from "../src/shared/queueSteer";
import { queueMergeErrorMessage } from "../src/shared/queueMerge";
import { useDebug } from "../src/renderer/src/lib/debugState";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${JSON.stringify(vars)})` : key);

describe("tipWanted (data-tip-overflow)", () => {
  const sized = (el: HTMLElement, scroll: number, client: number) => {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scroll });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: client });
  };

  it("an ordinary data-tip anchor always gets its tip", () => {
    const el = document.createElement("button");
    el.setAttribute("data-tip", "Send");
    expect(tipWanted(el)).toBe(true);
  });

  it("a label that repeats its own text gets a tip only while that text is cut off", () => {
    const el = document.createElement("div");
    el.setAttribute("data-tip", "pet-illust 打开了浏览器");
    el.setAttribute("data-tip-overflow", "");
    const span = el.appendChild(document.createElement("span"));
    sized(el, 300, 300);
    sized(span, 200, 200);
    expect(tipWanted(el)).toBe(false);
    sized(span, 420, 200);
    expect(tipWanted(el)).toBe(true);
  });
});

describe("data-tip-overflow while hovered", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("follows a resize: a tip appears once the text is cut off and goes once it fits again", () => {
    vi.useFakeTimers();
    const observers: { cb: () => void; disconnected: boolean }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { cb: () => void; disconnected: boolean };
      constructor(cb: () => void) { this.entry = { cb, disconnected: false }; observers.push(this.entry); }
      observe() {}
      disconnect() { this.entry.disconnected = true; }
    });
    const detach = installTips(window);
    try {
      document.body.innerHTML = `<span id="label" data-tip="pet-illust 打开了浏览器，放在它自己的 Shelf 里" data-tip-overflow="">pet-illust 打开了浏览器，放在它自己的 Shelf 里</span>`;
      const el = document.getElementById("label")!;
      let client = 400;
      Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => 300 });
      Object.defineProperty(el, "clientWidth", { configurable: true, get: () => client });
      const tip = () => document.querySelector("[data-tip-shown]");
      const resize = () => observers.forEach((o) => !o.disconnected && o.cb());
      el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(TIP_DELAY + 20);
      expect(tip()).toBeNull();
      client = 200; // the window narrows: the text is cut off now
      resize();
      expect(tip()?.textContent).toContain("pet-illust");
      client = 400; // wide again: it fits
      resize();
      expect(tip()).toBeNull();
      window.dispatchEvent(new Event("resize"));
      expect(tip()).toBeNull();
      el.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
      expect(observers.every((o) => o.disconnected)).toBe(true);
      client = 200;
      resize();
      expect(tip()).toBeNull();
    } finally {
      detach();
    }
  });
});

describe("toastSpot (side trays)", () => {
  // The minimum supported window and a long notice.
  const VIEW = { width: 560, height: 420 };
  const TOAST = { width: 528, height: 40 };
  const overlaps = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  for (const edge of ["left", "right"] as const) {
    it(`a tray docked ${edge} narrows the span; the toast never crosses it`, () => {
      const tray = edge === "left" ? { left: 8, top: 40, right: 64, bottom: 412, side: true } : { left: 496, top: 40, right: 552, bottom: 412, side: true };
      const composer = { left: 80, top: 250, right: 480, bottom: 400 };
      const spot = toastSpot(TOAST, VIEW, [tray, composer]);
      const width = Math.min(TOAST.width, spot.right - spot.left);
      const centre = (spot.left + spot.right) / 2;
      const placed = { left: centre - width / 2, right: centre + width / 2, top: spot.top, bottom: spot.top + TOAST.height };
      expect(overlaps(placed, tray)).toBe(false);
      expect(overlaps(placed, composer)).toBe(false);
      expect(width).toBeLessThan(TOAST.width);
    });
  }
});

describe("toastTop", () => {
  const VIEW = { width: 1200, height: 800 };
  const TOAST = { width: 500, height: 40 };
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  it("near the bottom when nothing is below it", () => {
    expect(toastTop(TOAST, VIEW, [])).toBe(800 - 16 - 40);
  });

  it("above a bottom tray and the composer above it — never over either", () => {
    const tray = rect(0, 740, 1200, 800);
    const composer = rect(300, 600, 900, 730);
    const top = toastTop(TOAST, VIEW, [tray, composer]);
    expect(top + TOAST.height).toBeLessThanOrEqual(composer.top);
    expect(top + TOAST.height).toBeLessThanOrEqual(tray.top);
  });

  it("ignores a box beside it (a composer in a pane off to the left)", () => {
    expect(toastTop(TOAST, VIEW, [rect(0, 600, 300, 730)])).toBe(800 - 16 - 40);
  });

  it("under the title bar (below a top tray) when rising above the bottom boxes would go too high", () => {
    const tallComposer = rect(200, 250, 1000, 790);
    expect(toastTop(TOAST, VIEW, [tallComposer])).toBe(48);
    const topTray = rect(0, 40, 1200, 100);
    expect(toastTop(TOAST, VIEW, [tallComposer, topTray])).toBe(108);
  });
});

describe("queueActionNotice", () => {
  const initial = useDebug.getState();
  afterEach(() => {
    useDebug.setState(initial);
    vi.restoreAllMocks();
  });

  it("an outcome-unknown 插话 adds no composer notice only once its 接下来 row says 不确定是否送达; else one plain sentence", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = queueSteerErrorMessage("outcomeUnknown", "request_outcome_unknown: the cutex operation completed far enough that its durable outcome is unknown (originalCode: outcome_unknown)");
    for (const debug of [false, true]) {
      useDebug.setState((s) => ({ state: { ...s.state, enabled: debug } }));
      expect(queueActionNotice(new Error(raw), t)).toBe("queue.steer.outcomeUnknown");
      const shown = new Error(raw);
      markShownInRow(shown);
      expect(queueActionNotice(shown, t)).toBeNull();
    }
  });

  it("other steer / merge refusals read as one plain sentence, never the code", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(queueActionNotice(new Error(queueSteerErrorMessage("agentPaused")), t)).toBe("queue.steer.agentPaused");
    expect(queueActionNotice(new Error(queueSteerErrorMessage("runtimeRefused", "cannot steer a review turn")), t)).toBe("queue.steer.runtimeRefusedPlain");
    expect(queueActionNotice(new Error(queueMergeErrorMessage("tooLarge")), t)).toBe("queue.merge.tooLarge");
  });

  it("raw codes and socket errors become 没有完成; a worded notice passes as is; debug mode too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const debug of [false, true]) {
      useDebug.setState((s) => ({ state: { ...s.state, enabled: debug } }));
      expect(queueActionNotice(new Error("queue_item_not_found:gone"), t)).toBe("queue.actionFailed");
      expect(queueActionNotice(new Error("revision_conflict: stale"), t)).toBe("queue.actionFailed");
      expect(queueActionNotice(new Error("connect ECONNREFUSED 127.0.0.1:24370"), t)).toBe("queue.actionFailed");
      expect(queueActionNotice(new Error("主机正忙，稍后再试"), t)).toBe("主机正忙，稍后再试");
    }
  });
});
