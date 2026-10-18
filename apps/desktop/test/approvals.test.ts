import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { ApprovalRecord } from "../src/shared/ipc";
import { agentPendingApprovals, formatHold, holdEnded, holdLeftMs, knownApprovalState, noteApprovalState, applyApprovalChange, approvalChangeOf, approvalFacts, approvalOfTool, approvalOfToolEvent, grantKind, livePending, sortApprovals, withoutApproval } from "../src/renderer/src/lib/approvals";

const record = (id: string, over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  approvalId: id,
  kind: "managed_service",
  reason: "outside_caller_envelope",
  requesterCutexSessionId: "cutex.a",
  summary: `summary ${id}`,
  details: null,
  requestSha256: "x",
  state: "pending",
  createdAt: "2026-10-07T10:00:00Z",
  ...over,
});

const hostEvent = (params: unknown, method = "cutex/approvals/changed"): EventEnvelope =>
  ({ cutexSessionId: "cutex.host", source: "cutex", correlation: {}, cutex: { method, params } }) as unknown as EventEnvelope;

describe("approvals reducer", () => {
  it("reads cutex/approvals/changed only", () => {
    const a = record("apr-1");
    expect(approvalChangeOf(hostEvent({ reason: "requested", approval: a }))).toEqual({ reason: "requested", approval: a });
    expect(approvalChangeOf(hostEvent({ reason: "x" }))).toBeNull();
    expect(approvalChangeOf(hostEvent({ approval: a }, "cutex/services/changed"))).toBeNull();
  });

  it("adds new pending requests newest first and drops decided ones", () => {
    const old = record("apr-1", { createdAt: "2026-10-07T09:00:00Z" });
    const added = applyApprovalChange([old], { reason: "requested", approval: record("apr-2", { createdAt: "2026-10-07T11:00:00Z" }) });
    expect(added!.map((a) => a.approvalId)).toEqual(["apr-2", "apr-1"]);
    const decided = applyApprovalChange(added, { reason: "approved", approval: record("apr-2", { state: "approved" }) });
    expect(decided!.map((a) => a.approvalId)).toEqual(["apr-1"]);
    // A replayed request replaces instead of duplicating.
    expect(applyApprovalChange(decided, { reason: "requested", approval: old })).toHaveLength(1);
  });

  it("leaves an unloaded list alone", () => {
    expect(applyApprovalChange(null, { reason: "requested", approval: record("apr-1") })).toBeNull();
    expect(withoutApproval(null, "apr-1")).toBeNull();
    expect(withoutApproval([record("apr-1"), record("apr-2")], "apr-1")!.map((a) => a.approvalId)).toEqual(["apr-2"]);
  });

  it("sorts by creation time and filters lapsed pending records", () => {
    const list = sortApprovals([record("apr-a", { createdAt: "2026-10-06T00:00:00Z" }), record("apr-b", { createdAt: "2026-10-07T00:00:00Z" })]);
    expect(list.map((a) => a.approvalId)).toEqual(["apr-b", "apr-a"]);
    expect(livePending(list, Date.parse("2026-10-07T12:00:00Z")).map((a) => a.approvalId)).toEqual(["apr-b"]);
  });
});

describe("approval display", () => {
  it("names the authority an approval grants", () => {
    expect(grantKind({ kind: "managed_service" })).toBe("runAsOwner");
    expect(grantKind({ kind: "agent_profile" })).toBe("useProfile");
    expect(grantKind({ kind: "future_kind" })).toBe("other");
  });

  it("lists details in a stable order, skipping empty values", () => {
    const facts = approvalFacts({ envKeys: ["A", "B"], cwd: "D:\\x", op: "register", port: null, command: ["npm", "run", "dev"], slug: "web", extra: { a: 1 } });
    expect(facts.map((f) => f.key)).toEqual(["op", "slug", "command", "cwd", "envKeys", "extra"]);
    expect(facts.find((f) => f.key === "command")!.value).toBe("npm run dev");
    expect(facts.find((f) => f.key === "envKeys")!.value).toBe("A, B");
    expect(facts.find((f) => f.key === "extra")!.value).toBe('{"a":1}');
    expect(approvalFacts(null)).toEqual([]);
  });
});

