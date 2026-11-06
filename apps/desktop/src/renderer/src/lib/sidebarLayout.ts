// Sidebar roster layout (pure; design 060 §5): each project lists, without segment labels, its Director,
// pins, agents that want the owner, running ones, then at most RECENT_CAP recently worked ones (within
// lib/rosterTiers RECENT_MS, online or offline); everyone else folds into 「在线空闲 +N」 or 「离线 +N」. The
// rule is lib/rosterTiers placeRoster, shared with the project view. Projects without online agents
// collapse to one row (a click expands it), projects quiet for `olderAfter` days go into the automatic
// 「更早的项目」 folder, 星标展开 puts every unstarred project under 其他项目. Settings → 外观 → 侧栏 picks
// the modes (lib/prefs).
import type { AgentSignal } from "./agentAttention";
import { agentSignal, wantsOwner } from "./agentAttention";
import { showsBackgroundWork } from "./agentBackgroundWork";
import { agentStatus, groupKey, rowKey, shownName, type AgentRow, type SidebarGroup } from "./sidebar";
import { compareRoster } from "./rosterOrder";
import type { NoOnlineProjects, ProjectGrouping, RunningAgents } from "./prefs";
import { olderAfterMs, placeRoster, RECENT_MS, rosterTier, type OlderProjectsAfter, type RosterTier } from "./rosterTiers";

export { RECENT_CAP } from "./rosterTiers";

export interface LayoutPrefs {
  grouping: ProjectGrouping;
  noOnline: NoOnlineProjects;
  running: RunningAgents;
  /** 「更早的项目」 threshold (lib/rosterTiers); absent = "off". */
  olderAfter?: OlderProjectsAfter;
}

export interface GroupLayout {
  group: SidebarGroup;
  starred: boolean;
  /** full: rows listed; collapsed: one project row (a click expands it). */
  mode: "full" | "collapsed";
  /** Listed first, drawn big (IM row with the preview line; `bigRow`): Director, pins, needs-you / error, running (运行中智能体 = 完整显示); Director and pins first, then `rosterOrder`. */
  big: AgentRow[];
  /** Running agents that need nothing, as compact rows or the 运行中 avatar row (`prefs.running` compact / avatars). `rosterOrder`. */
  running: AgentRow[];
  /**
   * Recently worked, listed after them as compact rows: the RECENT_CAP most recently active (so the cap never
   * hides what was just used) plus fresh agents, in `rosterOrder`. While searching: every other match.
   */
  recent: AgentRow[];
  /** 「在线空闲 +N」: online agents not listed (past the cap too), by name. Empty while searching. */
  idle: AgentRow[];
  /** 「离线 +N」: offline agents not listed, by name. Empty while searching. */
  offline: AgentRow[];
  runningCount: number;
  needsYouCount: number;
  /** Agents that want the owner (needs-you / error / done). */
  attentionCount: number;
  /** Online agents (the header's 「N 在线」). */
  onlineCount: number;
  /** Contains the open agent. */
  hasSelected: boolean;
  /** Newest last activity of its agents (ms). */
  lastActivity: number;
}

export interface SidebarLayout {
  /** Shown in place: starred first, then the rest (全部分组) or only starred (星标展开). */
  main: GroupLayout[];
  /** 星标展开: every other project, one row each under 其他项目. Empty in 全部分组. */
  others: GroupLayout[];
  /** 全部分组: projects quiet for `olderAfter`, one row each in the automatic 「更早的项目」 folder (never starred, open or wanting the owner). */
  older: GroupLayout[];
}

/** Rows / groups are matched by their keys (rowKey / groupKey: host keys when they carry a host). */
export interface LayoutContext {
  signalOf(key: string): AgentSignal | undefined;
  /** The open agent's row key. */
  selectedId: string | null;
  /** Starred group keys. */
  starred: ReadonlySet<string>;
  prefs: LayoutPrefs;
  /** While searching every match is listed and nothing collapses. */
  searching?: boolean;
  /** A row's last conversation activity (ms; default `row.lastActivity`). */
  lastOf?(row: AgentRow): number;
  /**
   * The clock (ms) tiers and the 「更早的项目」 fold are decided at. Absent: nothing is recent by time and
   * no project is older (tests). Advance it with `nextRosterChange` so rows move by themselves.
   */
  now?: number;
  /** Freshly created agents the owner has not opened yet (lib/freshAgents): listed with the recent ones, never folded. */
  isFresh?(key: string): boolean;
}

