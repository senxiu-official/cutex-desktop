// 项目 page, 「全部项目」 (owner 2026-11-25, option B): one row per project of every host in the view scope, with what
// the app already knows about it. Pure: the page passes each host's sidebar groups and attention signals in.
//
// - 在线 / 成员, 需要你 and 最近活动 come from the host's own figures when it has them (cutex `project-table-summary-v1`:
//   `online_member_count`, `last_activity_at`); else from that host's agents as the sidebar has them (online rows, rows
//   whose signal is 需要你, the latest conversation activity); null (shown 「—」) while the app has no rows of that host.
// - No business state is made up here: archive / restore / pause stay cutex calls (AllProjects).
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { AgentRow } from "../../lib/sidebar";

/** cutex: the project list carries `last_activity_at` / `online_member_count` (r295, r290-p10). */
export const PROJECT_TABLE_SUMMARY_FEATURE = "project-table-summary-v1";
/** cutex: whole-project pause / resume (`GET/POST /v2/projects/{id}/run-control`). */
export const PROJECT_RUN_CONTROL_FEATURE = "project-run-control-v1";

export interface ProjectFacts {
  /** hostKey(hostId, id). */
  key: string;
  hostId: string;
  id: string;
  name: string;
  directorId: string | null;
  directorName: string | null;
  root: string | null;
  /**
   * Members, from the same source as `online` so the two compare: cutex's figures (its active member count, never fewer
   * than its online count), else the rows the app shows; cutex's active member count when online is unknown.
   */
  members: number;
  /** Online members; null: unknown (the host is not reachable, or the app has none of its rows). */
  online: number | null;
  /** Agents of the project waiting for the owner; null: unknown. */
  needsYou: number | null;
  /** Epoch ms of the latest activity; null: unknown or none. */
  lastActivity: number | null;
  archived: boolean;
  project: ProjectSummary;
}

/** What one host contributes: its project rows' agents (by project id) and their attention signals. */
export interface HostRows {
  /** The app has this host's agents (a snapshot, current or last): figures can be counted. */
  known: boolean;
  /** Agents per project id (online and offline rows of its sidebar group). */
  byProject: ReadonlyMap<string, { online: readonly AgentRow[]; offline: readonly AgentRow[] }>;
  /** 需要你 per row key (lib/attentionView signals). */
  needsYou(row: AgentRow): boolean;
  /** The host's own figures (PROJECT_TABLE_SUMMARY_FEATURE). */
  summaryFields: boolean;
  /** The host is connected now: its own figures are current (an unreachable host's last figures are history). */
  reachable: boolean;
}

const ms = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function projectFacts(hostId: string, key: string, project: ProjectSummary, archived: boolean, rows: HostRows): ProjectFacts {
  const raw = project as unknown as Record<string, unknown>;
  const group = rows.byProject.get(project.project_id);
  const all = group ? [...group.online, ...group.offline] : [];
  const director = project.director_cutex_session_id ?? null;
  const directorRow = director ? all.find((r) => r.id === director) : undefined;
  const own = rows.summaryFields && rows.reachable;
  const cutexOnline = own ? count(raw.online_member_count) : null;
  // Numerator and denominator from one source.
  let online: number | null = null;
  let members = project.active_member_count;
  if (archived) online = null;
  else if (cutexOnline !== null) [online, members] = [cutexOnline, Math.max(project.active_member_count, cutexOnline)];
  else if (rows.known && group) [online, members] = [group.online.filter((r) => r.status !== "offline" && r.status !== "unknown").length, all.length];
  else if (rows.known) online = 0; // no rows of it: nobody of it is online
  const last = own && "last_activity_at" in raw ? ms(raw.last_activity_at) : rows.known ? (all.length ? Math.max(...all.map((r) => r.lastActivity)) || null : null) : null;
  return {
    key,
    hostId,
    id: project.project_id,
    name: project.presentation.display_name,
    directorId: director,
    directorName: project.director_name || directorRow?.name || null,
    root: project.workspace_root ?? null,
    members,
    online,
    needsYou: rows.known && !archived ? all.filter((r) => rows.needsYou(r)).length : null,
    lastActivity: last,
    archived,
    project,
  };
}

export type ProjectStatus = "" | "needsYou" | "online" | "noDirector" | "archived";
export type ProjectSort = "activity" | "name" | "online" | "needsYou";
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["", "needsYou", "online", "noDirector", "archived"];
export const PROJECT_SORTS: readonly ProjectSort[] = ["activity", "name", "online", "needsYou"];

