import { isUpgradeApprovalRead } from "../../lib/delegationApprovalRead";
export { isUpgradeApprovalRead } from "../../lib/delegationApprovalRead";
import type { DelegationUpgradeCapabilities } from "./upgradeCapabilities";
import type { UpgradeSnapshot, UpgradePanelSnapshot } from "./upgradeTypes";
// Conservative view-model gate at the adapter boundary. No role inference or repairs.
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.length > 0;
const nullableText = (value: unknown) => value === null || typeof value === "string";
const ref = (value: unknown): value is { hostId: string; id: string } => object(value) && text(value.hostId) && text(value.id);
const nullableRef = (value: unknown) => value === null || ref(value);
const flags = (value: unknown, keys: readonly string[]) => object(value) && keys.every(key => typeof value[key] === "boolean");
const placeholderRef = (value: unknown) => object(value) && text(value.placeholderId);
const sameRef = (a: unknown, b: unknown) => ref(a) && ref(b) && a.hostId === b.hostId && a.id === b.id;
function actor(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === "owner") return value.hostId === null && value.sessionId === null && value.name === null && value.redacted === false;
  if (value.kind !== "agent") return false;
  return value.redacted === true ? value.hostId === null && value.sessionId === null && value.name === null
    : value.redacted === false && text(value.hostId) && text(value.sessionId) && nullableText(value.name);
}
function node(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === "redactedAncestor") return Object.keys(value).length === 6 && text(value.placeholderId)
    && value.labelKey === "delegation.ancestorRestricted" && value.reason === "notVisible" && value.expandable === false
    && object(value.allowedActions) && Object.keys(value.allowedActions).length === 0;
  if (value.kind !== "delegation" || !sameRef(value.ref, value) || !nullableRef(value.parent) || !nullableRef(value.root) || !nullableRef(value.followUp)) return false;
  if (!["none", "visible", "redacted", "unknown"].includes(String(value.parentState)) || !["visible", "redacted", "unknown"].includes(String(value.rootState))
    || !["none", "visible", "redacted", "unknown"].includes(String(value.followUpState))) return false;
  if ((value.parentState === "visible") !== ref(value.parent) || (value.rootState === "visible") !== ref(value.root)
    || (value.followUpState === "visible") !== ref(value.followUp)) return false;
  if (value.redactedParent !== (value.parentState === "redacted")) return false;
  if (value.parentState === "redacted" ? !placeholderRef(value.redactedParentRef) : value.redactedParentRef !== null) return false;
  if (value.rootState === "redacted" ? !placeholderRef(value.redactedRootRef) : value.redactedRootRef !== null) return false;
  if (![value.parentId, value.rootId, value.followUpOf, value.parentAttemptId].every(nullableText)) return false;
  for (const [reference, legacy] of [[value.parent, value.parentId], [value.root, value.rootId], [value.followUp, value.followUpOf]]) {
    if (ref(reference) && reference.hostId === value.hostId ? legacy !== reference.id : legacy !== null) return false;
  }
  if (value.parentState !== "visible" && value.parentAttemptId !== null) return false;
  if (!flags(value.allowedActions, ["readAttempts", "stop", "stopSelf", "stopJobs", "declareContinuation", "resumeContinuation"])) return false;
  const approval = value.routingApproval;
  if (approval !== null && (!object(approval) || !text(approval.id) || !Number.isSafeInteger(approval.revision)
    || !["pending", "approved", "denied", "stale", "cancelled"].includes(String(approval.state)))) return false;
  if (object(approval) && "allowedActions" in approval && (!flags(approval.allowedActions, ["approve", "deny"]) || !actor(approval.requestedBy)
    || !(approval.decidedBy === null || actor(approval.decidedBy)) || ![null, "owner", "director"].includes(approval.decisionAuthority as string | null)
    || !nullableText(approval.decisionNote) || !nullableText(approval.decidedAt))) return false;
  return true;
}
export function isUpgradeSnapshotComplete(value: unknown, caps?: DelegationUpgradeCapabilities): value is UpgradeSnapshot {
  if (!object(value) || !text(value.projectId) || !flags(value.caller, ["isOwner", "canManageMembers", "canOfflineMembers"])) return false;
  const raw = value;
  if (caps?.treeStop && (!["revision", "nodes", "nextCursor", "coverage", "unresolvedEdges"].every(key => Object.hasOwn(raw, key)))) return false;
  if (caps?.routing && (!object(value.policy) || !object(value.grants) || !Array.isArray(value.approvals) || !Array.isArray(value.parties))) return false;
  if (caps?.runControl && !object(value.runControl)) return false;
  for (const key of ["nodes", "unresolvedEdges", "policy", "grants", "runControl", "members", "parties", "approvals", "interruptedDelegations"]) {
    if (key in value && (value[key] === null || value[key] === undefined)) return false;
  }
  if (value.approvals !== undefined && (!Array.isArray(value.approvals) || !value.approvals.every(isUpgradeApprovalRead))) return false;
  if (value.revision !== undefined && typeof value.revision !== "string") return false;
  value = panelSnapshotOf(value as unknown as UpgradeSnapshot);
  if (!object(value) || !Array.isArray(value.nodes) || !value.nodes.every(node) || !Array.isArray(value.unresolvedEdges)
    || !value.unresolvedEdges.every(edge => object(edge) && ref(edge.from) && ["parent", "root", "followUp"].includes(String(edge.relation)) && ["redacted", "unavailable", "legacyUnknown"].includes(String(edge.reason)))) return false;
  const placeholders = new Set(value.nodes.filter(entry => object(entry) && entry.kind === "redactedAncestor").map(entry => object(entry) ? entry.placeholderId : null));
  for (const entry of value.nodes) {
    if (!object(entry) || entry.kind !== "delegation") continue;
    for (const boundary of [entry.redactedParentRef, entry.redactedRootRef]) {
      if (object(boundary) && !placeholders.has(boundary.placeholderId)) return false;
    }
    if (object(entry.redactedParentRef) && object(entry.redactedRootRef) && entry.redactedParentRef.placeholderId === entry.redactedRootRef.placeholderId) return false;
  }
  if (!object(value.policy) || !flags(value.policy.allowedActions, ["update"]) || !object(value.runControl) || !flags(value.runControl.allowedActions, ["pause", "pauseAll", "resume"])) return false;
  if (!object(value.grants) || !flags(value.grants.allowedActions, ["create"]) || !Array.isArray(value.grants.items)
    || !value.grants.items.every(grant => object(grant) && flags(grant.allowedActions, ["revoke"]) && ref(grant.rootDelegationRef) && ref(grant.requesterRef) && Array.isArray(grant.targetRefs) && grant.targetRefs.every(ref))) return false;
  return flags(value.caller, ["isOwner", "canManageMembers", "canOfflineMembers"]) && Array.isArray(value.members)
    && value.members.every(member => {
      if (!object(member) || !text(member.id) || !text(member.hostId) || !text(member.name) || typeof member.director !== "boolean") return false;
      const activity = caps?.activity || ["lastActivityAt", "observedAt", "activityStatus"].some(key => key in member);
      const lifecycle = caps?.retirement || ["archiveKind", "restorable", "restoreBlockers", "allowedActions"].some(key => key in member);
      if (activity && (!nullableText(member.lastActivityAt) || !text(member.observedAt) || !["busy", "idle", "offline", "unknown"].includes(String(member.activityStatus)))) return false;
      if (lifecycle && (!["active", "soft", "permanent", "unknown"].includes(String(member.archiveKind)) || typeof member.restorable !== "boolean"
        || !Array.isArray(member.restoreBlockers) || !member.restoreBlockers.every(item => typeof item === "string")
        || !Array.isArray(member.allowedActions) || !member.allowedActions.every(item => typeof item === "string"))) return false;
      return true;
    })
    && Array.isArray(value.parties) && value.parties.every(party => object(party) && text(party.name) && ref(party))
    && Array.isArray(value.interruptedDelegations) && value.interruptedDelegations.every(ref);
}

/** Empty denied placeholders adapt the frozen panel. They are never sent as server authority. */
export function panelSnapshotOf(value: UpgradeSnapshot): UpgradePanelSnapshot {
  return {
    ...value, revision: value.revision ?? "", nodes: value.nodes ?? [], nextCursor: value.nextCursor ?? null,
    coverage: value.coverage ?? "unknown", unresolvedEdges: value.unresolvedEdges ?? [],
    policy: value.policy ?? { revision: 0, memberMode: "approvalRequired", allowedActions: { update: false } },
    runControl: value.runControl ?? { epoch: 0, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: false, pauseAll: false, resume: false } },
    parties: value.parties ?? [],
    approvals: value.approvals ?? [],
    grants: value.grants ?? { items: [], allowedActions: { create: false } }, members: value.members ?? [], interruptedDelegations: value.interruptedDelegations ?? [],
  };
}
