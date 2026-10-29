import { panelSnapshotOf } from "../src/renderer/src/modules/delegations/upgradeContract";
import { describe, expect, it, vi } from "vitest";
import { createUpgradeMock, mock, type UpgradeMockOptions } from "../src/renderer/src/modules/delegations/mock";
import type {
  DelegationRef, PermanentRetirementReview, UpgradeAction, UpgradeNode, UpgradeApproval, UpgradeMember, UpgradePreviewApi, UpgradePanelSnapshot as UpgradeSnapshot,
} from "../src/shared/delegationUpgradePreview";

const HOST = "preview-local";
const PROJECT = "preview-project";
const remoteHost = HOST + ":preview-remote";
const ref = (id: string, hostId = HOST): DelegationRef => ({ id, hostId });
const act = async (api: UpgradePreviewApi, action: UpgradeAction) => { const result = await api.delegationUpgradeAction(PROJECT, action); if (!result.snapshot) throw new Error("mock_snapshot_missing"); return { ...result, snapshot: panelSnapshotOf(result.snapshot) }; };
async function all(api: UpgradePreviewApi, projectId = PROJECT): Promise<UpgradeSnapshot> {
  const snapshot = panelSnapshotOf(await api.delegationUpgradeSnapshot(projectId));
  let cursor = snapshot.nextCursor;
  const seen = new Set<string>();
  while (cursor) {
    expect(seen.has(cursor)).toBe(false);
    seen.add(cursor);
    const page = panelSnapshotOf(await api.delegationUpgradeSnapshot(projectId, cursor));
    expect(page.revision).toBe(snapshot.revision);
    snapshot.nodes.push(...page.nodes);
    snapshot.unresolvedEdges.push(...page.unresolvedEdges);
    cursor = page.nextCursor;
  }
  snapshot.nextCursor = null;
  return snapshot;
}
const nodes = (snapshot: UpgradeSnapshot) => snapshot.nodes.filter((n): n is UpgradeNode => n.kind === "delegation");
const node = (snapshot: UpgradeSnapshot, id: string, hostId = HOST) => nodes(snapshot).find(n => n.id === id && n.hostId === hostId)! as UpgradeNode & { routingApproval: UpgradeApproval | null };
const member = (snapshot: UpgradeSnapshot, id: string) => snapshot.members.find(m => m.id === id)! as Required<UpgradeMember>;
// Test-only capture of an isolated internal fixture; no extra wire or mutation API.
async function fixtureState(api: UpgradePreviewApi): Promise<UpgradeSnapshot> {
  await api.delegationUpgradeSnapshot(PROJECT);
  const spy = vi.spyOn(globalThis, "structuredClone");
  try {
    await api.delegationUpgradeSnapshot(PROJECT);
    return spy.mock.calls[0]![0] as UpgradeSnapshot;
  } finally { spy.mockRestore(); }
}
const stop = (nodeId: string, actionId = "stop-" + nodeId, cascade: "none" | "descendants" = "none", expectedRevision = 1, nodeHostId = HOST): UpgradeAction => ({
  kind: "stop", actionId, nodeId, nodeHostId, cascade, stopJobs: false, expectedRevision,
});
const pause = (actionId = "pause", mode: "afterTurn" | "interrupt" = "interrupt", scope: "members" | "all" = "members", expectedEpoch = 1): UpgradeAction => ({
  kind: "pause", actionId, mode, scope, expectedEpoch,
});
const resume = (snapshot: UpgradeSnapshot, actionId = "resume"): UpgradeAction => ({
  kind: "resume", actionId, pauseId: snapshot.runControl.pauseId!, expectedEpoch: snapshot.runControl.epoch,
});
const grant = (actionId = "grant"): UpgradeAction => ({
  kind: "grant", actionId, requesterRef: ref("idle"), targetRefs: [ref("worker")], rootDelegationRef: ref("root"), maxUses: 1,
});
const decision = (choice: "approve" | "deny" = "approve", actionId = "decision"): Extract<UpgradeAction, { kind: "decision" }> => ({
  kind: "decision", actionId, approvalId: "approval-1", decision: choice, expectedDigest: "mock-routing-digest-1", expectedRevision: 1,
});
const continuation = (actionId = "continue", expectedRevision = 1): UpgradeAction => ({
  kind: "resumeContinuation", actionId, nodeId: "limited", nodeHostId: HOST, expectedRevision,
});
const retire = (review: PermanentRetirementReview, actionId = "retire"): Extract<UpgradeAction, { kind: "retire" }> => ({
  kind: "retire", actionId, payload: { cutex_session_id: review.cutex_session_id, confirmed_name: review.formal_name,
    confirmation_token: review.confirmation_token, expected_revision: review.revision },
});
const review = (api: UpgradePreviewApi, id = "soft") => api.delegationRetirementReview(PROJECT, { cutex_session_id: id });
const nonOwner = (role: "director" | "operator" | "member"): UpgradeMockOptions => ({ caller: { isOwner: false, role } });

