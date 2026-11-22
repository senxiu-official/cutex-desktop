// When does a quota window run out (design 052 §5 items 1 and 3)? Computed from the quota curve only
// (cutex `GET /v2/usage/quota-history`, capability `usage-ledger`; already on r270 hosts), not the ledger:
// - short windows (5h …): the spend rate over the last hour of the current cycle, like cutex 041's
//   `slope()` (profile_auto_pick.rs: 60 min look-back, ≥ 10 min span, same reset within 10 min);
// - weekly windows (≥ 2 days): the average over the last 72 hours; under 24 hours of data → no forecast.
// A forecast cutex sends itself (`forecast` on a gauge, 052 §6) wins over the local one.
import { useEffect, useState } from "react";
import type { QuotaGauge } from "../../../shared/ipc";
import type { QuotaForecastWire, QuotaHistory, QuotaSnapshot } from "../../../shared/quotaAttribution";
import { USAGE_LEDGER_FEATURE } from "../../../shared/quotaAttribution";
import { translate } from "../i18n";
import { featuresOf, hostApi, useApp } from "../store";
import { observedClock } from "./quota";

const HOUR = 3600;
/** Short windows: look back one hour; at least 10 minutes between the first and the last point. */
export const SHORT_LOOKBACK_SECS = HOUR;
export const SHORT_MIN_SPAN_SECS = 10 * 60;
/** Weekly windows: the last 72 hours; at least 24 hours of points. */
export const LONG_LOOKBACK_SECS = 72 * HOUR;
export const LONG_MIN_SPAN_SECS = 24 * HOUR;
/** Two readings belong to the same cycle when their resets are this close (cutex SAME_CYCLE_SECS). */
export const SAME_CYCLE_SECS = 10 * 60;
/** Windows this long or longer are forecast from days of data (72 h average). */
export const LONG_WINDOW_SECS = 2 * 24 * HOUR;
/** Long windows up to this length read as "this week" (本周够用); longer ones (本月) get the plain wording. */
export const WEEK_WINDOW_MAX_SECS = 8 * 24 * HOUR;

/** Window length in seconds from a caption ("5h", "7d", "Fable 7d", "week"); null when unknown. */
export function windowSeconds(caption: string | null | undefined): number | null {
  if (!caption) return null;
  const c = caption.trim().toLowerCase();
  if (c === "week" || c === "weekly") return 7 * 24 * HOUR;
  if (c === "month" || c === "monthly") return 30 * 24 * HOUR;
  const m = /(\d+(?:\.\d+)?)\s*([mhd])$/.exec(c);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "d" ? 24 * HOUR : m[2] === "h" ? HOUR : 60);
}

/** What the window is: short (5h: last hour), week (7d: last 72 h, 「本周」 wording), long (a month: last 72 h). */
export type WindowSpan = "short" | "week" | "long";

export function windowSpan(caption: string | null | undefined): WindowSpan {
  const s = windowSeconds(caption) ?? 0;
  return s < LONG_WINDOW_SECS ? "short" : s <= WEEK_WINDOW_MAX_SECS ? "week" : "long";
}

export type QuotaForecast =
  /** Runs out before the reset: `at` unix seconds; `perHour` percent points per hour. */
  | { kind: "runsOut"; at: number; resetAt: number | null; perHour: number; span: WindowSpan }
  /** Lasts until the reset (or does not move). */
  | { kind: "lasts"; resetAt: number | null; perHour: number; span: WindowSpan }
  /** Already used up. */
  | { kind: "empty"; resetAt: number | null; span: WindowSpan }
  /** Not enough points yet. */
  | { kind: "unknown"; span: WindowSpan };

/** Spend per hour (percent points) from `(ts, remainingPercent)` points, oldest first; null = span too short. */
export function slope(points: readonly (readonly [number, number])[], minSpan: number): number | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const span = last[0] - first[0];
  if (span < minSpan) return null;
  return Math.max(0, (first[1] - last[1]) / (span / HOUR));
}

