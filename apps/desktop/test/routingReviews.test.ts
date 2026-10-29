// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskReviewReference } from "../src/shared/delegationReviews";
import type { UpgradeAction, UpgradeApprovalRead, UpgradeOperationLookup, UpgradeOperationReceipt, UpgradeResult } from "../src/shared/delegationUpgradePreview";

// Keep transport and the feature source fake; exercise the actual access gates, host
// lifetime, full-record validator, receipt matching and durable PendingActions store.
const fx = vi.hoisted(() => ({
  features: new Map<string, Set<string>>(),
  read: vi.fn<(id: string) => Promise<UpgradeApprovalRead>>(),
  write: vi.fn<(project: string, action: UpgradeAction) => Promise<UpgradeResult>>(),
  operation: vi.fn<(actionId: string) => Promise<UpgradeOperationLookup>>(),
  legacyDecision: vi.fn(),
  hostApi: vi.fn(),
  events: new Map<string, (event: { envelope: { cutex: { method: string } } }) => void>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { on: (name: string, listener: (event: { envelope: { cutex: { method: string } } }) => void) => {
    fx.events.set(name, listener);
    return () => fx.events.delete(name);
  } },
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => ({}) },
  featuresOf: (_state: unknown, host: string) => fx.features.get(host) ?? new Set<string>(),
}));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ hostApi: fx.hostApi }));

import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { checkRoutingOutcome, decideRoutingReviewOn, readRoutingReview, refreshRoutingReviews, routingActionScope } from "../src/renderer/src/lib/routingReviews";
import { PendingActions, unresolvedUpgradeActions as unresolved } from "../src/renderer/src/modules/delegations/upgradeActions";

const HOST = "routing-test-host";
const PROJECT = "project-a";
const reference: AskReviewReference = { kind: "routing", approvalId: "approval-a", projectId: PROJECT };
const scope = routingActionScope(HOST, PROJECT);
const PENDING_KEY = "cutex.delegation-pending-actions.v1";
const NOW = "2026-10-28T00:00:00.000Z";

