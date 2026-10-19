// Sending an owner decision (cutex owner-approvals) to the record's host, and the owner review of a
// delegation decided where the delegation shows (its card, the target's queue row, the side detail):
// the same pending record and the same daemon call as the 审批 page (modules/approvals PendingCard),
// never a second decision path. Store bindings; the pure parts are in lib/approvals.
import { useEffect, useMemo } from "react";
import type { ApprovalDecision, ApprovalDecisionOrigin, ApprovalDecisionResult, ApprovalRecord } from "../../../shared/ipc";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { bridge } from "../bridge";
import { featuresOf, useApp } from "../store";
import { APPROVAL_DECIDED_BY_FEATURE, APPROVALS_FEATURE, approvalDecisionTrace, askReviewApproval, canDecideApprovals } from "./approvals";
import { useHostAccess } from "./hostAccess";
import { hostApi } from "./hostLists";
import { hostData } from "./hostScope";

/**
 * One decision to `hostId`: the focus host's through the store (it drops the record from its list at
 * once), another host's straight to that host (its list follows `cutex/approvals/changed`). `where`:
 * cutex approval-decided-by facts, only for a cutex that has it (an older one refuses `client`).
 */
export function sendApprovalDecision(hostId: string, approvalId: string, decision: ApprovalDecision, note?: string, where?: ApprovalDecisionOrigin): Promise<ApprovalDecisionResult> {
  const s = useApp.getState();
  return hostId === (s.hosts?.active ?? LOCAL_HOST_ID) ? s.decideApproval(approvalId, decision, note, where) : hostApi(hostId).decideApproval(approvalId, decision, note, where);
}

/** A decision made on this desktop: the one local trace line (errors.jsonl `reported`), then the call. */
export function decideApprovalOn(hostId: string, record: ApprovalRecord, decision: ApprovalDecision, how: ApprovalDecisionOrigin, note?: string): Promise<ApprovalDecisionResult> {
  bridge.shell?.logError({ kind: "reported", message: approvalDecisionTrace(record, decision, how, hostId) }).catch(() => {});
  const where = featuresOf(useApp.getState(), hostId).has(APPROVAL_DECIDED_BY_FEATURE) ? how : undefined;
  return sendApprovalDecision(hostId, record.approvalId, decision, note, where);
}

export interface AskReview {
  /** The pending `ask_delivery` approval of the delegation (null: list not loaded, or none). */
  record: ApprovalRecord | null;
  /** This connection may decide approvals on the host (owner, owner-approvals, full device scope). */
  canDecide: boolean;
  /** The host has the 审批 page (owner-approvals in this connection's feature set). */
  approvalsPage: boolean;
}

/** Reloads asked for (host + askId), once per desktop run. */
const reloaded = new Set<string>();

/**
 * The owner review of `askId` on `hostId` (the host whose record it is). `active`: the delegation
 * waits for this owner's review (lib/delegations awaitsOwnerReview); otherwise nothing is read. A
 * record missing from a loaded list (an older cutex without approvals-live, or a list read before the
 * review was filed) reloads the host's list once.
 */
export function useAskReview(hostId: string, askId: string, active: boolean): AskReview {
  const access = useHostAccess(hostId);
  const features = useApp((s) => featuresOf(s, hostId));
  const list = useApp((s) => (active ? (hostData(s, hostId)?.approvals ?? null) : null));
  const refreshOn = useApp((s) => s.refreshApprovalsOn);
  const record = useMemo(() => (active ? askReviewApproval(list, askId) : null), [active, list, askId]);
  const canDecide = active && canDecideApprovals(features, access);
  const missing = canDecide && !record;
  useEffect(() => {
    const key = `${hostId}\n${askId}`;
    if (!missing || reloaded.has(key)) return;
    reloaded.add(key);
    void refreshOn(hostId);
  }, [missing, hostId, askId, refreshOn]);
  return { record, canDecide, approvalsPage: features.has(APPROVALS_FEATURE) };
}
