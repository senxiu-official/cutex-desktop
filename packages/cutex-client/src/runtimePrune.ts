/** Owner-only managed runtime cleanup. IDs are opaque daemon-issued handles. */
export const RUNTIME_PRUNE_FEATURE = "runtime-prune-v1";
export type RuntimePruneKind = "native" | "claude" | "dsh" | "kimi";
export interface RuntimePruneVersion {
  id: string;
  kind: RuntimePruneKind;
  release: string;
  version?: string;
  bytes: number;
  /** cutex B1 (2026-11-15): the size was not computed (`bytes` is then 0, not a size). */
  bytesEstimated?: boolean;
  canPrune: boolean;
  blockedReasons: string[];
  /** cutex after r288: on a Claude item blocked by `claude_process_unresolved`, the host-wide summary of Claude
   *  processes whose runtime could not be resolved (the same copy on every such item; not mapped to versions). */
  claudeProcessInspection?: RuntimePruneClaudeProcesses;
}
export interface RuntimePruneClaudeProcesses {
  /** At least 1. */
  unresolvedProcessCount: number;
  /** At most 20; `sessionId` (`cutex.<uuid>`) is observed from the process, not authenticated. */
  processes: { pid?: number; sessionId?: string }[];
  /** cutex's English diagnostic; the desktop shows its own words. */
  message: string;
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
