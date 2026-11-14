import { describe, expect, it } from "vitest";
import { INPUT_REASONS_BY_STATE, INPUT_STAGES, INPUT_STATES, SESSION_DELIVERY_HELD_REASONS, SESSION_DELIVERY_STATES, SESSION_TURN_KINDS } from "@cutex-desktop/protocol";
import { applyInputLedgerSnapshot, emptyInputLedgerSession } from "./alignment";
import { SESSION_DELIVERY_LABEL_IDS, sessionDeliveryLabel } from "./labels";
import { projectNextUp } from "./nextUpRegistry";
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
  // Record labels moved to the Next Up registry (nextUpRegistry.ts; test/nextUpRegistry.test.ts). Session labels stay here.
  it("a record status projects into the registry; unknown codes become state unknown", () => {
    for (const state of INPUT_STATES) for (const reason of [...(INPUT_REASONS_BY_STATE[state] ?? [])]) {
      const p = projectNextUp(record("r", { state, reason } as never));
      if (p.kind === "state") expect(p.state, `${state}/${reason}`).not.toBe("unknown");
    }
    for (const stage of INPUT_STAGES) expect(projectNextUp(record("r", { state: "accepted", stage }))).toMatchObject({ kind: "state", state: "awaitingRead" });
    expect(projectNextUp(record("r", { state: "waiting", reason: "brandNewReason" as never }))).toMatchObject({ state: "unknown", unknown: { field: "reason", code: "brandNewReason" } });
    expect(projectNextUp(record("r", { state: "parked" as never, reason: null }))).toMatchObject({ state: "unknown", unknown: { field: "state" } });
    expect(projectNextUp(record("r", { state: "accepted", stage: "delivered" as never }))).toMatchObject({ state: "unknown", unknown: { field: "stage" } });
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
