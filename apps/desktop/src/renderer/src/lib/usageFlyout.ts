// Identity menu → 用量 ▸ (components/UsageFlyout): what the flyout shows before its refresh is done,
// so it opens at its final size in the first frame instead of growing as profiles / quotas arrive.
// - The last rows shown, per host (module cache; the focus host starts over on a switch, a replaced /
//   removed connection drops its host — like lib/profileSnapshot).
// - First open without that cache: a prediction from the profile list (which profiles report quota,
//   how many gauges), drawn as placeholder rows of the same height.
import type { ProfileItem, QuotaGauge } from "../../../shared/ipc";
import { onHostReset, onHostSwitch } from "./hostSwitch";
import { splitUsage } from "./identity";

/** The row set: profiles with gauges (one row each, `counts[name]` gauges) and the 「未开启」 line. */
export interface UsageLayout {
  rows: string[];
  off: string[];
  counts: Record<string, number>;
}

/** A layout plus the gauges it was drawn with (values shown until the refresh replaces them). */
export interface UsageSnapshot extends UsageLayout {
  gauges: Record<string, QuotaGauge[]>;
}

/** Placeholder gauges of a predicted row (most readers have two windows: 5h + 7d). */
export const PREDICTED_GAUGES = 2;

const lastShown = new Map<string, UsageSnapshot>();
onHostSwitch(() => lastShown.clear());
onHostReset((hostId) => lastShown.delete(hostId));

export function cachedUsage(hostId: string): UsageSnapshot | null {
  return lastShown.get(hostId) ?? null;
}

export function rememberUsage(hostId: string, snapshot: UsageSnapshot): void {
  lastShown.set(hostId, snapshot);
}

/** Whether a profile is expected to report quota: ChatGPT / Claude logins natively, API keys with a reader. */
export function expectsQuota(p: Pick<ProfileItem, "authKind" | "cliKind" | "quotaEnabled">): boolean {
  return p.authKind === "chatgpt" || p.authKind === "claude" || p.cliKind === "claude" || p.quotaEnabled;
}

/** The layout guessed from the profile list alone (first open, nothing cached yet). */
export function predictUsage(profiles: readonly Pick<ProfileItem, "name" | "authKind" | "cliKind" | "quotaEnabled">[]): UsageLayout {
  const rows = profiles.filter(expectsQuota).map((p) => p.name);
  const off = profiles.filter((p) => !expectsQuota(p)).map((p) => p.name);
  return { rows, off, counts: Object.fromEntries(rows.map((n) => [n, PREDICTED_GAUGES])) };
}

/**
 * The layout of known gauges: `null` while some profile's quota is still unknown (the caller keeps
 * showing the cached / predicted layout) unless `settled` (every read finished: unknown ones drop out).
 */
export function usageLayout(names: readonly string[], gauges: Readonly<Record<string, readonly QuotaGauge[] | undefined>>, settled: boolean): UsageLayout | null {
  const { withQuota, without, waiting } = splitUsage(names, gauges);
  if (waiting && !settled) return null;
  return { rows: withQuota, off: without, counts: Object.fromEntries(withQuota.map((n) => [n, gauges[n]!.length])) };
}
