import { describe, expect, it } from "vitest";
import { INPUT_REASONS_BY_STATE, INPUT_STAGES, INPUT_STATES, SESSION_DELIVERY_HELD_REASONS, SESSION_DELIVERY_STATES, SESSION_TURN_KINDS } from "@cutex-desktop/protocol";
import { applyInputLedgerSnapshot, emptyInputLedgerSession } from "./alignment";
import { INPUT_LABEL_IDS, SESSION_DELIVERY_LABEL_IDS, inputLabel, inputLabelFor, sessionDeliveryLabel } from "./labels";
import { nextUpRecords, pendingNoteRecords, timelineRecordFor, timelineRecords } from "./selectors";
import { delivery, iso, record, T0 } from "./testkit";

const session = (records: ReturnType<typeof record>[]) =>
  applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e1", stateRevision: 50, records, coverage: { kind: "full" } }).session;

describe("surfaces (054 §3.2)", () => {
  const s = session([
    record("t2", { surface: "timeline", createdAt: iso(T0 + 2), timelineItemId: "item-2", state: "inContext", evidence: "clientIdEcho" }),
    record("t1", { surface: "timeline", createdAt: iso(T0 + 1), state: "sending" }),
    record("n-late", { surface: "nextUp", createdAt: iso(T0 + 1), order: null, kind: "alarm", state: "waiting", reason: "afterTurn" }),
    record("n2", { surface: "nextUp", createdAt: iso(T0 + 9), order: { admissionKey: "k2", position: 2 }, state: "waiting", reason: "explicitQueue" }),
    record("n1", { surface: "nextUp", createdAt: iso(T0 + 8), order: { admissionKey: "k1", position: 1 }, kind: "delegationRequest", state: "waiting", reason: "reviewPending" }),
    record("n-early", { surface: "nextUp", createdAt: iso(T0), order: null, kind: "agentMessage", state: "waiting", reason: "afterTurn" }),
    record("n-old", { surface: "nextUp", state: "uncertain", reason: "turnInterrupted", since: iso(T0 - 16 * 60_000) }),
    record("p1", { surface: "pendingNotes", kind: "agentMessage", state: "waiting", reason: "passive" }),
    record("gone", { surface: "none", state: "inContext", evidence: "claimedByWait" }),
  ]);

  it("timeline: surface timeline, oldest first", () => {
    expect(timelineRecords(s).map(r => r.inputId)).toEqual(["t1", "t2"]);
  });

  it("joins a native item by timelineItemId, then by clientUserMessageId", () => {
    expect(timelineRecordFor(s, "item-2")?.inputId).toBe("t2");
    expect(timelineRecordFor(s, "native-x", "t1")?.inputId).toBe("t1");
    expect(timelineRecordFor(s, "native-x", "n1")).toBeUndefined();
  });

  it("nextUp: by order.position, then createdAt; uncertainty never expires (owner decision 9)", () => {
    expect(nextUpRecords(s, { now: T0 }).map(r => r.inputId)).toEqual(["n1", "n2", "n-early", "n-old", "n-late"]);
    expect(nextUpRecords(s).map(r => r.inputId)).toContain("n-old");
    expect(nextUpRecords(s, { now: T0 - 2 * 60_000 }).map(r => r.inputId)).toContain("n-old");
    expect(nextUpRecords(s, { now: T0 + 30 * 86_400_000 }).map(r => r.inputId)).toContain("n-old");
  });

  it("pendingNotes: surface pendingNotes", () => {
    expect(pendingNoteRecords(s).map(r => r.inputId)).toEqual(["p1"]);
  });
});

