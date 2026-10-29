// Pure logic of the 正在运行的智能体 widget: which rows count, in what order, how long they have run.
import { runningSince } from "../../lib/agentAttention";
import type { AgentRow } from "../../lib/sidebar";

export interface RunningAgent {
  row: AgentRow;
  hostId: string;
  /** When the turn started (ms), null when the host did not say. */
  since: number | null;
}

/** The agents with a turn in progress: longest-running first (unknown start last), then by name. `focus` = only that host. */
export function runningAgents(rows: readonly AgentRow[], focusHost: string, onlyFocus: boolean): RunningAgent[] {
  const out: RunningAgent[] = [];
  for (const row of rows) {
    if (row.status !== "running") continue;
    const hostId = row.hostId ?? focusHost;
    if (onlyFocus && hostId !== focusHost) continue;
    out.push({ row, hostId, since: runningSince(row) });
  }
  return out.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity) || a.row.name.localeCompare(b.row.name));
}

/** Whole minutes a turn has run (never negative); null when its start is unknown. */
export function minutesRunning(since: number | null, now: number): number | null {
  return since === null ? null : Math.max(0, Math.floor((now - since) / 60000));
}

/** "<1 min" is the caller's word; from one minute: 5m, 1h05, 2d. */
export function longElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** How many rows a box of this height holds (title line + padding taken off; a row is 44 px). */
export function rowsThatFit(height: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor((height - 48) / 44)));
}
