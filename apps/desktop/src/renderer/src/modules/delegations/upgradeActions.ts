import { isUpgradeApprovalRead } from "./upgradeContract";
import type { UpgradeApprovalRead, UpgradeIntent, UpgradePanelSnapshot } from "./upgradeTypes";
import type { DelegationUpgradeCapabilities } from "./upgradeCapabilities";

/** UI availability is server permission intersected with explicit capability; never a role guess. */
export function canUpgradeAction(snapshot: UpgradePanelSnapshot, intent: UpgradeIntent, caps: DelegationUpgradeCapabilities): boolean {
  const node = "nodeId" in intent ? snapshot.nodes.find(node => node.kind === "delegation" && node.id === intent.nodeId && node.hostId === intent.nodeHostId) : undefined;
  const member = "memberId" in intent ? snapshot.members.find(member => member.id === intent.memberId) : undefined;
  switch (intent.kind) {
    case "stop": return caps.treeStop && node?.kind === "delegation" && node.closed === null && node.revision === intent.expectedRevision
      && (intent.cascade === "descendants" ? node.allowedActions.stop : node.allowedActions.stopSelf);
    case "pause": return caps.runControl && snapshot.runControl.epoch === intent.expectedEpoch
      && (intent.scope === "all" ? snapshot.caller.isOwner && snapshot.runControl.allowedActions.pauseAll : snapshot.runControl.allowedActions.pause);
    case "resume": return caps.runControl && snapshot.runControl.allowedActions.resume && snapshot.runControl.pauseId === intent.pauseId
      && snapshot.runControl.epoch === intent.expectedEpoch && (snapshot.runControl.scope !== "all" || snapshot.caller.isOwner);
    case "policy": return caps.routing && snapshot.policy.allowedActions.update && snapshot.policy.revision === intent.expectedRevision;
    // Compact approval allowedActions may be absent. Only the fresh full read authorizes the decision.
    case "decision": return caps.routing && snapshot.approvals.some(approval => approval.id === intent.approvalId);
    case "grant": return caps.routing && snapshot.grants.allowedActions.create && intent.maxUses === 1;
    case "revoke": return caps.routing && snapshot.grants.items.some(grant => grant.id === intent.grantId && grant.revision === intent.expectedRevision && grant.allowedActions.revoke);
    case "resumeContinuation": return caps.continuation && node?.kind === "delegation" && !node.closed && node.allowedActions.resumeContinuation
      && node.continuation?.revision === intent.expectedRevision && snapshot.runControl.phase === "running";
    case "offline": return caps.activity && snapshot.caller.canOfflineMembers && !!member && member.activityStatus === "idle"
      && typeof member.lastActivityAt === "string" && typeof member.observedAt === "string" && Date.parse(member.observedAt) - Date.parse(member.lastActivityAt) >= 7_200_000;
    case "archive": return caps.retirement && snapshot.caller.canManageMembers && !!member && member.allowedActions?.includes("archive") === true;
    case "restore": return caps.retirement && snapshot.caller.canManageMembers && !!member && member.restorable === true && member.allowedActions?.includes("restore") === true;
    case "retire": return caps.retirement && snapshot.caller.isOwner && snapshot.members.some(member => member.id === intent.payload.cutex_session_id && member.allowedActions?.includes("permanentRetire"));
  }
}
export function validApprovalRead(value: UpgradeApprovalRead, projectId: string, intent: Extract<UpgradeIntent, { kind: "decision" }>): boolean {
  return isUpgradeApprovalRead(value) && value.id === intent.approvalId && value.projectId === projectId && value.state === "pending"
    && typeof value.delegationRef?.hostId === "string" && typeof value.delegationRef.id === "string"
    && value.allowedActions?.[intent.decision] === true && value.requestDigest === intent.expectedDigest
    && value.revision === intent.expectedRevision && Number.isSafeInteger(value.revision);
}

export { PendingActions, unresolvedUpgradeActions, isUpgradePreconditionFailure, isConfirmedUpgradeResult, isKnownNoneUpgradeResult } from "../../lib/delegationOperations";
