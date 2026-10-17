// Sidebar v2 layout (pure): which agents of a project show as full rows, which fold into the
// 运行中 rows / 「N 个空闲」 / 离线 N, and which projects collapse to one row (hover
// flyout) or go under 其他项目. Settings → 外观 → 侧栏 picks the modes (lib/prefs).
import type { AgentSignal } from "./agentAttention";
import { agentSignal, wantsOwner } from "./agentAttention";
import { agentStatus, compareRows, groupKey, rowKey, type AgentRow, type SidebarGroup } from "./sidebar";
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
  /** Full rows (Director, pins, agents that want the owner, the open agent unless it is online idle, …), in the group's order. */
  full: AgentRow[];
  /** Running agents that need nothing: compact rows or the 运行中 avatar row (`prefs.running`). */
  running: AgentRow[];
  /** Online idle agents folded into 「N 个空闲」 (the open agent and finished turns not seen yet stay in here too; unconfirmed rows their snapshot put here). */
  idle: AgentRow[];
  /** Row key of the open agent when it sits in `idle` (the fold marks it while collapsed). */
  idleSelected: string | null;
  /** Row keys in `idle` with a finished turn not seen yet (完成: ✓ on the avatar, 「· N 完成」 on the header). */
  idleDone: string[];
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
  const idleDone: string[] = [];
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
    // Not confirmed yet (lib/sidebar `unknown`, host loading): the row stays where its last snapshot
    // put it — 运行中 rows or 「N 个空闲」 (with its own 连接中 look) — so a reconnect never unfolds a
    // collapsed fold. Only a snapshot state neither of them shows (an error) gets a full row.
    const unconfirmed = row.status === "unknown" && !off;
    const placed = unconfirmed ? agentStatus(row.session, false) : row.status;
    const unplaced = unconfirmed && placed !== "running" && placed !== "idle";
    const isRunning = row.status === "running";
    if (isRunning) runningCount++;
    if (signal === "needsYou") needsYouCount++;
    if (wantsOwner(signal)) attentionCount++;
    const selected = rowKey(row) === ctx.selectedId;
    if (selected) hasSelected = true;
    lastActivity = Math.max(lastActivity, ctx.lastOf?.(row) ?? row.lastActivity);
    const runningRow = isRunning || (unconfirmed && placed === "running");
    const idleRow = !runningRow && !off && !unplaced;
    // A finished turn not seen yet (完成) on an online idle agent stays in a collapsed 「N 个空闲」 (an
    // avatar with a ✓, 「· N 完成」 on the header; the 需要你 strip still lists it): collapsed means collapsed.
    const foldedDone = signal === "done" && idleRow && foldIdle;
    // A full row whatever the folds: the Director, the owner's pins (menu 置顶: never folded into
    // 「N 个空闲」 / the 运行中 rows / 离线 N), agents that want the owner, fresh ones. The open agent
    // leaves the 运行中 rows / 离线 list for a full row, but an online idle one stays in 「N 个空闲」
    // (the fold marks it), so opening an agent doesn't reshuffle the list.
    const keepFull = row.isDirector || row.pinned || (wantsOwner(signal) && !foldedDone) || (selected && !(idleRow && foldIdle)) || (!off && !!ctx.isFresh?.(rowKey(row)));
    if (ctx.searching) {
      (off ? offline : full).push(row);
    } else if (keepFull || unplaced) {
      full.push(row);
    } else if (off) {
      offline.push(row);
    } else if (runningRow) {
      (ctx.prefs.running === "full" ? full : running).push(row);
    } else {
      if (!foldIdle) full.push(row);
      else {
        idle.push(row);
        if (selected) idleSelected = rowKey(row);
        if (signal === "done") idleDone.push(rowKey(row));
      }
    }
  }
  full.sort(compareRows);
  return { group, starred, full, running, idle, idleSelected, idleDone, offline, runningCount, needsYouCount, attentionCount, hasSelected, lastActivity };
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

/**
 * The 「N 个空闲」 header's counts: `idle` without the finished turns not seen yet, `done` those
 * (「› 3 个空闲 · 2 完成」; only done ones: 「› 2 完成」). Shown whenever the fold has rows, collapsed or not.
 */
export function foldLabel(rows: number, done: number): { idle: number; done: number } {
  return { idle: Math.max(0, rows - done), done };
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
