// delegation-18f5c3 / 81305d: the card's 允许继续 reads resume permission (and, on r296 hosts, the blocked reason and the
// pending approval) from the owner tree read rooted at the delegation; the approvals page reads / decides r296
// continuation approvals through main, which re-reads the approval before writing.
import { describe, expect, it, vi } from "vitest";
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import { decideContinuation, readContinuationApprovals, readContinuationResume } from "../src/shared/delegationUpgradeAdapter";

const BASE = ["delegation-tree-stop-v1", "delegation-continuation-v1", "project-run-control-v1"];
const R296 = [...BASE, "delegation-continuation-approval-v1"];
const APPROVAL = { id: "cap-1", revision: 2, digest: "c".repeat(64), authorityEpoch: 5 };
const node = (over: Record<string, unknown> = {}) => ({
  kind: "delegation", ref: { hostId: "canonical", id: "ask-1" }, projectId: "proj", closed: null,
  continuation: { revision: 4, limitReason: "rounds", maxRounds: 32, maxElapsedSeconds: 86_400 },
  allowedActions: { readAttempts: true, stop: true, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: true },
  ...over,
});
const record = (over: Record<string, unknown> = {}) => ({
  id: "cap-1", delegationId: "ask-1", budgetEpoch: 1, authorityEpoch: 5, directorSessionId: null, revision: 2, digest: "c".repeat(64),
  reason: "rounds", requestedAt: "2026-11-25T00:00:00Z", briefPreview: "Poll CI", progressPreview: "round 32", decision: null,
  decisionNote: null, decidedBy: null, decidedAt: null, allowedActions: { approve: true, deny: true }, ...over,
});
function client({ features = BASE, user, nodes = [node()], phase = "running", approvals = [record()], control, detail = null }: {
  features?: string[]; user?: unknown; nodes?: unknown[]; phase?: string; approvals?: unknown[]; control?: () => Promise<unknown>; detail?: unknown;
} = {}) {
  const fake = {
    ask: vi.fn(async () => detail),
    capabilities: vi.fn(async () => ({ hostId: "canonical", featureList: features, ...(user === undefined ? {} : { user }) })),
    delegationTree: vi.fn(async () => ({ nodes })),
    projectRunControl: vi.fn(async () => ({ phase })),
    continuationApprovals: vi.fn(async () => approvals),
    delegationControl: vi.fn(control ?? (async (request: { body: { actionId: string } }) => ({ receipt: {
      schema: "cutex.delegation-operation.v1", actionId: request.body.actionId, operationId: "op-1", operation: "continuation.resume", requestDigest: "d".repeat(64),
      status: "completed", effectState: "committed", outcomeUnknown: false, revision: 3, updatedAt: "2026-11-25T00:00:00Z" } }))),
  };
  return { fake, c: fake as unknown as CutexClient };
}

describe("readContinuationResume", () => {
  it("reads the tree rooted at the delegation on cutex's host and returns its permission and revision", async () => {
    const { fake, c } = client();
    expect(await readContinuationResume(c, "proj", "ask-1")).toEqual({ nodeHostId: "canonical", allowed: true, expectedRevision: 4, projectPaused: false,
      blockedReason: null, approval: null, limit: { reason: "rounds", maxRounds: 32, maxElapsedSeconds: 86_400 } });
    expect(fake.delegationTree).toHaveBeenCalledWith("proj", { rootId: "ask-1", rootHostId: "canonical" });
  });

  it("a paused project is reported; a closed node is never allowed", async () => {
    expect(await readContinuationResume(client({ phase: "paused" }).c, "proj", "ask-1")).toMatchObject({ projectPaused: true });
    expect(await readContinuationResume(client({ nodes: [node({ closed: { reason: "answered" } })] }).c, "proj", "ask-1")).toMatchObject({ allowed: false });
  });

  it("no revision → expectedRevision null; no limit reason → limit null", async () => {
    expect(await readContinuationResume(client({ nodes: [node({ continuation: null })] }).c, "proj", "ask-1")).toMatchObject({ expectedRevision: null, limit: null });
  });

  it("r296: the blocked reason (tolerant of new codes) and the approval whenever present, only with the capability", async () => {
    const allowed = { readAttempts: true, stop: true, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false };
    const busy = node({ allowedActions: { ...allowed, resumeContinuationBlockedReason: "handlerBusy" }, continuation: { revision: 4, approval: APPROVAL } });
    expect(await readContinuationResume(client({ features: R296, nodes: [busy] }).c, "proj", "ask-1"))
      .toMatchObject({ allowed: false, blockedReason: "handlerBusy", approval: APPROVAL });
    // Without the capability the approval is never used (legacy path).
    expect(await readContinuationResume(client({ nodes: [busy] }).c, "proj", "ask-1")).toMatchObject({ approval: null, blockedReason: "handlerBusy" });
    const novel = node({ allowedActions: { ...allowed, resumeContinuationBlockedReason: "noApprovalAuthority" } });
    expect(await readContinuationResume(client({ features: R296, nodes: [novel] }).c, "proj", "ask-1")).toMatchObject({ blockedReason: "noApprovalAuthority" });
    const junk = node({ allowedActions: { ...allowed, resumeContinuationBlockedReason: "<b>x</b>" }, continuation: { revision: 4, approval: { ...APPROVAL, digest: "nope" } } });
    expect(await readContinuationResume(client({ features: R296, nodes: [junk] }).c, "proj", "ask-1")).toMatchObject({ blockedReason: null, approval: null });
  });

  it("returns null on older hosts, for non-owners and when the node is not in the tree", async () => {
    const old = client({ features: ["delegation-tree-stop-v1"] });
    expect(await readContinuationResume(old.c, "proj", "ask-1")).toBeNull();
    expect(old.fake.delegationTree).not.toHaveBeenCalled();
    expect(await readContinuationResume(client({ user: { isOwner: false, id: "u1", grant: null } }).c, "proj", "ask-1")).toBeNull();
    expect(await readContinuationResume(client({ nodes: [node({ ref: { hostId: "other", id: "ask-1" } })] }).c, "proj", "ask-1")).toBeNull();
  });

  it("rejects bad identifiers before any read", async () => {
    const { fake, c } = client();
    await expect(readContinuationResume(c, "../x", "ask-1")).rejects.toThrow();
    expect(fake.capabilities).not.toHaveBeenCalled();
  });
});

