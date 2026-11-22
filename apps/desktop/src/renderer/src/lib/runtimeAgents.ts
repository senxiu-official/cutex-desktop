// Settings → 运行时: the agents pinned to a version, active and archived apart. cutex's pin list counts every
// session; 升级 only covers unarchived ones, so an old version held by archived agents is not an agent left behind.
// The counts are exact only when cutex sends them (activeAgentCount / archivedAgentCount) or when the names it sent
// are the whole pin list; cutex sends at most 20 names, and a split derived from that sample was wrong (EVA
// 2026-11-15: 「79 个 · 5 个已归档」 for 84 pins, 80 of them archived). Otherwise the row shows only the total.
// Which of the sampled names are archived comes from the host's session lists (read on demand, lib/useArchivedAgents):
// nobody is called archived until the list says so.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { InstalledRuntime, PinnedAgent } from "../../../shared/runtimes";

interface Lists {
  active: readonly SessionResource[];
  retired: readonly SessionResource[];
}

export interface PinnedSplit {
  /** Sampled names not known to be archived (all sampled names when there is no split). */
  agents: PinnedAgent[];
  /** Pins not archived; the whole agentCount when there is no split. */
  agentCount: number;
  /** Sampled names known to be archived; empty when there is no split. */
  archived: PinnedAgent[];
  /** Exact archived count; null when it is not known (the row then shows only the total). */
  archivedCount: number | null;
}

export function splitPinnedAgents(runtime: Pick<InstalledRuntime, "agentCount" | "agents"> & Partial<Pick<InstalledRuntime, "activeAgentCount" | "archivedAgentCount">>, lists: Lists | null | undefined): PinnedSplit {
  const retired = new Set((lists?.retired ?? []).map(s => s.cutexSessionId));
  for (const s of lists?.active ?? []) if (s.lifecycle === "retired") retired.add(s.cutexSessionId);
  const archived = runtime.agents.filter(a => retired.has(a.id));
  const agents = runtime.agents.filter(a => !retired.has(a.id));
  if (runtime.activeAgentCount != null && runtime.archivedAgentCount != null)
    return { agents, agentCount: runtime.activeAgentCount, archived, archivedCount: runtime.archivedAgentCount };
  if (runtime.agents.length >= runtime.agentCount)
    return { agents, agentCount: runtime.agentCount - archived.length, archived, archivedCount: archived.length };
  return { agents: runtime.agents, agentCount: runtime.agentCount, archived: [], archivedCount: null };
}
