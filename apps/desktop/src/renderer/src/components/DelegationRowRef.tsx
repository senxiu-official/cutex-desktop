// The delegation a tool row acts on, by name (owner 2026-11-18): 「放弃委托 · profile-a 额度调查 → profile-a-quota-audit」.
// Resolved from what the desktop already holds — the host's delegation store, else what the transcript said
// (lib/taskRows delegationRef) — never a read per row. Unknown: the id itself. Click opens the delegation.
import { useConvHost } from "../lib/conversationScope";
import { useDelegation } from "../lib/delegationStore";
import { useResolvedAskId, useResolvedSessionId } from "../lib/delegationsView";
import { openDelegationDetail } from "../lib/delegationOpen";
import { isSessionRef } from "../lib/shortIds";
import type { TaskRowDelegation } from "../lib/taskRows";
import { delegationRowLabel } from "../lib/delegationRowLabel";
import { sidebarOf, useApp } from "../store";

export function DelegationRowRef({ delegation }: { delegation: TaskRowDelegation }) {
  const hostId = useConvHost();
  const askId = useResolvedAskId(delegation.id, hostId);
  const record = useDelegation(hostId, askId);
  // A session reference the transcript gave as the handler: its sidebar name.
  const targetSession = useResolvedSessionId(delegation.target && isSessionRef(delegation.target) ? delegation.target : null);
  const sessionName = useApp((s) => {
    if (!targetSession) return null;
    const sb = sidebarOf(s, hostId);
    return [...(sb?.active ?? []), ...(sb?.retired ?? [])].find((x) => x.cutexSessionId === targetSession)?.displayName ?? null;
  });
  const { text, title } = delegationRowLabel(delegation, record, sessionName);
  const open = () => openDelegationDetail(hostId, askId, { title: record?.title ?? delegation.title ?? undefined });
  return (
    <span
      role="link"
      tabIndex={0}
      data-delegation-row-ref={delegation.id}
      title={title}
      onClick={(e) => (e.stopPropagation(), open())}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), open())}
      className="min-w-0 shrink truncate text-foreground/80 hover:text-foreground hover:underline"
    >
      {text}
    </span>
  );
}