/** One group's rows split by the rules (mode decided by the caller). */
export function layoutGroup(group: SidebarGroup, ctx: LayoutContext, starred: boolean): Omit<GroupLayout, "mode"> {
  const big: AgentRow[] = [];
  const running: AgentRow[] = [];
  let runningCount = 0;
  let needsYouCount = 0;
  let attentionCount = 0;
  let onlineCount = 0;
  let hasSelected = false;
  let lastActivity = 0;
  const offlineRows = new Set(group.offline);
  const lastOf = (r: AgentRow) => ctx.lastOf?.(r) ?? r.lastActivity;
  const tiers = new Map<AgentRow, RosterTier>();
  const signals = new Map<AgentRow, AgentSignal>();
  const rows = [...group.online, ...group.offline];
  for (const row of rows) {
    const key = rowKey(row);
    const signal = ctx.signalOf(key) ?? agentSignal(row, undefined, undefined);
    const off = offlineRows.has(row);
    // Not confirmed yet (lib/sidebar `unknown`, host loading): placed by its last snapshot, so a
    // reconnect never moves a running row out of the listed ones.
    const unconfirmed = row.status === "unknown" && !off;
    const isRunning = row.status === "running" || (unconfirmed && agentStatus(row.session, false) === "running");
    if (row.status === "running") runningCount++;
    if (!off && row.status !== "unknown") onlineCount++;
    if (signal === "needsYou") needsYouCount++;
    if (wantsOwner(signal)) attentionCount++;
    if (key === ctx.selectedId) hasSelected = true;
    const last = lastOf(row);
    lastActivity = Math.max(lastActivity, last);
    signals.set(row, signal);
    // Searching: every match is listed (big rows as usual, the others with the recent ones, uncapped).
    if (ctx.searching) {
      tiers.set(row, bigRow(row, signal) ? "now" : "recent");
      continue;
    }
    const busy = showsBackgroundWork(row.session.runtime, signal, true);
    tiers.set(row, rosterTier({ isDirector: row.isDirector, pinned: row.pinned, signal, running: isRunning, busy, lastActivity: last }, ctx.now ?? Number.POSITIVE_INFINITY));
  }
  const placed = placeRoster(rows, (r) => tiers.get(r)!, {
    online: (r) => !offlineRows.has(r) && isOnlineRow(r),
    lastOf,
    order: rosterOrder,
    keep: (r) => ctx.isFresh?.(rowKey(r)) ?? false,
    cap: ctx.searching ? Number.POSITIVE_INFINITY : undefined,
  });
  for (const row of placed.now) {
    const signal = signals.get(row)!;
    const quietRunning = !row.isDirector && !row.pinned && !(signal === "needsYou" || signal === "error") && ctx.prefs.running !== "full" && !ctx.searching;
    (quietRunning ? running : big).push(row);
  }
  big.sort((a, b) => Number(b.isDirector) - Number(a.isDirector) || Number(b.pinned) - Number(a.pinned) || rosterOrder(a, b));
  return { group, starred, big, running, recent: placed.recent, idle: placed.idle, offline: placed.offline, runningCount, needsYouCount, attentionCount, onlineCount, hasSelected, lastActivity };
}

/** A row's runtime is up (an unconfirmed row: as its snapshot says). */
export function isOnlineRow(row: Pick<AgentRow, "status" | "session">): boolean {
  if (row.status === "unknown") return row.session.runtime?.status === "online";
  return row.status !== "offline";
}

/**
 * The order inside a segment (owner 2026-11-05, lib/rosterOrder): online before offline, then the shown
 * name (Latin and Chinese together by pinyin, numbers by value, case ignored), then id. Stable: activity
 * never reorders rows, only a change of tier or of online / offline does.
 */
export const rosterOrder: (a: AgentRow, b: AgentRow) => number = compareRoster<AgentRow>(isOnlineRow, shownName);

/**
 * Which 现在 rows get the big IM row (avatar, name, preview line): the Director, pinned agents, agents
 * that need the owner or failed, and running ones (owner 2026-10-21, sidebar density).
 */
export function bigRow(row: Pick<AgentRow, "isDirector" | "pinned" | "status">, signal: AgentSignal): boolean {
  return row.isDirector || row.pinned || signal === "needsYou" || signal === "error" || signal === "running" || row.status === "running";
}

