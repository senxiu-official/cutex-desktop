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

describe("额度重置券 line: one place from the start", () => {
  it("states", () => {
    expect(resetLineState(undefined, null)).toBe("loading");
    expect(resetLineState(undefined, "boom")).toBe("error");
    expect(resetLineState(null, null)).toBe("unsupported");
    expect(resetLineState(view({ supported: false, unsupportedReason: "apiKey" }), null)).toBe("unsupported");
    expect(resetLineState(view({}), null)).toBe("ready");
  });

  it.each([
    ["none (Codex)", view({ provider: "codex", availableCount: 0 }), "resets.none", false],
    ["coupons (Claude)", view({ provider: "claude", availableCount: 2, credits: [{ id: "c1", title: null, description: null, status: "available", grantedAt: null, expiresAt: null, resetsLeft: 1 }] }), "resets.count:2", true],
    ["found to have none while open", view({ supported: false, unsupportedReason: "apiKey" }), "resets.unsupported.apiKey", false],
  ])("loading → %s: the same one-line row, text replaced in place", async (_name, answer, text, use) => {
    const read = deferred<ResetCreditsView>();
    api.profileResetCredits.mockReturnValue(read.promise);
    await renderLine(fresh());
    const before = line()!;
    expect(before.dataset.resetState).toBe("loading");
    expect(before.textContent).toBe("resets.loading");
    expect(before.getAttribute("aria-busy")).toBe("true");
    const row = before.querySelector(".h-6")!;
    await act(async () => read.resolve(answer));
    expect(line()).toBe(before);
    expect(before.querySelector(".h-6")).toBe(row);
    expect(before.textContent).toContain(text);
    expect(!!before.querySelector('[data-testid="reset-credit-use"]')).toBe(use);
    // The 用一张 button sits inside the fixed-height row.
    if (use) expect(row.contains(before.querySelector('[data-testid="reset-credit-use"]'))).toBe(true);
  });

  it("a first read that fails says 读不到重置券 (not loading forever), with the reason on hover", async () => {
    api.profileResetCredits.mockRejectedValue(new Error("503 upstream"));
    await renderLine(fresh());
    await flush();
    expect(line()!.dataset.resetState).toBe("error");
    expect(line()!.textContent).toBe("resets.unknown");
    expect(line()!.querySelector("[title]")!.getAttribute("title")).toBe("503 upstream");
  });

  it("an account already known to have none when the card opens: no line (as before)", async () => {
    const profile = fresh();
    api.profileResetCredits.mockResolvedValue(view({ supported: false, unsupportedReason: "apiKey" }));
    await renderLine(profile);
    await flush();
    expect(line()).not.toBeNull(); // learned while open: kept
    act(() => root.unmount());
    root = createRoot(host);
    await renderLine(profile);
    expect(line()).toBeNull();
  });

  it("in the popover it is there at once, before the read answers", async () => {
    api.profileResetCredits.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
    const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.dataset.tip ?? b.title ?? "").includes("composer.quota.title"))!;
    await act(async () => void trigger.click());
    const popover = document.querySelector<HTMLElement>("[data-popover]")!;
    expect(popover.querySelector('[data-testid="reset-credits-line"]')?.getAttribute("data-reset-state")).toBe("loading");
  });
});

describe("谁在用: no growth when the answer lands", () => {
  it("loading has the answer's shape: title, bar and the top rows at the rows' height", () => {
    act(() => root.render(h(WhoUses, { attribution: undefined, onOpenAgent() {} })));
    const loading = host.querySelector<HTMLElement>('[data-quota-who="loading"]')!;
    const rows = loading.querySelectorAll("[data-quota-who-placeholder]");
    expect(rows).toHaveLength(TOP_AGENTS);
    for (const r of rows) expect(r.className).toContain("h-5");
    expect(loading.className).toContain("space-y-1.5");
  });

  it("a reopened card starts from the last answer (no loading shape again)", async () => {
    const openCard = async () => {
      await act(async () => root.render(h(ProfileQuota, { profile: "claude", rateLimits: null, rateLimitsAt: null, sessionId: null, busy: false })));
      const trigger = [...host.querySelectorAll<HTMLElement>("button")].find((b) => (b.dataset.tip ?? b.title ?? "").includes("composer.quota.title"))!;
      await act(async () => void trigger.click());
    };
    api.profileResetCredits.mockReturnValue(new Promise(() => {}));
    await openCard();
    await flush();
    expect(document.querySelector('[data-popover] [data-quota-who=""]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    const later = deferred<QuotaAttribution>();
    api.quotaAttribution.mockReturnValue(later.promise);
    await openCard();
    // The new read is still out: the remembered answer shows, not the loading shape.
    expect(document.querySelector('[data-popover] [data-quota-who="loading"]')).toBeNull();
    expect(document.querySelector('[data-popover] [data-quota-who-row="kai"]')).not.toBeNull();
    await act(async () => later.resolve(attribution));
  });
});
