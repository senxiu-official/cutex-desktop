// Quota curve and 「谁在用」 (design 052). Two cutex routes:
// - `GET /v2/usage/quota-history?from&to&profile` (capability `usage-ledger`, r2xx and later): the
//   15-minute quota snapshots the forecast is computed from (lib/quotaForecast). Desktop-only, works on r270.
// - `GET /v2/usage/quota-attribution?profile=&window=5h|7d` (capability `quota-attribution`, design 052 §6
//   contract v1, cutex r290): which agents used a Claude account's window. Fields a reader can do without
//   are optional.

/** cutex capability for `GET /v2/usage/quota-attribution`. */
export const QUOTA_ATTRIBUTION_FEATURE = "quota-attribution";
/** cutex capability that carries `GET /v2/usage/quota-history` (with `/v2/usage`). */
export const USAGE_LEDGER_FEATURE = "usage-ledger";

/** One `usage-quota-history` row (cutex `snapshot_resource`). */
export interface QuotaSnapshot {
  /** Unix seconds of the upstream observation. */
  ts: number;
  profile: string;
  profileId: string;
  gaugeId: string;
  label?: string | null;
  kind?: string | null;
  remainingPercent: number | null;
  balance?: string | null;
  resetAt: number | null;
}

export interface QuotaHistory {
  from: string;
  to: string;
  profile: string | null;
  snapshots: QuotaSnapshot[];
}

/** cutex's forecast of a window (052 §6 v1 `forecast`). */
export interface QuotaForecastWire {
  /** `exhausted` (≥ 99.5 %), `runsOut` before the reset (at `runsOutAt`), `lasts` to the reset, `unknown` (too few readings). */
  state: "exhausted" | "runsOut" | "lasts" | "unknown";
  percentPerHour: number | null;
  /** Unix seconds; set with `runsOut`. */
  runsOutAt: number | null;
  basis?: string;
}

/** One `(session, model)` row, largest first (052 §6 v1). */
export interface QuotaAttributionRow {
  cutexSessionId: string | null;
  agentName: string | null;
  /** The session is no longer in the session records (shown as 已删除的会话). */
  sessionDeleted?: boolean;
  profile?: string | null;
  model?: string | null;
  units: number;
  /** Percent of this window's attributed units (always sent by v1). */
  share?: number;
  /** Approximate percent of the window (units ÷ unitsPerPercent); null without a calibration. */
  percent: number | null;
  /** Units of this agent's background subagents, and their share of this row (claude-r35 and later). */
  backgroundUnits?: number;
  backgroundShare?: number;
  requests?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  lastAt?: number | null;
  /** The session is in `inFlight` (its usage is recorded at turn end). */
  running?: boolean;
}

/** A session whose latest turn on this account started and has not ended (under 6 h). */
export interface QuotaInFlight {
  cutexSessionId: string;
  agentName: string | null;
  startedAt: number;
}

/** `GET /v2/usage/quota-attribution` (052 §6, contractVersion 1). */
export interface QuotaAttribution {
  contractVersion?: number;
  account?: { id: string; label: string | null } | null;
  window: { label: string; startAt: number | null; resetAt: number | null; usedPercent: number | null; observedAt: number | null };
  forecast?: QuotaForecastWire | null;
  /** `unitsPerPercent` null = not calibrated yet (rows carry shares only). */
  calibration?: { unitsPerPercent: number | null; windows: number; confidence: "high" | "medium" | "low" } | null;
  rows: QuotaAttributionRow[];
  totalUnits?: number;
  attributedPercent?: number | null;
  /** usedPercent − attributedPercent, ≥ 0; null without a calibration or a reading. Shown at or above `tolerancePercent`. */
  unattributedPercent?: number | null;
  tolerancePercent?: number;
  inFlight?: QuotaInFlight[];
  coverage?: { ledgerThrough?: number | null; accounting?: string; backgroundSubagents?: string; warnings?: string[] } | null;
}