describe("readContinuationApprovals", () => {
  it("[] without the capability or for non-owners; never reads the list", async () => {
    const old = client();
    expect(await readContinuationApprovals(old.c, "proj")).toEqual([]);
    expect(old.fake.continuationApprovals).not.toHaveBeenCalled();
    expect(await readContinuationApprovals(client({ features: R296, user: { isOwner: false, id: "u1", grant: null } }).c, "proj")).toEqual([]);
  });

  it("validates each record (malformed or decided ones are left out) and carries the scope", async () => {
    const { fake, c } = client({ features: R296, approvals: [record(), record({ id: "cap-2", digest: "short" }), record({ id: "cap-3", decision: "approve" }), record({ id: "cap-4", reason: "other" })] });
    const rows = await readContinuationApprovals(c, "proj");
    expect(rows.map((r) => r.id)).toEqual(["cap-1"]);
    expect(rows[0]).toMatchObject({ projectId: "proj", delegationId: "ask-1", revision: 2, authorityEpoch: 5, reason: "rounds", allowedActions: { approve: true, deny: true } });
    expect(fake.continuationApprovals).toHaveBeenCalledWith("proj");
    expect((await readContinuationApprovals(client({ features: R296 }).c, null))[0]!.projectId).toBeNull();
  });
});

