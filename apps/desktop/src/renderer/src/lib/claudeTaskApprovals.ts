// cutex r295: background Claude subagents whose tool approval was declined unattended (lib/subagents
// claudeTaskApprovalFromEvent). Scoped like the subagent task state (store setSubAgentStatus / forgetSubAgents):
// per host and task reference, fenced by the parent's runtime generation (an older runtime's replayed update
// never sets or clears it), and forgotten when the parent's timeline is read again (that read and the next
// update decide). The task's newest update decides: a later update without the flag clears it.
import { create } from "zustand";

interface Entry { denied: true; generation: number }
interface ClaudeTaskApprovals {
  byKey: Readonly<Record<string, Entry>>;
  /** Generation of the newest update seen per key (also kept after a clear, as the fence). */
  seenAt: Readonly<Record<string, number>>;
}

export const useClaudeTaskApprovals = create<ClaudeTaskApprovals>(() => ({ byKey: {}, seenAt: {} }));

export const claudeTaskApprovalKey = (hostId: string, threadId: string): string => `${hostId}\u0000${threadId}`;

/** `generation`: the update's runtime generation (0 = unknown: accepted, like subagent statuses). */
export function noteClaudeTaskApproval(hostId: string, threadId: string, denied: boolean, generation = 0): void {
  const key = claudeTaskApprovalKey(hostId, threadId);
  const { byKey, seenAt } = useClaudeTaskApprovals.getState();
  const seen = seenAt[key] ?? 0;
  if (generation > 0 && generation < seen) return;
  const genChanged = generation > 0 && generation !== seen;
  if (!!byKey[key] === denied && !genChanged) return;
  const nextBy = { ...byKey };
  if (denied) nextBy[key] = { denied: true, generation: Math.max(generation, seen) };
  else delete nextBy[key];
  useClaudeTaskApprovals.setState({ byKey: nextBy, seenAt: genChanged ? { ...seenAt, [key]: generation } : seenAt });
}

/** The parent's timeline was read again: forget what earlier feeds said about these tasks. */
export function forgetClaudeTaskApprovals(hostId: string, threadIds: Iterable<string>): void {
  const { byKey, seenAt } = useClaudeTaskApprovals.getState();
  let nextBy: Record<string, Entry> | null = null, nextSeen: Record<string, number> | null = null;
  for (const id of threadIds) {
    const key = claudeTaskApprovalKey(hostId, id);
    if (key in byKey) delete (nextBy ??= { ...byKey })[key];
    if (key in seenAt) delete (nextSeen ??= { ...seenAt })[key];
  }
  if (nextBy || nextSeen) useClaudeTaskApprovals.setState({ byKey: nextBy ?? byKey, seenAt: nextSeen ?? seenAt });
}

export function resetClaudeTaskApprovals(): void {
  useClaudeTaskApprovals.setState({ byKey: {}, seenAt: {} });
}