/**
 * The rows a 「在线空闲 +N」 / 「离线 +N」 fold shows: collapsed, only `keep` rows (the open agent: opening
 * never hides a row); expanded, those whose name matches `filter` (case-insensitive; empty = all).
 */
export function foldRows(rows: readonly AgentRow[], opts: { open: boolean; filter?: string; keep?(row: AgentRow): boolean; nameOf?(row: AgentRow): string }): AgentRow[] {
  if (!opts.open) return rows.filter((r) => opts.keep?.(r) ?? false);
  const q = (opts.filter ?? "").trim().toLowerCase();
  if (!q) return [...rows];
  const name = opts.nameOf ?? ((r: AgentRow) => r.name);
  return rows.filter((r) => name(r).toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
}

/**
 * When the layout changes next by the clock alone after `now` (ms): a row's last activity leaving
 * RECENT_MS (listed → folded), or a project's newest activity passing `olderAfter` (→ 「更早的项目」). Null:
 * nothing will. The caller lays the sidebar out again at that time (`LayoutContext.now`).
 */
export function nextRosterChange(groups: readonly SidebarGroup[], now: number, lastOf: (row: AgentRow) => number = (r) => r.lastActivity, olderAfter: OlderProjectsAfter = "off"): number | null {
  const older = olderAfterMs(olderAfter);
  let next: number | null = null;
  const take = (at: number) => {
    if (at > now && (next === null || at < next)) next = at;
  };
  for (const g of groups) {
    let newest = 0;
    for (const row of [...g.online, ...g.offline]) {
      const last = lastOf(row);
      newest = Math.max(newest, last);
      take(last + RECENT_MS);
    }
    if (older !== null && newest > 0) take(newest + older);
  }
  return next;
}

/** A project that goes into the automatic 「更早的项目」 folder: quiet for the threshold, not starred, not open, nothing for the owner, nothing running. */
function isOlder(l: Omit<GroupLayout, "mode">, ctx: LayoutContext): boolean {
  const after = olderAfterMs(ctx.prefs.olderAfter ?? "off");
  if (after === null || ctx.now === undefined || ctx.searching) return false;
  if (l.group.kind !== "project" || l.starred || l.hasSelected || l.attentionCount > 0 || l.runningCount > 0) return false;
  // No known activity time (0) is not "old".
  return l.lastActivity > 0 && ctx.now - l.lastActivity >= after;
}

/**
 * The sidebar's groups (already in display order) laid out. Starred groups move to the top (in
 * their order) and never collapse. 全部分组: a project quiet for `olderAfter` goes into 「更早的项目」;
 * a group without online agents collapses to one row (unless 无在线项目 = 始终展开, or it holds the
 * open agent / an agent that wants the owner). 星标展开: starred groups in full, every other group one
 * row under 其他项目.
 */
export function layoutSidebar(groups: readonly SidebarGroup[], ctx: LayoutContext): SidebarLayout {
  const starredFirst = [...groups.filter((g) => ctx.starred.has(groupKey(g))), ...groups.filter((g) => !ctx.starred.has(groupKey(g)))];
  const main: GroupLayout[] = [];
  const others: GroupLayout[] = [];
  const older: GroupLayout[] = [];
  for (const g of starredFirst) {
    const starred = ctx.starred.has(groupKey(g));
    const base = layoutGroup(g, ctx, starred);
    if (starred || ctx.searching) {
      main.push({ ...base, mode: "full" });
    } else if (ctx.prefs.grouping === "starred") {
      others.push({ ...base, mode: "collapsed" });
    } else if (isOlder(base, ctx)) {
      older.push({ ...base, mode: "collapsed" });
    } else {
      const quiet = g.online.length === 0 && !base.hasSelected && base.attentionCount === 0;
      main.push({ ...base, mode: quiet && ctx.prefs.noOnline === "collapse" ? "collapsed" : "full" });
    }
  }
  return { main, others, older };
}

/**
 * Pinned rows (menu 置顶) of a group shown while the group itself is collapsed (a one-row project, a
 * project folded by its header, the folded 快速会话 list): a pin is never folded away.
 */
export function pinnedRows(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter((r) => r.pinned);
}

/** Whether the latest-message line shows under this row's name (Settings 「agent 名下显示最新消息」). */
export function showsPreview(row: Pick<AgentRow, "isDirector">, mode: "off" | "director" | "all"): boolean {
  return mode === "all" || (mode === "director" && row.isDirector);
}
