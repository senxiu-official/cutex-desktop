// @vitest-environment jsdom
// Design 052 §5 item 4: the 「快用完」 notification — only while an agent works on the profile, only for a
// short window forecast to run out within 30 minutes, once per window (a new window may alert again),
// never while the owner's switch is off (the default until 052 §8 Q2 is decided).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";
import type { QuotaSnapshot } from "../src/shared/quotaAttribution";

const H = 3600;
const NOW = Math.round(Date.now() / 1000);
const win = (id: string, windowLabel: string, remaining: number, resetIn: number): QuotaGauge => ({ id, label: "Claude", kind: "window", remainingPercent: remaining, balance: null, resetAt: NOW + resetIn * H, windowLabel, observedAt: NOW, stale: false });
const line = (gaugeId: string, current: number, rate: number, hours: number, resetAt: number | null): QuotaSnapshot[] => {
  const out: QuotaSnapshot[] = [];
  for (let t = NOW - hours * H; t < NOW; t += 15 * 60) out.push({ ts: t, profile: "claude", profileId: "claude", gaugeId, remainingPercent: current + (rate * (NOW - t)) / H, resetAt });
  return out;
};

const state = vi.hoisted(() => ({
  quotas: {} as Record<string, QuotaGauge[]>,
  active: [] as { cutexSessionId: string; displayName: string; profile: string | null; activityStatus?: string; busySince?: string | null }[],
  features: new Set<string>(),
  history: [] as QuotaSnapshot[],
  listeners: [] as ((s: unknown, p: unknown) => void)[],
  openAgent: vi.fn(async () => {}),
  signal: vi.fn(),
  attribution: vi.fn(async () => null as unknown),
}));
vi.mock("../src/renderer/src/store", () => {
  const getState = () => ({ quotas: state.quotas, openAgent: state.openAgent, signal: state.signal });
  return {
    useApp: Object.assign(() => undefined, { getState, subscribe: (l: (s: unknown, p: unknown) => void) => (state.listeners.push(l), () => {}) }),
    agentHost: () => "local",
    featuresOf: () => state.features,
    sidebarOf: () => ({ active: state.active }),
    hostApi: () => ({ quotaHistory: async () => ({ from: "", to: "", profile: "claude", snapshots: state.history }), quotaAttribution: state.attribution }),
  };
});

const { alertBody, alertKey, runOutCandidates, startQuotaRunOutAlerts } = await import("../src/renderer/src/lib/quotaAlert");
const { setNotifyHandler } = await import("../src/renderer/src/lib/notifyEvents");
const { setUiPref } = await import("../src/renderer/src/lib/prefs");
const { clearQuotaHistoryCache } = await import("../src/renderer/src/lib/quotaForecast");
const { translate } = await import("../src/renderer/src/i18n");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");

const busy = new Map([["claude", [{ id: "kai", name: "Kai" }]]]);
const burning = () => {
  const g = win("claude-0", "5h", 16, 3);
  return { g, history: line("claude-0", 16, 34, 1, g.resetAt) };
};

beforeEach(() => {
  localStorage.clear();
  clearQuotaHistoryCache();
  state.listeners = [];
  state.features = new Set();
  state.attribution.mockReset().mockResolvedValue(null);
});
afterEach(() => setUiPref("quotaRunOutAlert", false));

describe("runOutCandidates", () => {
  it("a busy profile whose 5h runs out within 30 minutes; not idle profiles, weekly windows or slow burns", () => {
    const { g, history } = burning();
    const weekly = win("claude-1", "7d", 2, 40);
    const slow = win("claude-9", "5h", 60, 1);
    const quotas = { claude: [g, weekly, slow] };
    const found = runOutCandidates({ hostId: "local", quotas, busy, history: () => [...history, ...line("claude-1", 2, 5, 30, weekly.resetAt), ...line("claude-9", 60, 2, 1, slow.resetAt)], sent: new Set(), now: NOW });
    expect(found.map((c) => c.gauge.id)).toEqual(["claude-0"]);
    expect(runOutCandidates({ hostId: "local", quotas, busy: new Map(), history: () => history, sent: new Set(), now: NOW })).toEqual([]);
  });

  it("once per window: the same reset is skipped, the next window alerts again", () => {
    const { g, history } = burning();
    const sent = new Set([alertKey("local", "claude", g)]);
    expect(runOutCandidates({ hostId: "local", quotas: { claude: [g] }, busy, history: () => history, sent, now: NOW })).toEqual([]);
    const next = { ...g, resetAt: g.resetAt! + 5 * H };
    expect(runOutCandidates({ hostId: "local", quotas: { claude: [next] }, busy, history: () => line("claude-0", 16, 34, 1, next.resetAt), sent, now: NOW })).toHaveLength(1);
  });

  it("the body names the window, the time and the main agent", () => {
    const { g, history } = burning();
    const [c] = runOutCandidates({ hostId: "local", quotas: { claude: [g] }, busy, history: () => history, sent: new Set(), now: NOW });
    const time = /\d\d:\d\d/;
    expect(alertBody(c!, "review-insert-opus")).toMatch(time);
    expect(alertBody(c!, "review-insert-opus").startsWith("claude Claude 5h ")).toBe(true);
    expect(alertBody(c!, "review-insert-opus").endsWith(translate("quota.alert.mostly", { agent: "review-insert-opus" }))).toBe(true);
    expect(alertBody(c!, null)).not.toContain("review-insert-opus");
    expect(zhCN["quota.alert.body"]).toBe("{profile} {window} 约 {at} 用完（{reset} 重置）");
    expect(zhCN["quota.alert.mostly"]).toBe("，主要是 {agent}");
  });
});

