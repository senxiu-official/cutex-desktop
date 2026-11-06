// The live state of a cutex call that answered "needs the owner" (agent_delegate pendingReview, agent_create
// approval_required, an action_status receipt in awaitingApproval). The transcript keeps that first reply; the host's
// delegation list and approvals list say what happened since, so the row follows them instead of saying 等待授权 for
// good. Works with every host that has those lists (asks / owner-approvals): nothing new is read.
import type { AskExecution, ApprovalRecord } from "../../../shared/ipc";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { useHostRecords } from "./delegationStore";
import { APPROVALS_LIVE_FEATURE, approvalOfTool, knownApprovalState } from "./approvals";
import { resultDelegationId, toolResult, type TaskRowOutcome } from "./taskRows";
import type { RawItem } from "./timeline";
import { resolveId } from "./shortIds";
import { featuresOf, useApp } from "../store";

/** pending: still waiting; decided: no longer waiting, the decision unknown here (decided before this run). */
export type LiveApproval = "pending" | "approved" | "denied" | "expired" | "decided";

/** What a call is waiting on: the owner approval it named, and / or the delegation it created. */
export interface ApprovalSubject {
  approvalId?: string | null;
  delegationId?: string | null;
}

/** A delegation under the owner's review (pendingReview) after the review: run / rejected. Cancelled: not known. */
export function delegationApproval(execution: AskExecution | undefined): LiveApproval | null {
  if (!execution || execution === "cancelled") return null;
  if (execution === "pendingReview") return "pending";
  return execution === "rejected" ? "denied" : "approved";
}

/**
 * An owner approval: in the host's pending list = pending; else what this run saw decided. A loaded list without it
 * on a host that streams every request (approvals-live) = decided; otherwise unknown (null: keep the reply).
 */
export function ownerApproval(approvalId: string | null | undefined, pending: readonly ApprovalRecord[] | null | undefined, known: ApprovalRecord["state"] | undefined, live: boolean): LiveApproval | null {
  if (!approvalId) return null;
  if (pending?.some((a) => a.approvalId === approvalId)) return "pending";
  if (known === "approved" || known === "consumed") return "approved";
  if (known === "denied") return "denied";
  if (known === "expired") return "expired";
  return pending && live ? "decided" : null;
}

/** The delegation's record id among a host's records (agents see `delegation-…`, the host keys `ask-…`). */
export function delegationRecordId(delegationId: string | null | undefined, records: Readonly<Record<string, unknown>>): string | null {
  if (!delegationId) return null;
  return delegationId in records ? delegationId : resolveId(delegationId, Object.keys(records));
}

/** The live state of `subject` on `hostId` (null: unknown, show the reply as it was). */
export function useLiveApproval(hostId: string, subject: ApprovalSubject | null): LiveApproval | null {
  // The host's pending list (lib/hostScope hostData), read narrowly: every task row calls this.
  const pending = useApp((s) => (hostId === (s.hosts?.active ?? LOCAL_HOST_ID) ? s.approvals : s.byHost?.[hostId]?.approvals) ?? null);
  const live = useApp((s) => featuresOf(s, hostId).has(APPROVALS_LIVE_FEATURE));
  const records = useHostRecords(hostId);
  if (!subject) return null;
  const askId = delegationRecordId(subject.delegationId, records);
  const fromDelegation = askId ? delegationApproval(records[askId]?.execution) : null;
  if (fromDelegation) return fromDelegation;
  const approvalId = subject.approvalId ?? null;
  return ownerApproval(approvalId, pending, approvalId ? knownApprovalState(approvalId) : undefined, live);
}

/** What the row says: the reply's outcome, or what became of the approval it waited for. */
export type ShownOutcomeKind = TaskRowOutcome["kind"] | "approved" | "expired" | "decided";
export type ShownOutcome = Omit<TaskRowOutcome, "kind"> & { kind: ShownOutcomeKind };

/** The reply's "awaiting the owner" outcome after the owner's decision; any other outcome unchanged. */
export function liveOutcome(outcome: TaskRowOutcome | null, live: LiveApproval | null): ShownOutcome | null {
  if (outcome?.kind !== "approval" || !live || live === "pending") return outcome;
  return { ...outcome, kind: live === "denied" ? "declined" : live };
}

/** What a cutex call that waits for the owner names: the delegation it created, the approval (agent_create, services, …). */
export function approvalSubject(item: RawItem): ApprovalSubject {
  const r = toolResult(item);
  const inner = r && typeof r.result === "object" && r.result !== null && !Array.isArray(r.result) ? r.result as Record<string, unknown> : null;
  const id = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    delegationId: resultDelegationId(inner) ?? resultDelegationId(r),
    approvalId: approvalOfTool(item)?.approvalId ?? id(inner?.approval_id) ?? id(r?.approval_id),
  };
}
