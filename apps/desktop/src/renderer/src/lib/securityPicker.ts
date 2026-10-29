import type { ExternalAgentGrant, SidebarSnapshot } from "../../../shared/ipc";
import { domainOptions, externalCandidates } from "./agentSecurity";
import { parseHostKey } from "./hostKeys";

type Snapshot = Pick<SidebarSnapshot, "active" | "projects" | "hostRows"> | null | undefined;
export interface SecurityPickerOption { value: string; label: string; group: string; searchText?: string }

/** Match the sidebar's per-host dragged project order; unlisted projects keep snapshot order. */
export function securityProjectIds(sidebar: Snapshot, order: readonly string[], hostId: string): string[] {
  const ids = (sidebar?.projects?.projects ?? []).map(project => project.project_id);
  const own = order.flatMap(key => {
    const parsed = parseHostKey(key);
    return parsed ? parsed[0] === hostId ? [parsed[1]] : [] : [key];
  });
  return [...new Set([...own.filter(id => ids.includes(id)), ...ids])];
}

export function grantPickerOptions(sidebar: Snapshot, projectId: string, grants: readonly ExternalAgentGrant[], projects: readonly string[], independent: string): SecurityPickerOption[] {
  const rank = new Map(projects.map((id, i) => [id, i]));
  return externalCandidates(sidebar, projectId, grants)
    .sort((a, b) => Number(a.projectId === null) - Number(b.projectId === null)
      || (rank.get(a.projectId!) ?? projects.length) - (rank.get(b.projectId!) ?? projects.length)
      || (a.projectId ?? "").localeCompare(b.projectId ?? "") || a.name.localeCompare(b.name))
    .map(agent => ({ value: agent.id, label: agent.name, group: agent.projectName ?? independent, searchText: `${agent.name} ${agent.projectName ?? independent}` }));
}

export function linkPickerOptions(sidebar: Snapshot, projects: readonly string[], projectLabel: string, independent: string): SecurityPickerOption[] {
  const rank = new Map(projects.map((id, i) => [id, i]));
  return domainOptions(sidebar).sort((a, b) => Number(a.kind === "agent") - Number(b.kind === "agent")
    || (a.kind === "project" && b.kind === "project" ? (rank.get(a.id) ?? projects.length) - (rank.get(b.id) ?? projects.length) : a.label.localeCompare(b.label)))
    .map(domain => ({ value: domain.key, label: domain.label, group: domain.kind === "project" ? projectLabel : independent }));
}
