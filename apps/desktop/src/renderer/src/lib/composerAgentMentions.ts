import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { agentMentionMarkdown, parseAgentMentionHref } from "./agentMentions";
import { realAgentName } from "./agentAlias";
import { compareNames } from "./rosterOrder";
import { isQuickChat } from "./sidebar";

export interface MentionHost {
  id: string;
  label: string;
  connected: boolean;
  sidebar: SidebarSnapshot | null;
}
export interface AgentMentionCandidate {
  id: string;
  name: string;
  /** The agent's own name (lib/agentAlias): what the inserted link carries, so the agent reads its own name, not the owner's 显示名称. */
  wireName: string;
  label: string;
  hostId: string;
  hostLabel: string;
  sameProject: boolean;
  presence: "online" | "offline" | "unknown";
  session: SessionResource;
}

/** The recent-mention key of an agent (lib/agentPickerOptions recent memory, context "mention", host "*"). */
export const mentionRecentKey = (hostId: string, id: string): string => `${hostId}
${id}`;

/**
 * Only identities already returned in the user's authorized host snapshots are offered. Order (owner 2026-11-09):
 * the current agent's project, then recent mentions (`recent`: mentionRecentKey values, newest first), then by
 * name. The query also matches the agent's project; quick chats outside a project show only when searched (or recent).
 */
export function agentMentionCandidates(hosts: readonly MentionHost[], currentHost: string, currentAgent: string, query: string, limit = 50, recent: readonly string[] = []): AgentMentionCandidate[] {
  const recentRank = new Map(recent.map((key, i) => [key, i]));
  const rankOf = (c: AgentMentionCandidate) => recentRank.get(mentionRecentKey(c.hostId, c.id)) ?? Infinity;
  const project = hosts.find(host => host.id === currentHost)?.sidebar?.hostRows?.[currentAgent]?.projectId;
  const needle = query.toLocaleLowerCase();
  const seen = new Set<string>();
  const candidates: AgentMentionCandidate[] = [];
  for (const host of hosts) for (const session of host.sidebar?.active ?? []) {
    const id = session.cutexSessionId;
    if (id === currentAgent || seen.has(id) || session.visible === false || session.lifecycle === "retired" || !parseAgentMentionHref(`cutex:agent/${id}`)) continue;
    seen.add(id);
    const name = session.displayName || session.formalAgentName || id;
    const label = host.id === currentHost ? name : `${name}@${host.label}`;
    const row = host.sidebar?.hostRows?.[id];
    const projectId = row?.projectId ?? null;
    const projectName = projectId ? row?.projectName || host.sidebar?.projects?.projects.find(p => p.project_id === projectId)?.presentation.display_name || null : null;
    if (needle && ![label, name, session.formalAgentName, id, projectName].some(value => value?.toLocaleLowerCase().includes(needle))) continue;
    if (!needle && !projectId && isQuickChat(session, row) && !recentRank.has(mentionRecentKey(host.id, id))) continue;
    candidates.push({ id, name, wireName: realAgentName(session) || name, label, hostId: host.id, hostLabel: host.label,
      sameProject: !!project && host.id === currentHost && host.sidebar?.hostRows?.[id]?.projectId === project,
      presence: !host.connected ? "unknown" : session.runtime.status === "online" ? "online" : session.runtime.status === "offline" ? "offline" : "unknown",
      session,
    });
  }
  return candidates.sort((a, b) => Number(b.sameProject) - Number(a.sameProject) || rankOf(a) - rankOf(b) || compareNames(a.label, b.label) || a.id.localeCompare(b.id)).slice(0, Math.max(0, Math.min(100, limit)));
}

/**
 * What picking a candidate inserts (`hostId`: the conversation's host): another host's agent carries its host. The link's
 * label is the agent's own name (owner 2026-11-05); the chip still draws the current 显示名称 from the id.
 */
export function agentMentionInsert(agent: Pick<AgentMentionCandidate, "id" | "name" | "hostId" | "hostLabel"> & Partial<Pick<AgentMentionCandidate, "wireName">>, hostId: string): string {
  return agentMentionMarkdown(agent.wireName || agent.name, agent.id, agent.hostId === hostId ? null : agent.hostLabel);
}
