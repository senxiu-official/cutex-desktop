// Browser card agent picker model: the host's grantable agents (main's `/v2/browser/agents` list),
// filtered by name / project, the current conversation's agent and recently granted agents first,
// the rest grouped by project (独立 last). Pure except the per-viewer recent-grant memory, which is
// a localStorage convenience only (main re-checks every grant).
import type { BrowserAgentView } from "../../../../shared/browser";
import { byNameThenId } from "../../lib/rosterOrder";

export interface PickerAgent extends BrowserAgentView {
  projectId: string | null;
  projectName: string | null;
  /** A quick chat outside any project (lib/sidebar isQuickChat): listed only while searching, unless current / recent. */
  quickChat?: boolean;
}
/** kind "top" = current conversation + recent grants; "project"; "independent" (no project); "chats" (quick chats, while searching). */
export interface PickerGroup {
  key: string;
  kind: "top" | "project" | "independent" | "chats";
  label: string | null;
  agents: PickerAgent[];
}

const RECENT_KEY = "cutex.browser.recentGrants";
const RECENT_MAX = 5;

export function agentMatches(agent: PickerAgent, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${agent.name}\n${agent.projectName ?? ""}`.toLowerCase();
  return words.every(word => text.includes(word));
}

export function pickerGroups(agents: readonly PickerAgent[], options: { query?: string; current?: string | null; recent?: readonly string[] } = {}): PickerGroup[] {
  const shown = agents.filter(agent => agentMatches(agent, options.query ?? ""));
  const byId = new Map(shown.map(agent => [agent.sessionId, agent]));
  const topIds = [...new Set([options.current, ...(options.recent ?? [])].filter((id): id is string => !!id && byId.has(id)))];
  const groups: PickerGroup[] = topIds.length ? [{ key: "top", kind: "top", label: null, agents: topIds.map(id => byId.get(id)!) }] : [];
  const top = new Set(topIds);
  const projects = new Map<string, PickerGroup>();
  const independent: PickerAgent[] = [];
  const chats: PickerAgent[] = [];
  const searching = !!(options.query ?? "").trim();
  const byName = byNameThenId<PickerAgent>((a) => a.name, (a) => a.sessionId);
  for (const agent of shown) {
    if (top.has(agent.sessionId)) continue;
    if (!agent.projectId && agent.quickChat) { if (searching) chats.push(agent); continue; }
    if (!agent.projectId) { independent.push(agent); continue; }
    let group = projects.get(agent.projectId);
    if (!group) projects.set(agent.projectId, group = { key: `project:${agent.projectId}`, kind: "project", label: agent.projectName || agent.projectId, agents: [] });
    group.agents.push(agent);
  }
  for (const group of [...projects.values()].sort(byNameThenId((g) => g.label!, (g) => g.key))) groups.push({ ...group, agents: group.agents.sort(byName) });
  if (independent.length) groups.push({ key: "independent", kind: "independent", label: null, agents: independent.sort(byName) });
  if (chats.length) groups.push({ key: "chats", kind: "chats", label: null, agents: chats.sort(byName) });
  return groups;
}

export function recentGrants(hostId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as unknown;
    const list = value && typeof value === "object" ? (value as Record<string, unknown>)[hostId] : null;
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function rememberGrant(hostId: string, sessionId: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as unknown;
    const all = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    all[hostId] = [sessionId, ...recentGrants(hostId).filter(id => id !== sessionId)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch { /* per-viewer convenience only */ }
}
