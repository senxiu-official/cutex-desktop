// Old hosts (no input ledger): legacy rows map onto registry states / effects only (review 2026-11-14 finding 8).
import { describe, expect, it } from "vitest";
import { LEGACY_FAILED_SEND_EFFECTS, legacyItemState, legacyOutboxState, legacySteerState } from "./legacyNextUp";
import { NEXT_UP_EFFECTS, NEXT_UP_STATE_IDS, NEXT_UP_STATES } from "./nextUpRegistry";

describe("legacy rows through the registry", () => {
  it("optimistic sends", () => {
    expect(legacyOutboxState({ state: "sending" })).toBe("sending");
    expect(legacyOutboxState({ state: "sending", waitingForPrevious: true })).toBe("queued");
    expect(legacyOutboxState({ state: "held" })).toBe("queued");
    expect(legacyOutboxState({ state: "confirmed" })).toBe("awaitingRead");
    expect(legacyOutboxState({ state: "failed" })).toBe("failed");
  });
  it("a failed send's buttons are registered on state 13 and include a disposal", () => {
    for (const effect of LEGACY_FAILED_SEND_EFFECTS) expect(NEXT_UP_STATES.failed.buttons).toContain(effect);
    expect(LEGACY_FAILED_SEND_EFFECTS.some(effect => NEXT_UP_EFFECTS[effect].disposal)).toBe(true);
  });
  it("steers and queue items map to registered states", () => {
    for (const state of [legacySteerState(true), legacySteerState(false), legacyItemState({}), legacyItemState({ paused: true }), legacyItemState({ afterTurn: true })])
      expect(NEXT_UP_STATE_IDS).toContain(state);
  });
});
