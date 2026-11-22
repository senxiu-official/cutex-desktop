// @vitest-environment jsdom
// Design 052 §5 items 1 and 3: a window's forecast from the quota curve (cutex quota-history) — 用完 /
// 撑得到重置 / 本周够用 / 数据不够, times in local time, the curve read once per host + profile.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";
import type { QuotaSnapshot } from "../src/shared/quotaAttribution";
import { translate } from "../src/renderer/src/i18n";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { zhHantTW } from "../src/renderer/src/i18n/zh-Hant-TW";
import {
  clearQuotaHistoryCache,
  forecastClock,
  forecastGauge,
  forecastText,
  forecastTone,
  HISTORY_TTL_MS,
  loadQuotaHistory,
  localDay,
  slope,
  windowSeconds,
  windowSpan,
  type QuotaForecast,
} from "../src/renderer/src/lib/quotaForecast";

const H = 3600;
const NOW = Math.round(new Date(2026, 9, 31, 1, 0, 0).getTime() / 1000); // Sat 2026-10-31 01:00 local
const win = (id: string, windowLabel: string, remaining: number, resetIn: number | null, over: Partial<QuotaGauge> = {}): QuotaGauge => ({ id, label: "Claude", kind: "window", remainingPercent: remaining, balance: null, resetAt: resetIn === null ? null : NOW + resetIn * H, windowLabel, observedAt: NOW, stale: false, ...over });
/** Points every 15 minutes going back `hours`, spending `rate` %/h, ending just before `now` at `current`. */
const line = (gaugeId: string, current: number, rate: number, hours: number, resetAt: number | null): QuotaSnapshot[] => {
  const out: QuotaSnapshot[] = [];
  for (let t = NOW - hours * H; t < NOW; t += 15 * 60) out.push({ ts: t, profile: "claude", profileId: "p1", gaugeId, remainingPercent: Math.min(100, current + (rate * (NOW - t)) / H), resetAt });
  return out;
};

afterEach(() => clearQuotaHistoryCache());

describe("window lengths", () => {
  it("reads 5h / 7d / Fable 7d / week / month captions", () => {
    expect(windowSeconds("5h")).toBe(5 * H);
    expect(windowSeconds("7d")).toBe(7 * 24 * H);
    expect(windowSeconds("Fable 7d")).toBe(7 * 24 * H);
    expect(windowSeconds("week")).toBe(7 * 24 * H);
    expect(windowSeconds("month")).toBe(30 * 24 * H);
    expect(windowSeconds(null)).toBeNull();
    expect(windowSpan("5h")).toBe("short");
    expect(windowSpan("7d")).toBe("week");
    expect(windowSpan("month")).toBe("long");
    expect(windowSpan(null)).toBe("short");
  });

  it("slope needs the minimum span and never goes negative", () => {
    expect(slope([[0, 80], [5 * 60, 70]], 10 * 60)).toBeNull();
    expect(slope([[0, 80], [H, 70]], 10 * 60)).toBe(10);
    expect(slope([[0, 70], [H, 80]], 10 * 60)).toBe(0);
  });
});

describe("forecastGauge", () => {
  it("runs out before the reset at the last hour's pace (5h)", () => {
    const g = win("claude-0", "5h", 16, 3);
    const f = forecastGauge(g, line("claude-0", 16, 32, 1, g.resetAt), NOW)!;
    expect(f.kind).toBe("runsOut");
    const out = f as Extract<QuotaForecast, { kind: "runsOut" }>;
    expect(out.perHour).toBeCloseTo(32, 0);
    expect(out.at - NOW).toBeCloseTo(0.5 * H, -2);
    expect(out.span).toBe("short");
    expect(forecastTone(f, NOW)).toBe("danger");
  });

  it("lasts until the reset when the pace is slow, and only looks back one hour", () => {
    const g = win("claude-0", "5h", 80, 2);
    // A fast burn 3 hours ago is outside the window; the last hour spent 2 %/h.
    const history = [...line("claude-0", 90, 30, 3, g.resetAt).filter((s) => s.ts < NOW - 1.5 * H), ...line("claude-0", 80, 2, 1, g.resetAt)];
    const f = forecastGauge(g, history, NOW)!;
    expect(f.kind).toBe("lasts");
    expect(forecastTone(f, NOW)).toBe("muted");
  });

  it("ignores points of another reset cycle and other gauges; too few points = unknown", () => {
    const g = win("claude-0", "5h", 50, 4);
    const otherCycle = line("claude-0", 50, 40, 1, NOW - 1 * H);
    const otherGauge = line("claude-1", 50, 40, 1, g.resetAt);
    expect(forecastGauge(g, [...otherCycle, ...otherGauge], NOW)).toEqual({ kind: "unknown", span: "short" });
  });

  it("weekly windows use 72 hours and need at least a day of points", () => {
    const g = win("claude-1", "7d", 18, 48);
    const f = forecastGauge(g, line("claude-1", 18, 0.8, 72, g.resetAt), NOW)!;
    expect(f.kind).toBe("runsOut");
    expect((f as Extract<QuotaForecast, { kind: "runsOut" }>).span).toBe("week");
    expect(forecastGauge(g, line("claude-1", 18, 0.8, 20, g.resetAt), NOW)).toEqual({ kind: "unknown", span: "week" });
    const ok = forecastGauge(win("claude-1", "7d", 31, 48), line("claude-1", 31, 0.3, 72, NOW + 48 * H), NOW)!;
    expect(ok.kind).toBe("lasts");
  });

  it("used up, balances and errors", () => {
    expect(forecastGauge(win("g", "5h", 0, 1), [], NOW)).toEqual({ kind: "empty", resetAt: NOW + H, span: "short" });
    expect(forecastGauge({ ...win("b", "", 0, null), kind: "balance", remainingPercent: null, balance: "¥3" }, [], NOW)).toBeNull();
    expect(forecastGauge(win("e", "5h", 40, 1, { error: "401" }), [], NOW)).toBeNull();
  });

  it("a forecast cutex sends on the gauge wins", () => {
    const g = { ...win("claude-0", "5h", 30, 2), forecast: { state: "runsOut" as const, percentPerHour: 34, runsOutAt: NOW + 50 * 60, basis: "history60m" } };
    expect(forecastGauge(g, [], NOW)).toEqual({ kind: "runsOut", at: NOW + 50 * 60, resetAt: NOW + 2 * H, perHour: 34, span: "short" });
    const lasts = { ...g, forecast: { state: "lasts" as const, percentPerHour: 3, runsOutAt: null } };
    expect(forecastGauge(lasts, [], NOW)!.kind).toBe("lasts");
    const exhausted = { ...g, forecast: { state: "exhausted" as const, percentPerHour: null, runsOutAt: null } };
    expect(forecastGauge(exhausted, [], NOW)!.kind).toBe("empty");
    const unknown = { ...g, forecast: { state: "unknown" as const, percentPerHour: null, runsOutAt: null } };
    expect(forecastGauge(unknown, [], NOW)!.kind).toBe("unknown");
  });
});

