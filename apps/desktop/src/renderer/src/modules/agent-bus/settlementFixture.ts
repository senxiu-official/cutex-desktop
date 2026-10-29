// Shared by behavioral tests and the parent's admission preview integration. All scripted server
// facts live with the agent-bus module, including the actual 接下来 row.
import type { AdmissionNextStep, MessageSettlement } from "@cutex-desktop/protocol";

export function settlementFixture(): MessageSettlement {
  return {
    state: "outcome_unknown", canClose: true, evidenceToken: "settlement-evidence-1",
    evidence: { runtime: "claude", runtimeGeneration: 3, threadId: "settlement-thread", actualTurnId: "settlement-turn", terminalStatus: "interrupted", observedAt: new Date().toISOString() },
    closure: null,
  };
}

export function settlementAdmissionFixture(settlement = settlementFixture()): AdmissionNextStep {
  return { id: "m-settlement", deliveryKind: "tell", enqueuedAt: "2026-10-27T00:00:00Z", from: "Mika", preview: "请检查迁移结果并回复。", waitReason: "nativeReceipt", settlement };
}
