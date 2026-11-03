// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import type { UpgradeAction, UpgradeApprovalRead, UpgradeGrant, UpgradeNode, UpgradeOperationReceipt, UpgradePanelSnapshot, UpgradeResult } from "../src/shared/delegationUpgradePreview";
import { en } from "../src/renderer/src/i18n/en";

// Fake transport/features/i18n and unrelated delegation-list refresh. Exercise the real component, armed confirmation,
// authorization checks, routing reads and durable unresolved-action store together.
const fx = vi.hoisted(() => ({
  features: new Set<string>(), read: vi.fn(), snapshot: vi.fn(), write: vi.fn(), operation: vi.fn(),
  api: vi.fn(), events: new Map<string, Set<(event: unknown) => void>>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (name: string, listener: (event: unknown) => void) => {
  const listeners = fx.events.get(name) ?? new Set(); listeners.add(listener); fx.events.set(name, listeners);
  return () => listeners.delete(listener);
} } }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (state: unknown) => unknown) => select({}), { getState: () => ({}) }),
  featuresOf: () => fx.features,
}));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: fx.api }));
vi.mock("../src/renderer/src/i18n", () => {
  const translate = (key: keyof typeof en, params: Record<string, string | number> = {}) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
  return { useI18n: () => ({ t: translate, locale: "en" }), translate };
});
vi.mock("../src/renderer/src/lib/approvalDecision", () => ({
  decideRoutingReviewOn: async (...args: Parameters<typeof import("../src/renderer/src/lib/routingReviews").decideRoutingReviewOn>) =>
    (await import("../src/renderer/src/lib/routingReviews")).decideRoutingReviewOn(...args),
}));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ runDelegationCommand: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  refreshOpenDelegations: vi.fn().mockResolvedValue(undefined), refreshDelegation: vi.fn().mockResolvedValue(undefined),
}));

import { RoutingDelegationReview } from "../src/renderer/src/components/RoutingReview";
import { DelegationReviewerGrant } from "../src/renderer/src/components/DelegationReviewerGrant";
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { refreshRoutingReviews, routingActionScope } from "../src/renderer/src/lib/routingReviews";
import { PendingActions, unresolvedUpgradeActions as unresolved } from "../src/renderer/src/lib/delegationOperations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let hostSequence = 0;
let HOST = "review-grant-fixture";
const PROJECT = "cutex-e";
const CHILD = "delegation-26";
const PARENT = "release-parent";
const WREN = "wren-session";
const RELEASE = "release-021-session";
const NOW = "2026-10-30T09:35:00.000Z";
const reference = { kind: "routing", approvalId: "routing-26", projectId: PROJECT } as const;
let scope = routingActionScope(HOST, PROJECT);
const ref = (id: string) => ({ hostId: HOST, id });
const owner = { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false } as const;
let record: UpgradeApprovalRead;
let d: AskSummary;
let snapshot: UpgradePanelSnapshot;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