describe("forecast text", () => {
  const day = new Date(NOW * 1000);
  const nowMs = NOW * 1000;
  it("HH:MM today, weekday within the week (local time zone)", () => {
    expect(forecastClock(NOW + 40 * 60, nowMs)).toBe("01:40");
    const thu = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 5, 14, 0).getTime() / 1000; // Thu 11-05
    expect(forecastClock(thu, nowMs)).toBe(`${translate("quota.forecast.weekday.4")} 14:00`);
    expect(zhCN["quota.forecast.weekday.4"]).toBe("周四");
    expect(en["quota.forecast.weekday.4"]).toBe("Thu");
  });

  it("用完 / 撑得到重置 / 本周够用 / 数据不够 in zh-CN, en and Hant", () => {
    const out: QuotaForecast = { kind: "runsOut", at: NOW + 40 * 60, resetAt: NOW + H, perHour: 30, span: "short" };
    expect(forecastText(out, nowMs)).toBe(translate("quota.forecast.runsOut", { at: "01:40", reset: "02:00" }));
    expect(forecastText({ kind: "lasts", resetAt: NOW + H, perHour: 2, span: "short" }, nowMs)).toBe(translate("quota.forecast.lasts"));
    expect(forecastText({ kind: "lasts", resetAt: NOW + 48 * H, perHour: 0.2, span: "week" }, nowMs)).toBe(translate("quota.forecast.weekOk"));
    expect(forecastText({ kind: "lasts", resetAt: NOW + 400 * H, perHour: 0.01, span: "long" }, nowMs)).toBe(translate("quota.forecast.lasts"));
    expect(forecastText({ kind: "unknown", span: "short" }, nowMs)).toBe(translate("quota.forecast.unknown"));
    expect(forecastText({ kind: "unknown", span: "week" }, nowMs)).toBe(translate("quota.forecast.unknownDays"));
    expect(forecastText({ kind: "empty", resetAt: NOW + H, span: "short" }, nowMs)).toBe(translate("quota.forecast.empty", { reset: "02:00" }));
    expect(zhCN["quota.forecast.runsOut"]).toBe("按最近 1 小时的速度，约 {at} 用完（{reset} 重置）");
    expect(zhCN["quota.forecast.lasts"]).toBe("按现在的速度，撑得到重置");
    expect(zhCN["quota.forecast.weekOk"]).toBe("本周够用");
    expect(zhCN["quota.forecast.unknown"]).toBe("数据还不够，暂不预测");
    expect(en["quota.forecast.runsOut"]).toBe("At the last hour's pace, runs out around {at} (resets {reset})");
    expect(en["quota.forecast.weekOk"]).toBe("Enough for this week");
    expect(zhHantCN["quota.forecast.weekOk"]).toBe("本週夠用");
    expect(zhHantTW["quota.forecast.lasts"]).toBe("按現在的速度，撐得到重置");
    expect(zhHantTW["quota.who.title"]).toBe("誰在用");
  });
});

describe("quota history cache", () => {
  it("one read per host + profile within the TTL; a failed or missing route is null", async () => {
    const snapshots = line("claude-0", 50, 10, 1, null);
    const read = vi.fn(async () => ({ from: "a", to: "b", profile: "claude", snapshots }));
    const now = Date.now();
    const [a, b] = await Promise.all([loadQuotaHistory("h", "claude", read, now), loadQuotaHistory("h", "claude", read, now)]);
    expect(a).toBe(snapshots);
    expect(b).toBe(snapshots);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({ profile: "claude", from: localDay(now - 4 * 24 * H * 1000), to: localDay(now) });
    await loadQuotaHistory("h", "claude", read, now + 1000);
    expect(read).toHaveBeenCalledOnce();
    await loadQuotaHistory("h", "claude", read, Date.now() + HISTORY_TTL_MS + 1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await loadQuotaHistory("other", "claude", async () => null)).toBeNull();
    expect(await loadQuotaHistory("bad", "claude", () => { throw new Error("no method"); })).toBeNull();
  });
});