describe("labels (054 §3.3, §5.3)", () => {
  it("every documented (state, reason, stage) has a label", () => {
    const ids = new Set<string>(INPUT_LABEL_IDS);
    for (const state of INPUT_STATES) {
      const reasons: (string | null)[] = [...(INPUT_REASONS_BY_STATE[state] ?? [])];
      // States that may carry no reason (null). Terminal states must carry one, but a missing one still labels.
      if (state !== "waiting") reasons.push(null);
      const stages: (string | null)[] = state === "accepted" ? [null, ...INPUT_STAGES] : [null];
      for (const reason of reasons) {
        for (const stage of stages) {
          for (const stalled of [null, { reason: "noProgress", since: iso(T0) }]) {
            const label = inputLabelFor({ state, reason, stage, stalled });
            expect(label.kind, `${state}/${reason}/${stage}`).toBe("label");
            if (label.kind === "label") {
              expect(ids.has(label.id)).toBe(true);
              expect(label.reason).toBe(reason);
              expect(label.stalled).toEqual(stalled);
            }
          }
        }
      }
    }
  });

  it("matches the §3.3 rows", () => {
    const at = (state: string, reason: string | null = null, stage: string | null = null, insert?: boolean) => {
      const label = inputLabelFor({ state, reason, stage, stalled: null, ...(insert === undefined ? {} : { insert }) });
      return label.kind === "label" ? label.id : `unknown:${label.code}`;
    };
    expect(at("held", "hostBusy")).toBe("held");
    for (const reason of ["turnRunning", "turnFinishing", "adapterQueued", "rideAlongAhead", "ownerQueueAhead", "hostBusy"]) expect(at("waiting", reason)).toBe("afterCurrentTurn");
    expect(at("waiting", "agentOffline")).toBe("agentOffline");
    expect(at("waiting", "explicitQueue")).toBe("queued");
    expect(at("waiting", "delegationLease")).toBe("lease");
    expect(at("waiting", "eventLease")).toBe("lease");
    for (const reason of ["paused", "stopHold", "ownerPause"]) expect(at("waiting", reason)).toBe("paused");
    expect(at("waiting", "nativeHeld")).toBe("nativeHeld");
    expect(at("sending")).toBe("sending");
    expect(at("accepted")).toBe("inserted");
    expect(at("accepted", null, null, false)).toBe("accepted");
    expect(at("accepted", null, "registered")).toBe("registered");
    expect(at("accepted", null, "offered")).toBe("offered");
    expect(at("inContext")).toBe("inContext");
    expect(at("uncertain", "turnInterrupted")).toBe("uncertain");
    expect(at("failed", "admission_timeout")).toBe("failed");
  });

  it("sending{interruptSend} uses the existing sending label instead of an unknown-code warning", () => {
    expect(inputLabel(record("same", { state: "sending", reason: "interruptSend" }))).toMatchObject({ kind: "label", id: "sending", reason: "interruptSend" });
  });
  it("an unknown reason / stage / state is shown as its code and reported", () => {
    expect(inputLabelFor({ state: "waiting", reason: "brandNewReason", stage: null, stalled: null })).toMatchObject({ kind: "unknown", code: "brandNewReason", field: "reason", report: true });
    expect(inputLabelFor({ state: "failed", reason: "turnRunning", stage: null, stalled: null })).toMatchObject({ kind: "unknown", code: "turnRunning", field: "reason" });
    expect(inputLabelFor({ state: "sending", reason: "hostBusy", stage: null, stalled: null })).toMatchObject({ kind: "unknown", code: "hostBusy" });
    expect(inputLabelFor({ state: "accepted", reason: null, stage: "delivered", stalled: null })).toMatchObject({ kind: "unknown", code: "delivered", field: "stage" });
    expect(inputLabelFor({ state: "parked", reason: null, stage: null, stalled: null })).toMatchObject({ kind: "unknown", code: "parked", field: "state" });
    expect(inputLabelFor({ state: "waiting", reason: null, stage: null, stalled: null })).toMatchObject({ kind: "unknown", field: "reason" });
  });

  it("an accepted owner record is an insert; another kind is not", () => {
    expect(inputLabel(record("a", { state: "accepted", kind: "owner" }))).toMatchObject({ id: "inserted" });
    expect(inputLabel(record("b", { state: "accepted", kind: "agentMessage" }))).toMatchObject({ id: "accepted" });
  });

  it("every session delivery has a label; a stale lease is flagged", () => {
    const ids = new Set<string>(SESSION_DELIVERY_LABEL_IDS);
    for (const state of SESSION_DELIVERY_STATES) {
      const variants = state === "turn"
        ? SESSION_TURN_KINDS.map(kind => delivery("turn", 1, { turn: { turnId: "t", kind, askId: null, startedAt: null, inputIds: [] } }))
        : state === "held"
          ? SESSION_DELIVERY_HELD_REASONS.map(reason => delivery("held", 1, { reason }))
          : [delivery(state, 1)];
      for (const d of variants) {
        const label = sessionDeliveryLabel(d);
        expect(label.kind, JSON.stringify(d)).toBe("label");
        if (label.kind === "label") expect(ids.has(label.id)).toBe(true);
      }
    }
    expect(sessionDeliveryLabel(delivery("held", 1, { reason: "stopHold" }))).toMatchObject({ id: "held.paused" });
    expect(sessionDeliveryLabel(delivery("turn", 1))).toMatchObject({ id: "turn.unknown" });
    const lease = { holder: "event" as const, turnId: null, since: iso(T0), runtimeGeneration: 1, inputIds: [], reconcile: { state: "stale" as const } };
    expect(sessionDeliveryLabel(delivery("held", 1, { reason: "eventLease", lease }))).toEqual({ kind: "label", id: "held.eventLease", leaseStale: true });
    expect(sessionDeliveryLabel(delivery("held", 1))).toMatchObject({ kind: "unknown", report: true });
  });
});
