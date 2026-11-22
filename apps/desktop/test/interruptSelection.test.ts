// 打断并发送 with several 插话 (cutex interrupt-send-many-v1): which inputs go, in what order, and main's check of a
// submit's selection.
import { describe, expect, it } from "vitest";
import { record, delivery } from "../src/renderer/src/lib/inputLedger/testkit";
import { batchBlocked, batchDeferred, batchRetryBlocked, escSteerCount, interruptBatchOf, interruptSelection, selectionParams, sendsManyAtOnce, unreadSteers } from "../src/renderer/src/lib/inputLedger/interruptSelection";
import { interruptSendSelection } from "../src/shared/interruptSendSelection";

const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 0, 0, s)).toISOString();
const steer = (id: string, s: number, patch: Parameters<typeof record>[1] = {}) => record(id, { kind: "owner", state: "accepted", turnId: "t1", createdAt: at(s), actions: ["interruptSend", "dismiss"], rev: s + 1, ...patch });
const running = delivery("turn", 1, { runtimeGeneration: 7, turn: { turnId: "t1", kind: "owner", askId: null, startedAt: null, inputIds: [] } });

describe("unreadSteers / interruptSelection", () => {
  it("only the owner's accepted 插话 of the running turn still offered, in send order", () => {
    const list = [steer("c", 30), steer("a", 10), steer("b", 20),
      steer("read", 5, { actions: ["dismiss"] }), steer("other-turn", 6, { turnId: "t0" }), steer("note", 7, { kind: "agentMessage" }), steer("queued", 8, { state: "waiting", turnId: null })];
    expect(unreadSteers(list, "t1").map(r => r.inputId)).toEqual(["a", "b", "c"]);
    expect(unreadSteers(list, null)).toEqual([]);
  });
  it("the clicked one brings every unread 插话; a clicked queued input joins them in send order; not offered: nothing", () => {
    const list = [steer("a", 10), steer("b", 20), steer("queued", 15, { state: "waiting", turnId: null })];
    expect(interruptSelection(list, running, "b").map(r => r.inputId)).toEqual(["a", "b"]);
    expect(interruptSelection(list, running, "queued").map(r => r.inputId)).toEqual(["a", "queued", "b"]);
    expect(interruptSelection([...list, steer("gone", 1, { actions: [] })], running, "gone")).toEqual([]);
  });
  it("never cut short (the caller refuses over the limit)", () => {
    const many = Array.from({ length: 101 }, (_, i) => steer(`s${i}`, i));
    expect(interruptSelection(many, running, "s100")).toHaveLength(101);
  });
  it("params: ids in order, exact revs, the running turn and generation; none without a turn", () => {
    expect(selectionParams([steer("a", 10), steer("b", 20)], running)).toEqual({ inputIds: ["a", "b"], expectedRevs: { a: 11, b: 21 }, expectedTurnId: "t1", expectedRuntimeGeneration: 7 });
    expect(selectionParams([steer("a", 10)], delivery("idle", 1))).toBeNull();
  });
  it("capability names and the cli Esc count", () => {
    expect(sendsManyAtOnce(["interrupt-send-many-v1"]) && sendsManyAtOnce(new Set(["interruptSendManyV1"]))).toBe(true);
    expect(sendsManyAtOnce(["input-ledger-v1"]) || sendsManyAtOnce(null)).toBe(false);
    expect([escSteerCount(3, true), escSteerCount(1, false), escSteerCount(3, false), escSteerCount(0, true)]).toEqual([3, 1, 0, 0]);
  });
});