describe("approvals from cutex tool results (inline cards, older cutex fallback)", () => {
  const id = "apr-0123456789abcdef0123456789abcdef";
  const refusal = { ok: false, status: "approval_required", code: "approval_required", approval_id: id,
    detail: "Nothing was done yet: this needs the owner's approval (Keep service blank-persist persistently). The owner sees the request in the cutex desktop. Retry the same call after they approve." };
  const tool = (result: unknown, over: Record<string, unknown> = {}) => ({ type: "mcpToolCall", id: "call-1", server: "cutex", tool: "service_register", status: "failed", result, ...over });

  it("reads the plain refusal with its summary", () => {
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify(refusal) }], isError: true }))).toEqual({ approvalId: id, code: "approval_required", summary: "Keep service blank-persist persistently" });
  });

  it("reads Agent Management's receipt text and a summary with parentheses", () => {
    const text = JSON.stringify({ outcome: { status: "no_write", code: "approval_required", detail: `Nothing was done yet: this needs the owner's approval (create agent r with profile gamma (workspace-write / on-request)). The owner sees the request in the cutex desktop. (approval_id ${id})` } });
    expect(approvalOfTool(tool({ content: [{ type: "text", text }] }, { tool: "agent_create" }))).toEqual({ approvalId: id, code: "approval_required", summary: "create agent r with profile gamma (workspace-write / on-request)" });
  });

  it("reads denials, and ignores other servers, running calls and results without an id", () => {
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify({ code: "approval_denied", approval_id: id }) }] }))?.code).toBe("approval_denied");
    expect(approvalOfTool(tool({ content: [{ type: "text", text: JSON.stringify(refusal) }] }, { server: "other" }))).toBeNull();
    expect(approvalOfTool(tool(null, { status: "inProgress" }))).toBeNull();
    expect(approvalOfTool(tool({ content: [{ type: "text", text: "approval_required" }] }))).toBeNull();
    expect(approvalOfTool({ type: "commandExecution" })).toBeNull();
  });

  it("finds them in item/completed events only", () => {
    const envelope = (method: string) => ({ cutexSessionId: "cutex.a", source: "native", correlation: {}, native: { kind: "notification", message: { method, params: { threadId: "t1", item: tool({ content: [{ type: "text", text: JSON.stringify(refusal) }] }) } } } }) as unknown as EventEnvelope;
    expect(approvalOfToolEvent(envelope("item/completed"))).toEqual({ item: { approvalId: id, code: "approval_required", summary: "Keep service blank-persist persistently" }, threadId: "t1" });
    expect(approvalOfToolEvent(envelope("item/started"))).toBeNull();
  });

  it("lists one agent's live pending approvals", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const list = [record("apr-1"), record("apr-2", { requesterCutexSessionId: "cutex.b" }), record("apr-3", { createdAt: "2026-10-05T10:00:00Z" })];
    expect(agentPendingApprovals(list, "cutex.a", now).map((a) => a.approvalId)).toEqual(["apr-1"]);
    expect(agentPendingApprovals(null, "cutex.a", now)).toEqual([]);
  });

  it("names the larger grant of a persistent managed service", () => {
    expect(grantKind(record("x", { kind: "service_lifetime", details: { managedExecution: true } }))).toBe("runAsOwner");
    expect(grantKind(record("x", { kind: "service_lifetime", details: { managedExecution: false } }))).toBe("other");
    expect(grantKind(record("x", { kind: "static_root", details: { staticRoot: "/srv/x" } }))).toBe("serveRoot");
    expect(grantKind(record("x", { kind: "service_lifetime", details: { managedExecution: false, staticRoot: "/srv/x" } }))).toBe("serveRoot");
    expect(approvalFacts({ op: "register", slug: "s", staticRoot: "/srv/x", allowedRoots: ["/a", "/b"] }).map((f) => [f.key, f.value])).toEqual([["op", "register"], ["slug", "s"], ["staticRoot", "/srv/x"], ["allowedRoots", "/a, /b"]]);
    expect(approvalFacts({ slug: "web", lifetime: "persistent", managedExecution: false, grants: "persistent lifetime" }).map((f) => f.key)).toEqual(["slug", "lifetime", "grants"]);
  });
});

