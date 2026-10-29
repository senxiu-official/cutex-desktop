export interface DshContext {
  used: number;
  size: number;
  observedAt: string;
  source: "acp";
  /**
   * Describes the occupancy figure only (cutex keeps "unavailable" even after r265 reports `billingUsage: true`).
   * Informational: whether the composer says 「计费数据不可用」 follows the runtime's `billingUsage` feature
   * (explicit false, lib/agentFeatures), never this note, and any value keeps the occupancy reading.
   */
  billing?: string;
}

/**
 * Kimi Code's occupancy (r266 K1: `thread.kimiContext`, live `kimi/contextUsage/updated`) has the same shape; its
 * `observedAt` may be null (then the time of reading stands in, so the composer's "observed" line stays honest enough).
 */
export function readAcpContext(value: unknown): DshContext | null {
  const direct = readDshContext(value);
  if (direct || !value || typeof value !== "object" || Array.isArray(value)) return direct;
  const v = value as Record<string, unknown>;
  return v.observedAt === null || v.observedAt === undefined ? readDshContext({ ...v, observedAt: new Date().toISOString() }) : null;
}

export function readDshContext(value: unknown): DshContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.used !== "number" || !Number.isFinite(v.used) || v.used < 0 || typeof v.size !== "number" || !Number.isFinite(v.size) || v.size <= 0 || typeof v.observedAt !== "string" || !Number.isFinite(Date.parse(v.observedAt)) || v.source !== "acp" || (v.billing !== undefined && typeof v.billing !== "string")) return null;
  return { used: v.used, size: v.size, observedAt: v.observedAt, source: "acp", ...(typeof v.billing === "string" ? { billing: v.billing } : {}) };
}
