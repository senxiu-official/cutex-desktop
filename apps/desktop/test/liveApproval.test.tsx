// @vitest-environment jsdom
// approval-live-row: a call that waited for the owner (agent_delegate pendingReview, agent_create approval_required,
// an action_status receipt in awaitingApproval) follows the host's delegation / approvals lists instead of keeping its
// first reply's 等待授权 / 调用等待审批 for good.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import type { AskSummary } from "../src/shared/ipc";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
const { approvalSubject, delegationApproval, delegationRecordId, liveOutcome, ownerApproval } = await import("../src/renderer/src/lib/liveApproval");
const { useDelegations } = await import("../src/renderer/src/lib/delegationStore");
const { hostKey } = await import("../src/renderer/src/lib/hostKeys");
const { useConvHost } = await import("../src/renderer/src/lib/conversationScope");
const { taskToolRow } = await import("../src/renderer/src/lib/taskRows");
const { TaskToolRow } = await import("../src/renderer/src/components/TaskRows");
const { StandardToolRow } = await import("../src/renderer/src/modules/conversation/StandardToolRow");

const ASK = "ask-0123456789abcdef0123456789abcdef";
const SHORT = "delegation-012345";
const call = (tool: string, args: unknown, result: unknown): RawItem => ({ type: "mcpToolCall", server: "cutex", tool, arguments: args, result: { structuredContent: result }, id: `${tool}-1`, status: "completed" }) as RawItem;
const delegate = call("agent_delegate", { target: "Kimi", text: "deploy" }, { ok: true, delegation: SHORT, state: "pendingReview", approval_id: "apr-1111aaaa", target: "Kimi", title: "deploy" });
const createRefusal = "Nothing was done yet: this needs the owner's approval (profile Ceobe). (approval_id apr-2222bbbb)";
const create = call("agent_create", { name: "quokka", profile: "Ceobe" }, { schema: "cutex/agent-management/v1", action_id: "c-1", outcome: { status: "no_write", code: "approval_required", detail: createRefusal } });
const receipt = (tool: string, result: unknown) => call("action_status", { tool, action_id: "a-1" }, { schema: "cutex.tool-action-receipt.v1", ok: true, tool, action_id: "a-1", status: "awaitingApproval", outcomeUnknown: false, result });
const summary = (execution: AskSummary["execution"]): AskSummary => ({ askId: ASK, title: "deploy", requester: { kind: "agent", cutexSessionId: "cutex.r" }, target: "cutex.k", execution, attempts: 0, createdAt: "", updatedAt: "", revision: 1 }) as unknown as AskSummary;

