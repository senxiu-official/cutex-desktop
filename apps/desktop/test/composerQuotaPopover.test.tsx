// @vitest-environment jsdom
// The composer quota popover (owner 2026-10-28): every gauge a row with its own 「显示圈」/「显示倒计时」
// switches (remembered by name), the old global reset switch gone, and same-reset windows merged into
// one ring until the bottom switch turns merging off.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";

const H = 3600;
const at = (hours: number) => Math.round(Date.now() / 1000 + hours * H);
const win = (id: string, label: string, remaining: number, resetAt: number): QuotaGauge =>
  ({ id, label: "Claude", kind: "window", remainingPercent: remaining, balance: null, resetAt, windowLabel: label, observedAt: Date.now() / 1000, stale: false }) as QuotaGauge;
/** The mock claude profile: 5h, then 7d and Fable 7d resetting together. */
let gauges: QuotaGauge[] = [win("claude-0", "5h", 88, at(3.72)), win("claude-1", "7d", 31, at(48)), win("claude-2", "Fable 7d", 79, at(48))];
const { loadQuota } = vi.hoisted(() => ({ loadQuota: vi.fn(async () => {}) }));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => null, loadProfileList: async () => null }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useComposerHost: () => "focus",
  useHostQuotas: () => ({ claude: gauges }),
  useHostLoadQuota: () => loadQuota,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ProfileQuota } = await import("../src/renderer/src/components/Composer");
const { getUiPrefs, setUiPref } = await import("../src/renderer/src/lib/prefs");

let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
const chipRings = () => [...host.querySelectorAll<HTMLElement>("[data-quota-ring]")];
const countdowns = () => [...host.querySelectorAll<HTMLElement>("[data-quota-reset]")];
const openPopover = async () => {
  const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.dataset.tip ?? "").includes("composer.quota.title"))!;
  await act(async () => void trigger.click());
};

