// 允许继续 outside the delegation tree (card / side detail / approvals page). The one place that builds a continuation
// decision: r296 hosts (delegation-continuation-approval-v1) get the approval's revision / digest / authority epoch
// (approve, or deny with a reason); older hosts keep the legacy {actionId, expectedRevision} resume. Both use the tree's
// shared unknown-outcome fence (lib/delegationOperations): an unconfirmed submit keeps its original action id until its
// receipt says committed or none; nothing here ever replays a write.
import type { ContinuationApprovalRead, ContinuationResumeRead, UpgradeAction, UpgradeResult } from "../../../shared/delegationUpgradePreview";
import { CONTINUATION_DECISION_REFUSALS } from "../../../shared/continuationRefusals";
import { delegationApi } from "./delegationStore";
import {
  isConfirmedUpgradeResult, isKnownNoneUpgradeResult, isUpgradePreconditionFailure, operationEntity, operationScope,
  projectOperations, unresolvedUpgradeActions, type PendingAction, type TrackedOperation,
} from "./delegationOperations";

/** allowed / denied: committed · notApplied: receipt none · changed: refused before any write (approval_changed …: read
 *  again) · confirmed: a checked receipt committed (approve or deny) · unknown: outcome unconfirmed (fenced until its
 *  receipt is checked). */
export type ResumeOutcome = "allowed" | "denied" | "confirmed" | "notApplied" | "changed" | "unknown";
export type ContinuationDecision = "approve" | "deny";

/** Fence scopes use "" for a project-less delegation. */
const projectKey = (projectId: string | null) => projectId ?? "";
/** The approvals page has no node host id: its own entity, matched together with the tree's `node:<host>:<id>`. */
const approvalEntity = (askId: string) => `continuation:${askId}`;

/** The unresolved operation that fences this delegation (its node on any host, its approval, or a legacy project marker). */
export function pendingResume(host: string, projectId: string | null, askId: string): TrackedOperation | null {
  return projectOperations(host, projectKey(projectId)).find((op) => op.entity === null || op.entity === approvalEntity(askId)
    || (op.entity.startsWith("node:") && op.entity.endsWith(`:${askId}`))) ?? null;
}

export function subscribePendingResume(listener: () => void): () => void {
  return unresolvedUpgradeActions.subscribe(listener);
}

async function fenced(scope: string, action: PendingAction, write: () => Promise<Pick<UpgradeResult, "effectState" | "receipt">>, decision: ContinuationDecision): Promise<ResumeOutcome> {
  unresolvedUpgradeActions.set(scope, action); // before the write: a lost answer leaves the fence
  try {
    const result = await write();
    if (isConfirmedUpgradeResult(result as UpgradeResult, action)) { unresolvedUpgradeActions.delete(scope, action.actionId); return decision === "deny" ? "denied" : "allowed"; }
    if (isKnownNoneUpgradeResult(result as UpgradeResult, action)) { unresolvedUpgradeActions.delete(scope, action.actionId); return "notApplied"; }
    return "unknown";
  } catch (error) {
    // The spec's refusals (bare codes from main) and the tree's own pre-write checks did nothing: lift the fence.
    if (isUpgradePreconditionFailure(error) || (error instanceof Error && CONTINUATION_DECISION_REFUSALS.has(error.message))) {
      unresolvedUpgradeActions.delete(scope, action.actionId); return "changed";
    }
    return "unknown";
  }
}

/** A decision on a card: the approval's own CAS on r296 hosts (approve, or deny with a reason); older hosts approve only,
 *  with the legacy continuation-revision resume. */
export async function submitContinuationResume(host: string, projectId: string | null, askId: string, read: ContinuationResumeRead,
  decision: ContinuationDecision = "approve", note: string | null = null): Promise<ResumeOutcome> {
  if (pendingResume(host, projectId, askId)) return "changed";
  const { approval } = read;
  if (approval) {
    const scope = operationScope(host, projectKey(projectId), operationEntity({ kind: "resumeContinuation", nodeId: askId, nodeHostId: read.nodeHostId }));
    const action: PendingAction = { kind: "resumeContinuation", actionId: crypto.randomUUID() };
    return fenced(scope, action, () => delegationApi(host).delegationContinuationDecision(projectId, {
      delegationId: askId, approvalId: approval.id, actionId: action.actionId, expectedRevision: approval.revision,
      expectedDigest: approval.digest, expectedEpoch: approval.authorityEpoch, decision, decisionNote: decision === "deny" ? note : null,
    }), decision);
  }
  // Older hosts: approve only, with the legacy continuation-revision resume.
  if (decision !== "approve" || read.expectedRevision === null || projectId === null) return "changed";
  const intent = { kind: "resumeContinuation" as const, nodeId: askId, nodeHostId: read.nodeHostId, expectedRevision: read.expectedRevision };
  const scope = operationScope(host, projectId, operationEntity(intent));
  const action: UpgradeAction = { ...intent, actionId: crypto.randomUUID() };
  return fenced(scope, action, () => delegationApi(host).delegationUpgradeAction(projectId, action), "approve");
}

/** A decision from the approvals page (approve, or deny with a reason of at most 200 characters). */
export async function decideContinuationApproval(host: string, approval: ContinuationApprovalRead, decision: ContinuationDecision, note: string | null): Promise<ResumeOutcome> {
  if (pendingResume(host, approval.projectId, approval.delegationId)) return "changed";
  const scope = operationScope(host, projectKey(approval.projectId), approvalEntity(approval.delegationId));
  const action: PendingAction = { kind: "resumeContinuation", actionId: crypto.randomUUID() };
  return fenced(scope, action, () => delegationApi(host).delegationContinuationDecision(approval.projectId, {
    delegationId: approval.delegationId, approvalId: approval.id, actionId: action.actionId, expectedRevision: approval.revision,
    expectedDigest: approval.digest, expectedEpoch: approval.authorityEpoch, decision, decisionNote: decision === "deny" ? note : null,
  }), decision);
}

/** Looks up the original action's receipt; only a definite answer lifts the fence. */
export async function checkContinuationResume(host: string, op: TrackedOperation): Promise<ResumeOutcome> {
  const { action } = op;
  try {
    const found = await delegationApi(host).delegationUpgradeOperation(action.actionId);
    const result = found.status === "found" && found.actionId === action.actionId && !found.outcomeUnknown && found.result
      ? { receipt: found.result.receipt, effectState: found.result.receipt.effectState } : null;
    if (result && isConfirmedUpgradeResult(result, action)) { unresolvedUpgradeActions.delete(op.scope, action.actionId); return "confirmed"; }
    if (result && isKnownNoneUpgradeResult(result, action)) { unresolvedUpgradeActions.delete(op.scope, action.actionId); return "notApplied"; }
  } catch { /* still unknown */ }
  return "unknown";
}

// r296 (review v2): an approval while the handler cannot run yet commits now and continues later. The card leaves the
// limited state at once, so it remembers the approval (this window, this session) to say 「已允许，等 X 空闲后继续」
// while the delegation still waits.
const approvedWaiting = new Set<string>();
const approvedListeners = new Set<() => void>();
const approvedKey = (host: string, askId: string) => `${host}\u0000${askId}`;
export function noteApprovedWaiting(host: string, askId: string): void {
  approvedWaiting.add(approvedKey(host, askId));
  for (const listener of approvedListeners) listener();
}
export function subscribeApprovedWaiting(listener: () => void): () => void {
  approvedListeners.add(listener);
  return () => { approvedListeners.delete(listener); };
}
export function isApprovedWaiting(host: string, askId: string): boolean {
  return approvedWaiting.has(approvedKey(host, askId));
}