describe("decisions seen this run", () => {
  it("keeps decided states, never pending", () => {
    noteApprovalState({ approvalId: "apr-seen-1", state: "pending" });
    expect(knownApprovalState("apr-seen-1")).toBeUndefined();
    noteApprovalState({ approvalId: "apr-seen-1", state: "approved" });
    noteApprovalState({ approvalId: "apr-seen-1", state: "consumed" });
    expect(knownApprovalState("apr-seen-1")).toBe("consumed");
  });
});

describe("approval-wait holds", () => {
  const now = Date.parse("2026-10-07T10:01:00Z");
  const wait = (until: string, end: string | null = null) => ({ id: "w", startedAt: "2026-10-07T10:00:00Z", until, end });

  it("counts down an active hold and ends at its deadline or end", () => {
    const holding = record("apr-h", { wait: wait("2026-10-07T10:02:30Z") });
    expect(holdLeftMs(holding, now)).toBe(90_000);
    expect(formatHold(90_000)).toBe("1:30");
    expect(formatHold(1_200)).toBe("0:02");
    expect(formatHold(-5)).toBe("0:00");
    expect(holdEnded(holding, now)).toBe(false);
    expect(holdLeftMs(holding, Date.parse("2026-10-07T10:02:31Z"))).toBeNull();
    expect(holdEnded(holding, Date.parse("2026-10-07T10:02:31Z"))).toBe(true);
    const timedOut = record("apr-t", { wait: wait("2026-10-07T10:02:30Z", "timeout") });
    expect(holdLeftMs(timedOut, now)).toBeNull();
    expect(holdEnded(timedOut, now)).toBe(true);
    // No hold at all (an older cutex or a façade that answered at once).
    expect(holdLeftMs(record("apr-n"), now)).toBeNull();
    expect(holdEnded(record("apr-n"), now)).toBe(false);
  });

  it("puts a holding request first and lets an ended hold leave the conversation", () => {
    const list = [
      record("apr-new"),
      record("apr-hold", { wait: wait("2026-10-07T10:02:00Z") }),
      record("apr-gave-up", { wait: wait("2026-10-07T10:00:30Z", "timeout") }),
    ];
    expect(agentPendingApprovals(list, "cutex.a", now, true).map((a) => a.approvalId)).toEqual(["apr-hold", "apr-new"]);
    // Without approval-wait the list is unchanged (every pending request keeps its card).
    expect(agentPendingApprovals(list, "cutex.a", now).map((a) => a.approvalId)).toEqual(["apr-new", "apr-hold", "apr-gave-up"]);
    // The hold runs out: its card goes too.
    expect(agentPendingApprovals(list, "cutex.a", Date.parse("2026-10-07T10:02:01Z"), true).map((a) => a.approvalId)).toEqual(["apr-new"]);
  });

  it("keeps a hold change in the pending list", () => {
    const started = record("apr-h", { wait: wait("2026-10-07T10:02:00Z") });
    const list = applyApprovalChange([record("apr-h")], { reason: "waiting", approval: started });
    expect(list![0]!.wait?.until).toBe("2026-10-07T10:02:00Z");
    const ended = applyApprovalChange(list, { reason: "wait_ended", approval: record("apr-h", { wait: wait("2026-10-07T10:02:00Z", "timeout") }) });
    expect(ended![0]!.wait?.end).toBe("timeout");
  });
});
