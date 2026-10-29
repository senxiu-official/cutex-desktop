// Desktop view models projected by the typed main adapter; not canonical daemon protocol.
export interface DelegationRef { hostId: string; id: string }
export interface UpgradeParty extends DelegationRef { name: string }
export type UpgradeTreeParty = UpgradeParty | { kind: "owner" } | { kind: "redacted"; reason: string };
export type UpgradeActor =
  | { kind: "owner"; hostId: null; sessionId: null; name: null; redacted: false }
  | { kind: "agent"; hostId: string; sessionId: string; name: string | null; redacted: false }
  | { kind: "agent"; hostId: null; sessionId: null; name: null; redacted: true };
export interface UpgradeContinuation {
  state: "declared" | "waiting" | "ready" | "resuming" | "limited" | "cancelled";
  roundNumber: number; maxRounds: number; maxElapsedSeconds: number;
  waitingFor: { kind: "after"; delaySeconds: number } | { kind: "children"; children: { kind: "delegation" | "native"; id: string }[]; until: "all" | "any" } | null; nextWakeAt: string | null; limitReason: string | null; revision: number;
}
export interface UpgradeApproval {
  id: string; state: "pending" | "approved" | "denied" | "stale" | "cancelled";
  requestDigest: string; policyRevision: number; authorityEpoch: number; revision: number;
  requestedBy: UpgradeActor; decidedBy: UpgradeActor | null; decisionAuthority: "owner" | "director" | null;
  decisionNote: string | null; createdAt: string; decidedAt: string | null;
  allowedActions: { approve: boolean; deny: boolean };
}
/** Full management read; compact tree identity is never decision authority. */
export type UpgradeCompactApproval = Pick<UpgradeApproval, "id" | "state" | "revision">;
export interface UpgradeApprovalRead extends UpgradeApproval {
  projectId: string; delegationRef: DelegationRef;
}
export interface UpgradeOperationReceipt {
  schema: "cutex.delegation-operation.v1";
  actionId: string; operationId: string; operation: string; requestDigest: string;
  status: "pending" | "completed"; effectState: "none" | "partial" | "committed" | "unknown";
  outcomeUnknown: boolean; revision: number; updatedAt: string;
}
export interface UpgradeOperationLookup {
  schema: "cutex.delegation-operation.v1"; actionId: string;
  status: "found" | "unknown" | "notFound"; outcomeUnknown: boolean;
  result: { receipt: UpgradeOperationReceipt; [field: string]: unknown } | null;
}
export interface UpgradeNode {
  kind: "delegation"; id: string; hostId: string; projectId: string; ref: DelegationRef;
  parent: DelegationRef | null; parentState: "none" | "visible" | "redacted" | "unknown";
  redactedParentRef: { placeholderId: string } | null;
  root: DelegationRef | null; rootState: "visible" | "redacted" | "unknown";
  redactedRootRef: { placeholderId: string } | null;
  followUp: DelegationRef | null; followUpState: "none" | "visible" | "redacted" | "unknown";
  parentId: string | null; rootId: string | null; followUpOf: string | null; parentAttemptId: string | null;
  lineageState: "verified" | "legacyUnknown"; redactedParent: boolean;
  requester: UpgradeTreeParty | null; target: UpgradeTreeParty; title: string;
  execution: "running" | "queued" | "answered" | "interrupted";
  closed: string | null; lastActivityAt: string | null;
  resumeEvidence: { kind: "none" | "newAttempt" | "restartRecovery" | "unknown" };
  continuation: UpgradeContinuation | null; routingApproval: UpgradeApproval | UpgradeCompactApproval | null;
  allowedActions: { readAttempts: boolean; stop: boolean; stopSelf: boolean; stopJobs: boolean; declareContinuation: boolean; resumeContinuation: boolean }; revision: number;
}
export interface RedactedAncestor {
  kind: "redactedAncestor"; placeholderId: string; labelKey: "delegation.ancestorRestricted";
  reason: "notVisible"; expandable: false; allowedActions: Record<string, never>;
}
export type UpgradeTreeNode = UpgradeNode | RedactedAncestor;
export interface UpgradeUnresolvedEdge { from: DelegationRef; relation: "parent" | "root" | "followUp"; reason: "redacted" | "unavailable" | "legacyUnknown" }
export type LifecycleAction = "archive" | "restore" | "permanentRetire" | "start" | "send";
export interface UpgradeMember {
  id: string; hostId: string; name: string; director: boolean;
  lastActivityAt?: string | null; observedAt?: string; activityStatus?: "busy" | "idle" | "offline" | "unknown";
  archiveKind?: "active" | "soft" | "permanent" | "unknown"; restorable?: boolean;
  /** Lifecycle candidates, NOT caller authorization. */
  allowedActions?: LifecycleAction[]; restoreBlockers?: string[];
}
export interface UpgradeRunControl {
  excludedSessionIds?: string[]; membershipRevision?: number;
  epoch: number; phase: "running" | "pausing" | "paused" | "partial"; pauseId: string | null;
  mode: "afterTurn" | "interrupt"; scope: "members" | "all";
  allowedActions: { pause: boolean; pauseAll: boolean; resume: boolean };
}
export interface UpgradeGrant {
  id: string; projectId: string;
  rootDelegationRef: DelegationRef; requesterRef: DelegationRef; targetRefs: DelegationRef[];
  purpose: "review"; maxUses: number; usedCount: number; expiresAt: string | null; authorityEpoch: number;
  revision: number; revokedAt: string | null; allowedActions: { revoke: boolean };
}
export interface UpgradePanelSnapshot {
  projectId: string; revision: string; nodes: UpgradeTreeNode[]; nextCursor: string | null;
  coverage: "complete" | "partial" | "unknown"; unresolvedEdges: UpgradeUnresolvedEdge[];
  policy: { revision: number; memberMode: "approvalRequired" | "allowlistedOnly" | "open"; allowedActions: { update: boolean } };
  parties: UpgradeParty[];
  approvals: UpgradeApprovalRead[];
  runControl: UpgradeRunControl; members: UpgradeMember[];
  grants: { items: UpgradeGrant[]; allowedActions: { create: boolean } };
  interruptedDelegations: DelegationRef[];
  /** Preview adapter's authenticated entry context; not an invented SessionResource wire field. */
  caller: { isOwner: boolean; canManageMembers: boolean; canOfflineMembers: boolean };
}
/** Sections are absent when the daemon does not advertise their capability. No aggregate revision exists. */
export type UpgradeSnapshot = Pick<UpgradePanelSnapshot, "projectId" | "caller"> & Partial<Omit<UpgradePanelSnapshot, "projectId" | "caller">>;
export interface PermanentRetirementReviewRequest { cutex_session_id: string }
export interface PermanentRetirementReview {
  confirmation_token: string; cutex_session_id: string; formal_name: string; revision: number;
  runtime_generation: number; expires_at_unix: number;
}
export interface PermanentRetirementExecute {
  action_id: string; cutex_session_id: string; confirmed_name: string; confirmation_token: string; expected_revision: number;
}
export type UpgradeAction = { actionId: string } & (
  | { kind: "stop"; nodeId: string; nodeHostId: string; cascade: "descendants" | "none"; stopJobs: false; expectedRevision: number }
  | { kind: "pause"; mode: "afterTurn" | "interrupt"; scope: "members" | "all"; expectedEpoch: number }
  | { kind: "resume"; pauseId: string; expectedEpoch: number }
  | { kind: "decision"; approvalId: string; decision: "approve" | "deny"; expectedDigest: string; expectedRevision: number; decisionNote?: string | null }
  | { kind: "policy"; memberMode: UpgradePanelSnapshot["policy"]["memberMode"]; expectedRevision: number }
  | { kind: "grant"; requesterRef: DelegationRef; targetRefs: DelegationRef[]; rootDelegationRef: DelegationRef; maxUses: 1 }
  | { kind: "revoke"; grantId: string; expectedRevision: number }
  | { kind: "offline" | "archive" | "restore"; memberId: string }
  | { kind: "retire"; payload: Omit<PermanentRetirementExecute, "action_id"> }
  | { kind: "resumeContinuation"; nodeId: string; nodeHostId: string; expectedRevision: number }
);
export interface UpgradeResult { snapshot?: UpgradeSnapshot; readError?: string; rawResult?: unknown; retirementReceipt?: unknown; effectState: "none" | "partial" | "committed" | "unknown"; message?: string; retirementStage?: string; receipt?: UpgradeOperationReceipt }
type WithoutId<T> = T extends unknown ? Omit<T, "actionId"> : never;
export type UpgradeIntent = WithoutId<UpgradeAction>;
export interface UpgradeSectionProps {
  snapshot: UpgradePanelSnapshot; busy: boolean; onAction(intent: UpgradeIntent): Promise<void>;
  reviewRetirement?(request: PermanentRetirementReviewRequest): Promise<PermanentRetirementReview>;
  readApproval?(approvalId: string): Promise<UpgradeApprovalRead>;
  archiveSupported?: boolean;
  activitySupported?: boolean;
}
/** View-model adapter. Main composes capability-scoped reads; no aggregate daemon route is implied. */
export interface UpgradePreviewApi {
  delegationUpgradeSnapshot(projectId: string, cursor?: string): Promise<UpgradeSnapshot>;
  delegationUpgradeAction(projectId: string, action: UpgradeAction): Promise<UpgradeResult>;
  delegationUpgradeApproval?(approvalId: string): Promise<UpgradeApprovalRead>;
  delegationUpgradeOperation?(actionId: string): Promise<UpgradeOperationLookup>;
  delegationRetirementReview(projectId: string, request: PermanentRetirementReviewRequest): Promise<PermanentRetirementReview>;
}
