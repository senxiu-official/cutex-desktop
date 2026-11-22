// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PendingActions, blockingOperation, forgetOperation, operationEntity, operationScope, projectOperationScope, projectOperations } from "./delegationOperations";

describe("per-entity uncertain-operation fences (r290 P11 / A1)", () => {
  let store: PendingActions;
  beforeEach(() => { localStorage.clear(); store = new PendingActions(); });

  it("maps each operation to the target it can repeat on", () => {
    expect(operationEntity({ kind: "stop", nodeId: "d1", nodeHostId: "h" })).toBe("node:h:d1");
    expect(operationEntity({ kind: "resumeContinuation", nodeId: "d1", nodeHostId: "h" })).toBe("node:h:d1");
    expect(operationEntity({ kind: "pause" })).toBe("runControl");
    expect(operationEntity({ kind: "resume" })).toBe("runControl");
    expect(operationEntity({ kind: "decision", approvalId: "a1" })).toBe("approval:a1");
    expect(operationEntity({ kind: "grant" })).toBe("routing");
    expect(operationEntity({ kind: "policy" })).toBe("routing");
    expect(operationEntity({ kind: "archive", memberId: "m1" })).toBe("member:m1");
    expect(operationEntity({ kind: "retire", payload: { cutex_session_id: "m1" } })).toBe("member:m1");
  });

  it("an unknown outcome blocks only its own entity", () => {
    store.set(operationScope("h", "p", "node:h:d1"), { kind: "stop", actionId: "x" });
    expect(blockingOperation("h", "p", "node:h:d1", store)?.action.actionId).toBe("x");
    expect(blockingOperation("h", "p", "node:h:d2", store)).toBeNull();
    expect(blockingOperation("h", "p", "runControl", store)).toBeNull();
    expect(blockingOperation("h", "other", "node:h:d1", store)).toBeNull();
  });

  it("a legacy whole-project marker still blocks every entity of that project", () => {
    store.set(projectOperationScope("h", "p"), { kind: "pause", actionId: "old" });
    const hit = blockingOperation("h", "p", "member:m1", store);
    expect(hit).toEqual({ scope: projectOperationScope("h", "p"), entity: null, action: { kind: "pause", actionId: "old" } });
  });

  it("lists a project's operations and forgets one by exact action id", () => {
    store.set(operationScope("h", "p", "runControl"), { kind: "pause", actionId: "a" });
    store.set(operationScope("h", "p", "approval:z"), { kind: "decision", actionId: "b" });
    store.set(operationScope("h", "q", "runControl"), { kind: "pause", actionId: "c" });
    expect(projectOperations("h", "p", store).map(op => op.entity)).toEqual(["runControl", "approval:z"]);
    expect(forgetOperation(operationScope("h", "p", "runControl"), "wrong", store)).toBe(false);
    expect(forgetOperation(operationScope("h", "p", "runControl"), "a", store)).toBe(true);
    expect(projectOperations("h", "p", store).map(op => op.entity)).toEqual(["approval:z"]);
  });
});
