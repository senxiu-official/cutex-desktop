// Codex sub-agents (multi-agent v1 / v2) as seen from the parent agent (DESIGN §4.16): names from
// `subAgentActivity.agentPath`, per-thread state from `collabAgentToolCall.agentsStates`.
//
// `agentsStates` is only a snapshot taken when that collab call ran (spawn → usually
// `pendingInit`). Nothing in the parent thread updates it when the child finishes unless the
// parent later calls `wait` (multi-agent v1 reports completion as a `<subagent_notification>`
// model-context fragment, not a thread item; v2 adds a `subAgentActivity` "completed" item only
// for some paths). The child thread itself is authoritative: its lifecycle events arrive on the
// parent stream and `thread/read` on it gives the settled state, so those (`live`) win.
//
// Readable names: cute-codex gives every spawned sub-agent a nickname (and its role), but only on
// the child's own native `Thread` (`agentNickname` / `agentRole`, also `source.subAgent.thread_spawn`).
// Neither `collabAgentToolCall` nor `subAgentActivity` carries them, and cute-codex sends no
// `thread/started` for a spawned child, so the desktop takes them from the child's `thread/read`
// (lib/background.ts → lib/subagentMetaStore.ts). Unknown (not read yet, parent offline, older
// runtime) → today's name: the v2 path leaf or the short thread id.
import { createContext, useContext } from "react";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { isClaudeTaskRef } from "./claudeTasks";
import { eventThreadId, orderedEntries, type RawItem, type TimelineState } from "./timeline";

/** Child-thread status by thread id, from the child's own events / `thread/read`. */
export type SubAgentLive = Readonly<Record<string, string>>;

/** The parent's cutex `runtimeGeneration` each `live` status was seen under (absent / 0 = unknown). */
export type SubAgentLiveGen = Readonly<Record<string, number>>;

/** States after which a sub-agent cannot run again; a child-thread status never overrides them. */
const CLOSED = new Set(["shutdown", "notFound"]);

/** Native `TurnStatus` → `CollabAgentStatus`. */
function fromTurnStatus(status: unknown): string | null {
  switch (status) {
    case "inProgress":
      return "running";
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "failed":
      return "errored";
    default:
      return null;
  }
}

/** Status change of a child thread carried by one of its own events on the parent stream. */
export function childStatusFromEvent(envelope: EventEnvelope): { threadId: string; status: string } | null {
  const message = envelope.native?.kind === "notification" ? envelope.native.message : null;
  const threadId = eventThreadId(envelope);
  if (!message || !threadId) return null;
  const params = (message.params ?? {}) as { turn?: { status?: unknown }; status?: { type?: unknown } };
  let status: string | null = null;
  if (message.method === "turn/started") status = "running";
  else if (message.method === "turn/completed") status = fromTurnStatus(params.turn?.status);
  else if (message.method === "thread/status/changed") {
    // `idle` says nothing about how the last turn ended; `turn/completed` carries that.
    if (params.status?.type === "active") status = "running";
    else if (params.status?.type === "systemError") status = "errored";
  }
  return status ? { threadId, status } : null;
}

/** Settled status of a child thread from its `thread/read` result (null: nothing known yet). */
export function childStatusFromThreadRead(result: unknown): string | null {
  const thread = (result as { thread?: { status?: { type?: unknown }; turns?: { status?: unknown }[] } } | null)?.thread;
  if (!thread) return null;
  if (thread.status?.type === "active") return "running";
  if (thread.status?.type === "systemError") return "errored";
  const last = thread.turns?.at(-1);
  return last ? fromTurnStatus(last.status) : null;
}

export interface SubAgentInfo {
  threadId: string;
  /** Display name: 「nickname · role」 once known (`subAgentDisplayName`), else the path leaf / short id. */
  name: string;
  /** First spawn prompt. */
  task: string | null;
  status: string;
  message: string | null;
  /** cute-codex nickname / role of the child thread (null until read, or on an older runtime). */
  nickname: string | null;
  role: string | null;
  /** Multi-agent v2 task path (`subAgentActivity.agentPath`, e.g. "/root/acl_checker"). */
  path: string | null;
}

/** Nickname / role cute-codex gave a spawned sub-agent. An entry means the thread was read: both
 *  null = it has none (older runtime), so it is not read again. */
export interface SubAgentMeta {
  nickname: string | null;
  role: string | null;
}

