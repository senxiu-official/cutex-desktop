// @vitest-environment jsdom
// Design 052 in the composer quota popover: each window's forecast line (from cutex quota-history,
// capability usage-ledger) and 「谁在用」 under the 5h window — only with capability quota-attribution;
// a click on an agent opens it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";
import type { QuotaAttribution, QuotaSnapshot } from "../src/shared/quotaAttribution";

const H = 3600;
const NOW = Math.round(Date.now() / 1000);
const win = (id: string, label: string, remaining: number, resetIn: number): QuotaGauge =>
  ({ id, label: "Claude", kind: "window", remainingPercent: remaining, balance: null, resetAt: NOW + resetIn * H, windowLabel: label, observedAt: NOW, stale: false }) as QuotaGauge;
const line = (gaugeId: string, current: number, rate: number, hours: number, resetAt: number | null): QuotaSnapshot[] => {
  const out: QuotaSnapshot[] = [];
  for (let t = NOW - hours * H; t < NOW; t += 15 * 60) out.push({ ts: t, profile: "claude", profileId: "claude", gaugeId, remainingPercent: current + (rate * (NOW - t)) / H, resetAt });
  return out;
};
const gauges = [win("claude-0", "5h", 16, 3), win("claude-1", "7d", 31, 48)];
const history = [...line("claude-0", 16, 34, 1, gauges[0]!.resetAt), ...line("claude-1", 31, 0.3, 72, gauges[1]!.resetAt)];
const attribution: QuotaAttribution = {
  window: { label: "5h", startAt: NOW - 2 * H, resetAt: gauges[0]!.resetAt, usedPercent: 84, observedAt: NOW },
  calibration: { unitsPerPercent: 260000, windows: 9, confidence: "high" },
  rows: [
    { cutexSessionId: "kai", agentName: "Kai", units: 10, percent: 42, running: true },
    { cutexSessionId: "sora", agentName: "Sora", units: 6, percent: 26 },
    { cutexSessionId: "probe", agentName: "probe", units: 1, percent: 4 },
    { cutexSessionId: "gone", agentName: null, units: 1, percent: 3, sessionDeleted: true },
  ],
  unattributedPercent: 9,
};

const shown = vi.hoisted(() => ({ gauges: [] as QuotaGauge[] }));
const api = vi.hoisted(() => ({ quotaHistory: vi.fn(), quotaAttribution: vi.fn() }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${Object.values(vars).join(",")}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api, apiFor: () => api, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => null, loadProfileList: async () => null }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useComposerHost: () => "local",
  useHostQuotas: () => ({ claude: shown.gauges }),
  useHostLoadQuota: () => async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ProfileQuota } = await import("../src/renderer/src/components/Composer");
const { useApp } = await import("../src/renderer/src/store");
const { clearQuotaHistoryCache } = await import("../src/renderer/src/lib/quotaForecast");
const { attributionForecast, clearAttributionCache, FORECAST_MAX_AGE } = await import("../src/renderer/src/lib/quotaAttribution");
const { translate } = await import("../src/renderer/src/i18n");

let host: HTMLDivElement, root: Root;
const openAgent = vi.fn(async () => {});
const withFeatures = (features: string[]) => useApp.setState({ features: new Set(features), openAgent } as never);
const render = async () => {
  await act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
  const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.dataset.tip ?? b.title ?? "").includes("composer.quota.title"))!;
  await act(async () => void trigger.click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};
const popover = () => document.querySelector<HTMLElement>("[data-popover]")!;

