// 设置 → 归档 → 已归档的智能体 (owner 2026-11-24): what one archived agent is filtered and sorted by — the facets its
// archive projection carries (name, project, model family, archive date) plus the figures lib/archivedStats caches.
// Pure: the page builds facts once per render and filters them.
import type { SessionResource } from "@cutex-desktop/protocol";
import { matchesFilter } from "../../lib/listFilter";
import type { ArchivedFigures } from "./archivedStats";

export interface ArchivedFacts {
  id: string;
  name: string;
  session: SessionResource;
  /** Its project (null: none). */
  project: { id: string; name: string } | null;
  /** Model family (lib/avatarThemes ModelFamily), "other" when unknown. */
  family: string;
  /** ms; null when cutex gave no (valid) retiredAt. */
  archivedAt: number | null;
  /** ms: the last conversation (activity), else the record's update; null unknown. */
  lastActiveAt: number | null;
  figures: ArchivedFigures | null;
}

/** 归档时间: presets rather than a free range (the owner asked for a date range; these cover it with one control). */
export type ArchivedWhen = "all" | "7d" | "30d" | "90d" | "older90d";
export type ArchivedSort = "archived" | "size" | "name" | "active";
export const NO_PROJECT = "\u0000none";

export interface ArchivedFilter {
  text: string;
  /** "" = every project, NO_PROJECT = without a project, else a project id. */
  project: string;
  /** "" = every family. */
  family: string;
  when: ArchivedWhen;
}
export const EMPTY_FILTER: ArchivedFilter = { text: "", project: "", family: "", when: "all" };

const DAY = 86_400_000;
const time = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/** The last conversation of an archived agent: activity.lastConversationAt / lastTurnCompletedAt, else updatedAt. */
export function lastActiveOf(session: SessionResource): number | null {
  const activity = (session as { activity?: Record<string, unknown> | null }).activity ?? null;
  return time(session.lastActivityAt) ?? time(activity?.lastConversationAt) ?? time(activity?.lastTurnCompletedAt) ?? time((session as { updatedAt?: unknown }).updatedAt);
}

export function archivedAtOf(session: SessionResource): number | null {
  return time(session.retiredAt);
}

export function matchesArchived(facts: ArchivedFacts, filter: ArchivedFilter, now: number): boolean {
  if (!matchesFilter(filter.text, facts.name, facts.project?.name, facts.id)) return false;
  if (filter.project && (filter.project === NO_PROJECT ? facts.project !== null : facts.project?.id !== filter.project)) return false;
  if (filter.family && facts.family !== filter.family) return false;
  if (filter.when !== "all") {
    if (facts.archivedAt === null) return false;
    const age = now - facts.archivedAt;
    if (filter.when === "older90d" ? age <= 90 * DAY : age > { "7d": 7, "30d": 30, "90d": 90 }[filter.when] * DAY) return false;
  }
  return true;
}

export function sortArchived(list: ArchivedFacts[], sort: ArchivedSort, locale: string): ArchivedFacts[] {
  const by = (f: (x: ArchivedFacts) => number | null) => (a: ArchivedFacts, b: ArchivedFacts) => (f(b) ?? -1) - (f(a) ?? -1) || a.name.localeCompare(b.name, locale);
  const cmp = sort === "name" ? (a: ArchivedFacts, b: ArchivedFacts) => a.name.localeCompare(b.name, locale)
    : sort === "size" ? by((x) => x.figures?.bytes ?? null)
    : sort === "active" ? by((x) => x.lastActiveAt)
    : by((x) => x.archivedAt);
  return [...list].sort(cmp);
}

/** Shift-click: every id from the last clicked one to this one (in the shown order) takes this one's new state. */
export function rangeIds(shown: readonly string[], anchor: string | null, target: string): string[] {
  const to = shown.indexOf(target);
  const from = anchor === null ? -1 : shown.indexOf(anchor);
  if (to < 0) return [];
  if (from < 0) return [target];
  return shown.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Totals of the shown (or selected) agents: count, measured size (and how many are measured), tokens / turns when known. */
export function totalsOf(list: readonly ArchivedFacts[]): { count: number; bytes: number; measured: number; tokens: number; turns: number; withUsage: number } {
  const out = { count: list.length, bytes: 0, measured: 0, tokens: 0, turns: 0, withUsage: 0 };
  for (const x of list) {
    const f = x.figures;
    if (f?.bytes !== null && f?.bytes !== undefined) { out.bytes += f.bytes; out.measured++; }
    if (f?.tokens !== null && f?.tokens !== undefined) { out.tokens += f.tokens; out.turns += f.turns ?? 0; out.withUsage++; }
  }
  return out;
}
