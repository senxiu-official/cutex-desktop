// Settings → 运行时: the agents pinned to a version, active and archived apart. cutex's pin list counts every
// session; 升级 only covers unarchived ones, so an old version held by archived agents is not an agent left behind.
// The lifecycle comes from the host's session lists. Archived agents are read on demand (lib/useArchivedAgents):
// nobody is called archived until the list says so.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { InstalledRuntime, PinnedAgent } from "../../../shared/runtimes";

interface Lists {
  active: readonly SessionResource[];
  retired: readonly SessionResource[];
}

export interface PinnedSplit {
  /** Everyone not known to be archived, as this row always listed them. */
  agents: PinnedAgent[];
  /** Includes pins cutex sent only as a count: those can't be told apart. */
  agentCount: number;
  archived: PinnedAgent[];
}

export function splitPinnedAgents(runtime: Pick<InstalledRuntime, "agentCount" | "agents">, lists: Lists | null | undefined): PinnedSplit {
  const retired = new Set((lists?.retired ?? []).map(s => s.cutexSessionId));
  for (const s of lists?.active ?? []) if (s.lifecycle === "retired") retired.add(s.cutexSessionId);
  const archived = runtime.agents.filter(a => retired.has(a.id));
  return { agents: runtime.agents.filter(a => !retired.has(a.id)), agentCount: runtime.agentCount - archived.length, archived };
}