describe("v2 preview fixtures and pagination", () => {
  it("preserves all five r265 capability names and adds the archive capability", () => {
    expect(mock.features?.new).toEqual(expect.arrayContaining([
      "delegation-tree-stop-v1", "delegation-routing-v1", "project-run-control-v1",
      "delegation-continuation-v1", "agent-activity-v1", "agent-archive-kind-v1",
    ]));
  });

  it("paginates refs, unknown lineage, follow-up links, exact redaction placeholders and unresolved edges", async () => {
    const api = createUpgradeMock(HOST);
    const first = await api.delegationUpgradeSnapshot(PROJECT);
    expect(first.nodes).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const snapshot = await all(api);
    expect(nodes(snapshot).length).toBeGreaterThanOrEqual(7);
    expect(new Set(nodes(snapshot).map(n => JSON.stringify(n.ref))).size).toBe(nodes(snapshot).length);
    expect(nodes(snapshot).every(n => n.projectId === PROJECT)).toBe(true);
    expect(node(snapshot, "root")).toMatchObject({ parentState: "none", rootState: "visible", root: ref("root") });
    expect(node(snapshot, "child").parent).toEqual(ref("root"));
    expect(node(snapshot, "grandchild").parent).toEqual(ref("child"));
    expect(node(snapshot, "remote", remoteHost)).toMatchObject({
      parent: ref("child"), parentState: "visible", parentId: null, root: ref("root"), rootId: null, parentAttemptId: "child#1",
    });
    expect(node(snapshot, "legacy")).toMatchObject({ parent: null, root: null, parentState: "unknown", rootState: "unknown", lineageState: "legacyUnknown" });
    expect(node(snapshot, "history")).toMatchObject({ closed: "completed", followUp: ref("legacy"), followUpState: "visible", followUpOf: "legacy" });
    const redacted = node(snapshot, "redacted");
    expect(redacted).toMatchObject({ parent: null, parentState: "redacted", root: null, rootState: "redacted", requester: null });
    const placeholders = snapshot.nodes.filter(n => n.kind === "redactedAncestor");
    expect(placeholders).toHaveLength(2);
    for (const placeholder of placeholders) {
      expect(Object.keys(placeholder).sort()).toEqual(["allowedActions", "expandable", "kind", "labelKey", "placeholderId", "reason"]);
      expect(placeholder).toMatchObject({ labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} });
    }
    expect(redacted.redactedParentRef?.placeholderId).not.toBe(redacted.redactedRootRef?.placeholderId);
    expect(snapshot.coverage).toBe("partial");
    expect(snapshot.unresolvedEdges).toEqual(expect.arrayContaining([
      { from: ref("redacted"), relation: "parent", reason: "redacted" },
      { from: ref("legacy"), relation: "root", reason: "legacyUnknown" },
      { from: ref("remote", remoteHost), relation: "parent", reason: "unavailable" },
    ]));
    expect(snapshot.caller).toEqual({ isOwner: true, canManageMembers: true, canOfflineMembers: true });
  });

  it("returns each page's referenced placeholders and rotates them after mutation and between callers", async () => {
    const api = createUpgradeMock(HOST);
    const first = await api.delegationUpgradeSnapshot(PROJECT);
    const second = panelSnapshotOf(await api.delegationUpgradeSnapshot(PROJECT, first.nextCursor!));
    const redacted = node(second, "redacted");
    expect(second.nodes.some(n => n.kind === "redactedAncestor" && n.placeholderId === redacted.redactedParentRef?.placeholderId)).toBe(true);
    expect(await api.delegationUpgradeSnapshot(PROJECT, first.nextCursor!)).toEqual(second);
    const old = redacted.redactedParentRef?.placeholderId;
    await act(api, stop("child"));
    expect(node(await all(api), "redacted").redactedParentRef?.placeholderId).not.toBe(old);
    expect(node(await all(createUpgradeMock(HOST, nonOwner("member"))), "redacted").redactedParentRef?.placeholderId).not.toBe(old);
    await expect(act(api, stop(old!))).rejects.toThrow("node_not_found");
  });

  it("rejects malformed, wrong-project, other-factory and stale cursors", async () => {
    const api = createUpgradeMock(HOST);
    const first = await api.delegationUpgradeSnapshot(PROJECT);
    await expect(api.delegationUpgradeSnapshot("other", first.nextCursor!)).rejects.toThrow("invalid_or_stale_cursor");
    await expect(createUpgradeMock(HOST).delegationUpgradeSnapshot(PROJECT, first.nextCursor!)).rejects.toThrow("invalid_or_stale_cursor");
    const prefix = first.nextCursor!.slice(0, first.nextCursor!.lastIndexOf(":") + 1);
    for (const suffix of ["", "0", "1", "4junk", "999999999999999999", "20"]) {
      await expect(api.delegationUpgradeSnapshot(PROJECT, prefix + suffix)).rejects.toThrow("invalid_or_stale_cursor");
    }
    await act(api, stop("root"));
    await expect(api.delegationUpgradeSnapshot(PROJECT, first.nextCursor!)).rejects.toThrow("invalid_or_stale_cursor");
  });

  it("seeds fresh tree activity only once and has an idle member idle for three observed hours", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-11-02T12:30:00.000Z");
      vi.setSystemTime(now);
      const api = createUpgradeMock(HOST);
      const initial = await all(api);
      expect(nodes(initial).filter(n => n.execution === "running").every(n => n.lastActivityAt === now.toISOString())).toBe(true);
      const idle = member(initial, "idle");
      expect(Date.parse(idle.observedAt) - Date.parse(idle.lastActivityAt!)).toBe(10800 * 1000);
      vi.setSystemTime(new Date(now.getTime() + 3600 * 1000));
      expect((await all(api)).nodes).toEqual(initial.nodes);
      expect(node(await all(api, "later"), "root").lastActivityAt).toBe(new Date(Date.now()).toISOString());
    } finally { vi.useRealTimers(); }
  });

  it("keeps lifecycle arrays separate from caller authorization and includes three historical audit examples", async () => {
    const snapshot = await all(createUpgradeMock(HOST, nonOwner("member")));
    expect(member(snapshot, "idle").allowedActions).toContain("permanentRetire");
    expect(snapshot.caller.isOwner).toBe(false);
    expect(member(snapshot, "soft")).toMatchObject({ archiveKind: "soft", restorable: true, restoreBlockers: [], allowedActions: ["restore", "permanentRetire"] });
    expect(member(snapshot, "permanent")).toMatchObject({ archiveKind: "permanent", restorable: false, allowedActions: [] });
    expect(member(snapshot, "unknown")).toMatchObject({ activityStatus: "unknown", lastActivityAt: null });
    expect(node(snapshot, "redactedActor").routingApproval).toMatchObject({
      state: "approved", decidedBy: { kind: "agent", hostId: null, sessionId: null, name: null, redacted: true }, decisionAuthority: "director",
    });
    expect(node(snapshot, "approved").routingApproval?.decidedBy).toEqual({ kind: "owner", hostId: null, sessionId: null, name: null, redacted: false });
    expect(node(snapshot, "unknown-audit").routingApproval).toMatchObject({ state: "approved", decidedBy: null, decisionAuthority: null, decidedAt: null });
  });

  it("isolates projects, factories, snapshots and cached results", async () => {
    const api = createUpgradeMock(HOST);
    const snapshot = await all(api);
    snapshot.members[0]!.allowedActions!.push("permanentRetire");
    node(snapshot, "root").title = "changed";
    expect(node(await all(api), "root").title).not.toBe("changed");
    const result = await act(api, stop("root"));
    result.snapshot.nodes.length = 0;
    expect((await act(api, stop("root"))).snapshot.nodes.length).toBeGreaterThan(7);
    expect(node(await all(api, "other"), "root").closed).toBeNull();
    expect(node(await all(createUpgradeMock(HOST)), "root").closed).toBeNull();
  });
});