export interface ProjectFilter {
  /** Matches the name, the Director's name, the directory (case-insensitive). */
  text: string;
  /** A host id; "" = every host. */
  host: string;
  status: ProjectStatus;
}
export const EMPTY_PROJECT_FILTER: ProjectFilter = { text: "", host: "", status: "" };

export function isFiltered(filter: ProjectFilter): boolean {
  return filter.text.trim() !== "" || filter.host !== "" || filter.status !== "";
}

/** Archived projects show only under 「已归档」; the other statuses list active ones. */
export function matchesProject(p: ProjectFacts, filter: ProjectFilter): boolean {
  if (filter.status === "archived" ? !p.archived : p.archived) return false;
  if (filter.host && p.hostId !== filter.host) return false;
  if (filter.status === "needsYou" && !(p.needsYou && p.needsYou > 0)) return false;
  if (filter.status === "online" && !(p.online && p.online > 0)) return false;
  if (filter.status === "noDirector" && p.directorId) return false;
  const q = filter.text.trim().toLowerCase();
  if (!q) return true;
  return [p.name, p.directorName ?? "", p.root ?? "", p.id].some((s) => s.toLowerCase().includes(q));
}

/** Sorted copy. Unknown figures (null) go last; ties by name. */
export function sortProjects(list: readonly ProjectFacts[], sort: ProjectSort, locale: string): ProjectFacts[] {
  const byName = (a: ProjectFacts, b: ProjectFacts) => a.name.localeCompare(b.name, locale) || a.key.localeCompare(b.key);
  const desc = (f: (p: ProjectFacts) => number | null) => (a: ProjectFacts, b: ProjectFacts) => {
    const x = f(a), y = f(b);
    if (x === y) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byName(a, b);
  };
  const cmp = sort === "name" ? byName : sort === "online" ? desc((p) => p.online) : sort === "needsYou" ? desc((p) => p.needsYou) : desc((p) => p.lastActivity);
  return [...list].sort(cmp);
}

/** Keys from `anchor` to `id` in the shown order (Shift-click), both included. */
export function rangeKeys(shown: readonly string[], anchor: string | null, id: string): string[] {
  const a = anchor ? shown.indexOf(anchor) : -1;
  const b = shown.indexOf(id);
  if (a < 0 || b < 0) return [id];
  return shown.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export interface ProjectTotals {
  projects: number;
  hosts: number;
  /** Online members over the projects whose online figure is known (null: none is), and their members. */
  online: number | null;
  onlineMembers: number;
  /** Projects whose online figure is unknown (not in `online` / `onlineMembers`): the line says it is partial. */
  onlineUnknown: number;
  /** 需要你 over the projects where it is known; `needsPartial`: some are not (so it is a lower bound). */
  needsYou: number | null;
  needsPartial: boolean;
}

/** Totals for the figures line of what is shown; unknown figures are left out and counted, never added as 0. */
export function projectTotals(list: readonly ProjectFacts[]): ProjectTotals {
  const withOnline = list.filter((p) => p.online !== null);
  const withNeeds = list.filter((p) => p.needsYou !== null);
  return {
    projects: list.length,
    hosts: new Set(list.map((p) => p.hostId)).size,
    online: withOnline.length ? withOnline.reduce((n, p) => n + p.online!, 0) : null,
    onlineMembers: withOnline.reduce((n, p) => n + p.members, 0),
    onlineUnknown: list.length - withOnline.length,
    needsYou: withNeeds.length ? withNeeds.reduce((n, p) => n + p.needsYou!, 0) : null,
    needsPartial: withNeeds.length > 0 && withNeeds.length < list.length,
  };
}

// ---------- detail tabs ----------

/** The tabs always shown on a project (in this order); every other tab (modules) is under 「更多」. */
export const MAIN_PROJECT_TABS: readonly string[] = ["overview", "agents", "tasks", "artifacts", "services", "memory", "settings"];

/** Splits the offered tabs into the row and 「更多」 (order kept). */
export function splitProjectTabs<T extends { tab: string }>(tabs: readonly T[]): { main: T[]; more: T[] } {
  const main = tabs.filter((x) => MAIN_PROJECT_TABS.includes(x.tab));
  const more = tabs.filter((x) => !MAIN_PROJECT_TABS.includes(x.tab));
  return { main, more };
}