describe("decideContinuation", () => {
  const request = { delegationId: "ask-1", approvalId: "cap-1", actionId: "act-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve" as const, decisionNote: null };

  it("re-reads the approval and writes the new decision fields on an exact match", async () => {
    const { fake, c } = client({ features: R296 });
    expect(await decideContinuation(c, "proj", request)).toMatchObject({ effectState: "committed" });
    expect(fake.delegationControl).toHaveBeenCalledWith({ kind: "continuationDecision", delegationId: "ask-1",
      body: { actionId: "act-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null } });
  });

  it.each([
    ["revision", { expectedRevision: 3 }],
    ["digest", { expectedDigest: "e".repeat(64) }],
    ["epoch", { expectedEpoch: 6 }],
    ["approval id", { approvalId: "cap-9" }],
  ])("a changed %s is approval_changed before any write", async (_name, over) => {
    const { fake, c } = client({ features: R296 });
    await expect(decideContinuation(c, "proj", { ...request, ...over })).rejects.toThrow(/^approval_changed$/);
    expect(fake.delegationControl).not.toHaveBeenCalled();
  });

  it("deny needs a reason of at most 200 characters; the note is trimmed", async () => {
    const { fake, c } = client({ features: R296 });
    await expect(decideContinuation(c, "proj", { ...request, decision: "deny", decisionNote: "  " })).rejects.toThrow("invalid_arguments");
    await expect(decideContinuation(c, "proj", { ...request, decision: "deny", decisionNote: "x".repeat(201) })).rejects.toThrow("invalid_arguments");
    await decideContinuation(c, "proj", { ...request, decision: "deny", decisionNote: "  不再需要 " });
    expect(fake.delegationControl.mock.calls[0]![0]).toMatchObject({ body: { decision: "deny", decisionNote: "不再需要" } });
  });

  it("a host without the capability is refused before any read", async () => {
    const { fake, c } = client();
    await expect(decideContinuation(c, "proj", request)).rejects.toThrow("approval_not_allowed");
    expect(fake.continuationApprovals).not.toHaveBeenCalled();
  });

  it("backend refusals before any write reach the renderer as a bare code; other failures keep their message", async () => {
    const stale = client({ features: R296, control: async () => { throw new CutexApiError(409, "approval_changed", "refresh", false, { refresh: "continuationApprovals" }); } });
    await expect(decideContinuation(stale.c, "proj", request)).rejects.toThrow(/^approval_changed$/);
    const lost = client({ features: R296, control: async () => { throw new Error("socket hang up"); } });
    await expect(decideContinuation(lost.c, "proj", request)).rejects.toThrow("socket hang up");
  });
});

describe("ddd0f067", () => {
  const card = { ...APPROVAL, allowedActions: { approve: true, deny: false } };
  it("a project-less delegation reads its owner-detail card (no tree, no run control)", async () => {
    const { fake, c } = client({ features: R296, detail: { askId: "ask-1", projectId: null, continuationApproval: card } });
    expect(await readContinuationResume(c, null, "ask-1")).toEqual({ nodeHostId: "canonical", allowed: false, expectedRevision: null, projectPaused: false,
      blockedReason: null, approval: card, limit: null });
    expect(fake.ask).toHaveBeenCalledWith("ask-1");
    expect(fake.delegationTree).not.toHaveBeenCalled();
    expect(fake.projectRunControl).not.toHaveBeenCalled();
  });

  it("project-less: null on hosts without the capability, for another ask or a project ask; no card → approval null", async () => {
    const old = client({ detail: { askId: "ask-1", projectId: null, continuationApproval: card } });
    expect(await readContinuationResume(old.c, null, "ask-1")).toBeNull();
    expect(old.fake.ask).not.toHaveBeenCalled();
    expect(await readContinuationResume(client({ features: R296, detail: { askId: "ask-2", projectId: null } }).c, null, "ask-1")).toBeNull();
    expect(await readContinuationResume(client({ features: R296, detail: { askId: "ask-1", projectId: "proj", continuationApproval: card } }).c, null, "ask-1")).toBeNull();
    expect(await readContinuationResume(client({ features: R296, detail: { askId: "ask-1", projectId: null } }).c, null, "ask-1")).toMatchObject({ approval: null });
  });

  it("the tree card's allowedActions are kept; a card without them (2add91fd) allows both; malformed ones are not decidable", async () => {
    const allowed = { readAttempts: true, stop: true, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false, resumeContinuationBlockedReason: "handlerOffline" };
    const read = (approval: unknown) => readContinuationResume(client({ features: R296, nodes: [node({ allowedActions: allowed, continuation: { revision: 4, approval } })] }).c, "proj", "ask-1");
    expect((await read(card))!.approval).toEqual(card);
    expect((await read(APPROVAL))!.approval).toEqual({ ...APPROVAL, allowedActions: { approve: true, deny: true } });
    expect((await read({ ...APPROVAL, allowedActions: { approve: "yes" } }))!.approval).toBeNull();
  });

  it.each(["idempotency_conflict", "action_id_payload_conflict", "continuation_revision_conflict", "continuation_reconciling", "unauthorized", "invalid_authority_epoch"])(
    "the spec refusal %s reaches the renderer as a bare code", async (code) => {
      const { c } = client({ features: R296, control: async () => { throw new CutexApiError(409, code, "refused"); } });
      await expect(decideContinuation(c, "proj", { delegationId: "ask-1", approvalId: "cap-1", actionId: "act-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null }))
        .rejects.toThrow(new RegExp("^" + code + "$"));
    });

  it("outcome_unknown keeps the backend's message (the renderer keeps the fence)", async () => {
    const { c } = client({ features: R296, control: async () => { throw new CutexApiError(503, "outcome_unknown", "lost"); } });
    await expect(decideContinuation(c, "proj", { delegationId: "ask-1", approvalId: "cap-1", actionId: "act-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null }))
      .rejects.toThrow("outcome_unknown: lost");
  });

  it("a project-less decision re-reads the project-less list", async () => {
    const { fake, c } = client({ features: R296 });
    await decideContinuation(c, null, { delegationId: "ask-1", approvalId: "cap-1", actionId: "act-1", expectedRevision: 2, expectedDigest: "c".repeat(64), expectedEpoch: 5, decision: "approve", decisionNote: null });
    expect(fake.continuationApprovals).toHaveBeenCalledWith(null);
  });
});
