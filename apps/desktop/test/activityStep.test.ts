// r295 Z3 current blocker and next step (lib/activityStep): the wire `activityLink` checked, the step each surface
// shows, how it survives events (lib/delegations), the project activity / 「动态」 rows (modules/project-view) and the
// workflow retry approval's unconfirmed steps (modules/approvals/workflowRetry).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
import type { AskDetail, AskSummary } from "../src/shared/ipc";
import type { ProjectEvent } from "../src/shared/projectEvents";
import type { WorkflowStepView } from "../src/shared/workflows";
import { askActivityLink, askStep, nextKey, ownSurfaceStep, rowStep, sameStep, OWNER_APPROVAL_STEP } from "../src/renderer/src/lib/activityStep";
import { applyAskEvent, mergeSummaries } from "../src/renderer/src/lib/delegations";
import { deriveActivity, type ActivityInput } from "../src/renderer/src/modules/project-view/model";
import { currentAskSteps } from "../src/renderer/src/modules/project-view/stream";
import { unconfirmedRetryRun, unconfirmedSteps } from "../src/renderer/src/modules/approvals/workflowRetry";
import { withDetailState } from "../src/renderer/src/lib/delegationStore";

const link = (askId: string, over: Record<string, unknown> = {}) => ({ delegation: { kind: "delegation", askId }, approval: null, result: null, blocker: null, next: "none", ...over });

function ask(askId: string, over: Partial<AskSummary> = {}): AskSummary {
  return {
    askId, title: `t-${askId}`, requester: { kind: "agent", cutexSessionId: "dir", name: "dir" }, target: "a", targetName: "a", projectId: "p",
    execution: "running", hold: null, review: null, closed: null, attempts: 1,
    createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T02:00:00Z", revision: 3, ...over,
  } as AskSummary;
}

