import { describe, expect, it } from "vitest";
import type { InputListResult, InputRecord, QueueListResult } from "@cutex-desktop/protocol";
import {
  applyInputLedgerNotification,
  applyInputLedgerSnapshot,
  applyInputStateChanged,
  applySessionDeliveryChanged,
  bootstrapSnapshot,
  emptyInputLedgerSession,
  inputGetSnapshot,
  inputLedgerReconnected,
  inputLedgerStreamReset,
  inputListSnapshot,
  queueListSnapshot,
  type InputLedgerSession,
} from "./alignment";
import { delivery, record } from "./testkit";

const changed = (rec: InputRecord, ledgerEpoch = "e1") => ({ cutexSessionId: "cutex.s1", ledgerEpoch, stateRevision: rec.stateRevision, record: rec });

function seeded(records: InputRecord[], rev: number, epoch = "e1"): InputLedgerSession {
  return applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: epoch, stateRevision: rev, records, coverage: { kind: "full" } }).session;
}

describe("events (054 §2.8 step 1)", () => {
  it("an event before any read asks for a full read once; the read sets the epoch and catches up", () => {
    const first = applyInputStateChanged(emptyInputLedgerSession(), changed(record("a", { stateRevision: 4 })));
    expect(first.session.epoch).toBeNull();
    expect(first.session.records.size).toBe(0);
    expect(first.fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: 1, reason: "initial" }]);
    const second = applyInputStateChanged(first.session, changed(record("b", { stateRevision: 6 })));
    expect(second.fetches).toEqual([]);
    // The read predates event 6: it answers at 5, so a since-read covers the rest.
    const read = applyInputLedgerSnapshot(second.session, { ledgerEpoch: "e1", stateRevision: 5, records: [record("a", { stateRevision: 4 })], coverage: { kind: "full" }, generation: 1 });
    expect(read.session).toMatchObject({ epoch: "e1", rev: 5, probe: null });
    expect(read.fetches).toEqual([{ method: "cutex/input/list", params: { sinceRevision: 5 }, generation: 2, reason: "gap" }]);
  });

  it("applies the next revision without a fetch", () => {
    const s = seeded([record("a", { stateRevision: 1 })], 1);
    const step = applyInputStateChanged(s, changed(record("a", { rev: 2, stateRevision: 2, state: "sending" })));
    expect(step.fetches).toEqual([]);
    expect(step.session.rev).toBe(2);
    expect(step.session.records.get("a")?.state).toBe("sending");
  });

  it("drops a record whose rev is not newer, but still advances the revision", () => {
    const s = seeded([record("a", { rev: 3, stateRevision: 3, state: "accepted" })], 3);
    const step = applyInputStateChanged(s, changed(record("a", { rev: 3, stateRevision: 3, state: "accepted" })));
    expect(step.session).toBe(s);
    const older = applyInputStateChanged(s, changed(record("a", { rev: 2, stateRevision: 2, state: "sending" })));
    expect(older.session.records.get("a")?.state).toBe("accepted");
    expect(older.fetches).toEqual([]);
  });

  it("a hole schedules input/list{sinceRevision: local rev} and rev = max", () => {
    const s = seeded([record("a", { stateRevision: 2 })], 2);
    const step = applyInputStateChanged(s, changed(record("b", { stateRevision: 5 })));
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: { sinceRevision: 2 }, generation: 1, reason: "gap" }]);
    expect(step.session.rev).toBe(5);
    // A late, lower revision does not move rev back and does not ask again.
    const late = applyInputStateChanged(step.session, changed(record("c", { stateRevision: 4 })));
    expect(late.session.rev).toBe(5);
    expect(late.fetches).toEqual([]);
    expect(late.session.records.has("c")).toBe(true);
  });

  it("another epoch on the stream asks for a full read; the read switches, then old-epoch events are ignored", () => {
    const s = seeded([record("a", { stateRevision: 9 })], 9);
    const step = applyInputStateChanged(s, changed(record("b", { stateRevision: 3 }), "e2"));
    expect(step.session.epoch).toBe("e1");
    expect(step.session.records.has("a")).toBe(true);
    expect(step.session.generation).toBe(s.generation + 1);
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: s.generation + 1, reason: "epoch" }]);
    // More events of e2 do not ask again.
    expect(applyInputStateChanged(step.session, changed(record("c", { stateRevision: 4 }), "e2")).fetches).toEqual([]);
    const read = applyInputLedgerSnapshot(step.session, { ledgerEpoch: "e2", stateRevision: 3, records: [record("b", { stateRevision: 3 })], coverage: { kind: "full" }, generation: step.fetches[0]!.generation });
    expect(read.session.epoch).toBe("e2");
    expect([...read.session.records.keys()]).toEqual(["b"]);
    expect(read.session.retiredEpochs.has("e1")).toBe(true);
    const stale = applyInputStateChanged(read.session, changed(record("a", { rev: 2, stateRevision: 10 }), "e1"));
    expect(stale.session).toBe(read.session);
    expect(stale.fetches).toEqual([]);
  });

  it("an old epoch replayed on the stream after a read switched epochs is retired by the next read", () => {
    const s = seeded([record("b", { stateRevision: 2 })], 2, "e2");
    const replay = applyInputStateChanged(s, changed(record("a", { stateRevision: 30 }), "e1"));
    expect(replay.session.epoch).toBe("e2");
    expect(replay.fetches).toHaveLength(1);
    const read = applyInputLedgerSnapshot(replay.session, { ledgerEpoch: "e2", stateRevision: 2, records: [record("b", { stateRevision: 2 })], coverage: { kind: "full" }, generation: replay.fetches[0]!.generation });
    expect(read.session.epoch).toBe("e2");
    expect(read.session.retiredEpochs.has("e1")).toBe(true);
    expect(read.session.records.has("a")).toBe(false);
    expect(read.fetches).toEqual([]);
  });

  it("deliveryChanged: newer revision wins, an older one is dropped, and it counts for gaps", () => {
    const s = seeded([], 1);
    const a = applySessionDeliveryChanged(s, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 2, delivery: delivery("turn", 2) });
    expect(a.session.delivery?.state).toBe("turn");
    expect(a.fetches).toEqual([]);
    const b = applySessionDeliveryChanged(a.session, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 4, delivery: delivery("idle", 4) });
    expect(b.session.delivery?.state).toBe("idle");
    expect(b.fetches).toEqual([{ method: "cutex/input/list", params: { sinceRevision: 2 }, generation: 1, reason: "gap" }]);
    const late = applySessionDeliveryChanged(b.session, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 3, delivery: delivery("finishing", 3) });
    expect(late.session.delivery?.state).toBe("idle");
  });

  it("dispatches by method and ignores other notifications", () => {
    const s = seeded([], 1);
    expect(applyInputLedgerNotification(s, "cutex/userInput/queued", {}).session).toBe(s);
    const step = applyInputLedgerNotification(s, "cutex/input/stateChanged", changed(record("a", { stateRevision: 2 })));
    expect(step.session.records.has("a")).toBe(true);
  });
});