/** Sub-agent nickname / role by thread id (lib/subagentMetaStore.ts). */
export type SubAgentMetaMap = Readonly<Record<string, SubAgentMeta>>;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Nickname / role of a native `Thread` (`agentNickname` / `agentRole`, else `source.subAgent.thread_spawn`). */
export function subAgentMetaOfThread(thread: unknown): SubAgentMeta {
  const t = (thread && typeof thread === "object" ? thread : {}) as { agentNickname?: unknown; agentRole?: unknown; source?: unknown };
  const subAgent = t.source && typeof t.source === "object" ? (t.source as { subAgent?: unknown }).subAgent : null;
  const spawn = subAgent && typeof subAgent === "object" ? (subAgent as { thread_spawn?: { agent_nickname?: unknown; agent_role?: unknown } | null }).thread_spawn : null;
  return { nickname: text(t.agentNickname) ?? text(spawn?.agent_nickname), role: text(t.agentRole) ?? text(spawn?.agent_role) };
}

/** Nickname / role from a sub-agent's `thread/read` result (both null when it has none). */
export function subAgentMetaFromThreadRead(result: unknown): SubAgentMeta {
  return subAgentMetaOfThread((result as { thread?: unknown } | null)?.thread);
}

/** 「Euclid · explorer」: the nickname (else `fallback`), plus the role unless it is absent or "default". */
export function subAgentDisplayName(fallback: string, meta: SubAgentMeta | undefined): string {
  const base = meta?.nickname ?? fallback;
  const role = meta?.role && meta.role.toLowerCase() !== "default" ? meta.role : null;
  return role ? `${base} · ${role}` : base;
}

/** A sub-agent's name: its entry in `agents` (the parent's timeline), else its nickname, else the short id. */
export function subAgentName(threadId: string, agents: ReadonlyMap<string, SubAgentInfo>, meta: SubAgentMetaMap): string {
  return agents.get(threadId)?.name ?? subAgentDisplayName(threadId.slice(0, 8), meta[threadId]);
}

/** Hover text of a sub-agent's name: its v2 task path (if any) and its thread id. */
export function subAgentTooltip(threadId: string, info?: Pick<SubAgentInfo, "path"> | null): string {
  return info?.path ? `${info.path}\n${threadId}` : threadId;
}

/** "/root/acl_checker" → "acl_checker"; falls back to a short thread id. */
export function nameFromPath(path: string | null | undefined, threadId: string): string {
  const leaf = path?.split("/").filter(Boolean).pop();
  return leaf || threadId.slice(0, 8);
}

/** All sub-agents this timeline knows about, keyed by thread id (latest state wins; `live`
 *  child-thread status over the parent's call-time snapshots; `meta` nicknames over path / id names). */
export function subAgentsOf(timeline: TimelineState | null, live: SubAgentLive = {}, meta: SubAgentMetaMap = {}): Map<string, SubAgentInfo> {
  const map = new Map<string, SubAgentInfo>();
  if (!timeline) return map;
  for (const entry of orderedEntries(timeline)) {
    const item = (entry as { item?: RawItem }).item;
    if (!item) continue;
    if (item.type === "subAgentActivity") {
      const threadId = String(item.agentThreadId);
      const prev = map.get(threadId);
      const kind = item.kind as string | undefined;
      const status = kind === "completed" || kind === "interrupted" ? kind : (prev?.status ?? "running");
      const path = text(item.agentPath) ?? prev?.path ?? null;
      map.set(threadId, { threadId, task: null, message: null, nickname: null, role: null, ...prev, status, path, name: nameFromPath(path, threadId) });
    } else if (item.type === "collabAgentToolCall") {
      const states = (item.agentsStates ?? {}) as Record<string, { status: string; message: string | null } | undefined>;
      for (const threadId of (item.receiverThreadIds as string[] | undefined) ?? []) {
        const prev = map.get(threadId);
        const state = states[threadId];
        map.set(threadId, {
          threadId,
          name: prev?.name ?? threadId.slice(0, 8),
          task: prev?.task ?? (item.tool === "spawnAgent" ? ((item.prompt as string | null) ?? null) : null),
          status: state?.status ?? prev?.status ?? "running",
          message: state?.message ?? prev?.message ?? null,
          nickname: null,
          role: null,
          path: prev?.path ?? null,
        });
      }
    }
  }
  for (const info of map.values()) {
    const status = live[info.threadId];
    if (status && !CLOSED.has(info.status)) info.status = status;
    const known = meta[info.threadId];
    if (known) {
      info.nickname = known.nickname;
      info.role = known.role;
      info.name = subAgentDisplayName(info.name, known);
    }
  }
  return map;
}

