// Preview data for the quota forecast and 「谁在用」 (design 052): `GET /v2/usage/quota-history` built from the
// mock gauges (dev/mockBridge MOCK_QUOTA) as a straight line back from each current reading, and a
// `GET /v2/usage/quota-attribution` answer for the claude profile's windows.
// `?quota=burn`: the claude 5h window burns ~34 %/h (runs out in ~40 min) and the weekly one runs out before
// its reset; `?quota=uncal`: attribution without a calibration (shares only).
import type { QuotaGauge } from "../../../shared/ipc";
import type { QuotaAttribution, QuotaHistory, QuotaSnapshot } from "../../../shared/quotaAttribution";

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
export const QUOTA_BURN = params.get("quota") === "burn";
const UNCALIBRATED = params.get("quota") === "uncal";

/** Percent points per hour each mock window has been spending. */
const RATES: Record<string, Record<string, number>> = {
  claude: { "claude-0": QUOTA_BURN ? 34 : 3, "claude-1": QUOTA_BURN ? 0.8 : 0.3, "claude-2": 0.1 },
  GLM: { primary: 9, "extra-0": 0.5 },
  Kimi: { primary: 20, "extra-0": 0.4, "extra-1": 0.05 },
};

const WINDOW_SECS: Record<string, number> = { "5h": 5 * 3600, "7d": 7 * 86400, "fable 7d": 7 * 86400, month: 30 * 86400 };
const STEP = 15 * 60;

/** Snapshots every 15 minutes over the last 4 days, inside each window's current cycle. */
export function mockQuotaHistory(profile: string, gauges: readonly QuotaGauge[], query: { from: string; to: string }): QuotaHistory {
  const now = Date.now() / 1000;
  const snapshots: QuotaSnapshot[] = [];
  for (const g of gauges) {
    if (g.kind !== "window" || g.remainingPercent === null) continue;
    const rate = RATES[profile]?.[g.id] ?? 0.5;
    const observed = g.observedAt ?? now;
    const length = WINDOW_SECS[(g.windowLabel ?? "").toLowerCase()] ?? 5 * 3600;
    const cycleStart = g.resetAt ? g.resetAt - length : observed - 4 * 86400;
    for (let ts = Math.ceil((observed - 4 * 86400) / STEP) * STEP; ts < observed; ts += STEP) {
      if (ts < cycleStart) continue;
      const remaining = Math.min(100, g.remainingPercent + (rate * (observed - ts)) / 3600);
      snapshots.push({ ts, profile, profileId: profile, gaugeId: g.id, label: g.label, kind: "window", remainingPercent: Math.round(remaining * 10) / 10, balance: null, resetAt: g.resetAt });
    }
  }
  snapshots.sort((a, b) => a.ts - b.ts);
  return { from: query.from, to: query.to, profile, snapshots };
}

/** Who used the claude account's window: Kai (working now), Sora, a hidden probe, a deleted session. */
export function mockQuotaAttribution(profile: string, window: string, gauges: readonly QuotaGauge[]): QuotaAttribution | null {
  if (profile !== "claude") return null;
  const g = gauges.find((x) => x.kind === "window" && x.windowLabel === window);
  if (!g || g.remainingPercent === null) return null;
  const used = 100 - g.remainingPercent;
  const unitsPerPercent = 260_000;
  const shares: [string | null, string | null, number, boolean, boolean][] = [
    ["kai", "Kai", 0.5, true, false],
    ["sora", "Sora", 0.31, false, false],
    ["hidden-claude", "explicit-launch-probe", 0.05, false, false],
    ["old-claude", null, 0.03, false, true],
  ];
  const now = Math.round(Date.now() / 1000);
  const length = window === "7d" ? 7 * 86400 : 5 * 3600;
  const total = shares.reduce((n, x) => n + x[2], 0);
  return {
    contractVersion: 1,
    account: { id: "ca-mock", label: "Claude Max" },
    window: { label: window, startAt: g.resetAt ? g.resetAt - length : now - length, resetAt: g.resetAt, usedPercent: used, observedAt: g.observedAt },
    forecast: null,
    calibration: { unitsPerPercent: UNCALIBRATED ? null : unitsPerPercent, windows: UNCALIBRATED ? 0 : window === "7d" ? 3 : 9, confidence: UNCALIBRATED || window === "7d" ? "low" : "high" },
    rows: shares.map(([id, name, share, running, deleted]) => ({
      cutexSessionId: id,
      agentName: name,
      sessionDeleted: deleted,
      profile: "claude",
      model: "claude-opus-5-5",
      units: Math.round(used * share * unitsPerPercent),
      share: Math.round((share / total) * 1000) / 10,
      percent: UNCALIBRATED ? null : Math.round(used * share * 10) / 10,
      backgroundUnits: 0,
      backgroundShare: 0,
      requests: Math.max(1, Math.round(share * 12)),
      lastAt: now - Math.round((1 - share) * 3600),
      running,
    })),
    totalUnits: Math.round(used * total * unitsPerPercent),
    attributedPercent: UNCALIBRATED ? null : Math.round(used * total * 10) / 10,
    unattributedPercent: UNCALIBRATED ? null : Math.round(used * 0.11 * 10) / 10,
    tolerancePercent: 8,
    inFlight: [{ cutexSessionId: "kai", agentName: "Kai", startedAt: now - 600 }],
    coverage: { ledgerThrough: now - 60, accounting: "turnEnd", backgroundSubagents: "inParentWithShare", warnings: [] },
  };
}
