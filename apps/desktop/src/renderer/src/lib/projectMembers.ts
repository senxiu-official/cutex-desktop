// Project membership (DESIGN §4.18): the project page's agent tab is the one place members and the
// Director are managed. Pure helpers for its pickers (添加成员 / 指定 or 更换 Director): who can be
// picked, search / filter / sort. No React, no store.
//
// cutex rules mirrored here (agent_management/projects.rs, projects/director.rs):
// - add_member: an active managed agent in NO project (an agent of another project is refused with
//   `agent_already_has_active_project`; cutex does not move it, so the picker shows it but disabled).
// - assign_director (no Director yet) / rotate_director (owner-rotation: replace the Director in one
//   commit, the old one stays a member): the picker offers this project's members.
import type { AgentRow, SidebarGroup } from "./sidebar";
import { runtimeOf, type RuntimeFilter } from "./agentList";
import { agentMatches } from "./agentAlias";

export type MemberStatusFilter = "all" | "online" | "offline";
/** 独立 = in no project (can join); elsewhere = in another project (cutex refuses until it leaves there). */
export type MembershipFilter = "all" | "independent" | "elsewhere";
export type MemberPickerSort = "recent" | "name";

export interface MemberCandidate {
  row: AgentRow;
  /** The agent's current project (null: independent). */
  projectId: string | null;
  projectName: string | null;
  online: boolean;
  /** Can be picked (add: independent; Director: a member that is not the Director already). */
  pickable: boolean;
}

export interface MemberPickerQuery {
  query: string;
  runtime: RuntimeFilter;
  status: MemberStatusFilter;
  membership: MembershipFilter;
  sort: MemberPickerSort;
}

export const DEFAULT_PICKER_QUERY: MemberPickerQuery = { query: "", runtime: "all", status: "all", membership: "all", sort: "recent" };

const isOnline = (row: AgentRow) => row.status !== "offline" && row.status !== "unknown";

/**
 * Agents that could join `projectId`: every agent of the host's sidebar groups outside this project.
 * `managed`: cutex's `available_agents` ids (null = the host does not list them: everyone is offered).
 */
export function addCandidates(groups: readonly SidebarGroup[], projectId: string, managed: ReadonlySet<string> | null = null): MemberCandidate[] {
  const out: MemberCandidate[] = [];
  for (const g of groups) {
    if (g.kind === "project" && g.id === projectId) continue;
    const project = g.kind === "project" ? g : null;
    for (const row of [...g.online, ...g.offline]) {
      if (managed && !managed.has(row.id)) continue;
      out.push({ row, projectId: project?.id ?? null, projectName: project?.name ?? null, online: isOnline(row), pickable: !project });
    }
  }
  return out;
}

/** This project's members as Director choices; the current Director is listed but not pickable. */
export function directorChoices(groups: readonly SidebarGroup[], projectId: string, directorId: string | null): MemberCandidate[] {
  const g = groups.find((x) => x.kind === "project" && x.id === projectId);
  if (!g || g.kind !== "project") return [];
  return [...g.online, ...g.offline].map((row) => ({ row, projectId, projectName: g.name, online: isOnline(row), pickable: row.id !== directorId }));
}

/** Search (name, note, id) + runtime / status / membership filters, then sort; pickable agents come first (the rest is context). */
export function filterCandidates(list: readonly MemberCandidate[], q: MemberPickerQuery, lastOf: (row: AgentRow) => number): MemberCandidate[] {
  const needle = q.query.trim().toLowerCase();
  const out = list.filter((c) => {
    if (q.runtime !== "all" && runtimeOf(c.row.session) !== q.runtime) return false;
    if (q.status === "online" && !c.online) return false;
    if (q.status === "offline" && c.online) return false;
    if (q.membership === "independent" && c.projectId !== null) return false;
    if (q.membership === "elsewhere" && c.projectId === null) return false;
    if (!needle) return true;
    return agentMatches(c.row.session, c.row.name, needle);
  });
  const byName = (a: MemberCandidate, b: MemberCandidate) => a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id);
  const pickFirst = (a: MemberCandidate, b: MemberCandidate) => Number(b.pickable) - Number(a.pickable);
  if (q.sort === "name") return out.sort((a, b) => pickFirst(a, b) || byName(a, b));
  return out.sort((a, b) => pickFirst(a, b) || lastOf(b.row) - lastOf(a.row) || byName(a, b));
}

/** Ids of `selected` that `run` may detach: never the Director (cutex: primary_director_requires_rotation). */
export function detachable(selected: readonly string[], directorId: string | null): string[] {
  return selected.filter((id) => id !== directorId);
}
