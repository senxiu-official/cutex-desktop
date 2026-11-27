// 项目 › 概览 v2 (owner 2026-11-26): what each block shows, from data the host already gives (sidebar rows, delegations,
// services, project memory). Pure functions; ProjectOverview.tsx draws them.
import type { AskSummary, ProjectMemoryView, ServiceView } from "../../../../shared/ipc";
import type { AgentRow } from "../../lib/sidebar";

/** 成员 block: at most this many working members are listed, then 「还有 N 个在工作」. */
export const BUSY_SHOWN = 5;
export const RECENT_DONE_SHOWN = 4;
export const ARTIFACTS_SHOWN = 4;
export const MEMORY_SHOWN = 3;

/** The overview's two-column layout needs this much room (rem); narrower (a side pane, a portrait screen) is one column. */
export const OVERVIEW_WIDE_REM = 44;

/** Working members (running, or waiting for the owner) other than the Director, the first `max`, and how many more. */
export function busyMembers(online: readonly AgentRow[], directorId: string | null, max = BUSY_SHOWN): { shown: AgentRow[]; more: number; total: number } {
  const busy = online.filter((r) => r.id !== directorId && (r.status === "running" || r.status === "needsInput"));
  return { shown: busy.slice(0, max), more: Math.max(0, busy.length - max), total: busy.length };
}

export type ClosedKind = "done" | "failed" | "stopped";

/** How a closed delegation ended, as the board reads it (shared/boardModel). */
export function closedKind(d: Pick<AskSummary, "execution" | "closed">): ClosedKind {
  if (d.execution === "failed") return "failed";
  return d.closed === "completed" || d.closed === "accepted" ? "done" : "stopped";
}

const closedMs = (d: AskSummary): number => Date.parse(d.closedAt ?? d.updatedAt ?? "") || 0;

export function localDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 最近完成: the project's closed delegations, newest first, and today's count (this device's day; every closed one counts
 * as finished, failed ones are a part of it — the board's rule).
 */
export function recentClosed(rows: readonly AskSummary[], projectId: string, now: number, max = RECENT_DONE_SHOWN): { rows: AskSummary[]; today: { done: number; failed: number } } {
  const closed = rows.filter((d) => d.projectId === projectId && (!!d.closed || !!d.closedAt)).sort((a, b) => closedMs(b) - closedMs(a));
  const start = localDayStart(now);
  const today = { done: 0, failed: 0 };
  for (const d of closed) {
    if (closedMs(d) < start) break;
    today.done += 1;
    if (closedKind(d) === "failed") today.failed += 1;
  }
  return { rows: closed.slice(0, max), today };
}

/** Services that need a look come first; the rest is one count. */
const PROBLEM: ReadonlySet<ServiceView["health"]> = new Set(["unreachable", "crashLooped", "starting"]);
export function serviceProblems(services: readonly ServiceView[]): { problems: ServiceView[]; rest: number } {
  const problems = services.filter((s) => PROBLEM.has(s.health)).sort((a, b) => Number(b.health === "crashLooped") - Number(a.health === "crashLooped") || Number(b.health === "unreachable") - Number(a.health === "unreachable"));
  return { problems, rest: services.length - problems.length };
}

export type MemoryEntry = ProjectMemoryView["entries"][number];

/** The newest memory files by their update time; none when the host does not send times (older cutex). */
export function recentMemory(memory: ProjectMemoryView | null | undefined, max = MEMORY_SHOWN): MemoryEntry[] {
  const entries = (memory?.entries ?? []).filter((e) => typeof e.updatedAt === "string" && !Number.isNaN(Date.parse(e.updatedAt)));
  return entries.sort((a, b) => Date.parse(b.updatedAt!) - Date.parse(a.updatedAt!)).slice(0, max);
}