describe("idempotence and compare-and-swap", () => {
  it("replays the first result regardless of property order or later state and rejects changed payload or project", async () => {
    const api = createUpgradeMock(HOST);
    const action = stop("child", "stable");
    const first = await act(api, action);
    await act(api, stop("grandchild"));
    const reordered = Object.fromEntries(Object.entries(action).reverse()) as UpgradeAction;
    expect(await act(api, reordered)).toEqual(first);
    expect((await all(api)).revision).toBe(String(Number(first.snapshot.revision) + 1));
    await expect(act(api, { ...stop("child", "stable"), cascade: "descendants" } as UpgradeAction)).rejects.toThrow("action_id_payload_conflict");
    await expect(api.delegationUpgradeAction("other", action)).rejects.toThrow("action_id_payload_conflict");
  });
  it("caches definite rejections and rejects empty IDs", async () => {
    const api = createUpgradeMock(HOST);
    const action = stop("root", "stale", "none", 42);
    await expect(act(api, action)).rejects.toThrow("revision_conflict");
    await expect(act(api, action)).rejects.toThrow("revision_conflict");
    await expect(act(api, stop("root", "stale"))).rejects.toThrow("action_id_payload_conflict");
    await expect(act(api, stop("root", " "))).rejects.toThrow("action_id_required");
    expect((await all(api)).revision).toBe("1");
  });
  it("checks policy CAS and invalidates pending approval without rewriting historical actors", async () => {
    const api = createUpgradeMock(HOST);
    const historical = node(await all(api), "redactedActor").routingApproval;
    const result = await act(api, { kind: "policy", actionId: "policy", memberMode: "open", expectedRevision: 1 });
    expect(result.snapshot.policy).toMatchObject({ memberMode: "open", revision: 2 });
    expect(node(result.snapshot, "approval").routingApproval).toMatchObject({ state: "stale", allowedActions: { approve: false, deny: false } });
    expect(node(result.snapshot, "redactedActor").routingApproval).toEqual(historical);
    await expect(act(api, { kind: "policy", actionId: "old", memberMode: "allowlistedOnly", expectedRevision: 1 })).rejects.toThrow("revision_conflict");
    expect((await act(api, { kind: "policy", actionId: "new", memberMode: "allowlistedOnly", expectedRevision: 2 })).snapshot.policy.memberMode).toBe("allowlistedOnly");
  });
});

describe("stop and project run control", () => {
  it("stops only self with cascade none and keeps unrelated work and completed history", async () => {
    const api = createUpgradeMock(HOST);
    const result = await act(api, stop("child"));
    expect(result.effectState).toBe("committed");
    expect(result.message).toContain("Mock preview");
    expect(node(result.snapshot, "child").closed).toBe("stopped");
    expect(node(result.snapshot, "grandchild").execution).toBe("running");
    expect(node(result.snapshot, "history").closed).toBe("completed");
    expect(result.snapshot.interruptedDelegations).toEqual([ref("child")]);
  });
  it("cascades explicit cross-host edges without guessing redacted/legacy/follow-up ancestry", async () => {
    const api = createUpgradeMock(HOST);
    const result = await act(api, stop("root", "cascade", "descendants"));
    expect(result.effectState).toBe("partial");
    for (const id of ["root", "child", "grandchild", "limited", "approval"]) expect(node(result.snapshot, id).closed).toBe("stopped");
    expect(node(result.snapshot, "remote", remoteHost).execution).toBe("running");
    expect(node(result.snapshot, "redacted").closed).toBeNull();
    expect(node(result.snapshot, "legacy").closed).toBe("completed");
    expect(node(result.snapshot, "history").closed).toBe("completed");
    expect(node(result.snapshot, "limited").continuation?.state).toBe("cancelled");
    expect(node(result.snapshot, "approval").routingApproval?.allowedActions).toEqual({ approve: false, deny: false });
    expect(result.snapshot.interruptedDelegations).not.toContainEqual(ref("remote", remoteHost));
    await expect(act(api, stop("root", "again", "none", 2))).rejects.toThrow("action_not_allowed");
  });
  it("does not collide identical IDs on different hosts or fabricate remote receipt", async () => {
    const api = createUpgradeMock(HOST);
    const local = await act(api, stop("same-id"));
    expect(node(local.snapshot, "same-id").closed).toBe("stopped");
    expect(node(local.snapshot, "same-id", remoteHost).closed).toBeNull();
    const remote = await act(api, stop("same-id", "remote", "none", 1, remoteHost));
    expect(remote.effectState).toBe("partial");
    expect(node(remote.snapshot, "same-id", remoteHost).closed).toBeNull();
    await expect(act(api, stop("remote"))).rejects.toThrow("node_not_found");
  });
  it.each([true, false])("checks stopSelf and stop independently (stopSelf=%s)", async (stopSelf) => {
    const api = createUpgradeMock(HOST);
    const target = node(await fixtureState(api), "child");
    target.allowedActions.stopSelf = stopSelf; target.allowedActions.stop = !stopSelf;
    const denied = stop("child", "denied", stopSelf ? "descendants" : "none");
    await expect(act(api, denied)).rejects.toThrow("action_not_allowed");
    const result = await act(api, stop("child", "allowed", stopSelf ? "none" : "descendants"));
    expect(node(result.snapshot, "child").closed).toBe("stopped");
  });
  it("rejects stale revisions, completed nodes, omitted cascade and unsupported stopJobs", async () => {
    const api = createUpgradeMock(HOST);
    await expect(act(api, stop("child", "stale", "none", 0))).rejects.toThrow("revision_conflict");
    await expect(act(api, stop("history"))).rejects.toThrow("action_not_allowed");
    const missing = { ...stop("root", "missing") };
    if (missing.kind === "stop") delete (missing as Partial<typeof missing>).cascade;
    await expect(act(api, missing)).rejects.toThrow("invalid_stop_request");
    const jobs = { ...stop("root", "jobs"), stopJobs: true };
    await expect(act(api, jobs as unknown as UpgradeAction)).rejects.toThrow("invalid_stop_request");
    expect((await all(api)).revision).toBe("1");
  });
  it("resume never requeues interrupted work or revives explicit stop and leaves offline members unchanged", async () => {
    const api = createUpgradeMock(HOST);
    const paused = await act(api, pause());
    expect(paused.effectState).toBe("partial");
    expect(node(paused.snapshot, "root").execution).toBe("interrupted");
    expect(node(paused.snapshot, "director-work").execution).toBe("running");
    const stopped = await act(api, stop("root", "stopped", "none", 2));
    const resumed = await act(api, resume(paused.snapshot));
    expect(resumed.effectState).toBe("partial");
    for (const id of ["root", "grandchild", "director-work", "limited"]) expect(node(resumed.snapshot, id)).toEqual(node(stopped.snapshot, id));
    expect(resumed.snapshot.members).toEqual(stopped.snapshot.members);
    expect(resumed.snapshot.interruptedDelegations).toEqual(stopped.snapshot.interruptedDelegations);
    expect(resumed.snapshot.interruptedDelegations).toContainEqual(ref("grandchild"));
    expect(resumed.snapshot.runControl).toMatchObject({ epoch: 3, pauseId: null, phase: "partial" });
  });
  it("afterTurn does not interrupt; all scope includes director but does not resume their interrupted work", async () => {
    const api = createUpgradeMock(HOST);
    const before = await all(api);
    const paused = await act(api, pause("after", "afterTurn", "all"));
    expect(node(paused.snapshot, "root")).toEqual(node(before, "root"));
    expect(paused.snapshot.interruptedDelegations).toEqual([]);
    await act(api, resume(paused.snapshot));
    const interrupted = await act(api, pause("interrupt-all", "interrupt", "all", 3));
    const resumed = await act(api, resume(interrupted.snapshot, "resume-all"));
    expect(node(resumed.snapshot, "director-work").execution).toBe("interrupted");
    expect(resumed.snapshot.interruptedDelegations).toContainEqual(ref("director-work"));
  });
  it("checks all-scope permission independently from pause and refuses forged all-scope resume", async () => {
    const api = createUpgradeMock(HOST, nonOwner("director"));
    expect((await all(api)).runControl.allowedActions).toEqual({ pause: true, pauseAll: false, resume: false });
    const state = await fixtureState(api);
    state.runControl.allowedActions.pauseAll = true;
    await expect(act(api, pause("all", "interrupt", "all"))).rejects.toThrow("action_not_allowed");
    const paused = await act(api, pause());
    state.runControl.scope = "all"; state.runControl.allowedActions.resume = true;
    await expect(act(api, resume(paused.snapshot))).rejects.toThrow("action_not_allowed");
  });
  it("owner pauseAll does not depend on the members-pause flag", async () => {
    const api = createUpgradeMock(HOST);
    (await fixtureState(api)).runControl.allowedActions.pause = false;
    const result = await act(api, pause("all", "interrupt", "all"));
    expect(node(result.snapshot, "director-work").execution).toBe("interrupted");
  });
  it("checks epoch, pause identity and current allowedActions", async () => {
    const api = createUpgradeMock(HOST);
    await expect(act(api, { kind: "resume", actionId: "not-paused", pauseId: "absent", expectedEpoch: 1 })).rejects.toThrow("pause_id_conflict");
    const paused = await act(api, pause());
    await expect(act(api, pause("stale"))).rejects.toThrow("epoch_conflict");
    await expect(act(api, pause("again", "interrupt", "members", 2))).rejects.toThrow("action_not_allowed");
    const wrong = { ...resume(paused.snapshot, "wrong"), pauseId: "wrong" } as UpgradeAction;
    await expect(act(api, wrong)).rejects.toThrow("pause_id_conflict");
    await act(api, resume(paused.snapshot));
    expect((await all(api)).runControl.epoch).toBe(3);
  });
});