describe("read results (054 §2.8 step 2)", () => {
  it("a stale full list never overwrites newer records or delivery", () => {
    let s = seeded([record("a", { rev: 1, stateRevision: 1 })], 1);
    s = applyInputStateChanged(s, changed(record("a", { rev: 2, stateRevision: 2, state: "inContext", evidence: "clientIdEcho" }))).session;
    s = applySessionDeliveryChanged(s, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 3, delivery: delivery("idle", 3) }).session;
    const stale: InputListResult = { ledgerEpoch: "e1", stateRevision: 1, records: [record("a", { rev: 1, stateRevision: 1 })], complete: true, delivery: delivery("turn", 1) };
    const step = applyInputLedgerSnapshot(s, inputListSnapshot(stale, {}));
    expect(step.session.records.get("a")?.state).toBe("inContext");
    expect(step.session.delivery?.state).toBe("idle");
    expect(step.session.rev).toBe(3);
    expect(step.fetches).toEqual([]);
  });

  it("a full list prunes what it does not list up to its revision and keeps newer records", () => {
    let s = seeded([record("old", { stateRevision: 1 }), record("a", { stateRevision: 2 })], 2);
    s = applyInputStateChanged(s, changed(record("new", { stateRevision: 3 }))).session;
    const step = applyInputLedgerSnapshot(s, { ledgerEpoch: "e1", stateRevision: 2, records: [record("a", { stateRevision: 2 })], coverage: { kind: "full" } });
    expect([...step.session.records.keys()].sort()).toEqual(["a", "new"]);
  });

  it("a since list merges and covers the hole", () => {
    const s = seeded([record("a", { stateRevision: 2 })], 2);
    const gap = applyInputStateChanged(s, changed(record("c", { stateRevision: 5 })));
    const fetch = gap.fetches[0]!;
    const result: InputListResult = { ledgerEpoch: "e1", stateRevision: 6, records: [record("b", { stateRevision: 3 }), record("a", { rev: 2, stateRevision: 4 }), record("c", { stateRevision: 5 }), record("d", { stateRevision: 6 })], complete: true };
    const step = applyInputLedgerSnapshot(gap.session, inputListSnapshot(result, fetch.params, fetch.generation));
    expect([...step.session.records.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    expect(step.session.records.get("a")?.rev).toBe(2);
    expect(step.session.rev).toBe(6);
    expect(step.fetches).toEqual([]);
  });

  it("resyncRequired asks for a full read and does not advance rev", () => {
    const s = seeded([record("a")], 1);
    const step = applyInputLedgerSnapshot(s, inputListSnapshot({ ledgerEpoch: "e1", stateRevision: 40, records: [], complete: false, resyncRequired: true }, { sinceRevision: 1 }));
    expect(step.session.rev).toBe(1);
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: 1, reason: "resync" }]);
  });

  it("a result of an older generation is dropped", () => {
    const s = seeded([record("a", { stateRevision: 1 })], 1);
    const moved = applyInputStateChanged(s, changed(record("b", { stateRevision: 1 }), "e2")).session;
    const step = applyInputLedgerSnapshot(moved, { ledgerEpoch: "e2", stateRevision: 5, records: [record("x", { stateRevision: 5 })], coverage: { kind: "since", sinceRevision: 1 }, generation: s.generation });
    expect(step.session).toBe(moved);
  });

  it("queue/list: partial — merges by rev, and a newer revision schedules a since read", () => {
    const s = seeded([record("a", { stateRevision: 2 })], 2);
    const result = {
      revision: 1, items: [], ledgerEpoch: "e1", stateRevision: 3,
      inputs: [record("q", { surface: "nextUp", state: "waiting", reason: "explicitQueue", stateRevision: 3 })],
      delivery: delivery("turn", 3),
    } as QueueListResult;
    const step = applyInputLedgerSnapshot(s, queueListSnapshot(result)!);
    expect(step.session.records.has("q")).toBe(true);
    expect(step.session.records.has("a")).toBe(true);
    expect(step.session.delivery?.state).toBe("turn");
    // R = local + 1 may still be a change outside `inputs`.
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: { sinceRevision: 2 }, generation: 1, reason: "gap" }]);
    expect(queueListSnapshot({ revision: 1, items: [] })).toBeNull();
  });

  it("a current-generation partial read of another epoch switches to it and asks for a full read", () => {
    const s = seeded([record("a")], 1);
    const step = applyInputLedgerSnapshot(s, inputGetSnapshot({ ledgerEpoch: "e2", stateRevision: 7, records: [record("z", { stateRevision: 7 })], missing: [] }, s.generation));
    expect(step.session.epoch).toBe("e2");
    expect([...step.session.records.keys()]).toEqual(["z"]);
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: 2, reason: "epoch" }]);
  });

  it("a read without a generation cannot switch epochs: it only asks for a full read", () => {
    const s = seeded([record("a")], 1);
    const step = applyInputLedgerSnapshot(s, inputGetSnapshot({ ledgerEpoch: "e2", stateRevision: 7, records: [record("z", { stateRevision: 7 })], missing: [] }));
    expect(step.session.epoch).toBe("e1");
    expect(step.session.records.has("a")).toBe(true);
    expect(step.fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: 2, reason: "epoch" }]);
  });

  it("bootstrap fields are a full read; absent fields mean an older cutex", () => {
    expect(bootstrapSnapshot({})).toBeNull();
    const snap = bootstrapSnapshot({ ledgerEpoch: "e1", stateRevision: 4, inputs: [record("a", { stateRevision: 4 })], delivery: delivery("idle", 4) })!;
    const step = applyInputLedgerSnapshot(emptyInputLedgerSession(), snap);
    expect(step.session).toMatchObject({ epoch: "e1", rev: 4, deliveryRevision: 4 });
    expect(step.fetches).toEqual([]);
  });
});

