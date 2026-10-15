import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { ApprovalRecord } from "../src/shared/ipc";
import { applyApprovalChange, approvalChangeOf, approvalFacts, grantKind, livePending, sortApprovals, withoutApproval } from "../src/renderer/src/lib/approvals";

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
