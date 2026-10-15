// Sub-agent nicknames / roles by thread id (lib/subagents `SubAgentMeta`), in their own small store
// like the agent-message store: fed by the `thread/read` results of sub-agent threads (the settle /
// name reads in lib/background.ts, the sub-agent thread card), read by everything that names a
// sub-agent (via `subAgentsOf(…, meta)`). Thread ids are unique across hosts and a nickname never
// changes, so entries are kept for the app session (no reset on a host switch).
import { create } from "zustand";
import type { SubAgentMeta, SubAgentMetaMap } from "./subagents";

interface SubAgentMetaState {
  byId: SubAgentMetaMap;
}

export const useSubAgentMetaStore = create<SubAgentMetaState>(() => ({ byId: {} }));

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