describe("details.interruptBatch", () => {
  it("reads retryBlocked / blocked / reason strictly", () => {
    expect(interruptBatchOf({ details: { interruptBatch: { attempt: 2, blocked: true, notSubmittedReason: "hook_blocked", deferredIds: ["a"] } } })).toEqual({ attempt: 2, deferred: null, retryBlocked: false, blocked: true, reason: "hook_blocked" });
    expect(interruptBatchOf({ details: { interruptBatch: { retryBlocked: true, notSubmittedReason: "" } } })).toEqual({ attempt: null, deferred: null, retryBlocked: true, blocked: false, reason: null });
    expect(interruptBatchOf({ details: { interruptBatch: ["x"] } })).toBeNull();
    expect(interruptBatchOf({ details: {} })).toBeNull();
  });
  it("the host's predicates hold only for the record's current attempt and matching state", () => {
    const blocked = record("b", { kind: "owner", state: "waiting", reason: "nativeHeld", attempt: 1, details: { interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "hook_blocked" } } });
    expect(batchBlocked(blocked)?.reason).toBe("hook_blocked");
    expect(batchBlocked({ ...blocked, attempt: 2 })).toBeNull(); // a manual retry moved on: the old proof says nothing
    expect(batchBlocked({ ...blocked, state: "uncertain", reason: "outcomeUnknown" })).toBeNull();
    expect(batchBlocked({ ...blocked, details: { interruptBatch: { attempt: 1, deferred: true, blocked: true, notSubmittedReason: "x" } } })).toBeNull();
    expect(batchBlocked({ ...blocked, kind: "agentMessage" })).toBeNull();
    // The host writes deferred explicitly; a missing one is not "false" (no blocked proof).
    expect(batchBlocked({ ...blocked, details: { interruptBatch: { attempt: 1, blocked: true, notSubmittedReason: "hook_blocked" } } })).toBeNull();
    expect(interruptBatchOf({ details: { interruptBatch: { attempt: 1 } } })?.deferred).toBeNull();
    const unknown = record("u", { kind: "owner", state: "uncertain", reason: "outcomeUnknown", attempt: 2, details: { interruptBatch: { attempt: 2, retryBlocked: true } } });
    expect(batchRetryBlocked(unknown)).toBe(true);
    expect(batchRetryBlocked({ ...unknown, attempt: 3 })).toBe(false);
    const held = record("h", { kind: "owner", state: "held", reason: "hostBusy", attempt: 1, details: { interruptBatch: { attempt: 1, deferred: true, notSubmittedReason: "not_idle" } } });
    expect(batchDeferred(held)?.reason).toBe("not_idle");
    expect(batchDeferred({ ...held, details: { interruptBatch: { attempt: 1, deferred: false, notSubmittedReason: "not_idle" } } })).toBeNull();
  });
});

describe("main: a submit's interruptSend selection", () => {
  const ok = { inputIds: ["a", "b"], expectedRevs: { a: 3, b: 4 }, expectedTurnId: "t1", expectedRuntimeGeneration: 7 };
  it("copies only the documented fields; none asked for = undefined", () => {
    expect(interruptSendSelection({ ...ok, extra: "x" }, "draft")).toEqual(ok);
    expect(interruptSendSelection(undefined, "draft")).toBeUndefined();
    expect(interruptSendSelection({ ...ok, inputIds: [], expectedRevs: {} }, "draft")).toEqual({ ...ok, inputIds: [], expectedRevs: {} });
  });
  it.each([
    ["the draft named", { ...ok, inputIds: ["a", "draft"], expectedRevs: { a: 3, draft: 1 } }],
    ["duplicate ids", { ...ok, inputIds: ["a", "a"] }],
    ["rev keys differ", { ...ok, expectedRevs: { a: 3, c: 4 } }],
    ["bad rev", { ...ok, expectedRevs: { a: 0, b: 4 } }],
    ["no turn", { ...ok, expectedTurnId: "" }],
    ["too many", { ...ok, inputIds: Array.from({ length: 100 }, (_, i) => `i${i}`), expectedRevs: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`i${i}`, 1])) }],
    ["long id", { ...ok, inputIds: ["x".repeat(257)], expectedRevs: { ["x".repeat(257)]: 1 } }],
  ])("refuses %s (never a silent draft-only send)", (_, value) => {
    expect(() => interruptSendSelection(value, "draft")).toThrow(/invalid_request/);
  });
});
