import { describe, expect, it } from "vitest";
import { readMessageSettlement } from "../src/shared/messageSettlement";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";

describe("settlement wire validation never invents eligibility", () => {
  it.each([
    { runtime: "codex" }, { terminalStatus: "inProgress" }, { terminalStatus: "in_progress" },
    { observedAt: "not-a-date" }, { observedAt: "" },
  ])("rejects mismatched or nonterminal evidence %j", (patch) => {
    const valid = settlementFixture();
    expect(readMessageSettlement({ ...valid, evidence: { ...valid.evidence, ...patch } })).toBeUndefined();
  });
  it("rejects inconsistent closure state and invalid close dates", () => {
    const valid = settlementFixture();
    const closure = { actor: "owner", closedAt: "2026-10-27T01:00:00Z", reason: "Reviewed separately", requestId: "key" };
    expect(readMessageSettlement({ ...valid, state: "closed", canClose: false })).toBeUndefined();
    expect(readMessageSettlement({ ...valid, state: "closed", closure })).toBeUndefined();
    expect(readMessageSettlement({ ...valid, closure })).toBeUndefined();
    expect(readMessageSettlement({ ...valid, state: "closed", canClose: false, closure: { ...closure, closedAt: "invalid" } })).toBeUndefined();
    expect(readMessageSettlement({ ...valid, state: "closed", canClose: false, closure })?.closure).toEqual(closure);
  });
  it.each(["completed", "failed", "interrupted"])("accepts contracted %s evidence without changing server canClose:false", (terminalStatus) => {
    const valid = settlementFixture();
    const raw = { ...valid, canClose: false, evidence: { ...valid.evidence, terminalStatus } };
    expect(readMessageSettlement(raw)).toEqual(raw);
  });
});
