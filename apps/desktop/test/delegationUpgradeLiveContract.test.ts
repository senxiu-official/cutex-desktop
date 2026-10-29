// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PendingActions, canUpgradeAction, isConfirmedUpgradeResult, unresolvedUpgradeActions } from "../src/renderer/src/modules/delegations/upgradeActions";
import { delegationUpgradeCapabilities } from "../src/renderer/src/modules/delegations/upgradeCapabilities";
import { isUpgradeSnapshotComplete, panelSnapshotOf } from "../src/renderer/src/modules/delegations/upgradeContract";
import type { UpgradeApprovalRead, UpgradeSnapshot } from "../src/shared/delegationUpgradePreview";

const caller = { isOwner: true, canManageMembers: true, canOfflineMembers: true };
const approval: UpgradeApprovalRead = {
  id: "approval-visible", projectId: "project", delegationRef: { hostId: "host", id: "not-on-first-page" },
  state: "pending", requestDigest: "sha256:" + "a".repeat(64), policyRevision: 3, authorityEpoch: 7, revision: 4,
  requestedBy: { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false },
  decidedBy: null, decisionAuthority: null, decisionNote: null, createdAt: "2026-10-27T00:00:00Z", decidedAt: null,
  allowedActions: { approve: true, deny: false },
};
const base: UpgradeSnapshot = { projectId: "project", caller };
const receipt = { schema: "cutex.delegation-operation.v1" as const, actionId: "stable-action", operationId: "server-operation", operation: "project.pause", requestDigest: "b".repeat(64), status: "completed" as const, effectState: "committed" as const, outcomeUnknown: false, revision: 1, updatedAt: "2026-10-27T00:00:00Z" };
beforeEach(() => { localStorage.clear(); unresolvedUpgradeActions.clear(); });

describe("live-shaped v3 contract without preview authority", () => {
  it.each(Array.from({ length: 64 }, (_, mask) => mask))("keeps independently absent sections and capabilities safe (mask %i)", mask => {
    const features = ["delegation-tree-stop-v1", "delegation-routing-v1", "project-run-control-v1", "delegation-continuation-v1", "agent-activity-v1", "agent-archive-kind-v1"].filter((_, index) => mask & (1 << index));
    const caps = delegationUpgradeCapabilities(features);
    const value: UpgradeSnapshot = { ...base,
      ...(caps.treeStop ? { revision: "opaque:9cf0", nodes: [], nextCursor: null, coverage: "complete" as const, unresolvedEdges: [] } : {}),
      ...(caps.routing ? { parties: [], approvals: [approval], policy: { revision: 3, memberMode: "approvalRequired" as const, allowedActions: { update: false } }, grants: { items: [], allowedActions: { create: false } } } : {}),
      ...(caps.runControl ? { runControl: { epoch: 8, pauseId: null, phase: "running" as const, mode: "afterTurn" as const, scope: "members" as const, excludedSessionIds: ["current-director", "designated-operator"], membershipRevision: 12, allowedActions: { pause: true, pauseAll: true, resume: false } } } : {}),
    };
    expect(isUpgradeSnapshotComplete(value, caps)).toBe(true);
    const panel = panelSnapshotOf(value);
    expect(canUpgradeAction(panel, { kind: "pause", mode: "afterTurn", scope: "members", expectedEpoch: 8 }, caps)).toBe(caps.runControl);
    expect(canUpgradeAction(panel, { kind: "policy", memberMode: "open", expectedRevision: 3 }, caps)).toBe(false);
    expect(panel.runControl.excludedSessionIds).toEqual(caps.runControl ? ["current-director", "designated-operator"] : undefined);
  });
  it("accepts compact tree approvals but requires independent full collection, even when its node is not loaded", () => {
    const value = { ...base, approvals: [approval], nodes: [], revision: "opaque-snapshot", nextCursor: "opaque-cursor", coverage: "partial" as const, unresolvedEdges: [],
      policy: { revision: 3, memberMode: "approvalRequired" as const, allowedActions: { update: false } }, grants: { items: [], allowedActions: { create: false } } };
    expect(isUpgradeSnapshotComplete(value)).toBe(true);
    expect(panelSnapshotOf(value).approvals[0]?.delegationRef.id).toBe("not-on-first-page");
    expect(isUpgradeSnapshotComplete({ ...value, revision: 123 })).toBe(false);
    expect(isUpgradeSnapshotComplete({ ...value, approvals: [{ id: "compact", state: "pending", revision: 4 }] })).toBe(false);
  });
  it("requires receipt identity/operation/finality and never mistakes tombstone for retirement cleanup", () => {
    const pending = { kind: "pause" as const, actionId: "stable-action" };
    expect(isConfirmedUpgradeResult({ effectState: "committed", receipt }, pending)).toBe(true);
    for (const wrong of [{ actionId: "other" }, { operation: "grant.create" }, { status: "pending" as const }, { outcomeUnknown: true }, { requestDigest: "malformed" }]) {
      expect(isConfirmedUpgradeResult({ effectState: "committed", receipt: { ...receipt, ...wrong } }, pending)).toBe(false);
    }
    expect(isConfirmedUpgradeResult({ effectState: "committed", retirementStage: "permanent_retirement_committed", retirementReceipt: { stage: "permanent_retirement_committed", request: { action_id: "stable-action" } } }, { kind: "retire", actionId: "stable-action" })).toBe(false);
  });
  it("restores the original nonsecret marker across new store instances with no expiry or token persistence", () => {
    const scope = JSON.stringify(["host", "project"]);
    unresolvedUpgradeActions.set(scope, { kind: "retire", actionId: "original-retirement" });
    const restored = new PendingActions();
    expect(restored.get(scope)).toEqual({ kind: "retire", actionId: "original-retirement" });
    expect(() => restored.set(scope, { kind: "retire", actionId: "new-id" })).toThrow("outcome_unknown");
    expect(JSON.parse(localStorage.getItem("cutex.delegation-pending-actions.v1")!)).toEqual([[scope, { kind: "retire", actionId: "original-retirement" }]]);
  });
  it("synchronizes another window's storage event without writing or creating a new action", () => {
    const scope = JSON.stringify(["host", "project"]);
    localStorage.setItem("cutex.delegation-pending-actions.v1", JSON.stringify([[scope, { kind: "pause", actionId: "other-window-action" }]]));
    window.dispatchEvent(new StorageEvent("storage", { key: "cutex.delegation-pending-actions.v1" }));
    expect(unresolvedUpgradeActions.get(scope)?.actionId).toBe("other-window-action");
  });
});
