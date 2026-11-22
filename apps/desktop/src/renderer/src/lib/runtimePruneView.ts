import type { MessageKey } from "../i18n";
import type { InstalledRuntime, RuntimePruneClaudeProcesses, RuntimePruneVersion } from "../../../shared/runtimes";

/** Presentation only. Discovery includes installed Claude versions omitted from the pin view.
 * Copies of one release share a display row; cleanup retains every opaque ID in its plan array. */
export function mergeRuntimePruneVersions(list: readonly InstalledRuntime[], versions: readonly RuntimePruneVersion[]): readonly InstalledRuntime[] {
  const merged = [...list];
  for (const v of versions) {
    if (merged.some(r => r.release === v.release && (!r.version || !v.version || r.version === v.version))) continue;
    merged.push({ release: v.release, version: v.version ?? null, sha256Prefix: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] });
  }
  return merged;
}
/** Installed versions a component reports (`/v2/components` versions) that the pin view leaves out: no session uses
 * them. Shown without waiting for the cleanup plan, which can be slow; cutex lists them oldest first. */
export function mergeInstalledVersions(list: readonly InstalledRuntime[], installed: readonly { version: string }[] | null | undefined): readonly InstalledRuntime[] {
  const extra = (installed ?? []).filter(v => v.version && !list.some(r => r.release === v.version)).reverse();
  return extra.length ? [...list, ...extra.map(v => ({ release: v.version, version: null, sha256Prefix: null, path: null, selected: false, missing: false, agentCount: 0, agents: [] }))] : list;
}
/** A plan entry's size: 「未计算」 when cutex did not compute it (bytesEstimated, bytes 0), never 「0 B」. */
export function pruneVersionSize(v: Pick<RuntimePruneVersion, "bytes" | "bytesEstimated">, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  return v.bytesEstimated ? t("runtimes.prune.sizeUnknown") : runtimeBytes(v.bytes);
}
/** Total of plan entries: exact, 「至少 X」 when some sizes were not computed, 「大小未计算」 when none were. */
export function pruneTotalSize(versions: readonly Pick<RuntimePruneVersion, "bytes" | "bytesEstimated">[], t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const known = versions.filter(v => !v.bytesEstimated);
  const bytes = known.reduce((n, v) => n + v.bytes, 0);
  if (known.length === versions.length) return runtimeBytes(bytes);
  return known.length ? t("runtimes.prune.atLeast", { size: runtimeBytes(bytes) }) : t("runtimes.prune.totalUnknown");
}
export function runtimeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
const REASONS: Record<string, MessageKey> = {
  selected: "runtimes.prune.selected", pinned: "runtimes.prune.pinned", rollback: "runtimes.prune.rollback",
  running: "runtimes.prune.running", unmanaged: "runtimes.prune.unmanaged", inspection_failed: "runtimes.prune.inspection_failed",
  not_found: "runtimes.prune.not_found", io_error: "runtimes.prune.io_error",
  claude_process_unresolved: "runtimes.prune.claude_process_unresolved",
};
export function runtimePruneReason(reason?: string): MessageKey { return REASONS[reason ?? ""] ?? "runtimes.prune.unknown"; }

/** Shown at most this many processes (cutex sends at most 20). */
export const CLAUDE_PROCESS_LIST_MAX = 20;
/** The host-wide unresolved-Claude-process summary of a plan (cutex copies it onto every blocked Claude item), or null. */
export function claudeProcessInspection(versions: readonly RuntimePruneVersion[]): RuntimePruneClaudeProcesses | null {
  for (const v of versions) {
    const inspection = v.kind === "claude" ? v.claudeProcessInspection : undefined;
    if (inspection && inspection.unresolvedProcessCount >= 1) return inspection;
  }
  return null;
}