beforeEach(() => {
  loadQuota.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  // The prefs module keeps its state from the previous test: reset the quota prefs through it.
  setUiPref("quotaGauges", {});
  setUiPref("quotaResetDefault", true);
  setUiPref("quotaMerge", true);
  gauges = [win("claude-0", "5h", 88, at(3.72)), win("claude-1", "7d", 31, at(48)), win("claude-2", "Fable 7d", 79, at(48))];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("composer quota popover", () => {
  it("stays open across animation frames, quota polling/rerenders and timeline auto-scroll on the same trigger", async () => {
    vi.useFakeTimers();
    const timeline = document.createElement("div");
    document.body.append(timeline);
    try {
      await render();
      const trigger = host.querySelector("button");
      await openPopover();
      const popover = document.querySelector("[data-popover]");
      expect(popover).not.toBeNull();
      expect(popover!.querySelectorAll("[data-quota-ring-toggle]")).toHaveLength(3);
      expect(loadQuota).toHaveBeenCalledExactlyOnceWith("claude");
      const originalArc = chipRings()[0]!.querySelector("[stroke-dasharray]")!.getAttribute("stroke-dasharray");

      const frame = vi.fn();
      requestAnimationFrame(frame);
      await act(async () => { await vi.advanceTimersByTimeAsync(32); });
      expect(frame).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-popover]")).toBe(popover);

      // A new quota snapshot arrives on the regular poll, without replacing the chip.
      loadQuota.mockImplementationOnce(async () => {
        gauges = [win("claude-0", "5h", 42, at(3.72)), ...gauges.slice(1)];
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      await render();
      expect(loadQuota).toHaveBeenCalledTimes(2);
      expect(chipRings()[0]!.querySelector("[stroke-dasharray]")!.getAttribute("stroke-dasharray")).not.toBe(originalArc);
      expect(host.querySelector("button")).toBe(trigger);
      expect(document.querySelector("[data-popover]")).toBe(popover);

      // Timeline follow-output is programmatic and unrelated to the composer anchor.
      await act(async () => {
        timeline.scrollTop = 500;
        timeline.dispatchEvent(new Event("scroll"));
      });
      expect(document.querySelector("[data-popover]")).toBe(popover);
      await act(async () => { await vi.advanceTimersByTimeAsync(32); });
      expect(document.querySelector("[data-popover]")).toBe(popover);
      expect(host.querySelector("button")).toBe(trigger);
    } finally { timeline.remove(); }
  });

  it.each(["outside click", "Escape"])("dismisses the actual quota popover on %s", async (action) => {
    await render();
    const trigger = host.querySelector("button");
    await openPopover();
    expect(document.querySelector("[data-quota-ring-toggle]")).not.toBeNull();
    await act(async () => {
      if (action === "outside click") document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-popover]")).toBeNull();
    expect(host.querySelector("button")).toBe(trigger);
  });

  it("merges same-reset windows into one ring; the hover lists both and their shared reset", async () => {
    await render();
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-0", "claude-1"]);
    expect(chipRings()[1]!.dataset.merged).toBe("");
    expect(chipRings()[1]!.dataset.tip).toContain("Claude · 7d");
    expect(chipRings()[1]!.dataset.tip).toContain("Claude · Fable 7d");
    expect(chipRings()[1]!.dataset.tip).toContain("composer.quota.mergedResets");
    expect(countdowns()).toHaveLength(2);
  });

  it.each(["remaining", "used"] as const)("keeps both model values visible when 7d windows share the same reset (%s)", async (view) => {
    setUiPref("quotaView", view);
    const reset = at(106);
    gauges = [win("claude-0", "5h", 92, at(1.93)), win("claude-1", "7d", 57, reset), win("claude-2", "Fable 7d", 100, reset)];
    await render();
    expect(chipRings()).toHaveLength(2);
    const weekly = chipRings().find((ring) => ring.dataset.merged !== undefined)!;
    const arcs = [...weekly.querySelectorAll<SVGCircleElement>("circle[stroke-dasharray]")];
    expect(arcs).toHaveLength(2);
    expect(new Set(arcs.map((arc) => arc.getAttribute("r"))).size).toBe(2);
    const fills = arcs.map((arc) => Number(arc.getAttribute("stroke-dasharray")!.split(" ")[0]) / (2 * Math.PI * Number(arc.getAttribute("r"))));
    expect(fills[0]).toBeCloseTo(view === "remaining" ? 0.57 : 0.43);
    expect(fills[1]).toBeCloseTo(view === "remaining" ? 1 : 0);
    expect(weekly.dataset.tip).toContain("Claude · 7d");
    expect(weekly.dataset.tip).toContain("Claude · Fable 7d");
  });

  it("one row per gauge with its own ring / countdown switches; the old global switch is gone", async () => {
    await render();
    await openPopover();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-quota-ring-toggle]")];
    expect(rows.map((b) => b.dataset.quotaRingToggle)).toEqual(["claude-0", "claude-1", "claude-2"]);
    expect([...document.querySelectorAll<HTMLElement>("[data-quota-reset-toggle]")]).toHaveLength(3);
    expect(document.querySelector("[data-popover]")!.textContent).not.toContain("composer.quota.showReset");
    expect([...document.querySelectorAll("input[type=checkbox]")].some((i) => i.closest("label")?.textContent?.includes("composer.quota.merge"))).toBe(true);
  });

  it("turning a gauge's ring off hides it (remembered by name, all Profiles)", async () => {
    await render();
    await openPopover();
    await act(async () => void document.querySelector<HTMLElement>('[data-quota-ring-toggle="claude-0"]')!.click());
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-1"]);
    expect(getUiPrefs().quotaGauges["Claude 5h"]).toEqual({ ring: false });
  });

  it("a hidden gauge under 15 % left shows temporarily in red, and hides again when it recovers", async () => {
    setUiPref("quotaGauges", { "Claude 5h": { ring: false } });
    gauges = [win("claude-0", "5h", 9, at(3.72)), ...gauges.slice(1)];
    await render();
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-0", "claude-1"]); // back, drawn by fillColor red

    gauges = [win("claude-0", "5h", 40, at(3.72)), ...gauges.slice(1)];
    await render();
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-1"]); // recovered → hidden again
  });

  it("turning a gauge's countdown off hides only its own; the old global default seeds the rest", async () => {
    setUiPref("quotaResetDefault", false);
    await render();
    expect(countdowns()).toHaveLength(0);
    await openPopover();
    await act(async () => void document.querySelector<HTMLElement>('[data-quota-reset-toggle="claude-1"]')!.click());
    expect(countdowns()).toHaveLength(1); // the merged ring's one countdown (a member said yes)
    expect(getUiPrefs().quotaGauges["Claude 7d"]).toEqual({ reset: true });
  });

  it("gauge names stay whole: the popover widens to its rows (capped), labels wrap instead of truncating", async () => {
    await render();
    await openPopover();
    const label = document.querySelector<HTMLElement>('[data-quota-label="claude-2"]')!;
    expect(label.textContent).toBe("Claude · Fable 7d");
    expect(label.dataset.tip).toBe("Claude · Fable 7d");
    expect(label.className).not.toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/\bline-clamp-2\b/);
    const popover = label.closest<HTMLElement>("[data-popover]")!;
    expect(popover.className).toMatch(/\bw-max\b/);
    expect(popover.className).toContain("max-w-[min(28rem,calc(100vw-2rem))]");
    expect(popover.className).not.toMatch(/(^|\s)w-72(\s|$)/);
  });

  it("the popover's bottom switch turns merging off", async () => {
    await render();
    await openPopover();
    const merge = [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) => i.closest("label")?.textContent?.includes("composer.quota.merge"))!;
    await act(async () => void merge.click());
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-0", "claude-1", "claude-2"]);
    expect(chipRings()[1]!.dataset.merged).toBeUndefined();
  });
});
