import { useEffect, useState } from "react";
import type { UpgradeAction, UpgradeApprovalRead, UpgradeGrant, UpgradeIntent, UpgradePanelSnapshot, UpgradeParty, UpgradeSnapshot } from "../../../../shared/delegationUpgradePreview";
import { isUpgradeApprovalRead, isUpgradeSnapshotComplete, panelSnapshotOf } from "./upgradeContract";
import { canUpgradeAction } from "./upgradeActions";
import { canDecideApprovals } from "../../lib/approvals";
import { featuresOf, useApp } from "../../store";
import { hostAccessNow } from "../../lib/hostAccess";
import { hostApi } from "../../lib/hostLists";
import { captureHostAction, onHostReset } from "../../lib/hostSwitch";
import { refreshDelegation, refreshOpenDelegations } from "../../lib/delegationStore";
import { beginRoutingWrite, endRoutingWrite, readRoutingReview, refreshRoutingReviews, routingActionScope, useRoutingRevision } from "../../lib/routingReviews";
import { isConfirmedUpgradeResult, isKnownNoneUpgradeResult, isUpgradePreconditionFailure, unresolvedUpgradeActions as unresolved } from "../../lib/delegationOperations";

const CAPS = { treeStop: true, routing: true, runControl: false, continuation: false, activity: false, retirement: false };
const MAX_PAGES = 8;
const MAX_NODES = 4096;
const cache = new Map<string, UpgradePanelSnapshot>();
const reads = new Map<string, Promise<UpgradePanelSnapshot>>();
// A committed grant must not be recreated while the ask's state/event is still catching up.
const committed = new Set<string>();
const submitted = new Map<string, string>();
let generation = 0;
onHostReset(() => { generation++; cache.clear(); reads.clear(); });

export type ReviewerGrantIntent = Extract<UpgradeIntent, { kind: "grant" }>;
export interface ReviewerGrantScope {
  intent: ReviewerGrantIntent;
  requester: UpgradeParty;
  target: UpgradeParty;
  root: { hostId: string; id: string; title: string };
  key: string;
}
export type ReviewerGrantState =
  | { kind: "unavailable" }
  | { kind: "waiting" }
  | { kind: "available"; scope: ReviewerGrantScope; grant: UpgradeGrant }
  | { kind: "needed"; scope: ReviewerGrantScope };

const same = (a: { hostId: string; id: string }, b: { hostId: string; id: string }) => a.hostId === b.hostId && a.id === b.id;
const authority = (host: string) => JSON.stringify(hostAccessNow(host));
const approvalKey = (host: string, record: UpgradeApprovalRead) => JSON.stringify([host, record.projectId, record.delegationRef, record.id, record.revision, record.requestDigest]);

export function canCreateReviewerGrant(host: string): boolean {
  const access = hostAccessNow(host), features = featuresOf(useApp.getState(), host);
  return access.isOwner && canDecideApprovals(features, access) && features.has("delegation-review-refs")
    && features.has("delegation-routing-v1") && features.has("delegation-tree-stop-v1");
}

