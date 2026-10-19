// The 最近完成 group of the 子代理 status category: an agent's finished sub-agents, derived from the
// timeline already loaded. Codex: the collab rows / sub-agent activity (`subAgentsOf`, so the same names
// as the running rows); Claude: the Agent / Task cards (lib/claudeTasks) only. Every Claude subagent has
// a card, while its `subAgentActivity` items name a task id that an older adapter never ties to the
// card (no `agentThreadId`), so listing those too would show it twice.
//
// Durations: a Claude card carries `durationMs`. A Codex child's comes from its own thread (turns, else
// createdAt → updatedAt), recorded from a read of the settled child (`subAgentSpanFromThreadRead`,
// lib/subagentMetaStore). Background Claude subagents (`run_in_background` not false; refused since
// claude-r21): the card ended at the launch and the adapter kept no transcript of the run that followed,
// so they show neither a duration nor an open.
// Pure (no React, no store) so it is unit-tested.
import { isClaudeAgentTool, isClaudeTaskRef } from "./claudeTasks";
import { subAgentDisplayName, subAgentsOf, type SubAgentLive, type SubAgentMetaMap } from "./subagents";
import { orderedEntries, type RawItem, type TimelineState, type TurnStatus } from "./timeline";

/** How many finished sub-agents the group lists. */
export const FINISHED_SUBAGENTS_LIMIT = 20;

export type FinishedOutcome = "completed" | "failed" | "stopped";

export interface FinishedSubAgent {
  /** Row key: the thread id, or the Claude card's item id. */
  key: string;
  /** What `openSubagentThread` opens; null = nothing to open (a Claude card without a transcript reference). */
  threadId: string | null;
  /** As the running rows name it; null = a Claude card with neither description nor type. */
  name: string | null;
  /** Claude `subagent_type` (general-purpose, Explore, …) or the Codex role ("default" omitted). */
  type: string | null;
  durationMs: number | null;
  outcome: FinishedOutcome;
  /** A background Claude subagent: no transcript was kept. */
  background: boolean;
  /** Its task (spawn prompt), for the tooltip. */
  task: string | null;
}

/** When a sub-agent's own thread ran (unix seconds). */
export interface SubAgentSpan {
  startedAt: number;
  endedAt: number;
}

export type SubAgentSpans = Readonly<Record<string, SubAgentSpan>>;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A settled sub-agent thread's span from its `thread/read` result: the first turn's start to the last
 *  turn's end, else createdAt → updatedAt. Null while it is active (the end is not known yet). */
export function subAgentSpanFromThreadRead(result: unknown): SubAgentSpan | null {
  const thread = (result as { thread?: { status?: { type?: unknown }; createdAt?: unknown; updatedAt?: unknown; turns?: { startedAt?: unknown; completedAt?: unknown }[] } } | null)?.thread;
  if (!thread || thread.status?.type === "active") return null;
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const startedAt = num(turns[0]?.startedAt) ?? num(thread.createdAt);
  const endedAt = turns.length > 0 ? num(turns.at(-1)?.completedAt) : num(thread.updatedAt);
  return startedAt !== null && endedAt !== null && endedAt >= startedAt ? { startedAt, endedAt } : null;
}

function spanMs(span: SubAgentSpan | undefined): number | null {
  return span ? Math.round((span.endedAt - span.startedAt) * 1000) : null;
}

/** A Codex `CollabAgentStatus` (or a Claude activity's) → outcome; null while it may still run. */
function outcomeOf(status: string): FinishedOutcome | null {
  switch (status) {
    case "completed":
      return "completed";
    case "errored":
    case "notFound":
      return "failed";
    case "interrupted":
    case "shutdown":
      return "stopped";
    default:
      return null;
  }
}

/** A Claude Agent / Task card's row (null while it runs). `turn`: the status of the card's turn. */
function claudeCardRow(item: RawItem, turn: TurnStatus | undefined, meta: SubAgentMetaMap, spans: SubAgentSpans): FinishedSubAgent | null {
  const args = (item.arguments && typeof item.arguments === "object" ? item.arguments : {}) as Record<string, unknown>;
  const ref = str(item.agentThreadId);
  const known = ref ? meta[ref] : undefined;
  const type = str(args.subagent_type) ?? known?.role ?? null;
  const description = str(args.description) ?? known?.nickname ?? null;
  let outcome: FinishedOutcome;
  if (item.status === "inProgress") {
    if (turn === "inProgress" || turn === undefined) return null;
    outcome = "stopped"; // its turn ended without it
  } else if (item.status === "failed" || item.success === false) outcome = turn === "interrupted" ? "stopped" : "failed";
  else outcome = "completed";
  // A refused call never ran, in the background or otherwise.
  const background = args.run_in_background !== false && outcome === "completed";
  return {
    key: String(item.id),
    threadId: ref,
    name: description ? subAgentDisplayName(description, { nickname: description, role: type }) : type,
    type,
    durationMs: background ? null : (num(item.durationMs) ?? (ref ? spanMs(spans[ref]) : null)),
    outcome,
    background,
    task: str(args.prompt),
  };
}

/**
 * The agent's finished sub-agents in `timeline`, newest first (the latest timeline mention of each),
 * at most `limit`. `live` / `meta` as for the running rows (lib/background `useSubAgentLive`, a stale
 * child shows as stopped); `spans` give Codex durations.
 */
export function finishedSubAgents(
  timeline: TimelineState | null,
  { live = {}, meta = {}, spans = {} }: { live?: SubAgentLive; meta?: SubAgentMetaMap; spans?: SubAgentSpans } = {},
  limit = FINISHED_SUBAGENTS_LIMIT,
): FinishedSubAgent[] {
  if (!timeline) return [];
  const turns = new Map(timeline.turns.map((t) => [t.id, t.status] as const));
  const rows: { at: number; row: FinishedSubAgent }[] = [];
  const lastSeen = new Map<string, number>();
  // The last completed / errored snapshot of each child: a later closeAgent (shutdown) keeps that outcome.
  const ended = new Map<string, string>();
  orderedEntries(timeline).forEach((entry, at) => {
    const item = (entry as { item?: RawItem }).item;
    if (!item) return;
    if (isClaudeAgentTool(item)) {
      const row = claudeCardRow(item, turns.get(entry.turnId ?? ""), meta, spans);
      if (row) rows.push({ at, row });
    } else if (item.type === "subAgentActivity") lastSeen.set(String(item.agentThreadId), at);
    else if (item.type === "collabAgentToolCall") {
      const states = (item.agentsStates ?? {}) as Record<string, { status?: string } | undefined>;
      for (const threadId of (item.receiverThreadIds as string[] | undefined) ?? []) {
        lastSeen.set(threadId, at);
        const status = states[threadId]?.status;
        if (status === "completed" || status === "errored") ended.set(threadId, status);
      }
    }
  });
  for (const info of subAgentsOf(timeline, live, meta).values()) {
    if (isClaudeTaskRef(info.threadId)) continue; // its card's row
    const outcome = outcomeOf(info.status === "shutdown" ? (ended.get(info.threadId) ?? info.status) : info.status);
    if (!outcome) continue;
    const type = info.role && info.role.toLowerCase() !== "default" ? info.role : null;
    rows.push({ at: lastSeen.get(info.threadId) ?? -1, row: { key: info.threadId, threadId: info.threadId, name: info.name, type, durationMs: spanMs(spans[info.threadId]), outcome, background: false, task: info.task } });
  }
  return rows
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((r) => r.row);
}