/** Statuses of a sub-agent that is still starting or working. */
export const ACTIVE_SUBAGENT: ReadonlySet<string> = new Set(["pendingInit", "running"]);

/**
 * `live` as of the parent's current runtime generation. A native sub-agent thread runs inside its
 * parent's app-server process, and cutex advances `runtimeGeneration` on every runtime launch: a
 * child seen starting / working under an older generation lost its process when that runtime
 * stopped, so it is "interrupted" (what cute-codex's own `thread/read` reports for a thread that is
 * not loaded: in-progress turns → interrupted). Its own events, or a read under the current
 * generation, replace that. Unchanged (same object) when nothing is stale or `generation` is unknown.
 */
export function liveAtGeneration(live: SubAgentLive, seenAt: SubAgentLiveGen, generation: number): SubAgentLive {
  if (!(generation > 0)) return live;
  let out: Record<string, string> | null = null;
  for (const [threadId, status] of Object.entries(live)) {
    const seen = seenAt[threadId] ?? 0;
    if (seen > 0 && seen < generation && ACTIVE_SUBAGENT.has(status)) (out ??= { ...live })[threadId] = "interrupted";
  }
  return out ?? live;
}

/** Active subagents (name, task, latest message) from the parent's timeline. The timeline only has
 *  each subagent's last recorded state, so a parent that went offline mid-run would show them as
 *  running forever: none are active unless the parent is online. */
export function activeSubAgents(timeline: TimelineState | null, parentOnline: boolean, live: SubAgentLive = {}, meta: SubAgentMetaMap = {}): SubAgentInfo[] {
  if (!parentOnline) return [];
  return [...subAgentsOf(timeline, live, meta).values()].filter((a) => ACTIVE_SUBAGENT.has(a.status));
}

/** A failed name read may be retried after this long, at most `NAME_READ_TRIES` reads in all. */
export const NAME_READ_RETRY_MS = 60_000;
export const NAME_READ_TRIES = 3;

/** Sub-agent thread reads already asked for, by `sessionId:threadId`. */
export interface SubAgentReadLog {
  /** Settle reads: one each. */
  settle: Set<string>;
  /** Name reads (a settle read counts): when the last one was asked and how many so far. */
  name: Map<string, { at: number; tries: number }>;
}

/**
 * The child-thread reads due now, recorded in `log`. `settle`: a full read (turns) for a sub-agent
 * that still looks active with no child-thread status yet, once per parent runtime `generation` (a
 * restarted runtime has its own answer) — it settles the status and names it too.
 * Otherwise a light read (no turns) for one whose nickname is unknown (not in `meta`). A Claude
 * task is not a thread: never read.
 */
export function takeSubAgentReads(sessionId: string, agents: Iterable<SubAgentInfo>, live: SubAgentLive, meta: SubAgentMetaMap, log: SubAgentReadLog, now: number, generation = 0): { threadId: string; settle: boolean }[] {
  const due: { threadId: string; settle: boolean }[] = [];
  for (const agent of agents) {
    if (isClaudeTaskRef(agent.threadId)) continue;
    const key = `${sessionId}:${agent.threadId}`;
    const settleKey = `${key}@${generation}`;
    const settle = ACTIVE_SUBAGENT.has(agent.status) && !live[agent.threadId] && !log.settle.has(settleKey);
    const asked = log.name.get(key);
    const name = !meta[agent.threadId] && (!asked || (asked.tries < NAME_READ_TRIES && now - asked.at >= NAME_READ_RETRY_MS));
    if (!settle && !name) continue;
    if (settle) log.settle.add(settleKey);
    log.name.set(key, { at: now, tries: (asked?.tries ?? 0) + 1 });
    due.push({ threadId: agent.threadId, settle });
  }
  return due;
}

export interface SubAgentContextValue {
  agents: Map<string, SubAgentInfo>;
  open(threadId: string): void;
}

export const SubAgentContext = createContext<SubAgentContextValue>({ agents: new Map(), open: () => {} });

export function useSubAgents(): SubAgentContextValue {
  return useContext(SubAgentContext);
}