describe("reset and reconnect (054 §2.8 steps 3–4)", () => {
  it("stream reset / lagged ask for a full read and keep the records until it answers", () => {
    const s = seeded([record("a")], 1);
    expect(inputLedgerStreamReset(s)).toEqual({ session: s, fetches: [{ method: "cutex/input/list", params: {}, generation: 1, reason: "streamReset" }] });
    expect(inputLedgerStreamReset(s, "lagged").fetches[0]!.reason).toBe("lagged");
  });

  it("reconnect reads since the local revision (full when nothing is known)", () => {
    expect(inputLedgerReconnected(emptyInputLedgerSession()).fetches).toEqual([{ method: "cutex/input/list", params: {}, generation: 0, reason: "initial" }]);
    const s = seeded([record("a", { stateRevision: 8 })], 8);
    expect(inputLedgerReconnected(s).fetches).toEqual([{ method: "cutex/input/list", params: { sinceRevision: 8 }, generation: 1, reason: "reconnect" }]);
  });
});


describe("C5 delivery-first same-revision action refresh (backend20757152)", () => {
  it("merges record versions after delivery advanced the session head, without inventing actions", () => {
    const before = record("owner", { rev: 4, stateRevision: 10, state: "accepted", actions: ["interruptSend"], turnId: "t1" });
    const initial = seeded([before], 10);
    const finishing = delivery("finishing", 11);
    const first = applySessionDeliveryChanged(initial, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 11, delivery: finishing });
    expect(first.session.rev).toBe(11);
    expect(first.session.records.get("owner")).toBe(before);
    const sending = record("owner", { rev: 5, stateRevision: 11, state: "sending", reason: "interruptSend", surface: "timeline", actions: [], turnId: "t1" });
    const second = applyInputStateChanged(first.session, changed(sending));
    expect(second.fetches).toEqual([]);
    expect(second.session.records.get("owner")).toEqual(sending);
    expect(second.session.delivery).toEqual(finishing);
    const refreshed = { ...sending, rev: 6, stateRevision: 12, state: "held" as const, reason: "hostBusy" as const, actions: ["interruptSend" as const] };
    const heldDelivery = applySessionDeliveryChanged(second.session, { cutexSessionId: "cutex.s1", ledgerEpoch: "e1", stateRevision: 12, delivery: delivery("held", 12, { reason: "hostBusy" }) });
    expect(heldDelivery.session.records.get("owner")?.actions).toEqual([]);
    const last = applyInputStateChanged(heldDelivery.session, changed(refreshed));
    expect(last.session.records.get("owner")).toEqual(refreshed);
    expect(applyInputStateChanged(last.session, changed(before)).session.records.get("owner")).toEqual(refreshed);
  });
});
