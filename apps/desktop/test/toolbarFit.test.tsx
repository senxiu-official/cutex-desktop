// @vitest-environment jsdom
// The composer settings row on a narrow pane (lib/toolbarFit): the right group (profile · quota | model · context) wraps
// to a second row instead of clipping; tighter still, the countdown text goes, then the Profile name truncates. Going
// back to a roomier step needs 24 px of slack, so a countdown that changes width does not flap the row.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitToolbar, TOOLBAR_HYSTERESIS, type ToolbarStep, type ToolbarWidths } from "../src/renderer/src/lib/toolbarFit";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, v?: Record<string, string>) => (v ? `${key}:${Object.values(v).join(",")}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/profileSnapshot", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cachedProfileList: () => null,
  loadProfileList: async () => null,
}));
const now = Date.now() / 1000;
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useComposerHost: () => "local",
  useHostQuotas: () => ({
    claude: [
      { id: "claude-0", label: "Claude", kind: "window", balance: null, windowLabel: "5h", remainingPercent: 88, resetAt: now + 3 * 3600, observedAt: now, stale: false },
      { id: "claude-1", label: "Claude", kind: "window", balance: null, windowLabel: "7d", remainingPercent: 31, resetAt: now + 48 * 3600, observedAt: now, stale: false },
    ],
  }),
  useHostLoadQuota: () => async () => {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("fitToolbar (wrap decision)", () => {
  const w = (width: number, o: Partial<ToolbarWidths> = {}): ToolbarWidths => ({ width, left: 300, right: 400, rightNoReset: 330, gap: 2, ...o });

  it("one row while both groups fit, else the right group on a second row, then no countdown, then a squeezed name", () => {
    expect(fitToolbar(w(702), 0)).toBe(0);
    expect(fitToolbar(w(701), 0)).toBe(1);
    expect(fitToolbar(w(400), 0)).toBe(1);
    expect(fitToolbar(w(399), 0)).toBe(2);
    expect(fitToolbar(w(330), 0)).toBe(2);
    expect(fitToolbar(w(329), 0)).toBe(3);
    expect(fitToolbar(w(10), 0)).toBe(3);
  });

  it("going back to a roomier step needs the hysteresis slack; tighter steps apply at once", () => {
    const H = TOOLBAR_HYSTERESIS;
    expect(H).toBe(24);
    // Wrapped: back to one row only with 24 px to spare.
    expect(fitToolbar(w(702), 1)).toBe(1);
    expect(fitToolbar(w(702 + H - 1), 1)).toBe(1);
    expect(fitToolbar(w(702 + H), 1)).toBe(0);
    // Countdown hidden: shown again only with 24 px to spare on the second row.
    expect(fitToolbar(w(400 + H - 1), 2)).toBe(2);
    expect(fitToolbar(w(400 + H), 2)).toBe(1);
    // Name squeezed: released only with 24 px to spare.
    expect(fitToolbar(w(330 + H - 1), 3)).toBe(3);
    expect(fitToolbar(w(330 + H), 3)).toBe(2);
    // A step can be skipped in either direction.
    expect(fitToolbar(w(2000), 3)).toBe(0);
    expect(fitToolbar(w(100), 0)).toBe(3);
  });

  it("a countdown changing width around the edge does not flap the row", () => {
    let step: ToolbarStep = 0;
    const seen: ToolbarStep[] = [];
    // The row is 700 wide; the countdown makes the right group 396 … 404 px wide (left 300 + gap 2).
    for (const right of [396, 404, 397, 403, 398, 402, 396]) {
      step = fitToolbar(w(700, { right }), step);
      seen.push(step);
    }
    expect(seen).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });

  it("without countdowns (prefs off) the right group's two widths are equal: step 2 is never roomier than 3", () => {
    expect(fitToolbar(w(399, { rightNoReset: 400 }), 0)).toBe(3);
  });
});

// Layout stand-in for jsdom: the row's width, and each group's max-content width (lib/toolbarFit lays a group out at
// `width: max-content` to read it). The right group is narrower without countdown text (data-drop-reset).
let rowWidth = 1000;
const LEFT = 300, RIGHT = 400, RIGHT_NO_RESET = 330;
const observers: (() => void)[] = [];
class FakeResizeObserver {
  constructor(private cb: (entries?: unknown) => void) {
    observers.push(() => this.cb());
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const resize = async (width: number) => {
  rowWidth = width;
  await act(async () => observers.forEach((notify) => notify()));
};

const { ComposerToolbarRow } = await import("../src/renderer/src/components/ComposerToolbarRow");
const { ProfileQuota } = await import("../src/renderer/src/components/Composer");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-toolbar-step") ? rowWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const natural = this.style.width === "max-content";
    const width = !natural ? 0 : this.hasAttribute("data-toolbar-right") ? (this.hasAttribute("data-drop-reset") ? RIGHT_NO_RESET : RIGHT) : LEFT;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 20, right: width, width, height: 20, toJSON: () => ({}) } as DOMRect;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer settings row", () => {
  const mount = async () => {
    await act(async () =>
      root.render(
        h(ComposerToolbarRow, {
          left: h("span", null, "permissions"),
          right: h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false }),
          tail: h("span", { "data-testid": "tail" }),
        }),
      ),
    );
  };
  const row = () => host.querySelector<HTMLElement>("[data-toolbar-step]")!;
  const right = () => host.querySelector<HTMLElement>("[data-toolbar-right]")!;

  it("steps through two rows → no countdown → truncated name as the row narrows, and back with slack", async () => {
    await mount();
    expect(row().dataset.toolbarStep).toBe("0");
    expect(row().className).not.toContain("flex-wrap");
    expect(host.querySelectorAll("[data-quota-reset]").length).toBe(2);
    // The countdown stays in the ring's hover whatever the step.
    const rings = [...host.querySelectorAll<HTMLElement>("[data-quota-reset]")].map((e) => e.parentElement!.dataset.tip ?? "");
    expect(rings.every((title) => title.includes("composer.quota.resets"))).toBe(true);
    expect(host.querySelector<HTMLElement>("[data-quota-name]")!.dataset.tip).toBe("claude");

    await resize(690);
    expect(row().dataset.toolbarStep).toBe("1");
    expect(row().className).toContain("flex-wrap");
    expect(right().className).toContain("basis-full");
    expect(right().className).toContain("justify-end");
    expect(right().hasAttribute("data-drop-reset")).toBe(false);

    await resize(380);
    expect(row().dataset.toolbarStep).toBe("2");
    expect(right().hasAttribute("data-drop-reset")).toBe(true);
    expect(right().hasAttribute("data-squeeze-name")).toBe(false);

    await resize(300);
    expect(row().dataset.toolbarStep).toBe("3");
    expect(right().hasAttribute("data-drop-reset")).toBe(true);
    expect(right().hasAttribute("data-squeeze-name")).toBe(true);
    // Measuring left no trace: inline styles restored.
    expect(right().style.width).toBe("");

    // Back: 340 fits the countdown-less group but not with 24 px to spare; 354 does.
    await resize(340);
    expect(row().dataset.toolbarStep).toBe("3");
    await resize(354);
    expect(row().dataset.toolbarStep).toBe("2");
    await resize(710);
    expect(row().dataset.toolbarStep).toBe("1");
    await resize(726);
    expect(row().dataset.toolbarStep).toBe("0");
    expect(row().className).not.toContain("flex-wrap");
  });
});
