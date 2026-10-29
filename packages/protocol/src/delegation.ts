/** r266 Management wire DTOs. No desktop role/permission inference. Backend df47f1c1. */
export const DELEGATION_CAPABILITIES = {
  routing: "delegation-routing-v1", tree: "delegation-tree-stop-v1", runControl: "project-run-control-v1",
  continuation: "delegation-continuation-v1", activity: "agent-activity-v1", settlement: "agent-bus-message-settlement-v1",
} as const;
export type DelegationCapability = typeof DELEGATION_CAPABILITIES[keyof typeof DELEGATION_CAPABILITIES];
export interface DelegationRef { hostId: string; id: string }
export interface DelegationActorAudit { kind: "owner" | "agent"; hostId: string | null; sessionId: string | null; name: string | null; redacted: boolean }
export type DelegationMemberMode = "approvalRequired" | "allowlistedOnly" | "open";
export interface DelegationPolicy { projectId: string; revision: number; memberMode: DelegationMemberMode; updatedBy: DelegationActorAudit | null; updatedAt: string | null; allowedActions: { update: boolean } }
export interface DelegationApproval {
  id: string; projectId: string; delegationRef: DelegationRef; requestDigest: string; policyRevision: number; authorityEpoch: number; revision: number;
  state: "pending" | "approved" | "denied" | "stale" | "cancelled"; requestedBy: DelegationActorAudit;
  decidedBy: DelegationActorAudit | null; decisionAuthority: "owner" | "director" | null; decisionNote: string | null;
  createdAt: string; decidedAt: string | null; allowedActions: { approve: boolean; deny: boolean };
}
export interface DelegationGrant {
  id: string; projectId: string; requesterRef: DelegationRef; targetRefs: DelegationRef[]; rootDelegationRef: DelegationRef;
  purpose: "review"; maxUses: number; usedCount: number; expiresAt: string | null; authorityEpoch: number; policyRevision: number;
  revision: number; createdBy: DelegationActorAudit; createdAt: string; revokedBy: DelegationActorAudit | null; revokedAt: string | null;
  rootClosedAt: string | null; allowedActions: { revoke: boolean };
}
export interface DelegationGrants { grants: DelegationGrant[]; allowedActions: { create: boolean } }
export type DelegationParty = (DelegationRef & { name: string }) | { kind: "owner" } | { kind: "redacted"; reason: "crossHostIdentityUnverified" };
export interface DelegationContinuation {
  state: "declared" | "waiting" | "ready" | "resuming" | "limited" | "cancelled"; revision: number; budgetEpoch: number;
  roundNumber: number; startedAt: string; deadlineAt: string; nextWakeAt: string | null; limitReason: "rounds" | "elapsed" | null;
  cancelReason?: string | null; reconciling?: boolean; maxRounds: number; maxElapsedSeconds: number;
  waitingFor: { kind: "after"; delaySeconds: number } | { kind: "children"; children: { kind: "delegation" | "native"; id: string }[]; until: "all" | "any" } | null;
  sourceAttemptId: string | null;
}
export interface DelegationTreeNode {
  kind: "delegation"; ref: DelegationRef; id: string; hostId: string; projectId: string | null; requester: DelegationParty; target: DelegationParty;
  title: string; execution: "queued" | "running" | "answered" | "interrupted"; hold: string | null; review: string | null;
  parent: DelegationRef | null; parentState: "none" | "visible" | "redacted" | "unknown"; redactedParentRef: { placeholderId: string } | null;
  root: DelegationRef | null; rootState: "visible" | "redacted" | "unknown"; redactedRootRef: { placeholderId: string } | null;
  followUp: DelegationRef | null; followUpState: "none" | "visible" | "redacted" | "unknown"; redactedFollowUpRef: { placeholderId: string } | null;
  parentId: string | null; rootId: string | null; followUpOf: string | null; parentAttemptId: string | null; redactedParent: boolean;
  lineageState: "verified" | "legacyUnknown"; allowedActions: { readAttempts: boolean; stop: boolean; stopSelf: boolean; stopJobs: boolean; declareContinuation: boolean; resumeContinuation: boolean };
  closed: string | null; createdAt: string; updatedAt: string; revision: number; attemptId: string | null; attemptNumber: number | null;
  attemptStartedAt: string | null; lastActivityAt: string | null; activitySource: "attempt" | "unknown";
  continuation: DelegationContinuation | null; routingApproval: Pick<DelegationApproval, "id" | "state" | "revision"> | null;
  stop: { requestedAt: string; phase: "stopped" | "pending"; reason: string; operationId: string | null } | null;
  resumeEvidence: { kind: "none" | "newAttempt" | "restartRecovery" | "unknown" };
}
export interface DelegationRedactedAncestor { kind: "redactedAncestor"; placeholderId: string; labelKey: "delegation.ancestorRestricted"; reason: "notVisible"; expandable: false; allowedActions: Record<string, never> }
export interface DelegationTreePage {
  nodes: (DelegationTreeNode | DelegationRedactedAncestor)[]; nextCursor: string | null; revision: string; coverage: "complete" | "partial" | "unknown";
  unresolvedEdges: { from: DelegationRef; relation: "parent" | "root" | "followUp"; reason: "redacted" | "unavailable" | "legacyUnknown" }[];
}
export interface DelegationTreeQuery { cursor?: string; limit?: number; rootId?: string; rootHostId?: string }
export interface DelegationAttempts { items: { attemptId: string; attemptNumber: number; startedAt: string | null; endedAt: string | null; cause: string | null; actionId: null }[]; nextCursor: string | null }
export interface ProjectRunControl {
  projectId: string; epoch: number; pauseId: string | null; requestedBy: DelegationActorAudit | null; requestedAt: string | null;
  mode: "afterTurn" | "interrupt"; scope: "members" | "all"; membershipRevision: number; excludedSessionIds: string[]; interruptUnknown: string[];
  phase: "running" | "pausing" | "paused" | "partial"; allowedActions: { pause: boolean; pauseAll: boolean; resume: boolean };
}
export interface AgentActivityProjection { lastActivityAt: string | null; activitySource: "conversation" | "unknown"; observedAt: string; activityStatus: "busy" | "idle" | "offline" | "unknown"; idleThresholdSeconds: number; busySince?: string | null }
export interface DelegationOperationReceipt {
  schema: "cutex.delegation-operation.v1"; actionId: string; operationId: string; operation: string; requestDigest: string;
  status: "pending" | "completed"; effectState: "none" | "partial" | "committed" | "unknown"; outcomeUnknown: boolean; revision: number; updatedAt: string;
}
/** Operation-specific result retained without converting transport completion to effect success. */
export interface DelegationOperationResult { receipt: DelegationOperationReceipt; [field: string]: unknown }
export interface DelegationOperationLookup { schema: "cutex.delegation-operation.v1"; actionId: string; status: "found" | "unknown" | "notFound"; outcomeUnknown: boolean; result: DelegationOperationResult | null }
export type DelegationControlRequest =
 | { kind: "policy"; projectId: string; body: { actionId: string; expectedRevision: number; memberMode: DelegationMemberMode } }
 | { kind: "grant"; projectId: string; body: { actionId: string; requesterRef: DelegationRef; targetRefs: DelegationRef[]; rootDelegationRef: DelegationRef; purpose: "review"; maxUses: number; expiresAt: string | null } }
 | { kind: "revoke"; grantId: string; body: { actionId: string; expectedRevision: number } }
 | { kind: "decision"; approvalId: string; body: { actionId: string; decision: "approve" | "deny"; expectedDigest: string; expectedRevision: number; decisionNote: string | null } }
 | { kind: "stop"; delegationId: string; body: { actionId: string; cascade: "descendants" | "none"; stopJobs: boolean; expectedRevision: number } }
 | { kind: "pause"; projectId: string; body: { actionId: string; expectedEpoch: number; mode: "afterTurn" | "interrupt"; scope: "members" | "all" } }
 | { kind: "resume"; projectId: string; body: { actionId: string; pauseId: string; expectedEpoch: number } }
 | { kind: "resumeContinuation"; delegationId: string; body: { actionId: string; expectedRevision: number } };
export interface PermanentRetirementReviewRequest { cutex_session_id: string }
export interface PermanentRetirementReview { confirmation_token: string; cutex_session_id: string; formal_name: string; revision: number; runtime_generation: number; expires_at_unix: number }
export interface PermanentRetirementRequest { action_id: string; cutex_session_id: string; confirmed_name: string; confirmation_token: string; expected_revision: number }
export interface AgentArchiveReceipt {
 request: { reason: string | null; action_id: string; review: { cutex_session_id: string; formal_name: string; operation: "archive" | "restore" | "permanent_retire"; current_project_id: string | null; revision: number; runtime_generation: number } };
 request_sha256: string; stage: "prepared" | "stopped" | "committed" | "stopped_not_archived" | "uncertain" | "permanent_retirement_committed";
 result: Record<string, unknown> | null; error: string | null; committed_at: string; archiveKind?: "active" | "soft" | "permanent" | "unknown"; restorable?: boolean;
}