describe("activityLink parsing", () => {
  it("reads blocker, next and references of its own delegation", () => {
    const l = askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-1", answerId: "ans-9" } }) });
    expect(l).toEqual({ askId: "ask-1", approval: null, result: { askId: "ask-1", answerId: "ans-9" }, blocker: "acceptance", unknownBlocker: false, next: "openResult" });
    expect(askStep(l)).toEqual({ blocker: "acceptance", next: "openResult", action: { kind: "result", answerId: "ans-9" } });
  });

  it("an older host (no field) or a link of another delegation gives nothing: the row keeps its old words", () => {
    expect(askActivityLink({ askId: "ask-1" })).toBeNull();
    expect(askActivityLink({ askId: "ask-1", activityLink: link("ask-2", { blocker: "quota", next: "openDelegation" }) })).toBeNull();
    expect(askActivityLink({ askId: "ask-1", activityLink: "quota" })).toBeNull();
    expect(rowStep({ askId: "ask-1", activityLink: link("ask-2", { blocker: "quota", next: "openDelegation" }) })).toBeNull();
  });

  it("a result of another delegation, a malformed approval or an unknown next never becomes a button target", () => {
    const foreignResult = askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-2", answerId: "ans-x" } }) })!;
    expect(foreignResult.result).toBeNull();
    expect(foreignResult.next).toBe("openDelegation");
    const badApproval = askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { blocker: "approval", next: "openApproval", approval: { kind: "routing", approvalId: "bad id with spaces", projectId: null } }) })!;
    expect(badApproval.approval).toBeNull();
    expect(badApproval.next).toBe("openDelegation");
    expect(askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { blocker: "quota", next: "teleport" }) })!.next).toBe("none");
  });

  it("a blocker this desktop has no words for is not guessed at", () => {
    const l = askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { blocker: "solarFlare", next: "openDelegation" }) })!;
    expect(l.blocker).toBeNull();
    expect(l.unknownBlocker).toBe(true);
    expect(askStep(l)).toBeNull();
  });

  it("closed (no blocker) shows no step; the result stays openable from the link", () => {
    const l = askActivityLink({ askId: "ask-1", activityLink: link("ask-1", { result: { kind: "delegationResult", askId: "ask-1", answerId: "ans-1" } }) })!;
    expect(askStep(l)).toBeNull();
    expect(l.result?.answerId).toBe("ans-1");
  });

  it("buttons only for navigation: 等待 is words, the approval goes by its reference", () => {
    const wait = rowStep({ askId: "ask-1", activityLink: link("ask-1", { blocker: "targetBusy", next: "wait" }) })!;
    expect(wait.action).toBeNull();
    expect(nextKey(wait)).toBe("delegation.step.next.wait");
    const approval = rowStep({ askId: "ask-1", activityLink: link("ask-1", { blocker: "approval", next: "openApproval", approval: { kind: "capability", approvalId: "apr-1", projectId: "p" } }) })!;
    expect(approval.action).toEqual({ kind: "approval", ref: { kind: "capability", approvalId: "apr-1", projectId: "p" } });
    expect(nextKey(approval)).toBe("delegation.step.next.approval");
    expect(nextKey(OWNER_APPROVAL_STEP)).toBe("delegation.step.next.approval");
    expect(nextKey({ blocker: "quota", next: "none", action: null })).toBeNull();
  });

  it("a delegation's own surfaces add only a step that leads elsewhere", () => {
    const result = rowStep({ askId: "a", activityLink: link("a", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "a", answerId: "r" } }) });
    const approval = rowStep({ askId: "a", activityLink: link("a", { blocker: "approval", next: "openApproval", approval: { kind: "capability", approvalId: "apr-2", projectId: null } }) });
    const delegation = rowStep({ askId: "a", activityLink: link("a", { blocker: "quota", next: "openDelegation" }) });
    expect(ownSurfaceStep(result, false)).toBe(result);
    expect(ownSurfaceStep(approval, false)).toBe(approval);
    // 批准 / 拒绝 already shown here: no 查看审批.
    expect(ownSurfaceStep(approval, true)).toBeNull();
    // Its status word says 额度用完; 查看委托 would open itself.
    expect(ownSurfaceStep(delegation, false)).toBeNull();
    expect(sameStep(result, rowStep({ askId: "a", activityLink: link("a", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "a", answerId: "r" } }) }))).toBe(true);
    expect(sameStep(result, rowStep({ askId: "a", activityLink: link("a", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "a", answerId: "r2" } }) }))).toBe(false);
  });
});

describe("a link describes its row's revision", () => {
  const records = (d: AskSummary) => ({ byId: { [d.askId]: d }, progress: {}, questions: {} });
  const linked = ask("ask-1", { execution: "pendingReview", activityLink: link("ask-1", { blocker: "approval", next: "openDelegation" }) });

  it("a newer state event, the answer or the close drops it until the next list read", () => {
    const changed = applyAskEvent(records(linked), "cutex/ask/stateChanged", { askId: "ask-1", execution: "queued", hold: null, review: null, revision: 4 })!;
    expect(changed.byId!["ask-1"]!.activityLink).toBeUndefined();
    expect(changed.byId!["ask-1"]!.execution).toBe("queued");
    const answered = applyAskEvent(records(linked), "cutex/ask/answered", { askId: "ask-1", answerId: "ans-2", preview: "done" })!;
    expect(answered.byId!["ask-1"]!.activityLink).toBeUndefined();
    const closed = applyAskEvent(records(linked), "cutex/ask/closed", { askId: "ask-1", outcome: "completed", revision: 4 })!;
    expect(closed.byId!["ask-1"]!.activityLink).toBeUndefined();
    // A stale event (older revision) changes nothing.
    expect(applyAskEvent(records(linked), "cutex/ask/stateChanged", { askId: "ask-1", execution: "queued", revision: 2 })).toBeNull();
  });

  it("a list read brings the current one; a newer full record (which has none) drops the old", () => {
    const fresh = ask("ask-1", { revision: 4, execution: "queued", activityLink: link("ask-1", { blocker: "targetBusy", next: "wait" }) });
    expect(mergeSummaries({ "ask-1": linked }, [fresh])["ask-1"]!.activityLink).toEqual(fresh.activityLink);
    const detail = { askId: "ask-1", title: "t", requester: { kind: "owner" }, targetCutexSessionId: "a", execution: "queued", createdAt: linked.createdAt, updatedAt: linked.updatedAt, revision: 4 } as AskDetail;
    expect(withDetailState(linked, detail).activityLink).toBeUndefined();
    expect(withDetailState(linked, { ...detail, revision: 3 })).toBe(linked);
  });
});

