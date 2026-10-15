// Offline agents in the sidebar: compact one-line rows, the most recently active first, at most
// `offlineAgents` (Settings → 外观) per group; the rest are in the 全部 agent list. Pure.
import type { AgentRow } from "./sidebar";

export type OfflineLimit = 0 | 3 | 5 | 10 | "all";
export const OFFLINE_LIMITS: readonly OfflineLimit[] = [0, 3, 5, 10, "all"];
export const DEFAULT_OFFLINE_LIMIT: OfflineLimit = 5;

/**
 * Stored pref → limit. The old display modes: "list" showed every offline agent (→ all); the
 * avatar row and the folded sub-list (→ the default).
 */
export function migrateOfflineLimit(value: unknown): OfflineLimit {
  if (value === "all" || value === "list") return "all";
  return (OFFLINE_LIMITS as readonly unknown[]).includes(value) ? (value as OfflineLimit) : DEFAULT_OFFLINE_LIMIT;
}

/** When the agent was last active: its own timestamps, or a newer activity preview. */
export function lastSeen(row: AgentRow, previewAt?: number): number {
  return Math.max(row.lastActivity, previewAt ?? 0);
}

/** Most recently active first; name, then id, for a stable order. */
export function compareRecent(lastOf: (row: AgentRow) => number): (a: AgentRow, b: AgentRow) => number {
  return (a, b) => lastOf(b) - lastOf(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export interface OfflineSlice {
  shown: AgentRow[];
  /** Offline rows left out (in the 全部 agent list). */
  hidden: number;
}

/**
 * The offline rows a sidebar group lists: the newest `limit`, plus any `keep` row beyond them (the
 * open agent, pins) so it never disappears; every row while searching. Newest first.
 */
export function offlineSlice(rows: readonly AgentRow[], limit: OfflineLimit, lastOf: (row: AgentRow) => number, opts: { searching?: boolean; keep?: (row: AgentRow) => boolean } = {}): OfflineSlice {
  const sorted = [...rows].sort(compareRecent(lastOf));
  if (opts.searching || limit === "all") return { shown: sorted, hidden: 0 };
  const shown = sorted.filter((row, i) => i < limit || (opts.keep?.(row) ?? false));
  return { shown, hidden: sorted.length - shown.length };
}
