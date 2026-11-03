import { describe, expect, it } from "vitest";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { newPendingSteer, settlePendingSteers } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";

const running = () => timelineFromThreadRead({ thread: { id: "thread", turns: [{ id: "turn", status: "inProgress", items: [] }] } });
const event = (stage: string, patch = {}) => ({ native: { kind: "notification", message: { method: "claude/input/stageChanged", params: { threadId: "thread", turnId: "turn", clientId: "input", stage, ...patch } } } }) as never;
describe("r34 receipt evidence, independent of transcript timing", () => {
  it("keeps registered and offered inputs pending in their live turn, settles only persisted", () => {
    const tl = running(); const p = newPendingSteer(tl, "input", "insert", 0, "turn");
    for (const stage of ["registered", "offered"]) {
      expect(applyEvent(tl, event(stage))).toBe(true);
      expect(settlePendingSteers([p], tl)).toEqual({ pending: [p], lost: [] });
      expect(tl.activeTurnId).toBe("turn");
    }
    applyEvent(tl, event("contextPersisted"));
    expect(settlePendingSteers([p], tl)).toEqual({ pending: [], lost: [] });
    expect(applyEvent(tl, event("offered"))).toBe(false);
    expect(tl.steerReceipts?.get("input")?.stage).toBe("contextPersisted");
  });
  it("handles a persisted receipt arriving before the submit reply creates the pending input", () => {
    const tl = running(); applyEvent(tl, event("contextPersisted"));
    expect(settlePendingSteers([newPendingSteer(tl, "input", "insert", 0, "turn")], tl).pending).toEqual([]);
  });
  it("supports the legacy contextPersisted notification and legitimate carried-turn receipts", () => {
    const tl = running(); const p = newPendingSteer(tl, "input", "insert", 0, "turn");
    applyEvent(tl, event("registered"));
    applyEvent(tl, { native: { kind: "notification", message: { method: "claude/input/contextPersisted", params: { threadId: "thread", turnId: "later", clientId: "input" } } } } as never);
    expect(settlePendingSteers([p], tl).pending).toEqual([]);
  });
  it.each([{ threadId: "other" }, { clientId: "" }, { turnId: null }, { stage: "read" }])("rejects malformed or wrong-thread receipts %j", patch => {
    const tl = running(); expect(applyEvent(tl, event("contextPersisted", patch))).toBe(false);
    expect(tl.steerReceipts).toBeUndefined();
  });
  it("restores checking state to waiting when positive receipt evidence proves its turn still live", () => {
    const tl = running(); applyEvent(tl, event("offered"));
    const p = { ...newPendingSteer(tl, "input", "insert", 0, "turn"), state: "checking" as const };
    expect(settlePendingSteers([p], tl)).toEqual({ pending: [{ ...p, state: "waiting" }], lost: [] });
  });
});