beforeEach(() => {
  shown.gauges = gauges;
  clearQuotaHistoryCache();
  clearAttributionCache();
  api.quotaHistory.mockReset().mockResolvedValue({ from: "", to: "", profile: "claude", snapshots: history });
  api.quotaAttribution.mockReset().mockResolvedValue(attribution);
  openAgent.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("quota popover forecast + 谁在用", () => {
  it("one forecast line per window: 5h runs out (danger), 7d 本周够用", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    await render();
    const lines = [...popover().querySelectorAll<HTMLElement>("[data-quota-forecast]")];
    expect(lines.map((l) => [l.dataset.quotaForecast, l.dataset.forecastKind])).toEqual([["claude-0", "runsOut"], ["claude-1", "lasts"]]);
    expect(lines[0]!.className).toContain("text-danger");
    expect(lines[0]!.textContent).toMatch(/\d\d:\d\d/);
    expect(lines[1]!.textContent).toBe(translate("quota.forecast.weekOk"));
    expect(api.quotaHistory).toHaveBeenCalledOnce();
    // The ring's hover carries the forecast too.
    const ring = host.querySelector<HTMLElement>("[data-quota-ring]")!;
    expect(ring.dataset.tip).toContain(lines[0]!.textContent!);
  });

  it("谁在用: top 3, 其它 for the rest, 未归因 above the tolerance; a click opens the agent and closes the popover", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    await render();
    expect(api.quotaAttribution).toHaveBeenCalledWith({ profile: "claude", window: "5h" });
    const who = popover().querySelector<HTMLElement>("[data-quota-who]")!;
    const rows = [...who.querySelectorAll<HTMLButtonElement>("[data-quota-who-row]")];
    expect(rows.map((r) => r.dataset.quotaWhoRow)).toEqual(["kai", "sora", "probe", "other", "unattributed"]);
    expect(rows[0]!.textContent).toContain("Kai");
    expect(rows[0]!.textContent).toContain("quota.who.share:42");
    expect(rows[0]!.querySelector(".animate-spin")).not.toBeNull();
    expect(rows[3]!.textContent).toContain("quota.who.other:1");
    expect(rows[3]!.disabled).toBe(true);
    await act(async () => rows[1]!.click());
    expect(openAgent).toHaveBeenCalledWith("sora", "local");
    expect(document.querySelector("[data-popover]")).toBeNull();
  });

  it("the full list shows every row; a deleted session is not clickable", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    await render();
    await act(async () => popover().querySelector<HTMLButtonElement>("[data-quota-who-all]")!.click());
    const rows = [...popover().querySelectorAll<HTMLButtonElement>("[data-quota-who-row]")];
    expect(rows.map((r) => r.dataset.quotaWhoRow)).toEqual(["kai", "sora", "probe", "gone", "unattributed"]);
    expect(rows[3]!.textContent).toContain("quota.who.deleted");
    expect(rows[3]!.disabled).toBe(true);
  });

  it("without quota-attribution: no 谁在用 and no request; without usage-ledger: no forecast", async () => {
    withFeatures(["usage-ledger"]);
    await render();
    expect(popover().querySelector("[data-quota-who]")).toBeNull();
    expect(api.quotaAttribution).not.toHaveBeenCalled();
    expect(popover().querySelectorAll("[data-quota-forecast]")).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    clearQuotaHistoryCache();
    api.quotaHistory.mockClear();
    withFeatures([]);
    await render();
    expect(popover().querySelectorAll("[data-quota-forecast]")).toHaveLength(0);
    expect(api.quotaHistory).not.toHaveBeenCalled();
  });

  it("the 快用完 switch sits with the quota prefs and is on by default (owner, 2026-11-17)", async () => {
    withFeatures([]);
    await render();
    const toggle = popover().querySelector<HTMLInputElement>("[data-quota-alert-toggle]")!;
    expect(toggle.checked).toBe(true);
  });
});