function approval(state: UpgradeApprovalRead["state"] = "approved"): UpgradeApprovalRead {
  return {
    id: reference.approvalId, projectId: PROJECT, delegationRef: ref(CHILD), state,
    requestDigest: `sha256:${"a".repeat(64)}`, revision: 2, policyRevision: 0, authorityEpoch: 9,
    requestedBy: { kind: "agent", hostId: HOST, sessionId: WREN, name: "Wren", redacted: false },
    decidedBy: state === "approved" ? owner : null, decisionAuthority: state === "approved" ? "owner" : null,
    decisionNote: null, createdAt: NOW, decidedAt: state === "approved" ? NOW : null,
    allowedActions: { approve: state === "pending", deny: state === "pending" },
  };
}
function node(id: string, isChild: boolean): UpgradeNode {
  return {
    kind: "delegation", id, hostId: HOST, ref: ref(id), projectId: PROJECT,
    parent: isChild ? ref(PARENT) : null, parentState: isChild ? "visible" : "none", redactedParentRef: null,
    root: ref(PARENT), rootState: "visible", redactedRootRef: null,
    followUp: null, followUpState: "none", parentId: isChild ? PARENT : null, rootId: PARENT,
    followUpOf: null, parentAttemptId: isChild ? "parent-attempt-1" : null,
    lineageState: "verified", redactedParent: false,
    requester: isChild ? { ...ref(WREN), name: "Wren" } : { kind: "owner" },
    target: { ...ref(isChild ? RELEASE : WREN), name: isChild ? "release-021" : "Wren" },
    title: isChild ? "Release 0.2.1 review" : "Release parent", execution: isChild ? "pendingReview" : "running",
    closed: null, lastActivityAt: NOW, resumeEvidence: { kind: "none" }, continuation: null,
    routingApproval: isChild ? record : null,
    allowedActions: { readAttempts: true, stop: true, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 3,
  };
}
function validGrant(): UpgradeGrant {
  return {
    id: "reviewer-grant-26", projectId: PROJECT, requesterRef: ref(WREN), targetRefs: [ref(RELEASE)],
    rootDelegationRef: ref(PARENT), purpose: "review", maxUses: 1, usedCount: 0,
    expiresAt: null, authorityEpoch: 9, policyRevision: 0, revision: 1, revokedAt: null, allowedActions: { revoke: true },
  };
}
function receipt(action: UpgradeAction): UpgradeOperationReceipt {
  return {
    schema: "cutex.delegation-operation.v1", actionId: action.actionId, operationId: `operation-${action.actionId}`,
    operation: action.kind === "grant" ? "grant.create" : "approval.decide", requestDigest: "b".repeat(64),
    revision: 1, status: "completed", effectState: "committed", outcomeUnknown: false, updatedAt: NOW,
  };
}
function access(isOwner = true, deviceScope: "full" | "read" | "chat" = "full") {
  noteHostAccess(HOST, { user: { id: isOwner ? "owner" : "member", isOwner, pending: false, scope: deviceScope } });
}
async function render(integrated = false) {
  await act(async () => root.render(integrated
    ? h(RoutingDelegationReview, { host: HOST, d, refValue: reference, variant: "card" })
    : h(DelegationReviewerGrant, { host: HOST, d, record, dense: false })));
}
const click = async (button: HTMLButtonElement) => { await act(async () => button.click()); };
function grantButton() {
  return container.querySelector<HTMLButtonElement>('[data-testid="delegation-reviewer-grant-allow"]:not(:disabled)') ?? undefined;
}
function checkButton() {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => /check|查询|核对/i.test(button.textContent ?? "") && !button.disabled);
  expect(found, container.textContent ?? "").toBeDefined();
  return found!;
}
async function ready(integrated = false) {
  await render(integrated);
  await act(async () => { await vi.waitFor(() => expect(grantButton(), container.textContent ?? "").toBeDefined()); });
  return grantButton()!;
}
const grantWrites = () => fx.write.mock.calls.filter(([, action]) => action.kind === "grant");

beforeEach(() => {
  // Production deliberately keeps committed-grant fences across host reconnects.
  // Give each case its own host rather than resetting or weakening that state.
  HOST = `review-grant-fixture-${++hostSequence}`; scope = routingActionScope(HOST, PROJECT);
  vi.clearAllMocks(); localStorage.clear(); unresolved.clear(); fireHostReset(HOST);
  fx.features = new Set(["owner-approvals", "delegation-review-refs", "delegation-routing-v1", "delegation-tree-stop-v1"]);
  access(); record = approval();
  d = { askId: CHILD, title: "Release 0.2.1 review", projectId: PROJECT, execution: "pendingReview", revision: 3,
    closed: null, remote: null, requester: { kind: "agent", cutexSessionId: WREN, name: "Wren" }, target: RELEASE,
    targetName: "release-021", reviewRef: reference, reviewRefs: [reference], attempts: 0, createdAt: NOW, updatedAt: NOW };
  snapshot = {
    projectId: PROJECT, revision: "tree-3", nodes: [node(PARENT, false), node(CHILD, true)], nextCursor: null,
    coverage: "complete", unresolvedEdges: [], approvals: [record],
    parties: [{ ...ref(WREN), name: "Wren" }, { ...ref(RELEASE), name: "release-021" }],
    policy: { revision: 0, memberMode: "approvalRequired", allowedActions: { update: true } },
    grants: { items: [], allowedActions: { create: true } }, members: [], interruptedDelegations: [],
    runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: false, pauseAll: false, resume: false } },
    caller: { isOwner: true, canManageMembers: true, canOfflineMembers: true },
  };
  fx.read.mockReset().mockImplementation(async () => structuredClone(record));
  fx.snapshot.mockReset().mockImplementation(async () => structuredClone(snapshot));
  fx.write.mockReset().mockImplementation(async (_project: string, action: UpgradeAction): Promise<UpgradeResult> => {
    if (action.kind === "decision") {
      record = approval("approved"); snapshot.approvals = [record];
      (snapshot.nodes[1] as UpgradeNode).routingApproval = record;
    } else if (action.kind === "grant") snapshot.grants.items = [validGrant()];
    return { effectState: "committed", receipt: receipt(action) };
  });
  fx.operation.mockReset().mockImplementation(async (actionId: string) => ({
    schema: "cutex.delegation-operation.v1", actionId, status: "unknown", outcomeUnknown: true, result: null,
  }));
  fx.api.mockReset().mockReturnValue({ delegationUpgradeApproval: fx.read, delegationUpgradeSnapshot: fx.snapshot,
    delegationUpgradeAction: fx.write, delegationUpgradeOperation: fx.operation });
  refreshRoutingReviews();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); unresolved.clear(); localStorage.clear(); });