describe("project activity (最近动态)", () => {
  const input = (asks: AskSummary[], over: Partial<ActivityInput> = {}): ActivityInput => ({ projectId: "p", members: new Set(["dir", "a", "b"]), asks, plans: [], artifacts: [], services: [], needs: [], ...over });

  it("a 需要你 row says the host's blocker; history rows stay as they happened", () => {
    const d = ask("ask-1", { requester: { kind: "owner" }, execution: "answered", review: "awaitingAcceptance", answerId: "ans-1", activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-1", answerId: "ans-1" } }) });
    const rows = deriveActivity(input([d]));
    const needs = rows.find((r) => r.id === "needs:ask-1")!;
    expect(needs).toMatchObject({ what: "needsDelegation", step: { blocker: "acceptance", action: { kind: "result", answerId: "ans-1" } }, open: { kind: "delegation", askId: "ask-1" } });
    for (const r of rows.filter((r) => r.id !== "needs:ask-1")) expect("step" in r && r.step).toBeFalsy();
  });

  it("stuck without needing the owner (quota, sign-in, paused, busy): one current row, kind 进度, not 需要你", () => {
    const quota = ask("ask-q", { execution: "queued", hold: { reason: "blocked", by: "quota" }, holdSince: "2026-11-25T02:30:00Z", activityLink: link("ask-q", { blocker: "quota", next: "openDelegation" }) });
    const busy = ask("ask-b", { execution: "queued", hold: { reason: "targetBusy" }, activityLink: link("ask-b", { blocker: "targetBusy", next: "wait" }) });
    const rows = deriveActivity(input([quota, busy]));
    expect(rows.find((r) => r.id === "blocked:ask-q")).toMatchObject({ kind: "progress", what: "blocked", at: Date.parse("2026-11-25T02:30:00Z"), step: { blocker: "quota", action: { kind: "delegation" } } });
    expect(rows.find((r) => r.id === "blocked:ask-b")).toMatchObject({ what: "blocked", step: { blocker: "targetBusy", next: "wait", action: null } });
    expect(rows.some((r) => r.kind === "needsYou")).toBe(false);
  });

  it("an older host (no link) and a closed delegation get no blocker and no new rows", () => {
    const old = ask("ask-o", { execution: "queued", hold: { reason: "blocked", by: "quota" } });
    const closed = ask("ask-c", { closed: "completed", execution: "answered", activityLink: link("ask-c", { blocker: "quota", next: "openDelegation" }) });
    const rows = deriveActivity(input([old, closed]));
    expect(rows.some((r) => r.id.startsWith("blocked:"))).toBe(false);
    expect(rows.filter((r) => r.what === "needsDelegation").every((r) => !("step" in r) || !r.step)).toBe(true);
  });

  it("same title, different ids: each row opens its own delegation (never matched by text)", () => {
    const a = ask("ask-A", { title: "Same", execution: "queued", hold: { reason: "blocked", by: "login" }, activityLink: link("ask-A", { blocker: "login", next: "openDelegation" }) });
    const b = ask("ask-B", { title: "Same", execution: "queued", hold: { reason: "blocked", by: "login" }, activityLink: link("ask-A", { blocker: "login", next: "openDelegation" }) });
    const rows = deriveActivity(input([a, b]));
    // Sign-in wants the owner: both are 需要你 rows, each opening its own delegation.
    expect(rows.find((r) => r.id === "needs:ask-A")).toMatchObject({ step: { blocker: "login" }, open: { kind: "delegation", askId: "ask-A" } });
    // ask-B carries ask-A's link: not trusted, so its row keeps the reason this desktop derives.
    const b2 = rows.find((r) => r.id === "needs:ask-B")!;
    expect(b2.open).toMatchObject({ kind: "delegation", askId: "ask-B" });
    expect("step" in b2 && b2.step).toBeFalsy();
  });

  it("an agent waiting for an owner approval links to the host's 审批 page (a host that sends activityLink)", () => {
    const rows = deriveActivity(input([], { activityLinks: true, needs: [{ sessionId: "a", at: 5, error: false, text: "x", approval: true }, { sessionId: "b", at: 4, error: false, text: "y" }] }));
    expect(rows.find((r) => r.id === "needs:agent:a")).toMatchObject({ step: OWNER_APPROVAL_STEP });
    expect(rows.find((r) => r.id === "needs:agent:b")).not.toHaveProperty("step");
  });
});

describe("「动态」 rows", () => {
  const ev = (seq: number, kind: string, askId: string | null): ProjectEvent => ({
    cursor: `pe:${seq}`, at: "2026-11-25T03:00:00.000Z", projectId: "p", cutexSessionId: "dir", agentName: "dir", kind, status: null, title: "T", detail: null,
    parent: { turnId: null, taskId: null, threadId: null }, refs: { askId, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null }, source: { method: null, eventCursor: null },
  });

  it("only the newest row of each open delegation carries its blocker, looked up by ask id", () => {
    const rows = [ev(9, "ask.answered", "ask-1"), ev(8, "turn.completed", null), ev(7, "ask.created", "ask-1"), ev(6, "ask.created", "ask-2"), ev(5, "ask.created", "ask-3")];
    const records: Record<string, AskSummary> = {
      "ask-1": ask("ask-1", { activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-1", answerId: "r" } }) }),
      "ask-2": ask("ask-2", { closed: "completed", activityLink: link("ask-2", { blocker: "quota", next: "openDelegation" }) }),
      // ask-3: an older host, no link.
      "ask-3": ask("ask-3"),
    };
    const steps = currentAskSteps(rows, (id) => records[id]);
    expect([...steps.keys()]).toEqual(["pe:9"]);
    expect(steps.get("pe:9")).toMatchObject({ blocker: "acceptance" });
  });
});

describe("workflow retry after unconfirmed steps", () => {
  const step = (i: number, state: WorkflowStepView["state"], over: Partial<WorkflowStepView> = {}): WorkflowStepView => ({ runId: "wr-1", stepKey: `k${i}`, callIndex: i, prompt: "p", state, tokens: 0, repairs: 0, createdAt: "", label: `s${i}`, sessionId: `cutex.s${i}`, askId: `ask-s${i}`, ...over });

  it("only a workflow approval marked unconfirmedSteps with a previous run asks for the step list", () => {
    expect(unconfirmedRetryRun({ kind: "workflow_run", details: { unconfirmedSteps: true, resumedFrom: "wr-0a1b2c3d4e5f6a7b" } })).toBe("wr-0a1b2c3d4e5f6a7b");
    expect(unconfirmedRetryRun({ kind: "workflow_run", details: { resumedFrom: "wr-0a1b2c3d4e5f6a7b" } })).toBeNull();
    expect(unconfirmedRetryRun({ kind: "workflow_run", details: { unconfirmedSteps: true, resumedFrom: null } })).toBeNull();
    expect(unconfirmedRetryRun({ kind: "workflow_run", details: { unconfirmedSteps: true, resumedFrom: "../etc" } })).toBeNull();
    expect(unconfirmedRetryRun({ kind: "managed_service", details: { unconfirmedSteps: true, resumedFrom: "wr-1" } })).toBeNull();
  });

  it("lists live steps and those whose outcome is unknown, with their delegation and session ids", () => {
    const steps = [
      step(0, "done"),
      step(1, "failed", { error: { code: "step_outcome_unknown", message: "" } }),
      step(2, "failed", { error: { code: "ask_missing", message: "" }, askIds: ["ask-s2", "ask-s2b"] }),
      step(3, "running", { label: "  " }),
      step(4, "failed", { error: { code: "provider_blocked", message: "" } }),
      step(5, "queued", { askId: null, sessionId: null }),
    ];
    expect(unconfirmedSteps(steps)).toEqual([
      { stepKey: "k1", label: "s1", why: "unknown", askIds: ["ask-s1"], sessionId: "cutex.s1" },
      { stepKey: "k2", label: "s2", why: "unknown", askIds: ["ask-s2", "ask-s2b"], sessionId: "cutex.s2" },
      { stepKey: "k3", label: "k3", why: "live", askIds: ["ask-s3"], sessionId: "cutex.s3" },
    ]);
  });
});

// Review 2026-11-25 (roster-bottom-review, activityStepBoundary.review.test.ts).
describe("review boundaries", () => {
  it("an id-only newer state event (targetReverted) immediately invalidates the old navigation", () => {
    const d = ask("ask-1", { activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-1", answerId: "ans-old" } }) });
    const records = { byId: { "ask-1": d }, progress: {}, questions: {} };
    const patch = applyAskEvent(records, "cutex/ask/stateChanged", { askId: "ask-1", revision: 4, targetReverted: true });
    const after = patch?.byId?.["ask-1"] ?? d;
    expect(after.activityLink).toBeUndefined();
    // The revision is left to the refresh; an older or link-less record changes nothing.
    expect(after.revision).toBe(3);
    expect(applyAskEvent(records, "cutex/ask/stateChanged", { askId: "ask-1", revision: 2, targetReverted: true })).toBeNull();
    expect(applyAskEvent({ byId: { "ask-1": ask("ask-1") }, progress: {}, questions: {} }, "cutex/ask/stateChanged", { askId: "ask-1", revision: 4, targetReverted: true })).toBeNull();
  });

  it("an in-flight list snapshot cannot restore the old result link after an answer event", () => {
    const d = ask("ask-1", { answerId: "ans-old", activityLink: link("ask-1", { blocker: "acceptance", next: "openResult", result: { kind: "delegationResult", askId: "ask-1", answerId: "ans-old" } }) });
    const changed = applyAskEvent({ byId: { "ask-1": d }, progress: {}, questions: {} }, "cutex/ask/stateChanged", { askId: "ask-1", revision: 4, execution: "answered", review: "awaitingAcceptance" })!;
    const patch = applyAskEvent({ byId: changed.byId!, progress: {}, questions: {} }, "cutex/ask/answered", { askId: "ask-1", answerId: "ans-new", preview: "new answer" })!;
    expect(patch.byId!["ask-1"]!.activityLink).toBeUndefined();
    const after = mergeSummaries(patch.byId!, [d])["ask-1"]!;
    expect(rowStep(after)?.action).not.toEqual({ kind: "result", answerId: "ans-old" });
  });

  it("legacy owner approvals with no activityLink keep the old project activity behaviour", async () => {
    const { needsYouByAgent } = await import("../src/renderer/src/lib/agentAttention");
    const needs = needsYouByAgent({ approvals: [{ approvalId: "apr-legacy", kind: "managed_service", state: "pending", requesterCutexSessionId: "a", details: {} } as never] });
    const n = needs.get("a")!;
    const rows = deriveActivity({ projectId: "p", members: new Set(["a"]), asks: [], plans: [], artifacts: [], services: [], needs: [{ sessionId: "a", at: 5, error: false, text: "approval", approval: n.reasons.includes("approval") }] });
    expect(rows.find((r) => r.id === "needs:agent:a")).not.toHaveProperty("step");
  });
});
