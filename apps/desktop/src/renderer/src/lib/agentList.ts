// 全部 agent list (dialog + project page): a group's online / offline / archived agents with search,
// sort, runtime filter, multi-select and bulk stop / start / archive / restore. Pure helpers (no React,
// no store).
import type { SessionResource } from "@cutex-desktop/protocol";
import { CLAUDE_PROTOCOL } from "./agentFeatures";
import { compareRecent } from "./offlineAgents";
import { agentMatches } from "./agentAlias";
import type { AgentRow, SidebarGroup } from "./sidebar";

export type AgentListTab = "online" | "offline" | "archived";
/** One bulk action of the list (cutex mutations: runtime offline / online, session retire / restore). */
export type AgentListAction = "stop" | "start" | "archive" | "restore" | "restoreStart";
export type AgentSort = "recent" | "name" | "created";
export type RuntimeFilter = "all" | "codex" | "claude";

/**
 * Tab a list opens on: the project page shows the project's online agents first; the sidebar dialog
 * opens on 离线 (it is reached from the 离线 divider, and the online ones are already in the sidebar).
 */
export function defaultAgentListTab(variant: "dialog" | "page"): AgentListTab {
  return variant === "page" ? "online" : "offline";
}

/** Footer buttons of a tab: [secondary, primary]. */
export function tabActions(tab: AgentListTab): readonly [AgentListAction, AgentListAction] {
  if (tab === "online") return ["archive", "stop"];
  if (tab === "offline") return ["archive", "start"];
  return ["restore", "restoreStart"];
}

/** The rows a tab lists before search / filter (`group`: the sidebar group; `archived`: archivedOf rows). */
export function tabRows(group: Pick<SidebarGroup, "online" | "offline"> | undefined, archived: readonly AgentRow[], tab: AgentListTab): readonly AgentRow[] {
  if (tab === "archived") return archived;
  return (tab === "online" ? group?.online : group?.offline) ?? [];
}

export const INDEPENDENT_GROUP: SidebarGroup["id"] = "__independent__";
/** Bulk starts beyond this many ask first; at most START_CONCURRENCY run at once. */
export const START_CONFIRM_OVER = 10;
export const START_CONCURRENCY = 3;

/** Claude (cutex claude_subscription runtime) or Codex; archived agents keep their backend too. */
export function runtimeOf(s: SessionResource): "codex" | "claude" {
  if (s.runtime?.backend === "claude_subscription" || s.effectiveNextLaunch?.source === "claude_subscription") return "claude";
  return s.native?.schema?.protocol === CLAUDE_PROTOCOL ? "claude" : "codex";
}

/** Profile the agent launches with (null for Claude subscription agents). */
export function profileOf(s: SessionResource): string | null {
  return s.launchedProfile ?? s.configuredProfile ?? s.profile ?? s.effectiveNextLaunch?.profile ?? null;
}

/**
 * Model as far as cutex says without a runtime: Claude's launch model, the session's model default,
 * the last thread settings, else the profile's model (`profileModels`: profile id / name → model).
 */
export function modelOf(s: SessionResource, profileModels?: ReadonlyMap<string, string | null>): string | null {
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const profile = profileOf(s);
  return (
    pick(s.effectiveNextLaunch?.model) ??
    pick(s.runtimeDefaults?.model) ??
    pick((s.runtime?.threadSettings as { model?: unknown } | null | undefined)?.model) ??
    (profile ? pick(profileModels?.get(profile)) : null)
  );
}

function created(s: SessionResource): number {
  const t = s.createdAt ? Date.parse(s.createdAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export interface ListQuery {
  query: string;
  sort: AgentSort;
  runtime: RuntimeFilter;
}

/** Search (name, note, id) + runtime filter, then sort. */
export function filterSortAgents(rows: readonly AgentRow[], q: ListQuery, lastOf: (row: AgentRow) => number): AgentRow[] {
  const needle = q.query.trim().toLowerCase();
  const out = rows.filter(
    (r) =>
      (q.runtime === "all" || runtimeOf(r.session) === q.runtime) &&
      agentMatches(r.session, r.name, needle),
  );
  const byName = (a: AgentRow, b: AgentRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  if (q.sort === "name") return out.sort(byName);
  if (q.sort === "created") return out.sort((a, b) => created(b.session) - created(a.session) || byName(a, b));
  return out.sort(compareRecent(lastOf));
}

/**
 * Archived agents of one group. cutex does not list archived agents in the host rows, so their
 * project comes from the session resource's `projectId` — absent on cutex versions that do not
 * send it; then `scoped` is false and every archived agent is listed.
 */
export function archivedOf(archived: readonly AgentRow[], groupId: string): { rows: AgentRow[]; scoped: boolean } {
  const scoped = archived.length === 0 || archived.some((r) => "projectId" in r.session);
  if (!scoped) return { rows: [...archived], scoped };
  const projectOf = (r: AgentRow) => ((r.session as { projectId?: string | null }).projectId ?? null) || INDEPENDENT_GROUP;
  return { rows: archived.filter((r) => projectOf(r) === groupId), scoped };
}

/** Ids from `anchor` to `target` (inclusive) in display order; just `target` without a usable anchor. */
export function rangeIds(order: readonly string[], anchor: string | null, target: string): string[] {
  const to = order.indexOf(target);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (to < 0) return [];
  if (from < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Shift-click: set every row between the anchor and `target` to `on`. */
export function selectRange(selected: ReadonlySet<string>, order: readonly string[], anchor: string | null, target: string, on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of rangeIds(order, anchor, target)) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Header checkbox: none / some / all of the selectable visible rows. */
export function selectionState(visible: readonly string[], selected: ReadonlySet<string>): "none" | "some" | "all" {
  const n = visible.filter((id) => selected.has(id)).length;
  return n === 0 ? "none" : n === visible.length ? "all" : "some";
}

/** Run `worker` over `items`, at most `limit` at a time, in order; resolves when all settled. */
export async function runLimited<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i]!, i);
      } catch {
        // the worker reports its own failure
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}
