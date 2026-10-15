// Sidebar v2 layout (pure): which agents of a project show as full rows, which fold into the
// 运行中 rows / 「N 个空闲」 / 离线 N, and which projects collapse to one row (hover
// flyout) or go under 其他项目. Settings → 外观 → 侧栏 picks the modes (lib/prefs).
import type { AgentSignal } from "./agentAttention";
import { agentSignal, wantsOwner } from "./agentAttention";
import { compareRows, groupKey, rowKey, type AgentRow, type SidebarGroup } from "./sidebar";
import type { NoOnlineProjects, ProjectGrouping, RunningAgents } from "./prefs";

export interface LayoutPrefs {
  grouping: ProjectGrouping;
  noOnline: NoOnlineProjects;
  running: RunningAgents;
  foldIdle: boolean;
}

export interface GroupLayout {
  group: SidebarGroup;
  starred: boolean;
  /** full: rows listed; collapsed: one project row (flyout lists its agents). */
  mode: "full" | "collapsed";
  /** Full rows (Director, agents that want the owner, the open agent unless it is online idle, …), in the group's order. */
  full: AgentRow[];
  /** Running agents that need nothing: compact rows or the 运行中 avatar row (`prefs.running`). */
  running: AgentRow[];
  /** Online idle agents folded into 「N 个空闲」 (the open agent stays in here too). */
  idle: AgentRow[];
  /** Row key of the open agent when it sits in `idle` (the fold marks it while collapsed). */
  idleSelected: string | null;
  /** Offline agents for the 离线 N section (not shown as full rows). */
  offline: AgentRow[];
  runningCount: number;
  needsYouCount: number;
  /** Agents that want the owner (needs-you / error / done). */
  attentionCount: number;
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
}

/** Rows / groups are matched by their keys (rowKey / groupKey: host keys when they carry a host). */
export interface LayoutContext {
  signalOf(key: string): AgentSignal | undefined;
  /** The open agent's row key. */
  selectedId: string | null;
  /** Starred group keys. */
  starred: ReadonlySet<string>;
  prefs: LayoutPrefs;
  /** While searching every match is a full row and nothing collapses. */
  searching?: boolean;
  /** Group keys of projects set to 「在线空闲不收起」 (their idle agents are listed one by one). */
  idleUnfolded?: ReadonlySet<string>;
  lastOf?(row: AgentRow): number;
  /**
   * Freshly created agents the owner has not opened yet (lib/freshAgents): a full row, never folded
   * into 「N 个空闲」 / the 运行中 rows, so a new agent does not seem to vanish after its first turn.
   */
  isFresh?(key: string): boolean;
}

/** One group's rows split by the rules (mode decided by the caller). */
export function layoutGroup(group: SidebarGroup, ctx: LayoutContext, starred: boolean): Omit<GroupLayout, "mode"> {
  const full: AgentRow[] = [];
  const running: AgentRow[] = [];
  const idle: AgentRow[] = [];
  const offline: AgentRow[] = [];
  let runningCount = 0;
  let needsYouCount = 0;
  let attentionCount = 0;
  let hasSelected = false;
  let idleSelected: string | null = null;
  let lastActivity = 0;
  const foldIdle = ctx.prefs.foldIdle && !ctx.idleUnfolded?.has(groupKey(group));
  const offlineRows = new Set(group.offline);
  const all = [...group.online, ...group.offline];
  for (const row of all) {
    const signal = ctx.signalOf(rowKey(row)) ?? agentSignal(row, undefined, undefined);
    // The group's 离线 list (an unconfirmed `unknown` row stays in the list its snapshot put it in).
    const off = offlineRows.has(row);
    // Not confirmed yet (lib/sidebar `unknown`): a full row with its own 连接中 look, not in 「N 个空闲」.
    const unconfirmed = row.status === "unknown" && !off;
    const isRunning = row.status === "running";
    if (isRunning) runningCount++;
    if (signal === "needsYou") needsYouCount++;
    if (wantsOwner(signal)) attentionCount++;
    const selected = rowKey(row) === ctx.selectedId;
    if (selected) hasSelected = true;
    lastActivity = Math.max(lastActivity, ctx.lastOf?.(row) ?? row.lastActivity);
    const idleRow = !isRunning && !off && !unconfirmed;
    // The open agent leaves the 运行中 rows / 离线 list for a full row, but an online idle one stays
    // in 「N 个空闲」 (the fold marks it), so opening an agent doesn't reshuffle the list.
    const pinned = row.isDirector || wantsOwner(signal) || (selected && !(idleRow && foldIdle)) || (!off && !!ctx.isFresh?.(rowKey(row)));
    if (ctx.searching) {
      (off ? offline : full).push(row);
    } else if (pinned || unconfirmed) {
      full.push(row);
    } else if (off) {
      offline.push(row);
    } else if (isRunning) {
      (ctx.prefs.running === "full" ? full : running).push(row);
    } else {
      if (!foldIdle) full.push(row);
      else {
        idle.push(row);
        if (selected) idleSelected = rowKey(row);
      }
    }
  }
  full.sort(compareRows);
  return { group, starred, full, running, idle, idleSelected, offline, runningCount, needsYouCount, attentionCount, hasSelected, lastActivity };
}

/**
 * The sidebar's groups (already in display order) laid out. Starred groups move to the top (in
 * their order) and never collapse. 全部分组: a group without online agents collapses to one row
 * (unless 无在线项目 = 始终展开, or it holds the open agent / an agent that wants the owner).
 * 星标展开: starred groups in full, every other group one row under 其他项目.
 */
export function layoutSidebar(groups: readonly SidebarGroup[], ctx: LayoutContext): SidebarLayout {
  const starredFirst = [...groups.filter((g) => ctx.starred.has(groupKey(g))), ...groups.filter((g) => !ctx.starred.has(groupKey(g)))];
  const main: GroupLayout[] = [];
  const others: GroupLayout[] = [];
  for (const g of starredFirst) {
    const starred = ctx.starred.has(groupKey(g));
    const base = layoutGroup(g, ctx, starred);
    if (starred || ctx.searching) {
      main.push({ ...base, mode: "full" });
    } else if (ctx.prefs.grouping === "starred") {
      others.push({ ...base, mode: "collapsed" });
    } else {
      const quiet = g.online.length === 0 && !base.hasSelected && base.attentionCount === 0;
      main.push({ ...base, mode: quiet && ctx.prefs.noOnline === "collapse" ? "collapsed" : "full" });
    }
  }
  return { main, others };
}

/** Whether the latest-message line shows under this row's name (Settings 「agent 名下显示最新消息」). */
export function showsPreview(row: Pick<AgentRow, "isDirector">, mode: "off" | "director" | "all"): boolean {
  return mode === "all" || (mode === "director" && row.isDirector);
}
