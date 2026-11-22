// mergePage settlement fence (bootstrap-bounded-bus): page reads and authoritative observations are ordered
// by a client-side sequence, never by clocks. A page read begun before an authoritative observation of a
// message (settlement read, settlement event, bootstrap row — also one that found no evidence) cannot bring
// evidence back; a read begun after it can; a closure always applies.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentMessages } from "../src/renderer/src/lib/agentMessageStore";
import { MESSAGE_SETTLEMENT_EVENT } from "../src/shared/messageSettlement";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";

const clientNow = Date.parse("2026-11-16T06:00:00Z");
const state = () => useAgentMessages.getState();
const evidence = (hostMillis: number, token: string) => ({ ...settlementFixture(), evidenceToken: token, evidence: { ...settlementFixture().evidence, observedAt: new Date(hostMillis).toISOString() } });
const row = (settlement?: unknown, id = "m") => ({ messageId: id, state: "inbox_accepted", ...(settlement ? { settlement } : {}) });
// The client clock is frozen: nothing below may depend on it.
beforeEach(() => { state().reset(); vi.spyOn(Date, "now").mockReturnValue(clientNow); });
afterEach(() => { vi.restoreAllMocks(); state().reset(); });

// Review repro 1 (peer-review, 03bc35135): host clock ahead of the client.
it("does not restore a cleared old token when the host clock is ahead of the client", () => {
  const old = evidence(clientNow + 600_000, "old-token");
  state().seed("a1", [row(old)], []);
  const readSeq = state().beginPageRead();
  state().applySettlementRead("m", undefined);
  state().mergePage("a1", [row(old)], [], readSeq);
  expect(state().byId.m?.settlement).toBeUndefined();
});

// Review repro 2: a later read in the same client millisecond, host clock behind.
it("accepts a genuinely later read in the same client millisecond with a behind host clock", () => {
  state().seed("a1", [row(evidence(clientNow - 600_000, "old-token"))], []);
  state().applySettlementRead("m", undefined);
  const readSeq = state().beginPageRead();
  state().mergePage("a1", [row(evidence(clientNow - 500_000, "new-token"))], [], readSeq);
  expect(state().byId.m?.settlement?.evidenceToken).toBe("new-token");
});

// Review repro 3: authoritative absence for a message with no cached settlement.
it("fences authoritative absence even when no settlement had previously been cached", () => {
  state().seed("a1", [row()], []);
  const readSeq = state().beginPageRead();
  state().applySettlementRead("m", undefined);
  expect(state().byId.m?.settlementKnown).toBe(true);
  state().mergePage("a1", [row(evidence(clientNow - 600_000, "expired-token"))], [], readSeq);
  expect(state().byId.m?.settlement).toBeUndefined();
});

it("fences after a settlement event and a bootstrap row too, but not a message the bootstrap did not list", () => {
  state().seed("a1", [row(evidence(clientNow, "t-n"), "n"), row(undefined, "x")], []);
  const readSeq = state().beginPageRead();
  state().apply({ cutex: { method: MESSAGE_SETTLEMENT_EVENT, params: { messageId: "n", settlement: null } }, receivedAt: new Date(clientNow).toISOString() } as never);
  expect(state().byId.n?.settlement).toBeUndefined();
  state().seed("a1", [row(undefined, "b")], []); // authoritative bootstrap row without evidence
  state().mergePage("a1", [row(evidence(clientNow, "t-n"), "n"), row(evidence(clientNow, "t-b"), "b"), row(evidence(clientNow, "t-x"), "x")], [], readSeq);
  expect(state().byId.n?.settlement).toBeUndefined();
  expect(state().byId.b?.settlement).toBeUndefined();
  // x was bootstrapped before the read began and not observed since: the page's evidence is news.
  expect(state().byId.x?.settlement?.evidenceToken).toBe("t-x");
});

it("orders each row by its own page's read, and always takes a closure", () => {
  state().seed("a1", [row(evidence(clientNow, "old"), "p"), row(evidence(clientNow, "old"), "q")], []);
  const first = state().beginPageRead();
  state().applySettlementRead("p", undefined);
  state().applySettlementRead("q", undefined);
  const second = state().beginPageRead();
  const early = row(evidence(clientNow, "early"), "p");
  const late = row(evidence(clientNow, "late"), "q");
  state().mergePage("a1", [early, late], [], (r) => (r === early ? first : second));
  expect(state().byId.p?.settlement).toBeUndefined();
  expect(state().byId.q?.settlement?.evidenceToken).toBe("late");
  const closed = { ...evidence(clientNow, "c"), state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T05:00:00Z", reason: "stale", requestId: "r" } };
  state().mergePage("a1", [row(closed, "p")], [], first);
  expect(state().byId.p?.settlement?.state).toBe("closed");
});

it("forgets the fences on a host switch", () => {
  state().seed("a1", [row(evidence(clientNow, "old"))], []);
  const readSeq = state().beginPageRead();
  state().applySettlementRead("m", undefined);
  state().reset();
  state().mergePage("a1", [row(evidence(clientNow, "old"))], [], readSeq);
  expect(state().byId.m?.settlement?.evidenceToken).toBe("old");
});

// Review repro (peer-review, e23d52295): the cap drops the cleared message's fence while its old page is in flight.
it("does not revive cleared evidence when its fence is evicted while the old page is in flight", () => {
  const old = evidence(clientNow, "old-token");
  state().seed("a1", [row(old)], []);
  const pageSeq = state().beginPageRead();
  state().applySettlementRead("m", undefined);
  for (let i = 0; i < 20_000; i++) state().applySettlementRead(`other-${i}`, undefined);
  state().mergePage("a1", [row(old)], [], pageSeq);
  expect(state().byId.m?.settlement).toBeUndefined();
  // A closure still applies from that old page.
  const closed = { ...old, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T05:00:00Z", reason: "stale", requestId: "r" } };
  state().mergePage("a1", [row(closed)], [], pageSeq);
  expect(state().byId.m?.settlement?.state).toBe("closed");
});

it("still accepts a page read begun after the eviction", () => {
  state().applySettlementRead("m", undefined);
  for (let i = 0; i < 20_000; i++) state().applySettlementRead(`other-${i}`, undefined);
  const pageSeq = state().beginPageRead();
  state().mergePage("a1", [row(evidence(clientNow, "new-token"))], [], pageSeq);
  expect(state().byId.m?.settlement?.evidenceToken).toBe("new-token");
});