describe("routing audit and independently authorized grants", () => {
  it.each(["approve", "deny"] as const)("records authenticated owner audit for %s and preserves idempotence", async choice => {
    const api = createUpgradeMock(HOST);
    const action = { ...decision(choice), decisionNote: "复核通过" };
    await expect(act(api, { ...action, actionId: "digest", expectedDigest: "stale" })).rejects.toThrow("digest_conflict");
    await expect(act(api, { ...action, actionId: "revision", expectedRevision: 2 })).rejects.toThrow("revision_conflict");
    const result = await act(api, action);
    expect(node(result.snapshot, "approval").routingApproval).toMatchObject({
      state: choice === "approve" ? "approved" : "denied", decisionAuthority: "owner",
      decidedBy: { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false },
      decisionNote: "复核通过", allowedActions: { approve: false, deny: false },
    });
    expect(node(result.snapshot, "approval").routingApproval?.decidedAt).toEqual(expect.any(String));
    expect(node(result.snapshot, "approval").closed).toBe(choice === "deny" ? "routing_denied" : null);
    expect(await act(api, action)).toEqual(result);
    await expect(act(api, { ...action, actionId: "second", expectedRevision: 2 })).rejects.toThrow("approval_already_decided");
  });
  it("records current Director actor from the authenticated entry", async () => {
    const api = createUpgradeMock(HOST, nonOwner("director"));
    const result = await act(api, decision());
    expect(node(result.snapshot, "approval").routingApproval).toMatchObject({
      decidedBy: { kind: "agent", hostId: HOST, sessionId: "director", name: "Preview Director", redacted: false }, decisionAuthority: "director",
    });
  });
  it.each(["operator", "member"] as const)("does not allow %s to route merely because lifecycle candidates exist", async role => {
    const api = createUpgradeMock(HOST, nonOwner(role));
    await expect(act(api, decision())).rejects.toThrow("action_not_allowed");
    await expect(act(api, grant())).rejects.toThrow("action_not_allowed");
    await expect(act(api, { kind: "policy", actionId: "policy", memberMode: "open", expectedRevision: 1 })).rejects.toThrow("action_not_allowed");
  });
  it("checks approve and deny independently and refuses stale authority epochs", async () => {
    const api = createUpgradeMock(HOST);
    const approval = node(await fixtureState(api), "approval").routingApproval!;
    approval.allowedActions.approve = false;
    await expect(act(api, decision("approve", "forbidden"))).rejects.toThrow("action_not_allowed");
    expect((await act(api, decision("deny"))).effectState).toBe("committed");
    const stale = createUpgradeMock(HOST);
    node(await fixtureState(stale), "approval").routingApproval!.authorityEpoch = 2;
    await expect(act(stale, decision())).rejects.toThrow("action_not_allowed");
  });
  it.each(["line\nbreak", "x".repeat(201)])("rejects invalid audit notes without deciding (%s)", async decisionNote => {
    const api = createUpgradeMock(HOST);
    await expect(act(api, { ...decision(), decisionNote })).rejects.toThrow("invalid_decision_note");
    expect(node(await all(api), "approval").routingApproval?.state).toBe("pending");
  });
  it("accepts 200 Unicode scalar values and rejects injected identity fields", async () => {
    const api = createUpgradeMock(HOST);
    const injected = { ...decision(), actionId: "spoof", decidedBy: { kind: "owner" } };
    await expect(act(api, injected)).rejects.toThrow("invalid_request_fields");
    const result = await act(api, { ...decision(), decisionNote: "😀".repeat(200) });
    expect(node(result.snapshot, "approval").routingApproval?.decisionNote).toBe("😀".repeat(200));
  });
  it("creates complete cross-host grant refs, keeps canonical identities and revokes once", async () => {
    const api = createUpgradeMock(HOST);
    const action: UpgradeAction = { kind: "grant", actionId: "grant", requesterRef: ref("idle"),
      targetRefs: [ref("worker"), ref("remote-worker", remoteHost)], rootDelegationRef: ref("root"), maxUses: 1 };
    const result = await act(api, action);
    const item = result.snapshot.grants.items[0]!;
    expect(item).toMatchObject({
      projectId: PROJECT, requesterRef: ref("idle"), targetRefs: [ref("worker"), ref("remote-worker", remoteHost)], rootDelegationRef: ref("root"), purpose: "review", maxUses: 1, usedCount: 0,
      revision: 1, revokedAt: null, allowedActions: { revoke: true },
    });
    await act(api, action);
    expect((await all(api)).grants.items).toHaveLength(1);
    const revoke: UpgradeAction = { kind: "revoke", actionId: "revoke", grantId: item.id, expectedRevision: item.revision };
    const revoked = await act(api, revoke);
    expect(revoked.snapshot.grants.items[0]?.revokedAt).toEqual(expect.any(String));
    expect(await act(api, revoke)).toEqual(revoked);
    await expect(act(api, { ...revoke, actionId: "new-revoke" })).rejects.toThrow("revision_conflict");
  });
  it("uses collection.create and item.revoke independently from policy.update", async () => {
    const api = createUpgradeMock(HOST);
    const state = await fixtureState(api);
    state.policy.allowedActions.update = false;
    state.grants.allowedActions.create = false;
    await expect(act(api, grant("no-create"))).rejects.toThrow("action_not_allowed");
    state.grants.allowedActions.create = true;
    const result = await act(api, grant());
    const item = state.grants.items[0]!;
    state.grants.allowedActions.create = false; item.allowedActions.revoke = false;
    await expect(act(api, { kind: "revoke", actionId: "no-revoke", grantId: item.id, expectedRevision: item.revision })).rejects.toThrow("action_not_allowed");
    item.allowedActions.revoke = true;
    expect((await act(api, { kind: "revoke", actionId: "revoke", grantId: result.snapshot.grants.items[0]!.id, expectedRevision: result.snapshot.grants.items[0]!.revision })).effectState).toBe("committed");
  });
  it("retains the canonical foreign requester ID alongside its unambiguous ref", async () => {
    const api = createUpgradeMock(HOST);
    const result = await act(api, { kind: "grant", actionId: "foreign-requester", requesterRef: ref("remote-worker", remoteHost),
      targetRefs: [ref("worker")], rootDelegationRef: ref("root"), maxUses: 1 });
    expect(result.snapshot.grants.items[0]).toMatchObject({ requesterRef: ref("remote-worker", remoteHost) });
  });
  it("does not turn a delegated stop or members-pause scope into routing or owner permissions", async () => {
    const api = createUpgradeMock(HOST, { caller: { isOwner: false, role: "operator", canPauseMembers: true, canStop: true } });
    expect((await act(api, stop("child"))).effectState).toBe("committed");
    await act(api, pause());
    await expect(act(api, grant())).rejects.toThrow("action_not_allowed");
    await expect(review(api)).rejects.toThrow("owner_required");
  });
  it.each([["unknown", "worker"], ["idle", "unknown"]])("allows reviewed unknown activity %s to %s", async (requesterId, targetId) => {
    const api = createUpgradeMock(HOST);
    const result = await act(api, { kind: "grant", actionId: "grant", requesterRef: ref(requesterId),
      targetRefs: [ref(targetId)], rootDelegationRef: ref("root"), maxUses: 1 });
    expect(result.snapshot.grants.items).toHaveLength(1);
    expect(member(result.snapshot, "unknown").activityStatus).toBe("unknown");
  });
  it("rejects self, empty or duplicate targets, archived identities, nonroots, unknown refs and invalid budgets", async () => {
    const api = createUpgradeMock(HOST);
    const base = { kind: "grant", requesterRef: ref("idle"), targetRefs: [ref("worker")], rootDelegationRef: ref("root"), maxUses: 1 } as const;
    const cases = [
      { targetRefs: [ref("idle")] }, { targetRefs: [] }, { targetRefs: [ref("worker"), ref("worker")] },
      { requesterRef: ref("permanent") }, { rootDelegationRef: ref("child") }, { requesterRef: ref("idle", remoteHost) },
    ];
    for (const [i, fields] of cases.entries()) await expect(act(api, { ...base, targetRefs: [...base.targetRefs], ...fields, actionId: "invalid-" + i })).rejects.toThrow();
    const invalid = { ...base, targetRefs: [...base.targetRefs], actionId: "budget", maxUses: 2 };
    await expect(act(api, invalid as unknown as UpgradeAction)).rejects.toThrow("invalid_grant_uses");
    expect((await all(api)).grants.items).toEqual([]);
  });
  it("expires existing root-bound grants on root closure and keeps their historical entry revocable", async () => {
    const api = createUpgradeMock(HOST);
    await act(api, grant());
    const stopped = await act(api, stop("root"));
    expect(stopped.snapshot.grants.items[0]).toMatchObject({ expiresAt: expect.any(String), revokedAt: null, allowedActions: { revoke: true } });
    await expect(act(api, grant("closed-root"))).rejects.toThrow("action_not_allowed");
    expect((await all(api)).grants.items).toHaveLength(1);
  });
});