/** A forecast cutex computed itself (052 §6), as a QuotaForecast. */
export function fromWire(wire: QuotaForecastWire, gauge: Pick<QuotaGauge, "resetAt" | "windowLabel" | "remainingPercent">): QuotaForecast {
  const span = windowSpan(gauge.windowLabel);
  if (gauge.remainingPercent !== null && gauge.remainingPercent <= 0) return { kind: "empty", resetAt: gauge.resetAt, span };
  if (wire.state === "exhausted") return { kind: "empty", resetAt: gauge.resetAt, span };
  if (wire.state === "unknown") return { kind: "unknown", span };
  // cutex stated the state; a missing pace does not turn it into 数据不够.
  if (wire.state === "runsOut" && wire.runsOutAt !== null) return { kind: "runsOut", at: wire.runsOutAt, resetAt: gauge.resetAt, perHour: wire.percentPerHour ?? 0, span };
  return { kind: "lasts", resetAt: gauge.resetAt, perHour: wire.percentPerHour ?? 0, span };
}

/** A window gauge, possibly with cutex's own `forecast` (052 §6; absent on r270). */
export type ForecastGauge = QuotaGauge & { forecast?: QuotaForecastWire | null };

/**
 * The forecast of one window gauge from its history (a profile's snapshots; this gauge's are picked by
 * `gaugeId` and the same reset cycle). The current reading is the newest point. Balances, windows without a
 * percent and gauges in error: null.
 */
