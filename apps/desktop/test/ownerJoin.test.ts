import { describe, expect, it } from "vitest";
import { ownerJoinIntent } from "../src/shared/ownerJoin";
import { newOutboxEntry } from "../src/renderer/src/lib/legacyDelivery/outbox";

describe("owner join IPC", () => {
  const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
  it("copies only a complete bound intent and retains it on a send", () => {
    expect(ownerJoinIntent(undefined)).toBeUndefined();
    expect(ownerJoinIntent(join)).toEqual(join);
    expect(ownerJoinIntent(join)).not.toBe(join);
    expect(newOutboxEntry(null, { id: "message", text: "owner", strategy: "auto", placement: "steer", joinDelegation: join }).joinDelegation).toEqual(join);
  });
  it("rejects incomplete, extra and invalid identity fields before IPC forwarding", () => {
    for (const value of [null, {}, { ...join, attempt: 0 }, { ...join, runtimeGeneration: -1 }, { ...join, expectedTurnId: "" }, { ...join, unrelated: true }]) expect(() => ownerJoinIntent(value)).toThrow("bad owner join intent");
  });
});
