// Last-activity helpers for agent lists (the sidebar roster, the 全部 agent list, member pickers). Pure.
// The sidebar no longer lists offline agents separately (design 060 B: lib/sidebarLayout 最近 / 其余).
import type { AgentRow } from "./sidebar";
import { compareNames } from "./rosterOrder";

/** When the agent was last active: its own timestamps, or a newer activity preview. */
export function lastSeen(row: AgentRow, previewAt?: number): number {
  return Math.max(row.lastActivity, previewAt ?? 0);
}

/** Most recently active first; name, then id, for a stable order. */
export function compareRecent(lastOf: (row: AgentRow) => number): (a: AgentRow, b: AgentRow) => number {
  return (a, b) => lastOf(b) - lastOf(a) || compareNames(a.name, b.name) || a.id.localeCompare(b.id);
}
