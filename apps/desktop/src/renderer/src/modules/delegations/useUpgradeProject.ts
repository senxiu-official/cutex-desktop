import { useCallback, useEffect, useRef, useState } from "react";
import { queueUpgradeRead } from "./upgradeReads";
import { apiFor, bridge } from "../../bridge";
import { canUpgradeAction, isConfirmedUpgradeResult, isKnownNoneUpgradeResult, isUpgradePreconditionFailure, validApprovalRead, unresolvedUpgradeActions as unresolved } from "./upgradeActions";
import { blockingOperation, forgetOperation, operationEntity, operationScope, projectOperations, type TrackedOperation } from "../../lib/delegationOperations";
import { delegationUpgradeCapabilities, type DelegationUpgradeCapabilities } from "./upgradeCapabilities";
import { isUpgradeSnapshotComplete, isUpgradeApprovalRead, panelSnapshotOf } from "./upgradeContract";
import type { UpgradeAction, UpgradeIntent, UpgradeSnapshot, PermanentRetirementReviewRequest } from "./upgradeTypes";

/** Typed main adapter; older bridges may omit these additive methods. */
export const upgradePreviewApiOf = apiFor;
// Preserve the immutable original request across panel remounts. Reads never replay it.
/** Lifecycle actions without a receipt lookup: the owner inspects them by hand. */
/** Operations whose unknown outcome needs a manual check (W4 names the operation in the notice). */
export const MANUAL_KINDS: ReadonlySet<string> = new Set(["retire", "archive", "restore", "offline"]);
const MANUAL = MANUAL_KINDS;
const noticeOf = (ops: readonly TrackedOperation[]) => ops.some(op => MANUAL.has(op.action.kind)) ? "manualResolution" as const : "partialResult" as const;
const EVENTS = new Set(["cutex/project/runControlChanged", "cutex/delegation/routingApprovalChanged", "cutex/delegation/lineageChanged", "cutex/delegation/continuationChanged"]);
export function useUpgradeProject(hostId: string, projectId: string, enabled: boolean, capabilities: DelegationUpgradeCapabilities = delegationUpgradeCapabilities([])) {
  const [snapshot, setSnapshot] = useState<UpgradeSnapshot | null>(null);
  const snapshotRef = useRef<UpgradeSnapshot | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const actionScope = JSON.stringify([hostId, projectId]);
  // A1: unknown outcomes fence only their own entity; a legacy whole-project marker still makes the panel read-only.
  const [pending, setPending] = useState<TrackedOperation[]>(() => projectOperations(hostId, projectId));
  const uncertain = pending.some(op => op.entity === null);
  useEffect(() => unresolved.subscribe(() => {
    const next = projectOperations(hostId, projectId);
    setPending(next);
    if (next.length && !mutating.current) setNotice(noticeOf(next));
  }), [hostId, projectId]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"failed" | "readFailed" | "partialResult" | "done" | "incomplete" | "manualResolution" | null>(null);
  const generation = useRef(0), reading = useRef(0), mutating = useRef(false);
  const scope = JSON.stringify([hostId, projectId, enabled, capabilities]);
  const activeScope = useRef<string | null>(null);
  const currentScope = useRef(scope); currentScope.current = scope;
  const performRead = useCallback(async (cursor?: string) => {
    if (currentScope.current !== scope || activeScope.current !== scope) return;
    const token = generation.current, request = ++reading.current;
    const fn = upgradePreviewApiOf(hostId).delegationUpgradeSnapshot;
    if (!enabled || !fn) return;
    const current = () => token === generation.current && request === reading.current && currentScope.current === scope;
    try {
      let append = !!cursor;
      let next: UpgradeSnapshot;
      try { next = await fn(projectId, cursor); }
      catch (error) {
        if (!cursor || !current()) throw error;
        // A failed page may reflect revoked visibility. Drop old pages/placeholders before refreshing.
        snapshotRef.current = null; setSnapshot(null); append = false;
        next = await fn(projectId);
      }
      if (!current()) return;
      if (append && snapshotRef.current?.revision !== next.revision) {
        snapshotRef.current = null; setSnapshot(null); append = false;
        next = await fn(projectId);
        if (!current()) return;
      }
      if (!isUpgradeSnapshotComplete(next, capabilities)) {
        snapshotRef.current = null; setSnapshot(null); setReadOnly(true); setNotice("incomplete"); return;
      }
      const prev = snapshotRef.current;
      const merged = append && prev ? {
        ...next,
        nodes: [...new Map([...(prev.nodes ?? []), ...(next.nodes ?? [])].map(node => [node.kind === "delegation" ? JSON.stringify([node.kind, node.hostId, node.id]) : JSON.stringify([node.kind, node.placeholderId]), node])).values()],
        unresolvedEdges: [...new Map([...(prev.unresolvedEdges ?? []), ...(next.unresolvedEdges ?? [])].map(edge => [JSON.stringify([edge.from.hostId, edge.from.id, edge.relation, edge.reason]), edge])).values()],
      } : next;
      snapshotRef.current = merged; setSnapshot(merged); setReadOnly(false);
      setNotice(previous => previous === "readFailed" || previous === "incomplete" ? null : previous);
    } catch { if (current()) setNotice("readFailed"); }
  }, [hostId, projectId, enabled, scope]);
  const read = useCallback((cursor?: string) => currentScope.current === scope && activeScope.current === scope ? queueUpgradeRead(actionScope, () => performRead(cursor)) : Promise.resolve(), [actionScope, performRead, scope]);
  useEffect(() => {
    activeScope.current = scope;
    const tracked = projectOperations(hostId, projectId);
    setPending(tracked);
    generation.current++; snapshotRef.current = null; setSnapshot(null); setReadOnly(false); setNotice(tracked.length ? noticeOf(tracked) : null); setBusy(false); mutating.current = false;
    void read();
    const off = bridge.on("hostEvent", event => {
      if (event.hostId !== hostId || !EVENTS.has(event.envelope.cutex?.method ?? "")) return;
      const params = event.envelope.cutex?.params as { projectId?: string } | undefined;
      if (params?.projectId === projectId) void read();
    });
    return () => { activeScope.current = null; generation.current++; off(); };
  }, [hostId, projectId, read]);
  const onAction = useCallback(async (intent: UpgradeIntent) => {
    const fn = upgradePreviewApiOf(hostId).delegationUpgradeAction;
    if (currentScope.current !== scope || activeScope.current !== scope || !enabled || !fn || mutating.current || !isUpgradeSnapshotComplete(snapshotRef.current, capabilities)) throw new Error("action_unavailable");
    const token = generation.current;
    const entity = operationEntity(intent), entityScope = operationScope(hostId, projectId, entity);
    if (blockingOperation(hostId, projectId, entity)) throw new Error("outcome_unknown");
    if (!canUpgradeAction(panelSnapshotOf(snapshotRef.current!), intent, capabilities)) throw new Error("action_unavailable");
    mutating.current = true; setBusy(true); setNotice(null);
    let submittedActionId: string | undefined;
    try {
      // Full approval read is required even when the tree displays an apparently actionable row.
      let checkedIntent = intent;
      if (intent.kind === "decision") {
        const approvalRead = upgradePreviewApiOf(hostId).delegationUpgradeApproval;
        if (!approvalRead) throw new Error("approval_read_unavailable");
        const approval = await approvalRead(intent.approvalId);
        if (token !== generation.current || currentScope.current !== scope) throw new Error("context_changed");
        const shown = snapshotRef.current?.approvals?.find(value => value.id === intent.approvalId);
        if (!validApprovalRead(approval, projectId, intent) || !shown
          || shown.delegationRef.hostId !== approval.delegationRef.hostId || shown.delegationRef.id !== approval.delegationRef.id) {
          void read(); throw new Error("approval_changed");
        }
        checkedIntent = { ...intent, expectedDigest: approval.requestDigest, expectedRevision: approval.revision };
      }
      if (!canUpgradeAction(panelSnapshotOf(snapshotRef.current!), checkedIntent, capabilities)) throw new Error("action_unavailable");
      const action = { ...checkedIntent, actionId: crypto.randomUUID() } as UpgradeAction;
      submittedActionId = action.actionId;
      unresolved.set(entityScope, action);
      const result = await fn(projectId, action);
      if (token !== generation.current || currentScope.current !== scope) throw new Error("context_changed");
      reading.current++;
      // The mutation receipt survives a failed follow-up read; a refresh error is not a refusal.
      if (result.snapshot !== undefined) {
        if (!isUpgradeSnapshotComplete(result.snapshot, capabilities)) {
          snapshotRef.current = null; setSnapshot(null); setReadOnly(true);
        } else { snapshotRef.current = result.snapshot; setSnapshot(result.snapshot); }
      }
      if (isKnownNoneUpgradeResult(result, action)) {
        unresolved.delete(entityScope, action.actionId); throw new Error("action_not_applied");
      }
      const committed = isConfirmedUpgradeResult(result, action);
      if (committed) unresolved.delete(entityScope, action.actionId);
      setNotice(committed ? result.readError ? "readFailed" : "done" : "partialResult");
      if (!committed) throw new Error("partial_result");
    } catch (error) {
      if (submittedActionId && isUpgradePreconditionFailure(error)) {
        unresolved.delete(entityScope, submittedActionId);
        if (token === generation.current && currentScope.current === scope) void read();
      }
      if (token === generation.current && currentScope.current === scope) setNotice(error instanceof Error && error.message === "contract_incomplete" ? "incomplete" : unresolved.get(entityScope)?.kind === "retire" ? "manualResolution" : error instanceof Error && error.message === "partial_result" ? "partialResult" : "failed");
      throw error;
    } finally {
      if (token === generation.current && currentScope.current === scope) { mutating.current = false; setBusy(false); }
    }
  }, [hostId, projectId, enabled, scope, actionScope, capabilities.treeStop, capabilities.routing, capabilities.runControl, capabilities.continuation, capabilities.activity, capabilities.retirement, read]);
  const reviewRetirement = useCallback(async (request: PermanentRetirementReviewRequest) => {
    const fn = upgradePreviewApiOf(hostId).delegationRetirementReview;
    if (currentScope.current !== scope || activeScope.current !== scope || blockingOperation(hostId, projectId, operationEntity({ kind: "retire", payload: request })) || !enabled || !fn || !capabilities.retirement || !snapshotRef.current?.caller.isOwner || !isUpgradeSnapshotComplete(snapshotRef.current, capabilities)) throw new Error("review_unavailable");
    const token = generation.current;
    const result = await fn(projectId, request);
    if (token !== generation.current || currentScope.current !== scope) throw new Error("context_changed");
    return result; // review tokens remain in the current dialog's memory only.
  }, [hostId, projectId, enabled, scope, actionScope, capabilities.retirement]);
  const readApproval = useCallback(async (approvalId: string) => {
    const fn = upgradePreviewApiOf(hostId).delegationUpgradeApproval;
    if (currentScope.current !== scope || activeScope.current !== scope || !enabled || !capabilities.routing || !fn) throw new Error("approval_read_unavailable");
    const token = generation.current;
    const value = await fn(approvalId);
    if (token !== generation.current || currentScope.current !== scope || !isUpgradeApprovalRead(value) || value.id !== approvalId || value.projectId !== projectId) throw new Error("context_changed");
    return value;
  }, [hostId, projectId, enabled, scope, capabilities.routing]);
  const refresh = useCallback(async () => {
    if (currentScope.current !== scope || activeScope.current !== scope || !enabled) return;
    const tracked = projectOperations(hostId, projectId);
    const lookup = upgradePreviewApiOf(hostId).delegationUpgradeOperation;
    if (tracked.some(op => MANUAL.has(op.action.kind))) setNotice("manualResolution");
    // Look up every original receipt; each settles only its own fence.
    for (const { scope: opScope, action } of tracked) {
      if (!enabled || !lookup || MANUAL.has(action.kind)) continue;
      try {
        const result = await lookup(action.actionId);
        if (currentScope.current !== scope) return;
        if (result.schema === "cutex.delegation-operation.v1" && result.actionId === action.actionId
          && result.status === "found" && !result.outcomeUnknown && result.result && isConfirmedUpgradeResult({ receipt: result.result.receipt, effectState: result.result.receipt.effectState }, action)) {
          unresolved.delete(opScope, action.actionId); setNotice("done");
        } else if (result.status === "found" && result.actionId === action.actionId && !result.outcomeUnknown && result.result
          && isKnownNoneUpgradeResult({ receipt: result.result.receipt, effectState: result.result.receipt.effectState }, action)) {
          unresolved.delete(opScope, action.actionId); setNotice("failed");
        } else setNotice("partialResult");
      } catch { if (currentScope.current === scope) setNotice("failed"); }
    }
    const left = projectOperations(hostId, projectId);
    if (left.length) setNotice(noticeOf(left));
    await read();
  }, [enabled, hostId, projectId, read, scope]);
  /** Owner recovery: stop tracking one unresolved operation (drops the local fence only; never replays). */
  const forget = useCallback((op: TrackedOperation) => {
    forgetOperation(op.scope, op.action.actionId);
    if (!projectOperations(hostId, projectId).length) setNotice(null);
  }, [hostId, projectId]);
  return { snapshot, readOnly: readOnly || uncertain, busy, notice, refresh, more: () => read(snapshot?.nextCursor ?? undefined), onAction, reviewRetirement, readApproval, pending, forget };
}
