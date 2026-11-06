import type { MessageKey } from "../i18n";
import type { InstalledRuntime, RuntimePruneVersion } from "../../../shared/runtimes";

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
};
export function runtimePruneReason(reason?: string): MessageKey { return REASONS[reason ?? ""] ?? "runtimes.prune.unknown"; }