describe("live approval state", () => {
  it("a reviewed delegation reads approved / denied; cancelled and unknown keep the reply", () => {
    expect(delegationApproval("pendingReview")).toBe("pending");
    for (const e of ["queued", "admitted", "running", "answered", "failed", "interrupted"] as const) expect(delegationApproval(e)).toBe("approved");
    expect(delegationApproval("rejected")).toBe("denied");
    expect(delegationApproval("cancelled")).toBeNull();
    expect(delegationApproval(undefined)).toBeNull();
  });
  it("an owner approval: pending in the list, else what this run saw, else decided only on approvals-live hosts", () => {
    const pending = [{ approvalId: "apr-1" }] as never[];
    expect(ownerApproval("apr-1", pending, undefined, true)).toBe("pending");
    expect(ownerApproval("apr-2", pending, "approved", false)).toBe("approved");
    expect(ownerApproval("apr-2", pending, "consumed", false)).toBe("approved");
    expect(ownerApproval("apr-2", pending, "denied", false)).toBe("denied");
    expect(ownerApproval("apr-2", pending, "expired", false)).toBe("expired");
    expect(ownerApproval("apr-2", pending, undefined, true)).toBe("decided");
    expect(ownerApproval("apr-2", pending, undefined, false)).toBeNull();
    expect(ownerApproval("apr-2", null, undefined, true)).toBeNull();
    expect(ownerApproval(null, pending, "approved", true)).toBeNull();
  });
  it("finds the delegation by the agent-facing short id and replaces only an awaiting outcome", () => {
    expect(delegationRecordId(SHORT, { [ASK]: 1 })).toBe(ASK);
    expect(delegationRecordId(ASK, { [ASK]: 1 })).toBe(ASK);
    expect(delegationRecordId("delegation-999999", { [ASK]: 1 })).toBeNull();
    const waiting = { kind: "approval" as const, code: null, detail: "d" };
    expect(liveOutcome(waiting, "approved")).toEqual({ ...waiting, kind: "approved" });
    expect(liveOutcome(waiting, "denied")?.kind).toBe("declined");
    expect(liveOutcome(waiting, "pending")).toBe(waiting);
    expect(liveOutcome(waiting, null)).toBe(waiting);
    const failed = { kind: "failed" as const, code: "x", detail: null };
    expect(liveOutcome(failed, "approved")).toBe(failed);
  });
  it("names the delegation / approval of a delegate reply, a create refusal and an action_status receipt", () => {
    expect(approvalSubject(delegate)).toEqual({ delegationId: SHORT, approvalId: "apr-1111aaaa" });
    expect(approvalSubject(create).approvalId).toBe("apr-2222bbbb");
    expect(approvalSubject(receipt("agent_delegate", { delegation: SHORT, state: "pendingReview" })).delegationId).toBe(SHORT);
    expect(approvalSubject(receipt("agent_create", { outcome: { status: "no_write", code: "approval_required", detail: createRefusal }, approval_id: "apr-2222bbbb" })).approvalId).toBe("apr-2222bbbb");
  });
});

let root: Root | undefined; let box: HTMLDivElement;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host = "";
function Probe() { host = useConvHost(); return null; }
function mount(node: React.ReactNode) { box = document.createElement("div"); document.body.append(box); root = createRoot(box); act(() => root!.render(h("div", null, h(Probe), node))); }
function setDelegation(execution: AskSummary["execution"] | null) {
  act(() => useDelegations.setState({ byKey: execution ? { [hostKey(host, ASK)]: summary(execution) } : {} }));
}
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; box?.remove(); act(() => useDelegations.setState({ byKey: {} })); });

describe("rows follow the live state", () => {
  it("an agent_delegate row stops saying 等待授权 once the owner's review passed", () => {
    const task = taskToolRow(delegate)!;
    expect(task.outcome?.kind).toBe("approval");
    mount(h(TaskToolRow, { item: delegate, task }));
    expect(box.textContent).toContain("taskrow.outcome.approval");
    setDelegation("pendingReview");
    expect(box.textContent).toContain("taskrow.outcome.approval");
    setDelegation("running");
    expect(box.textContent).not.toContain("taskrow.outcome.approval");
    expect(box.textContent).toContain("taskrow.outcome.approved");
    setDelegation("rejected");
    expect(box.textContent).toContain("taskrow.outcome.declined");
  });
  it("repeated action_status rows read the current state, not 调用等待审批 after the review", () => {
    const first = receipt("agent_delegate", { delegation: SHORT, state: "pendingReview" });
    const second = { ...first, id: "action_status-2" } as RawItem;
    mount([h(StandardToolRow, { key: 1, item: first, sessionId: "s" }), h(StandardToolRow, { key: 2, item: second, sessionId: "s" })]);
    setDelegation("pendingReview");
    expect(box.textContent?.match(/conversation\.tools\.actionStatus\.awaitingApproval/g)?.length).toBe(2);
    setDelegation("queued");
    expect(box.textContent).not.toContain("conversation.tools.actionStatus.awaitingApproval");
    expect(box.textContent?.match(/conversation\.tools\.actionStatus\.approval\.approved/g)?.length).toBe(2);
    expect(box.textContent).not.toContain("tool.approvalRequired");
  });
});