function approval(patch: Partial<UpgradeApprovalRead> = {}): UpgradeApprovalRead {
  return {
    id: reference.approvalId, projectId: PROJECT, state: "pending",
    delegationRef: { hostId: HOST, id: "delegation-a" },
    requestDigest: "a".repeat(64), revision: 17, policyRevision: 4, authorityEpoch: 9,
    requestedBy: { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false },
    decidedBy: null, decisionAuthority: null, decisionNote: null,
    createdAt: NOW, decidedAt: null, allowedActions: { approve: true, deny: true }, ...patch,
  };
}
function receipt(actionId: string, patch: Partial<UpgradeOperationReceipt> = {}): UpgradeOperationReceipt {
  return {
    schema: "cutex.delegation-operation.v1", actionId, operationId: "operation-a",
    operation: "approval.decide", requestDigest: "b".repeat(64), revision: 1,
    status: "completed", effectState: "committed", outcomeUnknown: false, updatedAt: NOW, ...patch,
  };
}
function result(action: Pick<UpgradeAction, "actionId">, patch: Partial<UpgradeOperationReceipt> = {}): UpgradeResult {
  const confirmed = receipt(action.actionId, patch);
  return { effectState: confirmed.effectState, receipt: confirmed };
}
function lookup(actionId: string, patch: Partial<UpgradeOperationReceipt> = {}): UpgradeOperationLookup {
  return { schema: "cutex.delegation-operation.v1", actionId, status: "found", outcomeUnknown: false, result: { receipt: receipt(actionId, patch) } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function access(isOwner = true, deviceScope: "full" | "read" | "chat" = "full", host = HOST) {
  noteHostAccess(host, { user: { id: isOwner ? "owner" : "member", isOwner, pending: false, scope: deviceScope } });
}
function expectNoWrite() {
  expect(fx.write).not.toHaveBeenCalled();
  expect(fx.legacyDecision).not.toHaveBeenCalled();
  expect(unresolved.has(scope)).toBe(false);
}
async function uncertainWrite() {
  fx.write.mockRejectedValueOnce(new Error("connection_lost"));
  await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("connection_lost");
  const action = fx.write.mock.calls.at(-1)![1];
  expect(unresolved.get(scope)).toEqual({ kind: "decision", actionId: action.actionId });
  return action;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unresolved.clear();
  fireHostReset(HOST);
  fx.features.clear();
  fx.features.set(HOST, new Set(["delegation-review-refs", "owner-approvals"]));
  access();
  refreshRoutingReviews();
  fx.read.mockReset().mockResolvedValue(approval());
  fx.write.mockReset().mockImplementation(async (_project, action) => result(action));
  fx.operation.mockReset().mockImplementation(async actionId => lookup(actionId));
  fx.hostApi.mockReset().mockReturnValue({
    delegationUpgradeApproval: fx.read, delegationUpgradeAction: fx.write,
    delegationUpgradeOperation: fx.operation, decideApproval: fx.legacyDecision,
  });
});
afterEach(() => { unresolved.clear(); localStorage.clear(); });

describe("routing full-record reads", () => {
  it("reads the referenced approval from the specified host and coalesces two surfaces", async () => {
    const gate = deferred<UpgradeApprovalRead>();
    fx.read.mockReturnValueOnce(gate.promise);
    const card = readRoutingReview(HOST, reference);
    const inbox = readRoutingReview(HOST, { ...reference });
    expect(fx.hostApi).toHaveBeenCalledExactlyOnceWith(HOST);
    expect(fx.read).toHaveBeenCalledExactlyOnceWith(reference.approvalId);
    gate.resolve(approval());
    expect(await card).toEqual(await inbox);
    await readRoutingReview(HOST, reference);
    expect(fx.read).toHaveBeenCalledOnce();
    await readRoutingReview(HOST, reference, true);
    expect(fx.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    { kind: "capability", projectId: PROJECT },
    { kind: "routing", projectId: null },
    { kind: "routing", projectId: "" },
  ] as const)("rejects unusable reference %o before reading", async patch => {
    await expect(readRoutingReview(HOST, { ...reference, ...patch })).rejects.toThrow("routing_review_unavailable");
    expect(fx.read).not.toHaveBeenCalled();
  });

  it("does not use the routing endpoint on a legacy host", async () => {
    fx.features.get(HOST)!.delete("delegation-review-refs");
    await expect(readRoutingReview(HOST, reference)).rejects.toThrow("routing_review_unavailable");
    expect(fx.read).not.toHaveBeenCalled();
  });

  it.each([
    { id: "other-approval" }, { projectId: "other-project" },
  ])("rejects a full read outside the reference identity: %o", async patch => {
    fx.read.mockResolvedValue(approval(patch));
    await expect(readRoutingReview(HOST, reference)).rejects.toThrow("approval_changed");
    expectNoWrite();
  });

  it("rejects a compact row even if its identity, state and revision match", async () => {
    fx.read.mockResolvedValue({ id: reference.approvalId, projectId: PROJECT, state: "pending", revision: 17 } as UpgradeApprovalRead);
    await expect(readRoutingReview(HOST, reference)).rejects.toThrow("approval_changed");
    expectNoWrite();
  });

  it.each(["cutex/delegation/routingApprovalChanged", "cutex/access/changed"])("invalidates cached evidence on %s", async method => {
    await readRoutingReview(HOST, reference);
    fx.events.get("hostEvent")!({ envelope: { cutex: { method } } });
    await readRoutingReview(HOST, reference);
    expect(fx.read).toHaveBeenCalledTimes(2);
  });
});

describe("routing decision authorization and CAS", () => {
  it.each(["approve", "deny"] as const)("sends %s through the upgrade action with the full approval CAS", async decision => {
    const shown = approval();
    await readRoutingReview(HOST, reference); // A cached row must never authorize the write.
    await decideRoutingReviewOn(HOST, shown, decision);
    expect(fx.read).toHaveBeenCalledTimes(2);
    expect(fx.write).toHaveBeenCalledExactlyOnceWith(PROJECT, {
      kind: "decision", actionId: expect.any(String), approvalId: shown.id, decision,
      expectedDigest: shown.requestDigest, expectedRevision: shown.revision, decisionNote: null,
    });
    expect(fx.legacyDecision).not.toHaveBeenCalled();
    expect(unresolved.has(scope)).toBe(false);
    expect(new PendingActions().has(scope)).toBe(false);
  });

  it.each(["approved", "denied", "cancelled", "stale"] as const)("does not write when the fresh state is %s", async state => {
    fx.read.mockResolvedValue(approval({ state }));
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("approval_changed");
    expectNoWrite();
  });

  it.each(["approve", "deny"] as const)("requires the fresh %s allowedAction", async decision => {
    fx.read.mockResolvedValue(approval({ allowedActions: { approve: decision !== "approve", deny: decision !== "deny" } }));
    await expect(decideRoutingReviewOn(HOST, approval(), decision)).rejects.toThrow("approval_changed");
    expectNoWrite();
  });

  it.each([
    { revision: 18 }, { requestDigest: "c".repeat(64) },
    { delegationRef: { hostId: HOST, id: "different-delegation" } },
    { delegationRef: { hostId: "other-host", id: "delegation-a" } },
    { id: "different-approval" }, { projectId: "different-project" },
  ])("rejects fresh CAS/identity changes before writing: %o", async patch => {
    fx.read.mockResolvedValue(approval(patch));
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("approval_changed");
    expectNoWrite();
  });

  it.each([
    { owner: false, device: "full" }, { owner: true, device: "read" }, { owner: true, device: "chat" },
  ] as const)("blocks the decision gate for %o", async ({ owner, device }) => {
    access(owner, device);
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("routing_not_authorized");
    expect(fx.read).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it.each(["owner-approvals", "delegation-review-refs"])("requires host feature %s even for a full owner", async feature => {
    fx.features.get(HOST)!.delete(feature);
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("routing_not_authorized");
    expect(fx.read).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it.each(["host reset", "access change", "feature removed"])("does not write after %s while the fresh read is pending", async change => {
    const gate = deferred<UpgradeApprovalRead>();
    fx.read.mockReturnValueOnce(gate.promise);
    const pending = decideRoutingReviewOn(HOST, approval(), "approve");
    const rejected = expect(pending).rejects.toThrow("context_changed");
    if (change === "host reset") fireHostReset(HOST);
    else if (change === "access change") access(true, "read");
    else fx.features.get(HOST)!.delete("delegation-review-refs");
    gate.resolve(approval());
    await rejected;
    expectNoWrite();
  });

  it("keeps unrelated host resets from cancelling a valid decision", async () => {
    const gate = deferred<UpgradeApprovalRead>();
    fx.read.mockReturnValueOnce(gate.promise);
    const pending = decideRoutingReviewOn(HOST, approval(), "deny");
    fireHostReset("unrelated-host");
    gate.resolve(approval());
    await pending;
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it("keeps two UI callers in the same project to one read/write even for different approvals", async () => {
    const readGate = deferred<UpgradeApprovalRead>();
    const writeGate = deferred<UpgradeResult>();
    fx.read.mockReturnValueOnce(readGate.promise);
    fx.write.mockReturnValueOnce(writeGate.promise);
    const card = decideRoutingReviewOn(HOST, approval(), "approve");
    await expect(decideRoutingReviewOn(HOST, approval({ id: "approval-b" }), "deny")).rejects.toThrow("routing_not_authorized");
    expect(fx.read).toHaveBeenCalledOnce();
    readGate.resolve(approval());
    await vi.waitFor(() => expect(fx.write).toHaveBeenCalledOnce());
    const action = fx.write.mock.calls[0]![1];
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
    await expect(decideRoutingReviewOn(HOST, approval(), "deny")).rejects.toThrow("routing_not_authorized");
    writeGate.resolve(result(action));
    await card;
    expect(fx.write).toHaveBeenCalledOnce();
    expect(unresolved.has(scope)).toBe(false);
  });
});

describe("durable unknown-operation fence and read-only reconciliation", () => {
  it("persists the action fence before transport and refuses to write if persistence fails", async () => {
    const saved = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage_unavailable"); });
    try {
      await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("storage_unavailable");
      expect(fx.write).not.toHaveBeenCalled();
      expect(fx.legacyDecision).not.toHaveBeenCalled();
      expect(unresolved.get(scope)).toEqual({ kind: "decision", actionId: expect.any(String) });
    } finally { saved.mockRestore(); }
  });

  it("keeps an unresolved marker when a response claims committed without a matching receipt", async () => {
    fx.write.mockImplementationOnce(async (_project, action) => result(action, { actionId: "different-action" }));
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("outcome_unknown");
    const action = fx.write.mock.calls[0]![1];
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
    expect(new PendingActions().get(scope)?.actionId).toBe(action.actionId);
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("routing_not_authorized");
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it("clears an authoritative none write receipt and reports that the action was not applied", async () => {
    fx.write.mockImplementationOnce(async (_project, action) => result(action, { effectState: "none" }));
    await expect(decideRoutingReviewOn(HOST, approval(), "deny")).rejects.toThrow("action_not_applied");
    expect(unresolved.has(scope)).toBe(false);
    expect(new PendingActions().has(scope)).toBe(false);
  });

  it("persists only the original action marker after transport loss and blocks resubmission", async () => {
    const action = await uncertainWrite();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual([[scope, { kind: "decision", actionId: action.actionId }]]);
    expect(new PendingActions().get(scope)).toEqual(unresolved.get(scope));
    await expect(decideRoutingReviewOn(HOST, approval(), "deny")).rejects.toThrow("routing_not_authorized");
    expect(fx.write).toHaveBeenCalledOnce();
    expect(fx.read).toHaveBeenCalledOnce();
  });

  it.each(["unknown", "notFound"] as const)("keeps the original action fence for %s operation lookup without mutation", async status => {
    const action = await uncertainWrite();
    fx.operation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId: action.actionId, status, outcomeUnknown: true, result: null });
    await checkRoutingOutcome(HOST, PROJECT);
    await checkRoutingOutcome(HOST, PROJECT);
    expect(fx.operation.mock.calls).toEqual([[action.actionId], [action.actionId]]);
    expect(unresolved.get(scope)).toEqual({ kind: "decision", actionId: action.actionId });
    expect(new PendingActions().get(scope)).toEqual(unresolved.get(scope));
    expect(fx.write).toHaveBeenCalledOnce();
    expect(fx.legacyDecision).not.toHaveBeenCalled();
  });

  it("reconciles a restored pending marker using the original operation actionId", async () => {
    const action = await uncertainWrite();
    unresolved.restore();
    await checkRoutingOutcome(HOST, PROJECT);
    expect(fx.operation).toHaveBeenCalledExactlyOnceWith(action.actionId);
    expect(unresolved.has(scope)).toBe(false);
    expect(new PendingActions().has(scope)).toBe(false);
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it.each(["committed", "none"] as const)("clears a matching authoritative %s receipt without another write", async effectState => {
    const action = await uncertainWrite();
    fx.operation.mockResolvedValue(lookup(action.actionId, { effectState }));
    await checkRoutingOutcome(HOST, PROJECT);
    expect(unresolved.has(scope)).toBe(false);
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it.each([
    { actionId: "wrong-action" }, { operation: "policy.update" }, { requestDigest: "bad-digest" },
    { revision: 0 }, { status: "pending" }, { outcomeUnknown: true }, { effectState: "unknown" },
  ] satisfies Partial<UpgradeOperationReceipt>[])("retains the fence for an unconfirmed receipt %o", async patch => {
    const action = await uncertainWrite();
    fx.operation.mockResolvedValue(lookup(action.actionId, patch));
    await checkRoutingOutcome(HOST, PROJECT);
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it("ignores a found receipt for another lookup actionId", async () => {
    const action = await uncertainWrite();
    fx.operation.mockResolvedValue({ ...lookup(action.actionId), actionId: "other-operation" });
    await checkRoutingOutcome(HOST, PROJECT);
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
  });

  it("retains the fence when the lookup transport fails", async () => {
    const action = await uncertainWrite();
    fx.operation.mockRejectedValueOnce(new Error("lookup_disconnected"));
    await expect(checkRoutingOutcome(HOST, PROJECT)).rejects.toThrow("lookup_disconnected");
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it.each(["host reset", "access change"])("does not clear a fence after %s during outcome lookup", async change => {
    const action = await uncertainWrite();
    const gate = deferred<UpgradeOperationLookup>();
    fx.operation.mockReturnValueOnce(gate.promise);
    const checking = checkRoutingOutcome(HOST, PROJECT);
    if (change === "host reset") fireHostReset(HOST);
    else access(true, "read");
    gate.resolve(lookup(action.actionId));
    await checking;
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
    expect(fx.write).toHaveBeenCalledOnce();
  });

  it("does not look up a different project or an absent operation", async () => {
    await checkRoutingOutcome(HOST, PROJECT);
    await uncertainWrite();
    await checkRoutingOutcome(HOST, "other-project");
    expect(fx.operation).not.toHaveBeenCalled();
  });

  it("does not reconcile through a connection that lost owner authority", async () => {
    const action = await uncertainWrite();
    access(false);
    await checkRoutingOutcome(HOST, PROJECT);
    expect(fx.operation).not.toHaveBeenCalled();
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
  });

  it("retains the fence if host context changes after the write reaches the server", async () => {
    const gate = deferred<UpgradeResult>();
    fx.write.mockReturnValueOnce(gate.promise);
    const pending = decideRoutingReviewOn(HOST, approval(), "approve");
    const rejected = expect(pending).rejects.toThrow("context_changed");
    await vi.waitFor(() => expect(fx.write).toHaveBeenCalledOnce());
    const action = fx.write.mock.calls[0]![1];
    fireHostReset(HOST);
    gate.resolve(result(action));
    await rejected;
    expect(unresolved.get(scope)?.actionId).toBe(action.actionId);
  });

  it("clears an explicit precondition failure but retains an ordinary transport failure", async () => {
    fx.write.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "approval_revision_conflict" }));
    await expect(decideRoutingReviewOn(HOST, approval(), "approve")).rejects.toThrow("stale");
    expect(unresolved.has(scope)).toBe(false);
    await uncertainWrite();
  });
});
