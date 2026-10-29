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
  useHostLoadQuota: () => async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ProfileQuota } = await import("../src/renderer/src/components/Composer");
const { getUiPrefs, setUiPref } = await import("../src/renderer/src/lib/prefs");

let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
const chipRings = () => [...host.querySelectorAll<HTMLElement>("[data-quota-ring]")];
const countdowns = () => [...host.querySelectorAll<HTMLElement>("[data-quota-reset]")];
const openPopover = async () => {
  const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.title ?? "").includes("composer.quota.title"))!;
  await act(async () => void trigger.click());
};

beforeEach(() => {
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
});

describe("composer quota popover", () => {
  it("merges same-reset windows into one ring; the hover lists both and their shared reset", async () => {
    await render();
    expect(chipRings().map((r) => r.dataset.quotaRing)).toEqual(["claude-0", "claude-1"]);
    expect(chipRings()[1]!.dataset.merged).toBe("");
    expect(chipRings()[1]!.title).toContain("Claude · 7d");
    expect(chipRings()[1]!.title).toContain("Claude · Fable 7d");
    expect(chipRings()[1]!.title).toContain("composer.quota.mergedResets");
    expect(countdowns()).toHaveLength(2);
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
    expect(label.title).toBe("Claude · Fable 7d");
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
