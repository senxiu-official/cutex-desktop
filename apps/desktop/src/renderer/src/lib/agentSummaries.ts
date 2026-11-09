// `services.agents` (docs/desktop-modules.md §7): the agents on the connected hosts in the small shape modules see.
// Everything comes from the sidebar snapshots the store already holds; nothing here asks the daemon.
import { useApp } from "../store";
import { agentIndex } from "./agentLook";
import { panesOpen } from "./paneServices";
import { agentStatus, type AgentStatus } from "./sidebar";

export interface AgentSummary {
  id: string;
  hostId: string;
  name: string;
  color: string | null;
  projectId: string | null;
  status: AgentStatus;
  archived: boolean;
}

let memo: { index: unknown; list: readonly AgentSummary[]; byId: ReadonlyMap<string, AgentSummary> } | null = null;

function current(): NonNullable<typeof memo> {
  const index = agentIndex(useApp.getState());
  if (memo?.index === index) return memo;
  const list = [...index.values()].map(({ hostId, session, row }): AgentSummary => ({
    id: session.cutexSessionId,
    hostId,
    name: session.displayName,
    color: session.avatar?.color ?? null,
    projectId: row?.projectId ?? null,
    status: agentStatus(session, false),
    archived: session.lifecycle === "retired",
  }));
  memo = { index, list, byId: new Map(list.map((a) => [a.id, a])) };
  return memo;
}

export const agentSummaries = (): readonly AgentSummary[] => current().list;
export const agentSummary = (id: string): AgentSummary | null => current().byId.get(id) ?? null;

/** Called when the list may have changed; `agentSummaries()` says whether it did. */
export function subscribeAgentSummaries(listener: () => void): () => void {
  let last = agentSummaries();
  return useApp.subscribe(() => {
    const next = agentSummaries();
    if (next === last) return;
    last = next;
    listener();
  });
}

export function openAgent(id: string): void {
  const agent = agentSummary(id);
  if (agent) panesOpen("core.conversation", { sessionId: id, hostId: agent.hostId }, { focus: true });
}