describe("bounded continuation and member lifecycle", () => {
  it("uses continuation CAS, resets round to one and preserves 32-round/86400-second bounds", async () => {
    const api = createUpgradeMock(HOST);
    const initial = node(await all(api), "limited");
    expect(initial.continuation).toMatchObject({ revision: 1, maxRounds: 32, maxElapsedSeconds: 86400, roundNumber: 32 });
    expect(initial.revision).not.toBe(initial.continuation?.revision);
    await expect(act(api, continuation("node-version", initial.revision))).rejects.toThrow("revision_conflict");
    const result = await act(api, continuation());
    expect(node(result.snapshot, "limited")).toMatchObject({ execution: "queued", resumeEvidence: { kind: "newAttempt" },
      continuation: { state: "resuming", revision: 2, roundNumber: 1, maxRounds: 32, maxElapsedSeconds: 86400 }, allowedActions: { resumeContinuation: false } });
    expect(await act(api, continuation())).toEqual(result);
    await expect(act(api, continuation("stale"))).rejects.toThrow("revision_conflict");
    await expect(act(api, continuation("again", 2))).rejects.toThrow("action_not_allowed");
  });
  it.each(["director", "operator", "member"] as const)("keeps continuation owner-only even if a %s forges the display flag", async role => {
    const api = createUpgradeMock(HOST, nonOwner(role));
    node(await fixtureState(api), "limited").allowedActions.resumeContinuation = true;
    await expect(act(api, continuation())).rejects.toThrow("action_not_allowed");
  });
  it("requires continuation permission, limited state, active target and running project", async () => {
    for (const change of ["permission", "state", "offline", "archive", "pause", "stop"]) {
      const api = createUpgradeMock(HOST);
      const state = await fixtureState(api);
      if (change === "permission") node(state, "limited").allowedActions.resumeContinuation = false;
      if (change === "state") node(state, "limited").continuation!.state = "ready";
      if (change === "offline") member(state, "worker").activityStatus = "offline";
      if (change === "archive") member(state, "worker").archiveKind = "soft";
      if (change === "pause") await act(api, pause());
      if (change === "stop") await act(api, stop("limited", "stop", "none", 2));
      await expect(act(api, continuation("continue", change === "stop" ? 2 : 1))).rejects.toThrow("action_not_allowed");
    }
  });
  it("does not expose owner declaration or accept a fabricated declare action", async () => {
    const api = createUpgradeMock(HOST);
    expect(nodes(await all(api)).every(n => n.allowedActions.declareContinuation === false)).toBe(true);
    const unsupported = { kind: "declareContinuation", actionId: "declare" };
    await expect(act(api, unsupported as unknown as UpgradeAction)).rejects.toThrow("unsupported_action");
  });
  it("offlines observed idle, softly archives and restores offline while retaining lifecycle projections", async () => {
    const api = createUpgradeMock(HOST);
    expect(member((await act(api, { kind: "offline", actionId: "offline", memberId: "idle" })).snapshot, "idle").activityStatus).toBe("offline");
    const archived = await act(api, { kind: "archive", actionId: "archive", memberId: "idle" });
    expect(member(archived.snapshot, "idle")).toMatchObject({ archiveKind: "soft", restorable: true, restoreBlockers: [], allowedActions: ["restore", "permanentRetire"] });
    const restored = await act(api, { kind: "restore", actionId: "restore", memberId: "idle" });
    expect(member(restored.snapshot, "idle")).toMatchObject({ archiveKind: "active", restorable: false, activityStatus: "offline", restoreBlockers: ["not_archived"] });
  });
  it.each([7199, 7200, 7201])("validates 7200-second observed idle threshold (%i)", async seconds => {
    const api = createUpgradeMock(HOST);
    const idle = member(await fixtureState(api), "idle");
    idle.lastActivityAt = new Date(Date.parse(idle.observedAt) - seconds * 1000).toISOString();
    const result = act(api, { kind: "offline", actionId: "offline", memberId: "idle" });
    if (seconds < 7200) await expect(result).rejects.toThrow("action_not_allowed");
    else expect(member((await result).snapshot, "idle").activityStatus).toBe("offline");
  });
  it.each([null, "invalid", "2026-10-26T02:00:00.000Z"])("rejects absent, invalid or future activity (%s)", async lastActivityAt => {
    const api = createUpgradeMock(HOST);
    member(await fixtureState(api), "idle").lastActivityAt = lastActivityAt;
    await expect(act(api, { kind: "offline", actionId: "offline", memberId: "idle" })).rejects.toThrow("action_not_allowed");
  });
  it("rejects an invalid observation timestamp even if the activity timestamp is known", async () => {
    const api = createUpgradeMock(HOST);
    member(await fixtureState(api), "idle").observedAt = "invalid";
    await expect(act(api, { kind: "offline", actionId: "offline", memberId: "idle" })).rejects.toThrow("action_not_allowed");
  });
  it("does not use lifecycle strings as authorization, and member-management/offline permissions are independent", async () => {
    const api = createUpgradeMock(HOST, nonOwner("member"));
    expect(member(await all(api), "soft").allowedActions).toContain("restore");
    for (const kind of ["offline", "archive", "restore"] as const) {
      await expect(act(api, { kind, actionId: kind, memberId: kind === "restore" ? "soft" : "idle" })).rejects.toThrow("action_not_allowed");
    }
    const scoped = createUpgradeMock(HOST, { caller: { isOwner: false, canManageMembers: true, canOfflineMembers: false } });
    await expect(act(scoped, { kind: "offline", actionId: "offline", memberId: "idle" })).rejects.toThrow("action_not_allowed");
    expect((await act(scoped, { kind: "archive", actionId: "archive", memberId: "idle" })).effectState).toBe("committed");
  });
  it("checks all restore conditions and never restores permanent/blocked archives", async () => {
    for (const id of ["permanent", "blocked"]) {
      const api = createUpgradeMock(HOST);
      await expect(act(api, { kind: "restore", actionId: "restore", memberId: id })).rejects.toThrow(id === "permanent" ? "permanent_retirement" : "restore_blocked");
    }
    for (const field of ["restorable", "allowedActions"]) {
      const api = createUpgradeMock(HOST);
      const soft = member(await fixtureState(api), "soft");
      if (field === "restorable") soft.restorable = false;
      else soft.allowedActions = ["permanentRetire"];
      await expect(act(api, { kind: "restore", actionId: "restore", memberId: "soft" })).rejects.toThrow("action_not_allowed");
    }
  });
  it.each(["unknown", "worker", "director"])("does not offline or softly archive %s", async id => {
    const api = createUpgradeMock(HOST);
    for (const kind of ["offline", "archive"] as const) await expect(act(api, { kind, actionId: kind, memberId: id })).rejects.toThrow("action_not_allowed");
  });
});

