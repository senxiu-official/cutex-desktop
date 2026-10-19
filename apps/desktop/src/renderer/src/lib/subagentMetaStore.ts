// Sub-agent nicknames / roles by thread id (lib/subagents `SubAgentMeta`), in their own small store
// like the agent-message store: fed by the `thread/read` results of sub-agent threads (the settle /
// name reads in lib/background.ts, the sub-agent thread card), read by everything that names a
// sub-agent (via `subAgentsOf(…, meta)`). Thread ids are unique across hosts and a nickname never
// changes, so entries are kept for the app session (no reset on a host switch). Also when a settled
// sub-agent's thread ran (lib/finishedSubagents `SubAgentSpan`: the 最近完成 durations), from the same reads.
import { create } from "zustand";
import type { SubAgentSpan, SubAgentSpans } from "./finishedSubagents";
import type { SubAgentMeta, SubAgentMetaMap } from "./subagents";

interface SubAgentMetaState {
  byId: SubAgentMetaMap;
  spans: SubAgentSpans;
}

export const useSubAgentMetaStore = create<SubAgentMetaState>(() => ({ byId: {}, spans: {} }));

/** All known sub-agent nicknames / roles (re-renders when one is learned). */
export function useSubAgentMeta(): SubAgentMetaMap {
  return useSubAgentMetaStore((s) => s.byId);
}

/** Records what a read of `threadId` said; a later read without a nickname never erases a known one. */
export function recordSubAgentMeta(threadId: string, meta: SubAgentMeta): void {
  const { byId } = useSubAgentMetaStore.getState();
  const prev = byId[threadId];
  const next = { nickname: meta.nickname ?? prev?.nickname ?? null, role: meta.role ?? prev?.role ?? null };
  if (prev && prev.nickname === next.nickname && prev.role === next.role) return;
  useSubAgentMetaStore.setState({ byId: { ...byId, [threadId]: next } });
}

/** Known spans of settled sub-agent threads. */
export function useSubAgentSpans(): SubAgentSpans {
  return useSubAgentMetaStore((s) => s.spans);
}

/** Records a settled sub-agent thread's span (null: still active, nothing to record). */
export function recordSubAgentSpan(threadId: string, span: SubAgentSpan | null): void {
  if (!span) return;
  const { spans } = useSubAgentMetaStore.getState();
  const prev = spans[threadId];
  if (prev && prev.startedAt === span.startedAt && prev.endedAt === span.endedAt) return;
  useSubAgentMetaStore.setState({ spans: { ...spans, [threadId]: span } });
}