/** Select only server-provided references. In particular, an unknown root is never the child itself. */
export function reviewerGrantState(snapshot: UpgradeSnapshot, record: UpgradeApprovalRead, now = Date.now()): ReviewerGrantState {
  if (!isUpgradeApprovalRead(record) || !isUpgradeSnapshotComplete(snapshot, CAPS) || snapshot.projectId !== record.projectId || !snapshot.caller.isOwner) return { kind: "unavailable" };
  const panel = panelSnapshotOf(snapshot);
  // An unreadable grant cannot be treated as an empty list and authorize another creation.
  if (!Number.isSafeInteger(panel.policy.revision) || panel.policy.revision < 0 || !panel.grants.items.every(value =>
    value.projectId === record.projectId && typeof value.id === "string" && value.id.length > 0 && value.purpose === "review"
    && Number.isSafeInteger(value.maxUses) && value.maxUses > 0 && Number.isSafeInteger(value.usedCount) && value.usedCount >= 0
    && Number.isSafeInteger(value.authorityEpoch) && value.authorityEpoch >= 0
    && (value.expiresAt === null || typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)))
    && (value.revokedAt === null || typeof value.revokedAt === "string" && Number.isFinite(Date.parse(value.revokedAt))))) return { kind: "unavailable" };
  const approval = panel.approvals.find(value => value.id === record.id && same(value.delegationRef, record.delegationRef));
  if (record.state !== "approved" || !approval || approval.state !== "approved" || approval.revision !== record.revision
    || approval.requestDigest !== record.requestDigest || approval.authorityEpoch !== record.authorityEpoch
    || record.policyRevision !== panel.policy.revision || approval.policyRevision !== panel.policy.revision) return { kind: "unavailable" };
  const node = panel.nodes.find(value => value.kind === "delegation" && same(value.ref, record.delegationRef));
  if (!node || node.kind !== "delegation" || node.projectId !== record.projectId) return { kind: "unavailable" };
  if (node.closed !== null || node.execution !== "pendingReview") return { kind: "waiting" };
  if (node.lineageState !== "verified" || node.rootState !== "visible" || !node.root || node.redactedRootRef
    || !node.requester || !("hostId" in node.requester) || !("id" in node.requester)
    || !("hostId" in node.target) || !("id" in node.target)) return { kind: "unavailable" };
  const root = panel.nodes.find(value => value.kind === "delegation" && same(value.ref, node.root!));
  if (!root || root.kind !== "delegation" || root.projectId !== record.projectId || root.closed !== null
    || root.lineageState !== "verified" || root.parentState !== "none" || root.parent !== null || root.redactedParent
    || root.rootState !== "visible" || !root.root || !same(root.root, root.ref)) return { kind: "unavailable" };
  const requester = panel.parties.find(party => same(party, node.requester as UpgradeParty));
  const target = panel.parties.find(party => same(party, node.target as UpgradeParty));
  if (!requester || !target || same(requester, target)) return { kind: "unavailable" };
  const intent: ReviewerGrantIntent = { kind: "grant", requesterRef: { hostId: requester.hostId, id: requester.id },
    targetRefs: [{ hostId: target.hostId, id: target.id }], rootDelegationRef: { ...root.ref }, maxUses: 1 };
  const scope: ReviewerGrantScope = { intent, requester, target, root: { ...root.ref, title: root.title },
    key: JSON.stringify([record.id, record.revision, record.requestDigest, record.authorityEpoch, panel.policy.revision, intent]) };
  const matching = panel.grants.items.filter(value => value.projectId === record.projectId && value.purpose === "review"
    && same(value.requesterRef, intent.requesterRef) && same(value.rootDelegationRef, intent.rootDelegationRef)
    && value.targetRefs.some(ref => same(ref, target)));
  // Older bridges can omit policyRevision. Unknown metadata for this scope is not absence.
  if (matching.some(value => !Number.isSafeInteger(value.policyRevision) || value.policyRevision! < 0)) return { kind: "unavailable" };
  const grant = matching.find(value => value.policyRevision === panel.policy.revision && value.revokedAt === null
    && value.authorityEpoch === record.authorityEpoch && Number.isSafeInteger(value.maxUses) && Number.isSafeInteger(value.usedCount)
    && value.usedCount >= 0 && value.maxUses > value.usedCount
    && (value.expiresAt === null || Date.parse(value.expiresAt) > now));
  if (grant) return { kind: "available", scope, grant };
  return canUpgradeAction(panel, intent, CAPS) ? { kind: "needed", scope } : { kind: "unavailable" };
}

/** One bounded project read is shared by every row/card. Fresh preflight bypasses the display cache. */
export function readReviewerGrantSnapshot(host: string, project: string, options: { fresh?: boolean; revision?: number } = {}): Promise<UpgradePanelSnapshot> {
  if (!canCreateReviewerGrant(host)) return Promise.reject(Error("grant_not_allowed"));
  const access = authority(host), current = captureHostAction(host), token = generation;
  const key = JSON.stringify([host, project, access, options.revision ?? 0, token]);
  if (!options.fresh && cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (!options.fresh && reads.has(key)) return reads.get(key)!;
  const valid = () => current() && token === generation && access === authority(host) && canCreateReviewerGrant(host);
  const pending = (async () => {
    let merged: UpgradePanelSnapshot | null = null;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let resources: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (!valid()) throw Error("context_changed");
      const value = await hostApi(host).delegationUpgradeSnapshot(project, cursor);
      if (!valid()) throw Error("context_changed");
      if (!isUpgradeSnapshotComplete(value, CAPS) || value.projectId !== project || !value.caller.isOwner) throw Error("grant_scope_unavailable");
      const next = panelSnapshotOf(value);
      const signature = JSON.stringify([next.policy, next.grants, next.parties, next.approvals, next.caller]);
      if (merged && (merged.revision !== next.revision || resources !== signature)) throw Error("grant_scope_changed");
      resources = signature;
      merged = merged ? { ...next, nodes: [...new Map([...merged.nodes, ...next.nodes].map(node =>
        [node.kind === "delegation" ? JSON.stringify([node.kind, node.hostId, node.id]) : JSON.stringify([node.kind, node.placeholderId]), node])).values()],
        unresolvedEdges: [...merged.unresolvedEdges, ...next.unresolvedEdges] } : next;
      if (merged.nodes.length > MAX_NODES) throw Error("grant_scope_unavailable");
      if (next.nextCursor === null) {
        if (!options.fresh) {
          if (cache.size >= 32) cache.delete(cache.keys().next().value!);
          cache.set(key, merged);
        }
        return merged;
      }
      if (!next.nextCursor || cursors.has(next.nextCursor)) throw Error("grant_scope_unavailable");
      cursors.add(next.nextCursor); cursor = next.nextCursor;
    }
    throw Error("grant_scope_unavailable");
  })().finally(() => { if (reads.get(key) === pending) reads.delete(key); });
  if (!options.fresh) reads.set(key, pending);
  return pending;
}

