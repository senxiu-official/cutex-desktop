import { describe, expect, it } from "vitest";
import { applyMessageEvent, seedMessages } from "../src/renderer/src/lib/agentMessages";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";
import { MESSAGE_SETTLEMENT_EVENT } from "../src/shared/messageSettlement";

const unknown = () => settlementFixture();
const closure = () => ({ ...unknown(), state: "closed" as const, canClose: false, closure: { actor: "owner", closedAt: "2026-10-27T01:00:00Z", reason: "Reviewed", requestId: "owner-key" } });
const seed = (settlement = unknown()) => seedMessages({}, "recipient", [{ messageId: "m1", state: "inbox_accepted", settlement }], []);

describe("server message settlement projections", () => {
  it("delivery wins over old failed rows, replayed observations and stale pending bootstrap", () => {
    let next = seedMessages({}, "recipient", [{ messageId: "m1", state: "failed" }], []);
    next = applyMessageEvent(next, "cutex/agentBus/messageDelivered", { messageId: "m1", turnId: "proven-turn", settlement: unknown() }, 1);
    next = applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", settlement: unknown() }, 2);
    next = seedMessages(next, "recipient", [{ messageId: "m1", state: "pending", settlement: unknown() }], []);
    expect(next.m1).toMatchObject({ state: "delivered", turnId: "proven-turn", settlementKnown: true });
    expect(next.m1!.settlement).toBeUndefined();
  });
  it("unknown -> explicit null clears only the observation and duplicate clears are idempotent", () => {
    const params = { messageId: "m1", requestId: "observation-key", settlement: null };
    const next = applyMessageEvent(seed(), MESSAGE_SETTLEMENT_EVENT, params, 1);
    expect(next.m1!.settlement).toBeUndefined();
    expect(next.m1!.settlementKnown).toBe(true);
    expect(applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, params, 2)).toBe(next);
  });
  it("unknown -> delivered without settlement confirms context and clears the observation", () => {
    const next = applyMessageEvent(seed(), "cutex/agentBus/messageDelivered", { messageId: "m1", turnId: "confirmed-turn" }, 1);
    expect(next.m1).toMatchObject({ state: "delivered", turnId: "confirmed-turn", settlementKnown: true });
    expect(next.m1!.settlement).toBeUndefined();
  });
  it("queued/presentation events with no settlement are partial, not clears", () => {
    const previous = seed();
    const next = applyMessageEvent(previous, "cutex/agentBus/messageQueued", { messageId: "m1", body: "presentation" }, 1);
    expect(next.m1!.settlement).toBe(previous.m1!.settlement);
    expect(applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "bad-partial" }, 2)).toBe(next);
  });
  it.each(["received", "sent"])("the full %s bootstrap can clear absence and carries sender-side unknown evidence", (direction) => {
    const row = { messageId: "m1", state: "pending", settlement: unknown(), toCutexSessionId: "recipient" };
    const present = seedMessages({}, direction === "sent" ? "sender" : "recipient", direction === "received" ? [row] : [], direction === "sent" ? [row] : []);
    expect(present.m1!.settlement).toEqual(row.settlement);
    const absent = { messageId: "m1", state: "pending" };
    const cleared = seedMessages(present, "sender", direction === "received" ? [absent] : [], direction === "sent" ? [absent] : []);
    expect(cleared.m1!.settlement).toBeUndefined();
  });
  it("known closure survives null, delivered, absent bootstrap, stale observation and replay", () => {
    const closed = closure();
    let next = seed(closed);
    next = applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "clear", settlement: null }, 1);
    next = applyMessageEvent(next, "cutex/agentBus/messageDelivered", { messageId: "m1" }, 2);
    next = seedMessages(next, "sender", [], [{ messageId: "m1", state: "pending" }]);
    next = applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "old-observation", settlement: unknown() }, 3);
    expect(next.m1!.settlement).toEqual(closed);
    expect(applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "owner-key", settlement: closed }, 4)).toBe(next);
  });
  it("merges projections instead of suppressing all updates sharing a requestId", () => {
    const previous = applyMessageEvent({}, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "same-key", settlement: unknown() }, 1);
    const cleared = applyMessageEvent(previous, MESSAGE_SETTLEMENT_EVENT, { messageId: "m1", requestId: "same-key", settlement: null }, 2);
    expect(cleared.m1!.settlement).toBeUndefined();
    const next = applyMessageEvent(cleared, MESSAGE_SETTLEMENT_EVENT, { messageId: "m2", requestId: "same-key", settlement: unknown() }, 3);
    expect(next.m2!.settlement?.state).toBe("outcome_unknown");
  });
  it("applies current eligibility from an observation event even when evidence observedAt is older; replay stays idempotent", () => {
    const previous = seed();
    const disabled = { ...unknown(), canClose: false, evidence: { ...unknown().evidence, observedAt: "2000-01-01T00:00:00Z" } };
    const params = { messageId: "m1", requestId: disabled.evidenceToken, settlement: disabled };
    const next = applyMessageEvent(previous, MESSAGE_SETTLEMENT_EVENT, params, 1);
    expect(next.m1!.settlement?.canClose).toBe(false);
    expect(applyMessageEvent(next, MESSAGE_SETTLEMENT_EVENT, structuredClone(params), 2)).toBe(next);
  });
});
