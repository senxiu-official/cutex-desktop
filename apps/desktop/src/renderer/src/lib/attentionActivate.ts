// Opening an agent that wants the owner where its need is handled — the 需要你 strip's chips and the sidebar's
// 「现在」 cards (layout B) do the same: owner approvals only → the 审批 page; a delegation waiting for your review only →
// the agent with that delegation's detail beside it (批准 / 拒绝 there); an agent → owner message → the agent at that
// message; else the agent.
import type { AttentionChip, NeedsYou } from "./agentAttention";
import { openDelegationDetail } from "./delegationOpen";
import { focusOwnerNote } from "./ownerNotifyStore";
import { services } from "../modules/app";
import { useApp } from "../store";

export function activateAttention(c: Pick<AttentionChip, "id" | "signal">, need: NeedsYou | undefined, host: string): void {
  const openAgent = useApp.getState().openAgent;
  const approvalsOnly = c.signal === "needsYou" && need?.reasons.length === 1 && need.reasons[0] === "approval";
  const note = c.signal === "needsYou" ? need?.notificationIds?.[0] : undefined;
  const review = c.signal === "needsYou" && need?.reasons.length === 1 && need.reasons[0] === "review" ? (need.askIds[0] ?? null) : null;
  if (approvalsOnly) services.ui.openPage("approvals.page");
  else if (review) void openAgent(c.id, host).then(() => openDelegationDetail(host, review));
  else if (note) focusOwnerNote(c.id, note, host);
  else void openAgent(c.id, host);
}