export function useReviewerGrant(host: string, record: UpgradeApprovalRead, enabled: boolean) {
  const revision = useRoutingRevision();
  const access = authority(host);
  const key = JSON.stringify([host, record.projectId, record.id, record.revision, record.requestDigest, revision, access, enabled]);
  const [state, setState] = useState<{ key: string; snapshot: UpgradePanelSnapshot | null; error: boolean }>({ key: "", snapshot: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void readReviewerGrantSnapshot(host, record.projectId, { revision }).then(snapshot => {
      if (live) setState({ key, snapshot, error: false });
    }, () => { if (live) setState({ key, snapshot: null, error: true }); });
    return () => { live = false; };
  }, [key]);
  return { ...(state.key === key ? state : { snapshot: null, error: false }),
    committed: committed.has(approvalKey(host, record)) };
}

async function refreshAfterGrant(host: string, record: UpgradeApprovalRead): Promise<void> {
  cache.clear(); refreshRoutingReviews();
  await Promise.allSettled([refreshOpenDelegations(host), refreshDelegation(host, record.delegationRef.id)]);
}

/** The armed scope is re-read and compared before creating exactly one durable action. */
export async function createReviewerGrant(host: string, record: UpgradeApprovalRead, shown: ReviewerGrantScope): Promise<"created" | "available"> {
  const scope = routingActionScope(host, record.projectId);
  if (!canCreateReviewerGrant(host) || committed.has(approvalKey(host, record)) || !beginRoutingWrite(host, record.projectId)) throw Error("grant_not_allowed");
  const current = captureHostAction(host), access = authority(host);
  let action: Extract<UpgradeAction, { kind: "grant" }> | null = null;
  const valid = () => current() && access === authority(host) && canCreateReviewerGrant(host);
  try {
    const [snapshot, latest] = await Promise.all([
      readReviewerGrantSnapshot(host, record.projectId, { fresh: true }),
      readRoutingReview(host, { kind: "routing", projectId: record.projectId, approvalId: record.id }, true),
    ]);
    if (!valid()) throw Error("context_changed");
    if (latest.state !== "approved" || latest.revision !== record.revision || latest.requestDigest !== record.requestDigest
      || !same(latest.delegationRef, record.delegationRef)) throw Error("grant_scope_changed");
    const selection = reviewerGrantState(snapshot, latest);
    if ((selection.kind !== "needed" && selection.kind !== "available") || selection.scope.key !== shown.key) throw Error("grant_scope_changed");
    if (selection.kind === "available") { await refreshAfterGrant(host, record); return "available"; }
    if (unresolved.has(scope)) throw Error("outcome_unknown");
    action = { ...selection.scope.intent, actionId: crypto.randomUUID() };
    unresolved.set(scope, action);
    submitted.set(action.actionId, approvalKey(host, record));
    if (!valid()) { unresolved.delete(scope, action.actionId); submitted.delete(action.actionId); action = null; throw Error("context_changed"); }
    const result = await hostApi(host).delegationUpgradeAction(record.projectId, action);
    if (!valid()) throw Error("context_changed");
    if (isKnownNoneUpgradeResult(result, action)) { unresolved.delete(scope, action.actionId); throw Error("action_not_applied"); }
    if (!isConfirmedUpgradeResult(result, action)) throw Error("outcome_unknown");
    committed.add(approvalKey(host, record));
    unresolved.delete(scope, action.actionId);
    submitted.delete(action.actionId);
    await refreshAfterGrant(host, record);
    return "created";
  } catch (error) {
    if (action && isUpgradePreconditionFailure(error)) { unresolved.delete(scope, action.actionId); submitted.delete(action.actionId); }
    throw error;
  } finally { endRoutingWrite(host, record.projectId); refreshRoutingReviews(); }
}

/** Lookup only the original durable operation; unknown/notFound never permits a replacement write. */
export async function checkReviewerGrantOutcome(host: string, record: UpgradeApprovalRead): Promise<void> {
  const scope = routingActionScope(host, record.projectId), action = unresolved.get(scope);
  if (!action || action.kind !== "grant" || !canCreateReviewerGrant(host)) return;
  const current = captureHostAction(host), access = authority(host);
  const result = await hostApi(host).delegationUpgradeOperation(action.actionId);
  if (!current() || access !== authority(host) || !canCreateReviewerGrant(host)) throw Error("context_changed");
  if (result.schema !== "cutex.delegation-operation.v1" || result.actionId !== action.actionId || result.status !== "found"
    || result.outcomeUnknown || !result.result) throw Error("outcome_unknown");
  const outcome = { receipt: result.result.receipt, effectState: result.result.receipt.effectState };
  const applied = isConfirmedUpgradeResult(outcome, action);
  if (!applied && !isKnownNoneUpgradeResult(outcome, action)) throw Error("outcome_unknown");
  // The project fence can belong to a different row/panel; never attribute its grant to this ask.
  const binding = submitted.get(action.actionId);
  if (applied && action.kind === "grant" && binding) committed.add(binding);
  submitted.delete(action.actionId);
  unresolved.delete(scope, action.actionId);
  await refreshAfterGrant(host, record);
}