describe("delegation reviewer grant flow", () => {
  it("approves routing, explicitly confirms one grant for Wren/release-021/parent root, then stops offering approval", async () => {
    record = approval("pending"); snapshot.approvals = [record]; (snapshot.nodes[1] as UpgradeNode).routingApproval = record;
    await render(true);
    await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-routing-decision="approve"]')).not.toBeNull()); });
    expect(grantButton()).toBeUndefined();
    expect(fx.write).not.toHaveBeenCalled();
    await click(container.querySelector<HTMLButtonElement>('[data-routing-decision="approve"]')!);
    expect(fx.write).toHaveBeenCalledTimes(1);
    expect(fx.write.mock.calls[0]![1]).toMatchObject({ kind: "decision", decision: "approve", approvalId: reference.approvalId });
    expect(d.execution).toBe("pendingReview");
    expect(snapshot.grants.items).toEqual([]);
    const button = await ready(true);
    expect(container.querySelector("[data-routing-decision]")).toBeNull();
    await click(button);
    expect(button.dataset.armed).toBe("true");
    expect(grantWrites()).toHaveLength(0);
    await click(button);
    expect(grantWrites()).toHaveLength(1);
    expect(grantWrites()[0]).toEqual([PROJECT, {
      kind: "grant", actionId: expect.any(String), requesterRef: ref(WREN), targetRefs: [ref(RELEASE)],
      rootDelegationRef: ref(PARENT), maxUses: 1,
    }]);
    expect(grantWrites()[0]![1].rootDelegationRef).not.toEqual(ref(CHILD));
    for (const execution of ["queued", "running"] as const) {
      d = { ...d, execution, revision: d.revision + 1 }; await render(true);
      expect(container.querySelector("[data-routing-decision]")).toBeNull();
      expect(grantButton()).toBeUndefined();
    }
    expect(fx.write).toHaveBeenCalledTimes(2);
  });

  it("does not offer another grant after a cold mount of a queued delegation with a consumed grant", async () => {
    d = { ...d, execution: "queued" };
    snapshot.nodes[1] = { ...snapshot.nodes[1]!, execution: "queued" } as UpgradeNode;
    snapshot.grants.items = [{ ...validGrant(), usedCount: 1 }];
    await render(true);
    expect(grantButton()).toBeUndefined();
    expect(fx.write).not.toHaveBeenCalled();
  });

  it("rechecks the server execution state before granting a stale pendingReview row", async () => {
    const button = await ready();
    await click(button);
    snapshot.nodes[1] = { ...snapshot.nodes[1]!, execution: "queued" } as UpgradeNode;
    snapshot.grants.items = [{ ...validGrant(), usedCount: 1 }];
    await click(button);
    expect(fx.write).not.toHaveBeenCalled();
  });

  it.each(["member", "operator", "read scope", "chat scope", "routing feature", "tree feature", "review feature", "approval feature", "grant permission"])("%s cannot issue a grant", async guard => {
    if (guard === "member" || guard === "operator") {
      access(false); snapshot.caller = { isOwner: false, canManageMembers: guard === "operator", canOfflineMembers: guard === "operator" };
      // A member/operator-looking row cannot confer owner authority.
      snapshot.members = [{ ...ref(WREN), name: "Wren", director: false, allowedActions: ["archive"] }];
    } else if (guard === "read scope") access(true, "read");
    else if (guard === "chat scope") access(true, "chat");
    else if (guard === "routing feature") fx.features.delete("delegation-routing-v1");
    else if (guard === "tree feature") fx.features.delete("delegation-tree-stop-v1");
    else if (guard === "review feature") fx.features.delete("delegation-review-refs");
    else if (guard === "approval feature") fx.features.delete("owner-approvals");
    else snapshot.grants.allowedActions.create = false;
    await render();
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) { await click(button); await click(button); }
    expect(fx.write).not.toHaveBeenCalled();
    expect(unresolved.has(scope)).toBe(false);
  });

  it("does not offer or create a duplicate when the authoritative snapshot already has a matching live grant", async () => {
    snapshot.grants.items = [validGrant()];
    await render();
    expect(fx.snapshot).toHaveBeenCalled();
    expect(grantButton()).toBeUndefined();
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) await click(button);
    expect(fx.write).not.toHaveBeenCalled();
  });

  it.each(["current policy changed", "approval policy changed", "grant policy unknown"])("%s cannot authorize a new grant", async change => {
    if (change === "current policy changed") snapshot.policy.revision = 1;
    else if (change === "approval policy changed") snapshot.approvals = [{ ...record, policyRevision: 1 }];
    else {
      const grant = validGrant(); delete grant.policyRevision;
      snapshot.grants.items = [grant];
    }
    await render();
    expect(fx.snapshot).toHaveBeenCalled();
    expect(grantButton()).toBeUndefined();
    // An unreadable/stale policy must not look like an empty list and permit creation.
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) { await click(button); await click(button); }
    expect(fx.write).not.toHaveBeenCalled();
    expect(unresolved.has(scope)).toBe(false);
  });

  it("rechecks the authoritative grant list after arming and does not duplicate a grant issued meanwhile", async () => {
    const button = await ready(); await click(button);
    expect(button.dataset.armed).toBe("true");
    snapshot.grants.items = [validGrant()];
    await click(button);
    expect(fx.snapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fx.write).not.toHaveBeenCalled();
    expect(grantButton()).toBeUndefined();
  });

  it("rechecks full owner authority when confirming an already armed grant", async () => {
    const button = await ready(); await click(button);
    expect(button.dataset.armed).toBe("true");
    await act(async () => access(true, "read"));
    // Even a stale DOM reference cannot recover the permission that was removed.
    await click(button);
    expect(fx.write).not.toHaveBeenCalled();
    expect(unresolved.has(scope)).toBe(false);
  });

  it.each(["unknown", "redacted"] as const)("an %s root never falls back to granting against the child", async rootState => {
    const child = snapshot.nodes[1] as UpgradeNode;
    child.root = null; child.rootId = null; child.rootState = rootState;
    if (rootState === "redacted") {
      child.redactedRootRef = { placeholderId: "restricted-root" };
      snapshot.nodes.push({ kind: "redactedAncestor", placeholderId: "restricted-root", labelKey: "delegation.ancestorRestricted",
        reason: "notVisible", expandable: false, allowedActions: {} });
    }
    await render();
    expect(fx.snapshot).toHaveBeenCalled();
    expect(grantButton()).toBeUndefined();
    for (const button of container.querySelectorAll<HTMLButtonElement>("button")) { await click(button); await click(button); }
    expect(fx.write).not.toHaveBeenCalled();
  });

  it.each(["unknown", "notFound"] as const)("transport loss then %s reads only the original action, survives remount and never replays", async status => {
    fx.write.mockRejectedValueOnce(new Error("connection_lost"));
    const button = await ready(); await click(button); await click(button);
    expect(grantWrites()).toHaveLength(1);
    const action = grantWrites()[0]![1] as UpgradeAction;
    expect(unresolved.get(scope)).toEqual({ kind: "grant", actionId: action.actionId });
    expect(new PendingActions().get(scope)).toEqual(unresolved.get(scope));
    fx.operation.mockImplementation(async (actionId: string) => ({
      schema: "cutex.delegation-operation.v1", actionId, status, outcomeUnknown: true, result: null,
    }));
    await click(checkButton()); await click(checkButton());
    expect(fx.operation.mock.calls).toEqual([[action.actionId], [action.actionId]]);
    await act(async () => root.unmount()); root = createRoot(container);
    unresolved.restore(); await render();
    expect(grantButton()).toBeUndefined();
    await click(checkButton());
    expect(fx.operation.mock.calls).toEqual([[action.actionId], [action.actionId], [action.actionId]]);
    expect(new PendingActions().get(scope)).toEqual({ kind: "grant", actionId: action.actionId });
    expect(grantWrites()).toHaveLength(1);
  });
});