export function forecastGauge(gauge: ForecastGauge, history: readonly QuotaSnapshot[], now = Date.now() / 1000): QuotaForecast | null {
  if (gauge.kind !== "window" || gauge.remainingPercent === null || gauge.error) return null;
  if (gauge.forecast) return fromWire(gauge.forecast, gauge);
  const span = windowSpan(gauge.windowLabel);
  const resetAt = gauge.resetAt;
  if (gauge.remainingPercent <= 0) return { kind: "empty", resetAt, span };
  const observed = gauge.observedAt ?? now;
  const long = span !== "short";
  const lookback = long ? LONG_LOOKBACK_SECS : SHORT_LOOKBACK_SECS;
  const sameCycle = (r: number | null) => (r === null || resetAt === null ? r === resetAt : Math.abs(r - resetAt) <= SAME_CYCLE_SECS);
  const points: [number, number][] = history
    .filter((s) => s.gaugeId === gauge.id && s.remainingPercent !== null && s.ts >= observed - lookback && s.ts < observed && sameCycle(s.resetAt))
    .map((s) => [s.ts, s.remainingPercent!] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  points.push([observed, gauge.remainingPercent]);
  const perHour = slope(points, long ? LONG_MIN_SPAN_SECS : SHORT_MIN_SPAN_SECS);
  if (perHour === null) return { kind: "unknown", span };
  if (perHour <= 0) return { kind: "lasts", resetAt, perHour, span };
  const at = observed + (gauge.remainingPercent / perHour) * HOUR;
  if (resetAt !== null && at >= resetAt) return { kind: "lasts", resetAt, perHour, span };
  return { kind: "runsOut", at, resetAt, perHour, span };
}

const WEEKDAYS = ["quota.forecast.weekday.0", "quota.forecast.weekday.1", "quota.forecast.weekday.2", "quota.forecast.weekday.3", "quota.forecast.weekday.4", "quota.forecast.weekday.5", "quota.forecast.weekday.6"] as const;

/** A forecast time in local time: "HH:MM" today, "周四 14:00" / "Thu 14:00" within the coming week, else "MM-DD HH:MM". */
export function forecastClock(at: number, now = Date.now()): string {
  const d = new Date(at * 1000);
  if (d.toDateString() === new Date(now).toDateString()) return observedClock(at, now);
  if (at * 1000 > now && at * 1000 - now < 6.5 * 24 * HOUR * 1000) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${translate(WEEKDAYS[d.getDay()]!)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return observedClock(at, now);
}

/**
 * The forecast's one line: "按最近 1 小时的速度，约 01:40 用完（02:00 重置）", "撑得到重置", "本周够用",
 * "按过去 3 天的日均，约周四 14:00 用完（周五 11:00 重置）", "数据还不够，暂不预测".
 */
export function forecastText(f: QuotaForecast, now = Date.now()): string {
  const week = f.span === "week";
  if (f.kind === "unknown") return translate(f.span === "short" ? "quota.forecast.unknown" : "quota.forecast.unknownDays");
  if (f.kind === "empty") return f.resetAt ? translate("quota.forecast.empty", { reset: forecastClock(f.resetAt, now) }) : translate("quota.forecast.emptyNoReset");
  if (f.kind === "lasts") return translate(week ? "quota.forecast.weekOk" : "quota.forecast.lasts");
  const at = forecastClock(f.at, now);
  const days = f.span !== "short";
  const key = f.resetAt ? (days ? "quota.forecast.runsOutDays" : "quota.forecast.runsOut") : days ? "quota.forecast.runsOutDaysNoReset" : "quota.forecast.runsOutNoReset";
  return translate(key, { at, reset: f.resetAt ? forecastClock(f.resetAt, now) : "" });
}

/** Tone of the forecast line: danger when empty or out within 30 minutes, warn when out before the reset. */
export function forecastTone(f: QuotaForecast, now = Date.now() / 1000): "danger" | "warn" | "muted" {
  if (f.kind === "empty") return "danger";
  if (f.kind !== "runsOut") return "muted";
  return f.at - now <= 30 * 60 ? "danger" : "warn";
}

// ---------- the history (one read per host + profile, cached a few minutes) ----------

/** History reads are reused this long (cutex records a point at most every 15 minutes). */
export const HISTORY_TTL_MS = 5 * 60_000;

const cache = new Map<string, { at: number; snapshots: QuotaSnapshot[] | null; pending?: Promise<QuotaSnapshot[] | null> }>();

/** Local "YYYY-MM-DD" (cutex filters history by local day). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A profile's snapshots of the last 4 days (enough for the 72 h weekly slope); null = route missing / failed. */
export function loadQuotaHistory(hostId: string, profile: string, read: (q: { profile: string; from: string; to: string }) => Promise<QuotaHistory | null>, now = Date.now()): Promise<QuotaSnapshot[] | null> {
  const key = `${hostId}\n${profile}`;
  const hit = cache.get(key);
  if (hit?.pending) return hit.pending;
  if (hit && now - hit.at < HISTORY_TTL_MS) return Promise.resolve(hit.snapshots);
  const pending = Promise.resolve()
    .then(() => read({ profile, from: localDay(now - 4 * 24 * HOUR * 1000), to: localDay(now) }))
    .then((r) => r?.snapshots ?? null)
    .catch(() => null)
    .then((snapshots) => {
      cache.set(key, { at: Date.now(), snapshots });
      return snapshots;
    });
  cache.set(key, { at: hit?.at ?? 0, snapshots: hit?.snapshots ?? null, pending });
  return pending;
}

/** The cached snapshots without reading (null = none yet). */
export function cachedQuotaHistory(hostId: string, profile: string): QuotaSnapshot[] | null {
  return cache.get(`${hostId}\n${profile}`)?.snapshots ?? null;
}

/** Tests only. */
export function clearQuotaHistoryCache(): void {
  cache.clear();
}

/**
 * A profile's quota history on a host (capability `usage-ledger`), re-read when the gauges' newest
 * reading moves on (`observedAt`) and the cache is older than HISTORY_TTL_MS. null until known / without the route.
 */
export function useQuotaHistory(hostId: string, profile: string | null, observedAt: number | null): QuotaSnapshot[] | null {
  const enabled = useApp((s) => featuresOf(s, hostId).has(USAGE_LEDGER_FEATURE));
  const [snapshots, setSnapshots] = useState<QuotaSnapshot[] | null>(() => (profile ? cachedQuotaHistory(hostId, profile) : null));
  useEffect(() => {
    if (!profile || !enabled) {
      setSnapshots(null);
      return;
    }
    let live = true;
    setSnapshots(cachedQuotaHistory(hostId, profile));
    void loadQuotaHistory(hostId, profile, (q) => hostApi(hostId).quotaHistory(q)).then((s) => live && setSnapshots(s));
    return () => {
      live = false;
    };
  }, [hostId, profile, enabled, observedAt]);
  return snapshots;
}
