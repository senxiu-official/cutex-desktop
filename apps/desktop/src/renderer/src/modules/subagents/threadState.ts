// subagents.thread params / state and its tab (kept out of the .tsx file).
import { useMemo } from "react";
import { useSubAgentLive } from "../../lib/background";
import { isClaudeTaskRef } from "../../lib/claudeTasks";
import { subAgentName, subAgentsOf, subAgentTooltip, type SubAgentInfo } from "../../lib/subagents";
import { useSubAgentMeta } from "../../lib/subagentMetaStore";
import { useApp } from "../../store";
import type { SideTabInfo, SideTabProps } from "../slots";
import type { Json } from "../types";

export type ThreadState = { threadId: string };

/** A Claude task (`claude:<session>:task:<id>`) is not a thread: never a card, nor a restored one. */
export function parseThreadParams(raw: Json): ThreadState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = raw.threadId;
  return typeof id === "string" && id.length > 0 && id.length <= 200 && !isClaudeTaskRef(id) ? { threadId: id } : null;
}

export function restoreThread(raw: Json, version: number): ThreadState | null {
  return version === 1 ? parseThreadParams(raw) : null;
}

/** The bound agent's sub-agents (its own timeline + the children's live status and nicknames). */
export function useBoundSubAgents(sessionId: string | null): Map<string, SubAgentInfo> {
  const view = useApp((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const live = useSubAgentLive(sessionId);
  const meta = useSubAgentMeta();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => subAgentsOf(view?.timeline ?? null, live, meta), [view?.timeline, view?.version, live, meta]);
}

export function useThreadTab({ instance, sessionId }: SideTabProps<ThreadState>): SideTabInfo {
  const threadId = instance.state.threadId;
  const agents = useBoundSubAgents(sessionId);
  const meta = useSubAgentMeta();
  const info = agents.get(threadId);
  const running = info?.status === "running" || info?.status === "pendingInit";
  const id = subAgentTooltip(threadId, info);
  return { title: subAgentName(threadId, agents, meta), tooltip: info?.task ? `${info.task}\n${id}` : id, busy: running };
}
