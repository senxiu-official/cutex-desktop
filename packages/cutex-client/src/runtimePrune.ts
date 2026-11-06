/** Owner-only managed runtime cleanup. IDs are opaque daemon-issued handles. */
export const RUNTIME_PRUNE_FEATURE = "runtime-prune-v1";
export type RuntimePruneKind = "native" | "claude" | "dsh" | "kimi";
export interface RuntimePruneVersion {
  id: string;
  kind: RuntimePruneKind;
  release: string;
  version?: string;
  bytes: number;
  canPrune: boolean;
  blockedReasons: string[];
}
export interface RuntimePrunePlan { versions: RuntimePruneVersion[] }
export interface RuntimePruneResult {
  freedBytes: number;
  results: { id: string; status: "deleted" | "refused" | "failed"; freedBytes: number; reason?: string }[];
}
export function runtimePruneBody(ids: readonly string[]): { ids: string[] } {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some(id => typeof id !== "string" || !id)) throw new Error("Expected 1–100 runtime IDs");
  return { ids: [...ids] };
}
