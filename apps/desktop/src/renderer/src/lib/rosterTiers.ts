// The roster's one rule (design 060 §5), shared by the sidebar (lib/sidebarLayout) and the project view
// (modules/project-view/model). Pure. A project lists, without segment labels, its Director, pins, agents
// that want the owner, running ones, then at most RECENT_CAP recently worked ones (placeRoster); everyone
// else goes into 「在线空闲 +N」 or 「离线 +N」 by whether its runtime is up (owner 2026-11-05).
import type { AgentSignal } from "./agentAttention";

/** now: listed first (Director, pins, wants the owner, running). recent: worked lately, or something open (capped, placeRoster). rest: folded. */
export type RosterTier = "now" | "recent" | "rest";

const DAY = 24 * 60 * 60_000;

/** The sidebar's 最近 window (owner 2026-11-05: 7 days). */
export const RECENT_MS = 7 * DAY;

export interface TierInput {
  isDirector?: boolean;
  /** Menu 置顶 (sidebar only). */
  pinned?: boolean;
  signal: AgentSignal;
  /** A turn runs (also a row the reconnect has not confirmed yet but last seen running). */
  running?: boolean;
  /** Something open besides its own turn: delegations, jobs, terminals, sub-agents, a background command. */
  busy?: boolean;
  /** Last conversation activity (ms). */
  lastActivity: number;
}

/**
 * Pinned / Director, wants the owner (needs-you, error), running → now; a finished turn not seen yet or
 * something open → recent; last activity within `window` (default RECENT_MS) → recent; else rest.
 */
export function rosterTier(a: TierInput, now: number, window = RECENT_MS): RosterTier {
  if (a.pinned || a.isDirector) return "now";
  if (a.signal === "needsYou" || a.signal === "error") return "now";
  if (a.running || a.signal === "running") return "now";
  if (a.signal === "done" || a.busy) return "recent";
  return now - a.lastActivity < window ? "recent" : "rest";
}

/**
 * When some agent's tier changes next by the clock alone (its last activity leaving `window`), or null.
 * The caller lays the roster out again at that time.
 */
export function nextTierChange(lastActivities: Iterable<number>, now: number, window = RECENT_MS): number | null {
  let next: number | null = null;
  for (const last of lastActivities) {
    const at = last + window;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/** A project with no activity for this long folds into 「更早的项目」 (Settings → 侧栏; "off" = never). */
export type OlderProjectsAfter = 3 | 7 | 14 | "off";
export const OLDER_PROJECTS_AFTER: readonly OlderProjectsAfter[] = [3, 7, 14, "off"];
export const DEFAULT_OLDER_PROJECTS_AFTER: OlderProjectsAfter = 7;

export function migrateOlderProjectsAfter(value: unknown): OlderProjectsAfter {
  return (OLDER_PROJECTS_AFTER as readonly unknown[]).includes(value) ? (value as OlderProjectsAfter) : DEFAULT_OLDER_PROJECTS_AFTER;
}

/** The fold threshold in ms (null: never fold). */
export function olderAfterMs(after: OlderProjectsAfter): number | null {
  return after === "off" ? null : after * DAY;
}

/** Recently worked agents a project lists (owner 2026-11-05: at most 5, the newest); the others fold. */
export const RECENT_CAP = 5;

/** Where an agent goes: listed (now, recent) or folded by its runtime (idle: online, offline). */
export type RosterPlace = "now" | "recent" | "idle" | "offline";

export interface Placed<M> {
  now: M[];
  recent: M[];
  /** 「在线空闲 +N」: online agents not listed. */
  idle: M[];
  /** 「离线 +N」: offline agents not listed. */
  offline: M[];
}

/**
 * The project's roster split by the rule: tier now → `now`; tier recent → `recent`, the RECENT_CAP newest by
 * `lastOf` (ties: `order`), plus any `keep` row (a fresh agent: never folded); every other agent, past the
 * cap too, → `idle` or `offline` by `online`. Each list is sorted by `order` (the caller re-sorts `now` when
 * it puts the Director and pins first). `cap: Infinity` lists every recent one (search).
 */
export function placeRoster<M>(
  members: readonly M[],
  tierOf: (m: M) => RosterTier,
  opts: { online(m: M): boolean; lastOf(m: M): number; order(a: M, b: M): number; keep?(m: M): boolean; cap?: number },
): Placed<M> {
  const out: Placed<M> = { now: [], recent: [], idle: [], offline: [] };
  const recent: M[] = [];
  const folded: M[] = [];
  for (const m of members) {
    const tier = tierOf(m);
    if (tier === "now") out.now.push(m);
    else if (tier === "recent" || opts.keep?.(m)) recent.push(m);
    else folded.push(m);
  }
  const cap = opts.cap ?? RECENT_CAP;
  recent.sort((a, b) => opts.lastOf(b) - opts.lastOf(a) || opts.order(a, b));
  recent.forEach((m, i) => (i < cap || opts.keep?.(m) ? out.recent : folded).push(m));
  for (const m of folded) (opts.online(m) ? out.idle : out.offline).push(m);
  out.now.sort(opts.order);
  out.recent.sort(opts.order);
  out.idle.sort(opts.order);
  out.offline.sort(opts.order);
  return out;
}