describe("startQuotaRunOutAlerts", () => {
  const run = async () => {
    const shown: { key: string; body: string; onClick?: () => void; decided?: unknown }[] = [];
    const off = setNotifyHandler((o) => shown.push(o));
    const stop = startQuotaRunOutAlerts();
    await new Promise((r) => setTimeout(r, 30));
    return { shown, done: () => (stop(), off()) };
  };

  it("does nothing while the switch is off (default)", async () => {
    const { g, history } = burning();
    state.quotas = { claude: [g] };
    state.history = history;
    state.active = [{ cutexSessionId: "kai", displayName: "Kai", profile: "claude", activityStatus: "busy" }];
    const { shown, done } = await run();
    expect(shown).toEqual([]);
    done();
  });

  it("switched on: one desktop notification per window, naming the top agent; a click opens the agent's quota", async () => {
    const { g, history } = burning();
    state.quotas = { claude: [g] };
    state.history = history;
    state.active = [{ cutexSessionId: "kai", displayName: "Kai", profile: "claude", busySince: new Date().toISOString() }, { cutexSessionId: "sora", displayName: "Sora", profile: "other" }];
    state.features = new Set(["quota-attribution"]);
    state.attribution.mockResolvedValue({ window: { label: "5h", startAt: 0, resetAt: g.resetAt, usedPercent: 84, observedAt: NOW }, calibration: { unitsPerPercent: 1, windows: 9, confidence: "high" }, rows: [{ cutexSessionId: "kai", agentName: "Kai", units: 50, percent: 50 }], unattributedPercent: 0 });
    setUiPref("quotaRunOutAlert", true);
    const { shown, done } = await run();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.key).toBe(alertKey("local", "claude", g));
    expect(shown[0]!.body).toContain(translate("quota.alert.mostly", { agent: "Kai" }));
    expect(shown[0]!.decided).toEqual({ level: "inform", actions: ["desktop"] });
    shown[0]!.onClick!();
    await vi.waitFor(() => expect(state.signal).toHaveBeenCalledWith("quota", undefined, { hostId: "local", sessionId: "kai" }));
    expect(state.openAgent).toHaveBeenCalledWith("kai", "local");
    // Later checks of the same window stay quiet, also after a restart (remembered on the device).
    for (const l of state.listeners) l({ quotas: { ...state.quotas } }, { quotas: state.quotas });
    await new Promise((r) => setTimeout(r, 20));
    expect(shown).toHaveLength(1);
    done();
    const again = await run();
    expect(again.shown).toEqual([]);
    again.done();
  });
});

describe("switching the alert off cancels (review 2026-11-17)", () => {
  it("off while a check is reading: nothing is sent and the window is not marked", async () => {
    const { g, history } = burning();
    state.quotas = { claude: [g] };
    state.history = history;
    state.active = [{ cutexSessionId: "kai", displayName: "Kai", profile: "claude", activityStatus: "busy" }];
    setUiPref("quotaRunOutAlert", true);
    const shown: unknown[] = [];
    const off = setNotifyHandler((o) => shown.push(o));
    const stop = startQuotaRunOutAlerts();
    // check() has reached its first await; the owner's opt-out is immediate.
    setUiPref("quotaRunOutAlert", false);
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toHaveLength(0);
    stop();
    // Back on: this window was never alerted, so it still can be.
    setUiPref("quotaRunOutAlert", true);
    const again = startQuotaRunOutAlerts();
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toHaveLength(1);
    again();
    off();
  });

  it("off while the top agent is being read: still nothing", async () => {
    const { g, history } = burning();
    state.quotas = { claude: [g] };
    state.history = history;
    state.active = [{ cutexSessionId: "kai", displayName: "Kai", profile: "claude", activityStatus: "busy" }];
    state.features = new Set(["quota-attribution"]);
    let answer!: (v: unknown) => void;
    state.attribution.mockImplementation(() => new Promise((r) => (answer = r)));
    setUiPref("quotaRunOutAlert", true);
    const shown: unknown[] = [];
    const off = setNotifyHandler((o) => shown.push(o));
    const stop = startQuotaRunOutAlerts();
    await vi.waitFor(() => expect(state.attribution).toHaveBeenCalled());
    setUiPref("quotaRunOutAlert", false);
    answer(null);
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toHaveLength(0);
    stop();
    off();
  });

  it("stop cancels a check in flight", async () => {
    const { g, history } = burning();
    state.quotas = { claude: [g] };
    state.history = history;
    state.active = [{ cutexSessionId: "kai", displayName: "Kai", profile: "claude", activityStatus: "busy" }];
    setUiPref("quotaRunOutAlert", true);
    const shown: unknown[] = [];
    const off = setNotifyHandler((o) => shown.push(o));
    const stop = startQuotaRunOutAlerts();
    stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(shown).toHaveLength(0);
    off();
  });
});