describe("cutex's forecast wins (review 2026-11-17)", () => {
  it("the attribution answer's forecast replaces the local estimate for that window, in the line and the ring", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    api.quotaAttribution.mockResolvedValue({ ...attribution, forecast: { state: "lasts", percentPerHour: 0, runsOutAt: null } });
    await render();
    const line = popover().querySelector<HTMLElement>('[data-quota-forecast="claude-0"]')!;
    expect(line.dataset.forecastKind).toBe("lasts");
    expect(host.querySelector<HTMLElement>("[data-quota-ring]")!.dataset.tip).toContain(line.textContent!);
    // The 7d window has no answer from cutex: the local estimate stays.
    expect(popover().querySelector<HTMLElement>('[data-quota-forecast="claude-1"]')!.dataset.forecastKind).toBe("lasts");
  });

  it("an answer about another window (other reset) is not applied", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    api.quotaAttribution.mockResolvedValue({ ...attribution, window: { ...attribution.window, resetAt: gauges[0]!.resetAt! - 5 * H }, forecast: { state: "lasts", percentPerHour: 0, runsOutAt: null } });
    await render();
    expect(popover().querySelector<HTMLElement>('[data-quota-forecast="claude-0"]')!.dataset.forecastKind).toBe("runsOut");
  });

  it("exhausted from cutex reads 已用完", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    api.quotaAttribution.mockResolvedValue({ ...attribution, forecast: { state: "exhausted", percentPerHour: null, runsOutAt: null } });
    await render();
    expect(popover().querySelector<HTMLElement>('[data-quota-forecast="claude-0"]')!.dataset.forecastKind).toBe("empty");
  });

  it("a session on two models is one row (no duplicate keys)", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    api.quotaAttribution.mockResolvedValue({ ...attribution, rows: [{ cutexSessionId: "kai", agentName: "Kai", model: "opus", units: 6, percent: 30 }, { cutexSessionId: "kai", agentName: "Kai", model: "sonnet", units: 4, percent: 20 }, ...attribution.rows.slice(1)] });
    await render();
    const rows = [...popover().querySelectorAll<HTMLButtonElement>("[data-quota-who-row]")];
    expect(rows.map((r) => r.dataset.quotaWhoRow)).toEqual(["kai", "sora", "probe", "other", "unattributed"]);
    expect(rows[0]!.textContent).toContain("quota.who.share:50");
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("a remembered cutex forecast older than the latest reading is not shown: the local estimate is (re-review repro)", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    api.quotaAttribution.mockResolvedValue({ ...attribution, forecast: { state: "lasts", percentPerHour: 0, runsOutAt: null } });
    await render();
    const lasts = popover().querySelector<HTMLElement>('[data-quota-forecast="claude-0"]')!;
    expect(lasts.dataset.forecastKind).toBe("lasts");
    const lastsText = lasts.textContent!;
    // The popover closes; 30 min later the 5h window reads 1% left.
    act(() => root.unmount());
    root = createRoot(host);
    shown.gauges = [{ ...gauges[0]!, remainingPercent: 1, observedAt: NOW + 30 * 60 }, gauges[1]!];
    await act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(attributionForecast("local", "claude", shown.gauges[0]!)).toBeNull();
    expect(host.querySelector<HTMLElement>("[data-quota-ring]")!.dataset.tip).not.toContain(lastsText);
  });

  it("a remembered cutex forecast expires after FORECAST_MAX_AGE even without a newer reading", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    api.quotaAttribution.mockResolvedValue({ ...attribution, forecast: { state: "lasts", percentPerHour: 0, runsOutAt: null } });
    await render();
    const at = Date.now() / 1000;
    expect(attributionForecast("local", "claude", gauges[0]!, at)).toMatchObject({ state: "lasts" });
    expect(attributionForecast("local", "claude", gauges[0]!, at + FORECAST_MAX_AGE + 5)).toBeNull();
  });

  // Re-review 2 (2026-11-18).
  const LASTS = { state: "lasts", percentPerHour: 0, runsOutAt: null } as const;
  const kind = () => popover().querySelector<HTMLElement>('[data-quota-forecast="claude-0"]')!.dataset.forecastKind;
  const rerender = async (next: QuotaGauge[]) => {
    shown.gauges = next;
    await act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  };

  it("popover open, no new reading: at FORECAST_MAX_AGE the cutex forecast goes by itself (nothing else re-renders)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      withFeatures(["usage-ledger", "quota-attribution"]);
      api.quotaAttribution.mockResolvedValue({ ...attribution, forecast: LASTS });
      await render();
      expect(kind()).toBe("lasts");
      await act(async () => void vi.advanceTimersByTime((FORECAST_MAX_AGE + 1) * 1000));
      expect(kind()).toBe("runsOut");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an answer without the host's observedAt is never used (its freshness cannot be shown): the local estimate", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    // The host's clock 1 h behind: its gauge readings carry host times.
    const behind = [{ ...gauges[0]!, observedAt: NOW - 3600 }, gauges[1]!];
    shown.gauges = behind;
    api.quotaAttribution.mockResolvedValue({ ...attribution, window: { ...attribution.window, observedAt: null }, forecast: LASTS });
    await render();
    expect(kind()).not.toBe("lasts");
    await rerender([{ ...behind[0]!, remainingPercent: 1, observedAt: NOW - 1800 }, gauges[1]!]);
    expect(attributionForecast("local", "claude", shown.gauges[0]!)).toBeNull();
  });

  it("a host clock ahead of the gauge's: a newer gauge reading still drops the forecast (tied to the reading it was shown with)", async () => {
    withFeatures(["usage-ledger", "quota-attribution"]);
    // One answer; the read the new reading starts has not come back yet.
    api.quotaAttribution.mockResolvedValueOnce({ ...attribution, window: { ...attribution.window, observedAt: NOW + 3600 }, forecast: LASTS }).mockImplementation(() => new Promise(() => {}));
    await render();
    expect(kind()).toBe("lasts");
    await rerender([{ ...gauges[0]!, remainingPercent: 1, observedAt: NOW + 1800 }, gauges[1]!]);
    expect(attributionForecast("local", "claude", shown.gauges[0]!)).toBeNull();
    expect(kind()).not.toBe("lasts");
  });
});
