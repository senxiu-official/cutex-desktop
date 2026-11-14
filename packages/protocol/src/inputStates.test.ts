// The TS input-ledger vocabulary equals cutex `schema/export/input-states.json` (054 §2.4, §4.2).
// Fixture is the byte-exact export of the deployed backend r282 (cutex c77e63d4, src/management/v2/schema/export/input-states.json),
// including discardedReason superseded / historyReverted (Next Up registry 1.4 contract).
import { describe, expect, it } from "vitest";
import exported from "./__fixtures__/input-states.json";
import {
  INPUT_CARRIED_REASONS, INPUT_SENDING_REASONS, INPUT_ACTIONS, INPUT_DELIVERY_MODES, INPUT_DISCARDED_REASONS, INPUT_EVIDENCE, INPUT_FAILED_REASONS, INPUT_HELD_REASONS,
  INPUT_KINDS, INPUT_LEASE_HOLDERS, INPUT_LEASE_RECONCILE_STATES, INPUT_REASONS_BY_STATE, INPUT_REJECTED_REASONS,
  INPUT_SENDER_KINDS, INPUT_SETTLED_STATES, INPUT_STAGES, INPUT_STALLED_REASONS, INPUT_STATES, INPUT_STRATEGIES,
  INPUT_SUPERSEDED_REASONS, INPUT_SURFACES, INPUT_TERMINAL_STATES, INPUT_TIMINGS, INPUT_UNCERTAIN_REASONS,
  INPUT_WAITING_REASONS, SESSION_DELIVERY_HELD_REASONS, SESSION_DELIVERY_STATES, SESSION_TURN_KINDS,
  isInputSettled, isInputTerminal, isKnownInputReason,
} from "./cutex";

const defs = exported.$defs as Record<string, { enum: string[] }>;

const constants: Record<string, readonly string[]> = {
  inputKind: INPUT_KINDS,
  senderKind: INPUT_SENDER_KINDS,
  inputState: INPUT_STATES,
  terminalState: INPUT_TERMINAL_STATES,
  settledState: INPUT_SETTLED_STATES,
  carriedReason: INPUT_CARRIED_REASONS,
  sendingReason: INPUT_SENDING_REASONS,
  heldReason: INPUT_HELD_REASONS,
  waitingReason: INPUT_WAITING_REASONS,
  uncertainReason: INPUT_UNCERTAIN_REASONS,
  failedReason: INPUT_FAILED_REASONS,
  rejectedReason: INPUT_REJECTED_REASONS,
  discardedReason: INPUT_DISCARDED_REASONS,
  supersededReason: INPUT_SUPERSEDED_REASONS,
  stalledReason: INPUT_STALLED_REASONS,
  surface: INPUT_SURFACES,
  stage: INPUT_STAGES,
  evidence: INPUT_EVIDENCE,
  action: INPUT_ACTIONS,
  strategy: INPUT_STRATEGIES,
  deliveryMode: INPUT_DELIVERY_MODES,
  timing: INPUT_TIMINGS,
  sessionDeliveryState: SESSION_DELIVERY_STATES,
  sessionDeliveryHeldReason: SESSION_DELIVERY_HELD_REASONS,
  sessionTurnKind: SESSION_TURN_KINDS,
  leaseHolder: INPUT_LEASE_HOLDERS,
  leaseReconcileState: INPUT_LEASE_RECONCILE_STATES,
};

describe("input-states.json ↔ protocol constants", () => {
  it("covers every exported $def and nothing more", () => {
    expect(Object.keys(constants).sort()).toEqual(Object.keys(defs).sort());
  });

  it.each(Object.keys(constants))("%s equals the export, in order", key => {
    expect([...constants[key]!]).toEqual(defs[key]!.enum);
  });

  it("maps every state with reasons to its export list", () => {
    const perState: Record<string, string> = {
      accepted: "carriedReason", inContext: "carriedReason",
      sending: "sendingReason", held: "heldReason", waiting: "waitingReason", uncertain: "uncertainReason", failed: "failedReason",
      rejected: "rejectedReason", discarded: "discardedReason", superseded: "supersededReason",
    };
    for (const state of INPUT_STATES) {
      const key = perState[state];
      expect(INPUT_REASONS_BY_STATE[state] ? [...INPUT_REASONS_BY_STATE[state]!] : undefined).toEqual(key ? defs[key]!.enum : undefined);
    }
  });

  it("settled = terminal + uncertain", () => {
    for (const state of INPUT_STATES) {
      expect(isInputSettled(state)).toBe(isInputTerminal(state) || state === "uncertain");
    }
  });

  it("flags reasons a state does not document", () => {
    expect(isKnownInputReason("waiting", "nativeHeld")).toBe(true);
    expect(isKnownInputReason("waiting", "notDelivered")).toBe(false);
    expect(isKnownInputReason("failed", "someFutureCode")).toBe(false);
    expect(isKnownInputReason("sending", null)).toBe(true);
    expect(isKnownInputReason("accepted", "turnRunning")).toBe(false);
  });
});
