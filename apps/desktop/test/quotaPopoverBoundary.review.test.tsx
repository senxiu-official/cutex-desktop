// @vitest-environment jsdom
// Owner 2026-11-24: the composer quota popover must not jump while its parts load.
// - 额度重置券 line: there from the start (正在读取重置券…), then 没有重置券 / 重置券 N 张 · 用一张 / 读不到重置券 / why
//   the account has none, in the same one-line place (Claude and Codex alike). An account already known to have none
//   when the card opens gets no line, as before.
// - 谁在用: while it is read, the answer's shape (title, bar, the top rows); a reopened card starts from the last answer.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";
import type { QuotaAttribution } from "../src/shared/quotaAttribution";
import type { ResetCreditsView } from "../src/shared/resetCredits";

const NOW = Math.round(Date.now() / 1000);
const gauge = (id: string, label: string): QuotaGauge =>
  ({ id, label: "Claude", kind: "window", remainingPercent: 40, balance: null, resetAt: NOW + 3600, windowLabel: label, observedAt: NOW, stale: false }) as QuotaGauge;
const attribution: QuotaAttribution = {
  window: { label: "5h", startAt: NOW - 7200, resetAt: NOW + 3600, usedPercent: 60, observedAt: NOW },
  calibration: { unitsPerPercent: 1000, windows: 9, confidence: "high" },
  rows: [
    { cutexSessionId: "kai", agentName: "Kai", units: 10, percent: 30, running: true },
    { cutexSessionId: "sora", agentName: "Sora", units: 6, percent: 20 },
  ],
  unattributedPercent: 10,
};
const view = (over: Partial<ResetCreditsView>): ResetCreditsView => ({
  profile: { id: "p", name: "p" }, provider: "codex", supported: true, unsupportedReason: null, availableCount: 0, credits: [], detailsComplete: true, fetchedAt: NOW, error: null, ...over,
});

/** A complete ResetCredit (the type needs every field). */
const credit = (id: string, resetsLeft: number) => ({ id, title: null, description: null, status: "available", grantedAt: null, expiresAt: null, resetsLeft });

const shown = vi.hoisted(() => ({ gauges: [] as QuotaGauge[] }));
const api = vi.hoisted(() => ({ quotaHistory: vi.fn(), quotaAttribution: vi.fn(), profileResetCredits: vi.fn() }));
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
const { ResetCreditsLine, resetLineState } = await import("../src/renderer/src/components/ResetCredits");
const { WhoUses } = await import("../src/renderer/src/components/QuotaInsight");
const { useApp } = await import("../src/renderer/src/store");
const { clearQuotaHistoryCache } = await import("../src/renderer/src/lib/quotaForecast");
const { clearAttributionCache, TOP_AGENTS } = await import("../src/renderer/src/lib/quotaAttribution");
const { loadResetCredits } = await import("../src/renderer/src/lib/resetCredits");
const { ResetCreditsDetail } = await import("../src/renderer/src/components/ResetCredits");
const { useQuotaAttribution } = await import("../src/renderer/src/lib/quotaAttribution");

let host: HTMLDivElement, root: Root;
const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
let n = 0;
/** A fresh profile name per read (the reset-credit cache is module state, kept 60 s). */
const fresh = () => `p${++n}`;
const line = () => host.querySelector<HTMLElement>('[data-testid="reset-credits-line"]');
const renderLine = (profile: string) => act(async () => root.render(h(ResetCreditsLine, { hostId: "local", profile, afterReset() {} })));

beforeEach(() => {
  shown.gauges = [gauge("claude-0", "5h"), gauge("claude-1", "7d")];
  clearQuotaHistoryCache();
  clearAttributionCache();
  api.quotaHistory.mockReset().mockResolvedValue({ from: "", to: "", profile: "claude", snapshots: [] });
  api.quotaAttribution.mockReset().mockResolvedValue(attribution);
  api.profileResetCredits.mockReset();
  useApp.setState({ hosts: { active: "local" } as never, features: new Set(["quota-attribution", "profile-reset-credits"]), openAgent: vi.fn() } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("independent quota scope and retry boundaries", () => {
  it("switching an open popover from a cached unsupported profile to one with coupons exposes its coupon action", async () => {
    const a = fresh(), b = fresh();
    api.profileResetCredits.mockImplementation(async (name: string) => view(name === a
      ? { supported: false, unsupportedReason: "apiKey" }
      : { profile: { id: b, name: b }, provider: "claude", availableCount: 2, credits: [credit("two", 2)] } as Partial<ResetCreditsView>));
    await loadResetCredits("local", a);
    const draw = (profile: string) => act(async () => root.render(h(ProfileQuota, { profile, rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
    await draw(a);
    const trigger = [...host.querySelectorAll<HTMLElement>("button")].find(el => (el.dataset.tip ?? el.title ?? "").includes("composer.quota.title"))!;
    await act(async () => trigger.click());
    expect(document.querySelector('[data-popover] [data-testid="reset-credits-line"]')).toBeNull();
    await draw(b); await flush();
    expect(api.profileResetCredits).toHaveBeenCalledWith(b, false);
    expect(document.querySelector('[data-popover] [data-testid="reset-credit-use"]')).not.toBeNull();
  });

  it("Settings distinguishes an initial read failure and recovers after an explicit retry", async () => {
    const profile = fresh();
    api.profileResetCredits.mockRejectedValueOnce(new Error("first failed"));
    await act(async () => root.render(h(ResetCreditsDetail, { hostId: "local", profile, afterReset() {} })));
    await flush();
    expect(host.textContent).toBe("resets.unknown");
    expect(host.querySelector('[title="first failed"]')).not.toBeNull();
    api.profileResetCredits.mockResolvedValue(view({ profile: { id: profile, name: profile }, availableCount: 1, credits: [credit("one", 1)] }));
    await act(async () => { await loadResetCredits("local", profile, true); });
    expect(host.textContent).toContain("resets.count:1");
    expect(host.querySelector('[data-testid="reset-credit-use"]')).not.toBeNull();
    expect(host.textContent).not.toContain("resets.unknown");
  });

  it("reopening attribution for A uses A's answer even when B was read most recently, without requests per render", async () => {
    const a = fresh(), b = fresh();
    function Probe({ profile }: { profile: string }) {
      const result = useQuotaAttribution("local", profile, "5h", true, 0);
      return h("span", { "data-who-probe": "" }, result?.rows[0]?.agentName ?? "loading");
    }
    api.quotaAttribution.mockImplementation(async ({ profile }: { profile: string }) => ({ ...attribution, rows: [{ ...attribution.rows[0]!, agentName: profile }] }));
    await act(async () => root.render(h(Probe, { profile: a }))); await flush();
    expect(host.textContent).toBe(a);
    await act(async () => root.render(h(Probe, { profile: b }))); await flush();
    expect(host.textContent).toBe(b);
    act(() => root.unmount()); root = createRoot(host);
    const pending = deferred<QuotaAttribution>(); api.quotaAttribution.mockReturnValue(pending.promise);
    await act(async () => root.render(h(Probe, { profile: a })));
    expect(host.textContent).toBe(a);
    const reads = api.quotaAttribution.mock.calls.length;
    for (let i = 0; i < 5; i++) await act(async () => root.render(h(Probe, { profile: a })));
    expect(api.quotaAttribution).toHaveBeenCalledTimes(reads);
    await act(async () => pending.resolve(attribution));
  });
});

