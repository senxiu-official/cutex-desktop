// 「谁在用」 (design 052 §5 item 2): the top agents of a Claude account's window from cutex
// `GET /v2/usage/quota-attribution` (capability `quota-attribution`; absent → the block does not show).
// Every figure is approximate (约): cutex converts tokens to units at API price ratios and calibrates
// them against the observed quota per account (052 §3.2–3.3).
import { useEffect, useState, useSyncExternalStore } from "react";
import type { QuotaGauge } from "../../../shared/ipc";
import type { QuotaAttribution, QuotaAttributionRow, QuotaForecastWire } from "../../../shared/quotaAttribution";
import { QUOTA_ATTRIBUTION_FEATURE } from "../../../shared/quotaAttribution";
import { featuresOf, hostApi, useApp } from "../store";

/** Rows shown before 「其它」. */
export const TOP_AGENTS = 3;
/** 未归因 shows only at or above this many percentage points when cutex does not say (052 §6 `tolerancePercent`). */
export const UNATTRIBUTED_TOLERANCE = 8;

export interface AttributionLine {
  row: QuotaAttributionRow;
  /** Share shown: the window percent when calibrated, else the share of the recorded usage (both 0..100). */
  share: number;
}

export interface AttributionSummary {
  /** Calibrated: shares are percent of the window; otherwise percent of what the ledger recorded. */
  calibrated: boolean;
  /** Low-confidence calibration (fewer than 5 windows or a wide spread). */
  lowConfidence: boolean;
  top: AttributionLine[];
  /** The rest after the top rows (null when nothing is left). */
  other: { count: number; share: number } | null;
  /** 未归因 percent of the window (null under the tolerance or without a calibration). */
  unattributed: number | null;
  /** Every row, largest first (the full list). */
  all: AttributionLine[];
  /** Agents with a turn still running (their usage lands at turn end). */
  inFlight: string[];
}

const sum = (x: number | null | undefined, y: number | null | undefined): number | null | undefined => (x === null || y === null ? null : x === undefined || y === undefined ? undefined : x + y);

/**
 * One row per agent: cutex sends a row per (session, model) (052 §6), so one agent on two models would take two
 * of the top places. Rows of the same session are added up (a null percent / share stays null / absent); rows
 * without a session stay apart. Sessions with a turn in flight but nothing recorded yet get a row of their own
 * (0, with the spinner), so 谁在用 names them.
 */
export function agentRows(a: QuotaAttribution): QuotaAttributionRow[] {
  const merged = new Map<string, QuotaAttributionRow>();
  a.rows.forEach((r, i) => {
    const key = r.cutexSessionId ?? `\u0000${i}`;
    const have = merged.get(key);
    if (!have) return void merged.set(key, { ...r });
    const units = have.units + r.units;
    const background = (have.backgroundUnits ?? 0) + (r.backgroundUnits ?? 0);
    merged.set(key, {
      ...have,
      agentName: have.agentName ?? r.agentName,
      model: have.model === r.model ? have.model : null,
      units,
      percent: sum(have.percent, r.percent) ?? null,
      share: sum(have.share, r.share) ?? undefined,
      backgroundUnits: background,
      backgroundShare: units > 0 ? (background / units) * 100 : 0,
      requests: (have.requests ?? 0) + (r.requests ?? 0),
      inputTokens: (have.inputTokens ?? 0) + (r.inputTokens ?? 0),
      cacheReadTokens: (have.cacheReadTokens ?? 0) + (r.cacheReadTokens ?? 0),
      cacheWriteTokens: (have.cacheWriteTokens ?? 0) + (r.cacheWriteTokens ?? 0),
      outputTokens: (have.outputTokens ?? 0) + (r.outputTokens ?? 0),
      lastAt: Math.max(have.lastAt ?? 0, r.lastAt ?? 0) || null,
      running: !!(have.running || r.running),
      sessionDeleted: !!(have.sessionDeleted || r.sessionDeleted),
    });
  });
  const calibrated = (a.calibration?.unitsPerPercent ?? null) !== null;
  for (const f of a.inFlight ?? []) {
    const have = merged.get(f.cutexSessionId);
    if (have) have.running = true;
    else merged.set(f.cutexSessionId, { cutexSessionId: f.cutexSessionId, agentName: f.agentName, units: 0, share: 0, percent: calibrated ? 0 : null, running: true });
  }
  return [...merged.values()];
}

/** The summary of an attribution answer: top 3 + 其它 + 未归因; null when nothing was recorded or running. */
export function summarizeAttribution(a: QuotaAttribution, top = TOP_AGENTS): AttributionSummary | null {
  const rows = agentRows(a).filter((r) => r.units > 0 || (r.percent ?? 0) > 0 || r.running);
  if (!rows.length) return null;
  const calibrated = rows.every((r) => r.percent !== null && r.percent !== undefined) && (a.calibration?.unitsPerPercent ?? null) !== null;
  const total = rows.reduce((n, r) => n + Math.max(0, r.units), 0);
  const all = rows
    .map((row): AttributionLine => ({ row, share: calibrated ? Math.max(0, row.percent ?? 0) : typeof row.share === "number" ? Math.max(0, row.share) : total > 0 ? (Math.max(0, row.units) / total) * 100 : 0 }))
    .sort((x, y) => y.share - x.share || (y.row.running ? 1 : 0) - (x.row.running ? 1 : 0));
  const rest = all.slice(top);
  const unattributed = calibrated && (a.unattributedPercent ?? 0) >= (a.tolerancePercent ?? UNATTRIBUTED_TOLERANCE) ? a.unattributedPercent! : null;
  return {
    calibrated,
    lowConfidence: a.calibration?.confidence === "low",
    top: all.slice(0, top),
    other: rest.length ? { count: rest.length, share: rest.reduce((n, l) => n + l.share, 0) } : null,
    unattributed,
    all,
    inFlight: [...new Set([...(a.inFlight ?? []).map((f) => f.agentName ?? ""), ...all.filter((l) => l.row.running).map((l) => l.row.agentName ?? "")].filter(Boolean))],
  };
}

