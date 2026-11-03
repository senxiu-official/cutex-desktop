import { useEffect, useState, useSyncExternalStore } from "react";
import type { AskReviewReference } from "../../../shared/delegationReviews";
import type { ApprovalDecision } from "../../../shared/ipc";
import type { UpgradeAction, UpgradeApprovalRead } from "../../../shared/delegationUpgradePreview";
import { bridge } from "../bridge";
import { featuresOf, useApp } from "../store";
import { canDecideApprovals } from "./approvals";
import { hostAccessNow, hostAccessStore, useHostAccess } from "./hostAccess";
import { hostApi } from "./hostLists";
import { captureHostAction, onHostReset } from "./hostSwitch";
import { isUpgradeApprovalRead } from "./delegationApprovalRead";
import { isConfirmedUpgradeResult, isKnownNoneUpgradeResult, isUpgradePreconditionFailure, unresolvedUpgradeActions as unresolved } from "./delegationOperations";

export const ROUTING_REVIEW_FEATURE = "delegation-review-refs";
const listeners = new Set<() => void>();
let revision = 0;
const cache = new Map<string, UpgradeApprovalRead>();
const reads = new Map<string, Promise<UpgradeApprovalRead>>();
const writing = new Set<string>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function refreshRoutingReviews(): void {
  cache.clear(); revision++;
  for (const listener of listeners) listener();
}
export function useRoutingRevision(): number { return useSyncExternalStore(subscribe, () => revision, () => 0); }
onHostReset(refreshRoutingReviews);
hostAccessStore.subscribe(refreshRoutingReviews);
bridge.on("hostEvent", ({ envelope }) => {
  if (envelope.cutex?.method === "cutex/delegation/routingApprovalChanged" || envelope.cutex?.method === "cutex/access/changed") refreshRoutingReviews();
});

function authority(host: string): string { return JSON.stringify(hostAccessNow(host)); }
function permitted(host: string): boolean {
  const features = featuresOf(useApp.getState(), host);
  const access = hostAccessNow(host);
  return access.isOwner && features.has(ROUTING_REVIEW_FEATURE) && canDecideApprovals(features, access);
}
export async function readRoutingReview(host: string, ref: AskReviewReference, fresh = false): Promise<UpgradeApprovalRead> {
  if (ref.kind !== "routing" || !ref.projectId || !featuresOf(useApp.getState(), host).has(ROUTING_REVIEW_FEATURE)) throw Error("routing_review_unavailable");
  const current = captureHostAction(host), access = authority(host), version = revision;
  const key = JSON.stringify([host, access, version, ref.projectId, ref.approvalId]);
  if (!fresh && cache.has(key)) return cache.get(key)!;
  if (!fresh && reads.has(key)) return reads.get(key)!;
  const pending = hostApi(host).delegationUpgradeApproval(ref.approvalId).then(record => {
    if (!current() || access !== authority(host) || !featuresOf(useApp.getState(), host).has(ROUTING_REVIEW_FEATURE)) throw Error("context_changed");
    if (!isUpgradeApprovalRead(record) || record.id !== ref.approvalId || record.projectId !== ref.projectId) throw Error("approval_changed");
    if (version === revision) cache.set(key, record);
    return record;
  }).finally(() => { if (reads.get(key) === pending) reads.delete(key); });
  if (!fresh) reads.set(key, pending);
  return pending;
}

export function useRoutingReview(host: string, ref: AskReviewReference, enabled: boolean) {
  const version = useRoutingRevision();
  const access = useHostAccess(host);
  const accessKey = JSON.stringify(access);
  const key = JSON.stringify([host, ref.projectId, ref.approvalId, version, accessKey, enabled]);
  const [state, setState] = useState<{ key: string; record: UpgradeApprovalRead | null; error: boolean }>({ key: "", record: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void readRoutingReview(host, ref).then(record => live && setState({ key, record, error: false }), () => live && setState({ key, record: null, error: true }));
    return () => { live = false; };
  }, [key]); // The key includes host, reference, authority and connection-reset revision.
  return state.key === key ? state : { key, record: null, error: false };
}

export function routingActionScope(host: string, project: string): string { return JSON.stringify([host, project]); }
export function useRoutingOperation(host: string, project: string) {
  const scope = routingActionScope(host, project);
  return useSyncExternalStore(listener => unresolved.subscribe(listener), () => unresolved.get(scope) ?? null, () => null);
}

/** Serialize owner routing decisions and scoped one-use grant writes together. */
export function beginRoutingWrite(host: string, project: string): boolean {
  const scope = routingActionScope(host, project);
  if (!permitted(host) || unresolved.has(scope) || writing.has(scope)) return false;
  writing.add(scope);
  return true;
}

export function endRoutingWrite(host: string, project: string): void {
  writing.delete(routingActionScope(host, project));
}

/** The current full record authorizes the write; references and compact rows never provide CAS. */
export async function decideRoutingReviewOn(host: string, shown: UpgradeApprovalRead, decision: ApprovalDecision): Promise<void> {
  const scope = routingActionScope(host, shown.projectId);
  if (!beginRoutingWrite(host, shown.projectId)) throw Error("routing_not_authorized");
  const current = captureHostAction(host), access = authority(host);
  let action: Extract<UpgradeAction, { kind: "decision" }> | null = null;
  try {
    const latest = await readRoutingReview(host, { kind: "routing", projectId: shown.projectId, approvalId: shown.id }, true);
    if (!current() || access !== authority(host) || !permitted(host)) throw Error("context_changed");
    if (latest.state !== "pending" || !latest.allowedActions[decision] || latest.revision !== shown.revision || latest.requestDigest !== shown.requestDigest ||
        latest.delegationRef.hostId !== shown.delegationRef.hostId || latest.delegationRef.id !== shown.delegationRef.id) throw Error("approval_changed");
    action = { kind: "decision", actionId: crypto.randomUUID(), approvalId: latest.id, decision, expectedDigest: latest.requestDigest, expectedRevision: latest.revision, decisionNote: null };
    unresolved.set(scope, action);
    const result = await hostApi(host).delegationUpgradeAction(latest.projectId, action);
    if (!current() || access !== authority(host)) throw Error("context_changed");
    if (isConfirmedUpgradeResult(result, action)) unresolved.delete(scope, action.actionId);
    else if (isKnownNoneUpgradeResult(result, action)) { unresolved.delete(scope, action.actionId); throw Error("action_not_applied"); }
    else throw Error("outcome_unknown");
  } catch (error) {
    if (action && isUpgradePreconditionFailure(error)) unresolved.delete(scope, action.actionId);
    throw error;
  } finally { endRoutingWrite(host, shown.projectId); refreshRoutingReviews(); }
}

/** Read the original receipt only. Unknown/notFound never sends a new mutation or replaces its id. */
export async function checkRoutingOutcome(host: string, project: string): Promise<void> {
  const scope = routingActionScope(host, project), action = unresolved.get(scope);
  if (!action || !permitted(host)) return;
  const current = captureHostAction(host), access = authority(host);
  const lookup = await hostApi(host).delegationUpgradeOperation(action.actionId);
  if (!current() || access !== authority(host)) return;
  if (lookup.status === "found" && lookup.actionId === action.actionId && lookup.result) {
    const result = { effectState: lookup.result.receipt.effectState, receipt: lookup.result.receipt };
    if (isConfirmedUpgradeResult(result, action) || isKnownNoneUpgradeResult(result, action)) unresolved.delete(scope, action.actionId);
  }
  refreshRoutingReviews();
}
