// Owner management routes available to paired devices; daemon authorizes user + device scope.
export interface MobileProfile {
  id: string; name: string; cliKind: string; provider: string | null; model: string | null;
  appearance?: { effectiveProviderCategory?: string | null };
}
export interface ProfileQuotaGauge {
  id: string; label: string; displayLabel?: string | null; kind: "window" | "balance";
  remainingPercent: number | null; balance: string | null; resetAt: number | null;
  windowLabel: string | null; observedAt: number | null; stale: boolean; error?: string | null;
}
export interface ProfileQuota { source?: string | null; gauges: ProfileQuotaGauge[]; nativeQuota?: Record<string, unknown> | null }
export interface UsageAmounts {
  turns: number; requests: number; input: number; cachedInput: number; cacheWriteInput: number;
  output: number; reasoningOutput: number; total: number; estimatedCost?: number; unpricedTokens?: number;
}
export type UsageDimension = "day" | "profile" | "model" | "agent" | "project" | "source";
export interface MobileUsageReport {
  from: string; to: string; totals: UsageAmounts; currency?: string; warnings: string[];
  recordingSince: string | null; rows: (UsageAmounts & { key: Record<string, string | null> })[];
}
export interface MobileService {
  slug: string; displayName?: string; health: string; runtime: string; stopped?: boolean; archived?: boolean;
  /** null for a background service (cutex `worker`: no port, no page) and static files. */
  url?: string | null; localUrl?: string | null; projectId?: string | null;
}
export interface HumanSessionCreate {
  requestId: string; start: boolean; displayName?: string; profile?: string; cwd?: string;
}
export interface HumanAgentCreate { requestId: string; start: boolean; name: string; profile?: string; cwd?: string }