/** A whole percent for 约 x %: under 1 shows "<1". */
export function shareText(share: number): string {
  return share > 0 && share < 1 ? "<1" : String(Math.round(share));
}

/** The attribution window for a gauge: "5h" / "7d" by its caption, null for other windows (no attribution). */
export function attributionWindow(windowLabel: string | null | undefined): "5h" | "7d" | null {
  const w = windowLabel?.trim().toLowerCase();
  return w === "5h" ? "5h" : w === "7d" ? "7d" : null;
}

/**
 * A profile's attribution for one window while `active` (the popover is open): read once on open and again
 * whenever `refreshKey` changes (the gauges' newest reading, i.e. cutex/profile/quota/updated) — no polling.
 * undefined = loading / not offered; null = cutex has no data for it.
 */
export function useQuotaAttribution(hostId: string, profile: string | null, window: string | null, active: boolean, refreshKey: number | null): QuotaAttribution | null | undefined {
  const offered = useApp((s) => featuresOf(s, hostId).has(QUOTA_ATTRIBUTION_FEATURE));
  const [value, setValue] = useState<QuotaAttribution | null | undefined>(undefined);
  useEffect(() => {
    if (!offered || !profile || !window || !active) return;
    let live = true;
    void hostApi(hostId)
      .quotaAttribution({ profile, window })
      .then(
        (r) => {
          if (!live) return;
          setValue(r);
          rememberAttribution(hostId, profile, window, r);
        },
        () => live && setValue(null),
      );
    return () => {
      live = false;
    };
  }, [offered, hostId, profile, window, active, refreshKey]);
  useEffect(() => setValue(undefined), [hostId, profile, window]);
  return offered ? value : undefined;
}

// The newest attribution answer per (host, profile, window): its `forecast` is cutex's own reading of that
// window, which the quota row and popover show instead of the desktop's estimate (lib/quotaForecast) while it
// is current: computed from a host reading (window.observedAt) not older than the gauge's, tied to the gauge reading
// it was first shown with (any newer reading drops it, whatever clock that reading carries), and at most
// FORECAST_MAX_AGE old (a timer re-renders at that moment). Otherwise the local estimate shows until the next
// answer (the popover reads one when it opens). Freshness that cannot be shown = the local estimate.
interface Remembered {
  answer: QuotaAttribution;
  /** Arrival, desktop clock (seconds): only compared with the desktop clock. */
  at: number;
  /** The gauge reading (observedAt) it was first shown against; undefined = not shown yet. */
  shownWith?: number;
  expiry: ReturnType<typeof setTimeout> | null;
}
const latest = new Map<string, Remembered>();
/** Seconds a remembered cutex forecast is used at most. */
export const FORECAST_MAX_AGE = 10 * 60;
const listeners = new Set<() => void>();
let version = 0;
const cacheKey = (hostId: string, profile: string, window: string) => JSON.stringify([hostId, profile, window]);

function rememberAttribution(hostId: string, profile: string, window: string, a: QuotaAttribution | null): void {
  const key = cacheKey(hostId, profile, window);
  const old = latest.get(key);
  if (old?.expiry) clearTimeout(old.expiry);
  if (a) {
    const entry: Remembered = { answer: a, at: Date.now() / 1000, expiry: null };
    // At FORECAST_MAX_AGE the forecast stops being used: re-render then, not only on the next reading.
    entry.expiry = setTimeout(() => {
      entry.expiry = null;
      if (latest.get(key) === entry) changed();
    }, FORECAST_MAX_AGE * 1000 + 50);
    latest.set(key, entry);
  } else if (!latest.delete(key)) return;
  changed();
}

function changed(): void {
  version++;
  for (const l of listeners) l();
}

/** Re-renders when a newer attribution answer lands (read the value with attributionForecast). */
export function useAttributionVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
  );
}

/**
 * cutex's forecast for this gauge's window, from the newest attribution answer — only while it describes the
 * same window (same reset, or no reset known on either side). null = none (older cutex, not read yet, other window).
 */
export function attributionForecast(hostId: string, profile: string | null, gauge: Pick<QuotaGauge, "windowLabel" | "resetAt" | "observedAt">, now = Date.now() / 1000): QuotaForecastWire | null {
  const window = attributionWindow(gauge.windowLabel);
  if (!profile || !window) return null;
  const entry = latest.get(cacheKey(hostId, profile, window));
  const a = entry?.answer;
  if (!entry || !a?.forecast) return null;
  if (a.window.resetAt !== null && gauge.resetAt !== null && a.window.resetAt !== gauge.resetAt) return null;
  // Too old: the window may have moved since (desktop clock on both sides).
  if (now - entry.at > FORECAST_MAX_AGE) return null;
  // Freshness has to be shown by the host's own reading; without one (or without the gauge's) it cannot be.
  const read = a.window.observedAt;
  if (read == null || gauge.observedAt == null) return null;
  if (read < gauge.observedAt) return null;
  // Tied to the gauge reading it was first shown with: a newer reading (on any clock) drops it.
  entry.shownWith ??= gauge.observedAt;
  if (entry.shownWith !== gauge.observedAt) return null;
  return a.forecast;
}

/** Tests: forget every remembered answer. */
export function clearAttributionCache(): void {
  for (const e of latest.values()) if (e.expiry) clearTimeout(e.expiry);
  latest.clear();
  version++;
}
