import { ownerWindowOf } from "./ownerWindow";
import type { UpgradeAction, UpgradeResult } from "../../../shared/delegationUpgradePreview";

type PendingAction = Pick<UpgradeAction, "kind" | "actionId">;
const PENDING_KEY = "cutex.delegation-pending-actions.v1";
export class PendingActions extends Map<string, PendingAction> {
  private listeners = new Set<() => void>();
  constructor() { super(); this.restore(); }
  restore() {
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
      super.clear();
      if (Array.isArray(entries)) for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1] && typeof entry[1].actionId === "string"
          && ["stop", "pause", "resume", "decision", "policy", "grant", "revoke", "offline", "archive", "restore", "retire", "resumeContinuation"].includes(entry[1].kind)) super.set(entry[0], { kind: entry[1].kind, actionId: entry[1].actionId });
      }
      this.emit();
    } catch { /* Keep memory fence if storage cannot be read. */ }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  private save() {
    // No tokens/payload, no TTL. Unknown markers remain until authoritative reconciliation.
    localStorage.setItem(PENDING_KEY, JSON.stringify([...this].map(([scope, action]) => [scope, { kind: action.kind, actionId: action.actionId }])));
    this.emit();
  }
  override set(scope: string, action: PendingAction) {
    this.restore();
    const previous = super.get(scope);
    if (previous && previous.actionId !== action.actionId) throw new Error("outcome_unknown");
    super.set(scope, { kind: action.kind, actionId: action.actionId });
    this.save(); // Failure prevents the network write; the memory fence remains.
    return this;
  }
  override delete(scope: string, expectedActionId?: string) {
    this.restore();
    if (expectedActionId && super.get(scope)?.actionId !== expectedActionId) return false;
    const removed = super.delete(scope); this.save(); return removed;
  }
  override clear() { super.clear(); try { this.save(); } catch { this.emit(); } }
}
export const unresolvedUpgradeActions = new PendingActions();
if (typeof window !== "undefined") {
  // This origin-wide store is shared by all panels; use the renderer's owner window for its lifecycle.
  const win = ownerWindowOf(null);
  win.addEventListener("storage", event => {
    if (event.key === PENDING_KEY || event.key === null) unresolvedUpgradeActions.restore();
  });
}

/** These exact backend errors precede durable mutation; other failures remain uncertain. */
export function isUpgradePreconditionFailure(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : null;
  return typeof code === "string" && new Set(["policy_revision_conflict", "grant_revision_conflict", "routing_not_authorized",
    // Adapter executeDelegationUpgrade need() checks before permanentRetirement/request/delegationControl.
    "run_control_changed", "delegation_changed", "continuation_changed", "grant_not_allowed", "pause_not_allowed",
    "resume_not_allowed", "member_scope_changed", "retirement_not_allowed", "lifecycle_not_allowed", "owner_delegation_context_required",
    "unsupported agent activity", "unsupported retirement lifecycle", "grant_revision_required",
    "routing_scope_mismatch", "delegation_approval_stale", "approval_already_decided", "approval_revision_conflict",
    "approval_digest_mismatch", "invalid_decision_note", "delegation_grant_not_found", "delegation_root_closed",
    "delegation_root_unverified", "cross_host_scope_unverified", "scope_mismatch", "approval_not_found", "routing_approval_not_found"]).has(code);
}

/** Receipt completion describes the control operation; never the handler's delegated work. */
export function isConfirmedUpgradeResult(result: UpgradeResult, action: PendingAction): boolean {
  if (result.effectState !== "committed") return false;
  if (action.kind === "retire") {
    const envelope = result.retirementReceipt;
    return result.retirementStage === "committed" && !!envelope && typeof envelope === "object" && "stage" in envelope && envelope.stage === "committed"
      && "request" in envelope && !!envelope.request && typeof envelope.request === "object" && "action_id" in envelope.request && envelope.request.action_id === action.actionId;
  }
  if (["archive", "restore", "offline"].includes(action.kind)) return true; // existing management adapter validates its separate envelope
  return receiptMatches(result.receipt, action, "committed");
}
export function isKnownNoneUpgradeResult(result: UpgradeResult, action: PendingAction): boolean {
  return result.effectState === "none" && receiptMatches(result.receipt, action, "none");
}
function receiptMatches(receipt: UpgradeResult["receipt"], action: PendingAction, effect: "none" | "committed"): boolean {
  const operations: Partial<Record<UpgradeAction["kind"], string>> = { stop: "delegation.stop", pause: "project.pause", resume: "project.resume", policy: "policy.update", decision: "approval.decide", grant: "grant.create", revoke: "grant.revoke", resumeContinuation: "continuation.resume" };
  return !!operations[action.kind] && !!receipt && receipt.schema === "cutex.delegation-operation.v1" && receipt.actionId === action.actionId
    && receipt.operation === operations[action.kind] && typeof receipt.operationId === "string" && receipt.operationId.length > 0
    && receipt.status === "completed" && receipt.effectState === effect && receipt.outcomeUnknown === false
    && typeof receipt.requestDigest === "string" && /^[a-f0-9]{64}$/.test(receipt.requestDigest)
    && Number.isSafeInteger(receipt.revision) && receipt.revision >= 1;
}
