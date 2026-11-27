// 设置 → 归档 → 整理不常用的智能体 (owner 2026-11-26: 「归档里面能不能选择批量归档 filter 下的若干天没用的 agents」):
// what one active agent is filtered by (days since its last conversation, project, Profile, online), why it cannot be
// archived from here (busy, open delegations, a project's Director / deputy, cutex does not allow it, owns services),
// and whether it starts ticked (not when pinned or paused by the owner). Pure: the page builds facts once per render.
import type { SessionResource } from "@cutex-desktop/protocol";
import { matchesFilter } from "../../lib/listFilter";
import { NO_PROJECT } from "./archivedFilter";

export { NO_PROJECT };

/** Why an agent is left out of the batch (shown on its row; never archived from here). */
export type IdleExclusion = "busy" | "delegations" | "director" | "deputy" | "notAllowed" | "services";

export interface IdleFacts {
  id: string;
  name: string;
  session: SessionResource;
  project: { id: string; name: string } | null;
  profile: string | null;
  online: boolean;
  /** ms of the last conversation (else creation); null unknown. */
  lastActiveAt: number | null;
  pinned: boolean;
  /** Paused by the owner (暂停智能体). */
  paused: boolean;
  exclusion: IdleExclusion | null;
  /** Local copy size; undefined = not read (yet), null = none / not measurable. */
  bytes?: number | null;
}

export const IDLE_DAY_PRESETS = [3, 7, 14, 30] as const;
export type IdleOnline = "all" | "online" | "offline";

export interface IdleFilter {
  text: string;
  /** Not used for at least this many days (0 = any). */
  days: number;
  /** "" = every project, NO_PROJECT = without a project, else a project id. */
  project: string;
  /** "" = every Profile. */
  profile: string;
  online: IdleOnline;
}
export const DEFAULT_IDLE_FILTER: IdleFilter = { text: "", days: 14, project: "", profile: "", online: "all" };
export const IDLE_DAYS_MAX = 3650;

const DAY = 86_400_000;

/** The input the exclusion needs (the page reads it from the sidebar, delegation and service stores). */
export interface ExclusionInput {
  session: SessionResource;
  busy: boolean;
  openDelegations: number;
  isDirector: boolean;
  isDeputy: boolean;
  ownedServices: number;
}

/**
 * The first reason that keeps an agent out, in the order the owner would check: working now, delegations not finished,
 * a project's Director / 副主管, cutex's own lifecycle answer (`allowedActions` without `archive`; absent on older cutex
 * = the menu's 归档 rule), services it owns (they would lose their owner).
 */
export function idleExclusion(x: ExclusionInput): IdleExclusion | null {
  if (x.busy) return "busy";
  if (x.openDelegations > 0) return "delegations";
  if (x.isDirector) return "director";
  if (x.isDeputy) return "deputy";
  const allowed = x.session.allowedActions;
  if (allowed && !allowed.includes("archive")) return "notAllowed";
  if (x.session.archiveKind && x.session.archiveKind !== "active") return "notAllowed";
  if (x.ownedServices > 0) return "services";
  return null;
}

/** Working now: a running turn, or cutex says busy. */
export function isBusy(session: SessionResource): boolean {
  return !!session.runtime?.activeTurnId || session.activityStatus === "busy";
}

/** Whole days since the last use (floor); null unknown. */
export function idleDaysOf(facts: Pick<IdleFacts, "lastActiveAt">, now: number): number | null {
  return facts.lastActiveAt === null ? null : Math.max(0, Math.floor((now - facts.lastActiveAt) / DAY));
}

export function matchesIdle(facts: IdleFacts, filter: IdleFilter, now: number): boolean {
  if (!matchesFilter(filter.text, facts.name, facts.project?.name, facts.profile ?? undefined, facts.id)) return false;
  if (filter.project && (filter.project === NO_PROJECT ? facts.project !== null : facts.project?.id !== filter.project)) return false;
  if (filter.profile && facts.profile !== filter.profile) return false;
  if (filter.online !== "all" && facts.online !== (filter.online === "online")) return false;
  if (filter.days > 0) {
    // Unknown activity never counts as unused.
    if (facts.lastActiveAt === null || now - facts.lastActiveAt < filter.days * DAY) return false;
  }
  return true;
}

/** What can be archived first (longest unused first, then by name); those that cannot, with their reason, last. */
export function sortIdle(list: IdleFacts[], locale: string): IdleFacts[] {
  return [...list].sort((a, b) => Number(!!a.exclusion) - Number(!!b.exclusion)
    || (a.lastActiveAt ?? Infinity) - (b.lastActiveAt ?? Infinity) || a.name.localeCompare(b.name, locale));
}

/** 全选当前筛选的: what can be archived and is not pinned / paused (those stay unticked but can be ticked by hand). */
export function defaultPicks(shown: readonly IdleFacts[]): string[] {
  return shown.filter((x) => !x.exclusion && !x.pinned && !x.paused).map((x) => x.id);
}

/** Selectable at all (an excluded agent never is). */
export const selectable = (x: IdleFacts): boolean => !x.exclusion;

/** A typed day count: whole days, 1…IDLE_DAYS_MAX; null when not one. */
export function parseDays(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= IDLE_DAYS_MAX ? n : null;
}
