// lib/inputLedger/noteDelivery: the host's optional note-delivery facts, read strictly (cutex fix/nextup-delivery handoff).
import { describe, expect, it } from "vitest";
import { WAITING_FOR, calmWait, hasNoteDiagnostics, noteActionCode, noteDiagnostics, passiveNotesReport, readNowParams, readNowResult, readsSelectedNotes, releaseLiftsPauseOnly, reportsPreTurnNotes } from "../src/renderer/src/lib/inputLedger/noteDelivery";
import { zhCN, en, zhHant } from "../src/renderer/src/lib/noteDeliveryMessages";

describe("capabilities", () => {
  it("featureList names and the camelCase features names; absent = old host", () => {
    expect(readsSelectedNotes(["agent-bus-read-notes-v1"])).toBe(true);
    expect(readsSelectedNotes(new Set(["agentBusReadNotesV1"]))).toBe(true);
    expect(reportsPreTurnNotes(["pre-turn-passive-notes-v1"])).toBe(true);
    expect(hasNoteDiagnostics(["passive-note-diagnostics-v1"])).toBe(true);
    expect(readsSelectedNotes(["input-ledger-v1"]) || reportsPreTurnNotes(null) || hasNoteDiagnostics(undefined)).toBe(false);
  });
});

describe("noteDiagnostics", () => {
  it("reads every field; unknown waitingFor is 'other'; bad stage / types dropped; null times kept null", () => {
    const d = noteDiagnostics({ details: { deliveryDiagnostics: { stage: "inbox", since: null, lastAttemptAt: "2026-11-19T10:00:00Z", lastError: "x", waitingFor: "nextTurn", blockedByInputId: null } } });
    expect(d).toEqual({ stage: "inbox", since: null, lastAttemptAt: "2026-11-19T10:00:00Z", lastAttemptKind: null, lastError: "x", waitingFor: "nextTurn", blockedByInputId: null, projection: null });
    expect(noteDiagnostics({ details: { deliveryDiagnostics: { lastAttemptKind: "nativeAdmission" } } })?.lastAttemptKind).toBe("nativeAdmission");
    expect(noteDiagnostics({ details: { deliveryDiagnostics: { lastAttemptKind: "teleport" } } })?.lastAttemptKind).toBeNull();
    expect(noteDiagnostics({ details: { deliveryDiagnostics: { stage: "moon", waitingFor: "teleport", lastError: 5 } } })).toMatchObject({ stage: null, waitingFor: "other", lastError: null });
    expect(noteDiagnostics({ details: {} })).toBeNull();
    expect(calmWait(d)).toBe(true);
    expect(calmWait(noteDiagnostics({ details: { deliveryDiagnostics: { waitingFor: "earlierInput" } } }))).toBe(false);
  });
  it("the exact blocker from any of its three places; projection failure attempts", () => {
    expect(noteDiagnostics({ details: { blockedByInputId: "a" } })?.blockedByInputId).toBe("a");
    expect(noteDiagnostics({ details: { projectionFailure: { code: "external_projection_blocked", blockedByInputId: "b", attempts: 0 } } })).toMatchObject({ blockedByInputId: "b", projection: { code: "external_projection_blocked", attempts: 0 } });
    expect(noteDiagnostics({ details: { deliveryDiagnostics: { blockedByInputId: "c" }, blockedByInputId: "d" } })?.blockedByInputId).toBe("c");
  });
  it("all 16 current waitingFor values have words in zh-CN, en and zh-Hant", () => {
    expect(WAITING_FOR).toHaveLength(16);
    for (const w of WAITING_FOR) for (const table of [zhCN, en, zhHant] as Record<string, string>[]) expect(table[`noteDelivery.wait.${w}`]).toBeTruthy();
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });
});

describe("passiveNotes and 现在读取", () => {
  it("the report keeps admitted / skipped / errors; malformed entries dropped", () => {
    expect(passiveNotesReport({ admitted: ["a", 3], skipped: [{ inputId: "b", waitingFor: "nextBoundaryBudget", error: null }, { nope: 1 }], errors: ["e"], budgetNotes: 2 }))
      .toEqual({ admitted: ["a"], skipped: [{ inputId: "b", waitingFor: "nextBoundaryBudget", error: null }], errors: ["e"] });
    expect(passiveNotesReport(null)).toBeNull();
  });
  it("the answer's counts; started only when true; params: deduplicated ids, {} for an older host", () => {
    expect(readNowResult({ pendingNotes: 2, started: true, submit: { passiveNotes: { admitted: ["a"], skipped: [], errors: [] } } })).toEqual({ pendingNotes: 2, started: true, passiveNotes: { admitted: ["a"], skipped: [], errors: [] } });
    expect(readNowResult(undefined)).toEqual({ pendingNotes: null, started: false, passiveNotes: null });
    expect(readNowParams(["a", "a", "b"], true)).toEqual({ inputIds: ["a", "b"] });
    expect(readNowParams(["a"], false)).toEqual({});
  });
});

describe("releaseHold and error codes", () => {
  it("pause-only only with both markers", () => {
    expect(releaseLiftsPauseOnly({ details: { ownerHold: true, releaseEffect: "removeOwnerPauseOnly" } })).toBe(true);
    expect(releaseLiftsPauseOnly({ details: { ownerHold: true } })).toBe(false);
    expect(releaseLiftsPauseOnly({ details: { releaseEffect: "removeOwnerPauseOnly", ownerHold: false } })).toBe(false);
  });
  it("finds the code inside an IPC-wrapped message, not a longer code containing it", () => {
    expect(noteActionCode(new Error("Error invoking remote method 'x': Error: read_notes_unsupported: no"))).toBe("read_notes_unsupported");
    expect(noteActionCode(new Error("policy_revision_conflict: x"))).toBeNull();
    expect(noteActionCode(new Error("revision_conflict: x"))).toBe("revision_conflict");
    expect(noteActionCode("boom")).toBeNull();
  });
});

describe("retryBlocked (cutex asks-start-catchup): parsed from the explicit marker only", () => {
  it("true only for retryBlocked === true", () => {
    const blocked = noteDiagnostics({ details: { deliveryDiagnostics: { stage: "context", waitingFor: "contextReceipt", retryBlocked: true } } })!;
    expect(blocked.retryBlocked).toBe(true);
    for (const v of [false, "true", 1, undefined]) {
      const d = noteDiagnostics({ details: { deliveryDiagnostics: { stage: "context", waitingFor: "contextReceipt", retryBlocked: v } } })!;
      expect(d.retryBlocked).toBeUndefined();
    }
    expect(zhCN["noteDelivery.retryBlocked.timeline"]).toBeTruthy();
    expect(en["noteDelivery.retryBlocked.timeline"]).toBeTruthy();
    expect(zhHant["noteDelivery.retryBlocked.timeline"]).toBeTruthy();
  });
});