describe("owner-only permanent retirement review and execute", () => {
  it("uses exact snake_case review and execute shapes, a 300s token, and committed-only success", async () => {
    const api = createUpgradeMock(HOST);
    const before = Math.floor(Date.now() / 1000);
    const confirmation = await review(api);
    expect(Object.keys(confirmation).sort()).toEqual(["confirmation_token", "cutex_session_id", "expires_at_unix", "formal_name", "revision", "runtime_generation"]);
    expect(confirmation.expires_at_unix).toBeGreaterThanOrEqual(before + 300);
    expect(confirmation.expires_at_unix).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300);
    const result = await act(api, retire(confirmation));
    expect(result.retirementStage).toBe("committed");
    expect(result.effectState).toBe("committed");
    expect(member(result.snapshot, "soft")).toMatchObject({ archiveKind: "permanent", restorable: false, restoreBlockers: ["permanently_closed"], allowedActions: [] });
    await expect(act(api, { kind: "restore", actionId: "restore", memberId: "soft" })).rejects.toThrow("permanent_retirement");
  });
  it.each(["director", "operator", "member"] as const)("does not admit %s to review or execute based on lifecycle candidates", async role => {
    const api = createUpgradeMock(HOST, nonOwner(role));
    expect(member(await all(api), "soft").allowedActions).toContain("permanentRetire");
    await expect(review(api)).rejects.toThrow("owner_required");
    const confirmation = await review(createUpgradeMock(HOST));
    await expect(act(api, retire(confirmation))).rejects.toThrow("owner_required");
  });
  it("requires review from this factory and project and rejects additional identity/action fields", async () => {
    const api = createUpgradeMock(HOST);
    const foreign = await review(createUpgradeMock(HOST));
    await expect(act(api, retire(foreign))).rejects.toThrow("archive_confirmation_invalid");
    const confirmation = await review(api);
    await expect(api.delegationUpgradeAction("other", retire(confirmation, "wrong-project"))).rejects.toThrow("archive_confirmation_invalid");
    const injectedReview = { cutex_session_id: "soft", owner: true };
    await expect(api.delegationRetirementReview(PROJECT, injectedReview)).rejects.toThrow("invalid_request_fields");
    const base = retire(confirmation, "injected");
    const injectedExecute = { ...base, payload: { ...base.payload, action_id: "different" } };
    await expect(act(api, injectedExecute)).rejects.toThrow("invalid_request_fields");
  });
  it("requires exact confirmation name and rejects revision or target substitution", async () => {
    const api = createUpgradeMock(HOST);
    const confirmation = await review(api);
    for (const [i, changes] of [
      { confirmed_name: confirmation.formal_name.toLowerCase() }, { confirmed_name: confirmation.formal_name + " " },
      { expected_revision: confirmation.revision + 1 }, { expected_revision: -1 }, { cutex_session_id: "idle" },
    ].entries()) {
      const action = retire(confirmation, "invalid-" + i);
      await expect(act(api, { ...action, payload: { ...action.payload, ...changes } })).rejects.toThrow(
        i < 2 ? "permanent_retirement_name_confirmation_required" : i < 4 ? "archive_confirmation_target_revision_mismatch" : "archive_confirmation_invalid");
    }
    expect(member(await all(api), "soft").archiveKind).toBe("soft");
  });
  it("rejects stale target revision and formal name changes before execution", async () => {
    const api = createUpgradeMock(HOST);
    const confirmation = await review(api, "idle");
    await act(api, { kind: "offline", actionId: "offline", memberId: "idle" });
    await expect(act(api, retire(confirmation))).rejects.toThrow("archive_confirmation_target_revision_mismatch");
    const renamed = createUpgradeMock(HOST);
    const nameReview = await review(renamed);
    member(await fixtureState(renamed), "soft").name = "new formal name";
    await expect(act(renamed, retire(nameReview))).rejects.toThrow("archive_confirmation_stale");
  });
  it.each(["runtimeGeneration", "nativeThreadId"] as const)("rejects changed occurrence %s before stopping", async field => {
    const retirement: NonNullable<UpgradeMockOptions["retirement"]> = { runtimeGeneration: 7, nativeThreadId: "thread-1" };
    const api = createUpgradeMock(HOST, { retirement });
    const confirmation = await review(api, "worker");
    if (field === "runtimeGeneration") retirement.runtimeGeneration = 8;
    else retirement.nativeThreadId = "thread-2";
    await expect(act(api, retire(confirmation))).rejects.toThrow("archive_confirmation_occurrence_changed");
    expect(member(await all(api), "worker").activityStatus).toBe("busy");
  });
  it("expires unexecuted tokens at 300 seconds but replays a committed action after expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
      const api = createUpgradeMock(HOST);
      const unused = await review(api, "idle");
      const confirmation = await review(api);
      const action = retire(confirmation, "stable-retire");
      const result = await act(api, action);
      vi.setSystemTime(new Date("2026-10-26T10:05:00Z"));
      await expect(act(api, retire(unused, "expired"))).rejects.toThrow("archive_confirmation_expired");
      expect(await act(api, action)).toEqual(result);
      await expect(act(api, { ...action, payload: { ...action.payload, confirmed_name: "changed" } })).rejects.toThrow("action_id_payload_conflict");
      await expect(act(api, retire(confirmation, "new-action"))).rejects.toThrow("archive_confirmation_already_used");
    } finally { vi.useRealTimers(); }
  });
  it("rejects an unfinished execute replay after expiry and keeps its target pending", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
      const api = createUpgradeMock(HOST, { retirement: { stage: "stopped_not_archived" } });
      const action = retire(await review(api));
      const result = await act(api, action);
      expect(result.retirementStage).toBe("stopped_not_archived");
      vi.setSystemTime(new Date("2026-10-26T10:05:00Z"));
      await expect(act(api, action)).rejects.toThrow("archive_confirmation_expired");
      await expect(review(api)).rejects.toThrow("permanent_retirement_pending");
      expect(member(await all(api), "soft").archiveKind).toBe("soft");
    } finally { vi.useRealTimers(); }
  });
  it("accepts an exact Unicode formal name without trimming or normalizing it", async () => {
    const api = createUpgradeMock(HOST);
    member(await fixtureState(api), "soft").name = "成员甲🌱 e\u0301";
    const confirmation = await review(api);
    const action = retire(confirmation);
    expect(action.payload.confirmed_name).toBe("成员甲🌱 e\u0301");
    expect((await act(api, action)).retirementStage).toBe("committed");
  });
  it.each(["stopped_not_archived", "uncertain"] as const)("never reports %s as committed or permanently archived", async stage => {
    const retirement: NonNullable<UpgradeMockOptions["retirement"]> = { stage, runtimeGeneration: 1 };
    const api = createUpgradeMock(HOST, { retirement });
    const action = retire(await review(api, "worker"));
    const result = await act(api, action);
    expect(result.retirementStage).toBe(stage);
    expect(result.effectState).toBe(stage === "uncertain" ? "unknown" : "partial");
    expect(member(result.snapshot, "worker").archiveKind).toBe("active");
    if (stage === "stopped_not_archived") {
      expect(member(result.snapshot, "worker").activityStatus).toBe("offline");
      expect(node(result.snapshot, "root").closed).toBe("stopped");
    } else expect(member(result.snapshot, "worker").activityStatus).toBe("busy");
    expect(await act(api, action)).toEqual(result);
    await expect(act(api, { ...action, actionId: "another" })).rejects.toThrow("permanent_retirement_pending");
    retirement.runtimeGeneration = 2;
    await expect(act(api, action)).rejects.toThrow("archive_confirmation_occurrence_changed");
  });
  it.each(["uncertain", "stopped_not_archived"] as const)("fences a %s target against new reviews and actions, including tokens obtained earlier", async stage => {
    const retirement: NonNullable<UpgradeMockOptions["retirement"]> = { stage };
    const api = createUpgradeMock(HOST, { retirement });
    const firstReview = await review(api);
    const earlierUnusedReview = await review(api);
    const action = retire(firstReview, "original-action");
    const result = await act(api, action);
    expect(member(result.snapshot, "soft").archiveKind).toBe("soft");
    await expect(review(api)).rejects.toThrow("permanent_retirement_pending");
    await expect(api.delegationRetirementReview("another-project", { cutex_session_id: "soft" })).rejects.toThrow("permanent_retirement_pending");
    await expect(act(api, retire(earlierUnusedReview, "fresh-action"))).rejects.toThrow("permanent_retirement_pending");
    await expect(act(api, { ...action, actionId: "new-action" })).rejects.toThrow("permanent_retirement_pending");
    await expect(act(api, { ...action, payload: { ...action.payload, confirmed_name: "different" } })).rejects.toThrow("action_id_payload_conflict");
    retirement.stage = "committed";
    expect(await act(api, action)).toEqual(result);
    expect((await all(api)).revision).toBe(result.snapshot.revision);
    expect(member(await all(api), "soft").archiveKind).toBe("soft");
    expect((await review(api, "idle")).cutex_session_id).toBe("idle");
  });
  it.each(["committed", "uncertain", "stopped_not_archived"] as const)("revalidates owner and scope before replaying a %s receipt, including after token expiry", async stage => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
      const caller = { isOwner: true, canManageMembers: true };
      const api = createUpgradeMock(HOST, { caller, retirement: { stage } });
      const action = retire(await review(api));
      const result = await act(api, action);
      vi.setSystemTime(new Date("2026-10-26T10:06:00Z"));
      caller.isOwner = false;
      await expect(act(api, action)).rejects.toThrow("owner_required");
      caller.isOwner = true;
      caller.canManageMembers = false;
      await expect(act(api, action)).rejects.toThrow("owner_required");
      caller.canManageMembers = true;
      if (stage === "committed") expect(await act(api, action)).toEqual(result);
      else await expect(act(api, action)).rejects.toThrow("archive_confirmation_expired");
    } finally { vi.useRealTimers(); }
  });
  it.each(["uncertain", "stopped_not_archived"] as const)("rejects changed thread and revision on unfinished %s execute replay without clearing pending", async stage => {
    const retirement: NonNullable<UpgradeMockOptions["retirement"]> = { stage, nativeThreadId: "original-thread" };
    const api = createUpgradeMock(HOST, { retirement });
    const action = retire(await review(api));
    const result = await act(api, action);
    retirement.nativeThreadId = "replacement-thread";
    await expect(act(api, action)).rejects.toThrow("archive_confirmation_occurrence_changed");
    retirement.nativeThreadId = "original-thread";
    expect(await act(api, action)).toEqual(result);
    await act(api, { kind: "restore", actionId: "restore-target", memberId: "soft" });
    await expect(act(api, action)).rejects.toThrow("archive_confirmation_target_revision_mismatch");
    await expect(review(api)).rejects.toThrow("permanent_retirement_pending");
    await expect(act(api, { ...action, actionId: "replacement-action" })).rejects.toThrow("permanent_retirement_pending");
  });
  it("does not accept owner identity in an agent mock entry", () => {
    expect(() => createUpgradeMock(HOST, { caller: { isOwner: false,
      actor: { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false } } })).toThrow("invalid_mock_caller");
  });
});

it("preserves full approval collection and canonical parties after successful continuation and exact replay", async () => {
  const api = createUpgradeMock(HOST);
  const first = panelSnapshotOf(await api.delegationUpgradeSnapshot(PROJECT));
  expect(first.parties.length).toBeGreaterThan(0);
  expect(first.approvals.some(approval => approval.state === "pending")).toBe(true);
  expect(first.nodes.some(node => node.kind === "delegation" && node.routingApproval?.state === "pending")).toBe(false);
  const changed = await act(api, continuation("preserve-collections"));
  expect(changed.effectState).toBe("committed");
  expect(changed.snapshot.parties).toEqual(first.parties);
  expect(changed.snapshot.approvals).toEqual(first.approvals);
  expect((await act(api, continuation("preserve-collections"))).snapshot).toEqual(changed.snapshot);
  expect(panelSnapshotOf(await api.delegationUpgradeSnapshot(PROJECT)).approvals).toEqual(changed.snapshot.approvals);
});
