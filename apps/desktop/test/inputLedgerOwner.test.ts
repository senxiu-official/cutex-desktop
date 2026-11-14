import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { record, delivery } from "../src/renderer/src/lib/inputLedger/testkit";
import { applyInputLedgerSnapshot, emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
import { viewKey } from "../src/renderer/src/lib/viewKey";
import { clearableUncertain } from "../src/renderer/src/lib/inputLedger/nextUp";
import { missingTimelineRecords, ownerTimelineEntry, predictedOwnerSurface } from "../src/renderer/src/lib/inputLedger/owner";

const mock = vi.hoisted(() => ({ calls: [] as { host: string; method: string; args: unknown[] }[], responses: new Map<string, (...args: any[]) => any>(), handlers: new Map<string, (value: any) => void>() }));
vi.mock("../src/renderer/src/bridge", () => {
  const apiFor = (host: string) => new Proxy({}, { get: (_, method: string) => (...args: unknown[]) => {
    mock.calls.push({ host, method, args });
    return Promise.resolve().then(() => mock.responses.get(method)?.(...args));
  } });
  return { api: apiFor("local"), apiFor, bridge: { on: (name: string, fn: (value: any) => void) => { mock.handlers.set(name, fn); return () => {}; }, shell: { logError: () => {} } } };
});

let app: typeof import("../src/renderer/src/store").useApp;
const key = viewKey("local", "cutex.s1");
const seed = (records = [record("old")]) => applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e", stateRevision: 1, records, delivery: delivery("idle", 1), coverage: { kind: "full" }, generation: 0 }).session;
const interruptSeed = (records: Parameters<typeof seed>[0]) => ({ ...seed(records), delivery: delivery("turn", 1, { runtimeGeneration: 7, turn: { turnId: "t1", kind: "owner", askId: null, startedAt: null, inputIds: [] } }) });
beforeEach(async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("document", { hasFocus: () => false });
  mock.calls.length = 0; mock.responses.clear();
  app = (await import("../src/renderer/src/store")).useApp;
  app.setState({ features: new Set(["input-ledger-v1", "owner-idle-busy-timeline-v1"]), selectedId: "cutex.s1", selectedHost: "local", inputs: { [key]: seed() }, ledgerOutbox: {}, ledgerOwnerDrafts: {}, outbox: {}, pendingSteers: {} });
  mock.responses.set("inputDismiss", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], failed: [] }));
  mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], delivery: delivery("idle", 1), complete: true }));
}, 60_000);
afterEach(() => vi.unstubAllGlobals());

describe("local clear marks are reclaimed only on positive evidence (review 2026-11-14)", () => {
  it("absence from a host list never reclaims a 清除此提示 mark; a finished record or a host missing does", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    resetTombstonesForTest();
    const mark = (id: string) => tombstoneKey("local", "cutex.s1", id, "unknown:agentMessage:waiting:futureReason:::");
    for (const id of ["u1", "u2", "u3"]) expect(addTombstone(mark(id))).toBe(true);
    // A full list (e.g. a history window) without them: kept.
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [], delivery: delivery("idle", 2), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    expect(["u1", "u2", "u3"].map(id => hasTombstone(mark(id)))).toEqual([true, true, true]);
    // The host reports u1 read: reclaimed.
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 3, records: [record("u1", { state: "inContext", surface: "timeline", rev: 5 })], delivery: delivery("idle", 3), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    expect(hasTombstone(mark("u1"))).toBe(false);
    // A point read says u2 is gone: reclaimed. u3 stays.
    mock.responses.set("inputGet", (_id: string, ids: string[]) => ({ ledgerEpoch: "e", stateRevision: 3, records: [], missing: ids }));
    // (dismissInput on an id the page does not hold re-reads it by id: the host answers "missing".)
    await app.getState().dismissInput("cutex.s1", "u2", "local");
    expect(mock.calls.some(call => call.method === "inputGet" && (call.args[1] as string[]).includes("u2"))).toBe(true);
    expect(hasTombstone(mark("u2"))).toBe(false);
    expect(hasTombstone(mark("u3"))).toBe(true);
  });
  it("a late 'missing' answer never reclaims the mark on a newer delivery (night-review race: R1 hangs, R2 arrives and is cleared)", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey, unknownWhat } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    const { rowIdentity } = await import("../src/renderer/src/lib/inputLedger/nextUpRegistry");
    resetTombstonesForTest();
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], delivery: delivery("idle", 1), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    // R1: a point read for the id while the page holds nothing for it; its answer is held back.
    let answer!: (result: unknown) => void;
    mock.responses.set("inputGet", () => new Promise(resolve => { answer = resolve; }));
    const late = app.getState().dismissInput("cutex.s1", "r1", "local");
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    // R2: a newer delivery of the same input arrives; the owner clears its unknown status.
    const r2 = record("r1", { state: "waiting", reason: "futureReason" as never, attempt: 2, rev: 2, surface: "nextUp" });
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [r2], delivery: delivery("idle", 2), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    const mark = tombstoneKey("local", "cutex.s1", rowIdentity(r2), unknownWhat(r2));
    expect(addTombstone(mark)).toBe(true);
    // R1 finally answers "missing": the ledger keeps R2 and the mark stays.
    answer({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ["r1"] });
    await late;
    expect(app.getState().inputs[key]!.records.get("r1")?.rev).toBe(2);
    expect(hasTombstone(mark)).toBe(true);
  });
  it("a 'missing' answer from another ledger epoch reclaims nothing", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    resetTombstonesForTest();
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], delivery: delivery("idle", 1), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    const mark = tombstoneKey("local", "cutex.s1", "x1", "unknown:agentMessage:waiting:futureReason:::");
    expect(addTombstone(mark)).toBe(true);
    mock.responses.set("inputGet", (_id: string, ids: string[]) => ({ ledgerEpoch: "other", stateRevision: 9, records: [], missing: ids }));
    await app.getState().dismissInput("cutex.s1", "x1", "local");
    expect(hasTombstone(mark)).toBe(true);
  });
  it("a finished record the registry still shows as unknown keeps its mark (night-review repro: inContext + unknown reason)", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey, unknownWhat } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    const { projectNextUp, rowIdentity } = await import("../src/renderer/src/lib/inputLedger/nextUpRegistry");
    resetTombstonesForTest();
    const old = record("h1", { state: "inContext", reason: "futureReadProof" as never, surface: "timeline", rev: 1 });
    expect(projectNextUp(old)).toMatchObject({ kind: "state", state: "unknown" });
    const mark = tombstoneKey("local", "cutex.s1", rowIdentity(old), unknownWhat(old));
    expect(addTombstone(mark)).toBe(true); // the owner cleared it
    // A list without it (history window): kept.
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [], delivery: delivery("idle", 2), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    expect(hasTombstone(mark)).toBe(true);
    // Later read back by id: still the same historical record, still rendered unknown → the mark must stay.
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [old], missing: [] }));
    await app.getState().dismissInput("cutex.s1", "h1", "local");
    expect(mock.calls.some(call => call.method === "inputGet")).toBe(true);
    expect(hasTombstone(mark)).toBe(true);
    // The same record listed again: still kept.
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 3, records: [old], delivery: delivery("idle", 3), complete: true }));
    await app.getState().refreshInputs("cutex.s1", "local");
    expect(hasTombstone(mark)).toBe(true);
  });
});

describe("input-disposal-v1: every disposal goes through cutex/input/dispose", () => {
  const receipt = (inputId: string, appliedAt: string | null) => ({ inputId, cutexSessionId: "cutex.s1", dispositionId: "d1", requestedAt: "2026-11-14T00:00:00Z", appliedAt, effect: "stop" });
  beforeEach(() => { app.setState({ features: new Set(["input-ledger-v1", "owner-idle-busy-timeline-v1", "input-disposal-v1"]) }); });
  it("dismiss of a row with no offered action calls dispose by id; a pending receipt greys the row until it is applied", async () => {
    vi.useFakeTimers();
    try {
      const sending = record("snd", { kind: "agentMessage", state: "sending", reason: null, surface: "nextUp", actions: [], rev: 4 });
      app.setState({ inputs: { [key]: seed([sending]) } });
      mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [sending], missing: [] }));
      mock.responses.set("inputDispose", (_s: string, id: string) => receipt(id, null));
      const pending = app.getState().dismissInput("cutex.s1", "snd", "local");
      await vi.advanceTimersByTimeAsync(0);
      expect(await pending).toEqual({ ok: true });
      expect(mock.calls.filter(c => c.method === "inputDispose").map(c => c.args)).toEqual([["cutex.s1", "snd"]]);
      expect(mock.calls.some(c => c.method === "inputDismiss")).toBe(false);
      expect(app.getState().inputDisposals[key]?.snd?.appliedAt).toBeNull();
      // Still not applied: the desktop re-reads the input (never re-disposes) and the row stays grey.
      const reads = () => mock.calls.filter(c => c.method === "inputGet").length;
      const readsBefore = reads();
      await vi.advanceTimersByTimeAsync(1_100);
      expect(reads()).toBe(readsBefore + 1);
      expect(app.getState().inputDisposals[key]?.snd?.appliedAt).toBeNull();
      // The host applies it: the next read (2 s later) sees it leave, and the grey state goes.
      const gone = { ...sending, state: "discarded" as const, reason: "ownerDiscarded" as never, surface: "none" as const, rev: 5, stateRevision: 2 };
      mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [gone], missing: [] }));
      await vi.advanceTimersByTimeAsync(2_100);
      expect(mock.calls.filter(c => c.method === "inputDispose")).toHaveLength(1);
      expect(app.getState().inputDisposals[key]?.snd).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it("a failed dispose is never a silent no-op: the call rejects to the row", async () => {
    app.setState({ inputs: { [key]: seed([record("w", { kind: "owner", state: "waiting", reason: "hostBusy", surface: "nextUp", actions: [] })]) } });
    mock.responses.set("inputDispose", () => { throw new Error("event_persistence_unavailable"); });
    mock.responses.set("inputGet", (_s: string, ids: string[]) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await expect(app.getState().dismissInput("cutex.s1", "w", "local")).rejects.toThrow("event_persistence_unavailable");
    expect(app.getState().inputDisposals[key]?.w).toBeUndefined();
  });
  it("an applied receipt reclaims the clear marks that existed when the owner asked; a mark made after stays", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    resetTombstonesForTest();
    const odd = record("odd", { kind: "agentMessage", state: "waiting", reason: "futureReason" as never, surface: "nextUp", actions: [] });
    app.setState({ inputs: { [key]: seed([odd]) } });
    const before = tombstoneKey("local", "cutex.s1", "odd", "unknown:before");
    const later = tombstoneKey("local", "cutex.s1", "odd", "unknown:later");
    expect(addTombstone(before)).toBe(true);
    let answer!: (value: unknown) => void;
    mock.responses.set("inputDispose", () => new Promise(resolve => { answer = resolve; }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [odd], missing: [] }));
    const done = app.getState().dismissInput("cutex.s1", "odd", "local");
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    expect(addTombstone(later)).toBe(true);
    answer(receipt("odd", "2026-11-14T00:00:01Z"));
    await done;
    expect(hasTombstone(before)).toBe(false);
    expect(hasTombstone(later)).toBe(true);
  });
  it("a pending receipt reclaims nothing", async () => {
    const { addTombstone, hasTombstone, resetTombstonesForTest, tombstoneKey } = await import("../src/renderer/src/lib/inputLedger/nextUpTombstones");
    resetTombstonesForTest();
    const odd = record("odd2", { kind: "agentMessage", state: "waiting", reason: "futureReason" as never, surface: "nextUp", actions: [] });
    app.setState({ inputs: { [key]: seed([odd]) } });
    const mark = tombstoneKey("local", "cutex.s1", "odd2", "unknown:x");
    expect(addTombstone(mark)).toBe(true);
    mock.responses.set("inputDispose", (_s: string, id: string) => receipt(id, null));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [odd], missing: [] }));
    await app.getState().dismissInput("cutex.s1", "odd2", "local");
    expect(hasTombstone(mark)).toBe(true);
    app.setState({ inputDisposals: {} }); // stop the background check
  });
});

describe("D3 owner ledger integration", () => {
  it("submits with auto-start even when the caller disables it, without legacy optimistic state", async () => {
    mock.responses.set("submit", (_id, _text, _strategy, _start, options) => ({ disposition: "steered", input: record(options.clientUserMessageId, { state: "accepted", stateRevision: 2 }) }));
    await app.getState().submit("same text", "auto", [], { startIfOffline: false });
    const call = mock.calls.find(call => call.method === "submit")!;
    expect(call.args[3]).toBe(true);
    expect(app.getState().outbox).toEqual({});
    expect(app.getState().pendingSteers).toEqual({});
    expect(app.getState().inputs[key]!.records.get((call.args[4] as any).clientUserMessageId)?.state).toBe("accepted");
    expect(app.getState().ledgerOutbox[key]).toEqual([]);
  });

  it("a lost POST outcome reads only its id, keeps missing O0, and never resends automatically", async () => {
    mock.responses.set("submit", () => { throw new Error("connection lost"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await app.getState().submit("keep me", "auto");
    const entry = app.getState().ledgerOutbox[key]![0]!;
    expect(entry.phase).toBe("unconfirmed");
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(1);
    expect(mock.calls.filter(call => call.method === "inputGet")[0]?.args).toEqual(["cutex.s1", [entry.inputId]]);
    expect(mock.calls.some(call => call.method === "bootstrap")).toBe(false);
    app.getState().discardLedgerOutbox("cutex.s1", entry.inputId, "local");
    expect(app.getState().ledgerOutbox[key]).toEqual([]);
  });
  it("keeps the initial offline prediction while delivery changes, then follows the first record", async () => {
    app.setState({ inputs: { [key]: { ...seed([]), delivery: delivery("offline", 1) } } });
    let finish!: (result: any) => void;
    mock.responses.set("submit", () => new Promise(resolve => { finish = resolve; }));
    const submitted = app.getState().submit("start once", "auto");
    const first = app.getState().ledgerOutbox[key]![0]!;
    expect(first.predictedSurface).toBe("nextUp");
    app.setState({ inputs: { [key]: { ...seed([]), delivery: delivery("idle", 2) } } });
    expect(predictedOwnerSurface(app.getState().ledgerOutbox[key]![0]!, delivery("idle", 2))).toBe("nextUp");
    await Promise.resolve();
    finish({ disposition: "started", input: record(first.inputId, { state: "accepted", stateRevision: 2, surface: "timeline" }) });
    await submitted;
    expect(app.getState().ledgerOutbox[key]).toEqual([]);
    expect(app.getState().inputs[key]?.records.get(first.inputId)?.surface).toBe("timeline");
  });
  it.each([false, true].flatMap(fixed => [false, true].flatMap(carries => [false, true].map(running => ({ fixed, carries, running })))))("hostBusy prediction keeps its surface with 057: %j", async ({ fixed, carries, running }) => {
    const surface = fixed && !running ? "timeline" : "nextUp";
    const turn = running ? { turnId: "t1", kind: "owner" as const, askId: null, startedAt: null, inputIds: [] } : null;
    app.setState({ features: new Set(["input-ledger-v1", ...(fixed ? ["owner-idle-busy-timeline-v1"] : []), ...(carries ? ["owner-carries-v1"] : [])]), inputs: { [key]: { ...seed([]), delivery: delivery("held", 1, { reason: "hostBusy", turn }) } } });
    let finish!: (result: any) => void;
    mock.responses.set("submit", () => new Promise(resolve => { finish = resolve; }));
    const submitted = app.getState().submit("old host", "auto");
    const first = app.getState().ledgerOutbox[key]![0]!;
    expect(first.predictedSurface).toBe(surface);
    await Promise.resolve();
    finish({ disposition: "held", input: record(first.inputId, { state: "held", reason: "hostBusy", stateRevision: 2, surface }) });
    await submitted;
    expect(app.getState().ledgerOutbox[key]).toEqual([]);
    expect(app.getState().inputs[key]?.records.get(first.inputId)?.surface).toBe(surface);
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(1);
  });
  it("only an explicit owner retry recomputes the O0 prediction from current delivery", async () => {
    app.setState({ inputs: { [key]: { ...seed([]), delivery: delivery("offline", 1) } } });
    mock.responses.set("submit", () => { throw Error("lost reply"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await app.getState().submit("keep id", "auto");
    const id = app.getState().ledgerOutbox[key]![0]!.inputId;
    app.setState({ inputs: { [key]: { ...seed([]), delivery: delivery("idle", 2) } } });
    expect(app.getState().ledgerOutbox[key]?.[0]?.predictedSurface).toBe("nextUp");
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(1);
    await app.getState().retryLedgerOutbox("cutex.s1", id, "local");
    expect(app.getState().ledgerOutbox[key]?.[0]).toMatchObject({ inputId: id, predictedSurface: "timeline" });
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(2);
  });

  it("late input/get evidence settles a lost HTTP response without a second submit", async () => {
    mock.responses.set("submit", () => { throw new Error("lost reply"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 2, records: [record(ids[0], { state: "inContext", stateRevision: 2 })], missing: [] }));
    await app.getState().submit("one input", "auto");
    expect(app.getState().ledgerOutbox[key]).toEqual([]);
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(1);
  });

  it("interrupt-and-send transfers the composer draft even if its reply is lost", async () => {
    app.setState({ sessions: { [key]: { timeline: { activeTurnId: null } } as any } });
    mock.responses.set("submit", () => { throw new Error("lost reply"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    expect(await app.getState().interruptAndSend("one draft", [], "cutex.s1", "local")).toBe(true);
    expect(app.getState().ledgerOutbox[key]).toHaveLength(1);
    expect(app.getState().ledgerOutbox[key]?.[0]).toMatchObject({ text: "one draft", phase: "unconfirmed" });
    expect(mock.calls.filter(call => call.method === "submit")).toHaveLength(1);
  });

  it("retries and dismisses uncertain records with the exact revision, then reads input/get", async () => {
    const uncertain = record("u", { state: "uncertain", rev: 8, actions: ["retry", "dismiss"] });
    app.setState({ inputs: { [key]: seed([uncertain]) } });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [uncertain], missing: [] }));
    await app.getState().retryInput("cutex.s1", "u", "local");
    await app.getState().dismissInput("cutex.s1", "u", "local");
    expect(mock.calls.filter(call => ["inputRetry", "inputDismiss"].includes(call.method)).map(call => call.args)).toEqual([["cutex.s1", "u", 8], ["cutex.s1", "u", 8]]);
  });

  it("owner queue steer bypasses legacy feedback, native-history probes and synthetic outbox", async () => {
    const item = { queueId: "q", revision: 4, clientUserMessageId: "u" } as any;
    mock.responses.set("queuePromote", () => ({ result: { disposition: "steered", input: record("u", { state: "accepted", stateRevision: 2 }) } }));
    await app.getState().queueSendNow(item, "cutex.s1", "local");
    expect(mock.calls.find(call => call.method === "queuePromote")?.args.slice(0, 4)).toEqual(["cutex.s1", "q", 4, true]);
    expect(app.getState().outbox).toEqual({});
    expect(app.getState().pendingSteers).toEqual({});
  });

  it.each([
    { read: "fails", quiet: false },
    { read: "still waiting", quiet: false },
    { read: "uncertain", quiet: true },
  ])("an outcome-unknown insert is left to its row only once the row says 不确定 (read $read)", async ({ read, quiet }) => {
    const { queueActionNotice } = await import("../src/renderer/src/lib/queueSteer");
    const { queueSteerErrorMessage } = await import("../src/shared/queueSteer");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const item = { queueId: "q", revision: 4, clientUserMessageId: "u" } as any;
    mock.responses.set("queuePromote", () => { throw new Error(queueSteerErrorMessage("outcomeUnknown", "request_outcome_unknown: the cutex operation completed far enough that its durable outcome is unknown")); });
    mock.responses.set("inputGet", () => {
      if (read === "fails") throw new Error("connection lost");
      return { ledgerEpoch: "e", stateRevision: 2, records: [record("u", read === "uncertain" ? { rev: 2, stateRevision: 2, state: "uncertain", reason: "outcomeUnknown", surface: "nextUp", actions: ["retry", "dismiss"] } : { rev: 2, stateRevision: 2, state: "waiting", reason: "turnRunning", surface: "nextUp" })], missing: [] };
    });
    const error = await app.getState().queueSendNow(item, "cutex.s1", "local").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const t = (k: string) => k;
    expect(queueActionNotice(error, t)).toBe(quiet ? null : "queue.steer.outcomeUnknown");
  });

  it.each([false, true])("atomic merge applies every superseded record before steering (one revision=%s)", async sameRevision => {
    const items = ["a", "b"].map((id, index) => ({ queueId: `q-${id}`, clientUserMessageId: id, revision: index + 3, input: [{ type: "text", text: id }] })) as any;
    const attachment = { type: "image", url: "data:image/png;base64,AA==" };
    const carrier = { ...items[0], revision: 9, input: [{ type: "text", text: "full a" }, { type: "text", text: "full b" }, attachment] };
    app.setState({ ledgerOwnerDrafts: { [key]: { a: { inputId: "a", text: "old a" }, b: { inputId: "b", text: "old b" } } as any } });
    const tail = record("b", { rev: 2, stateRevision: sameRevision ? 2 : 3, state: "superseded", reason: "mergedInsert", supersededBy: "a", surface: "none" });
    mock.responses.set("queueMerge", () => ({ revision: 900, affectedQueueIds: ["q-a", "q-b"], item: carrier, inputs: [record("a", { rev: 2, stateRevision: 2, state: "waiting", surface: "nextUp" }), tail] }));
    mock.responses.set("queuePromote", () => {
      expect(app.getState().inputs[key]!.records.get("b")).toEqual(tail);
      const drafts = app.getState().ledgerOwnerDrafts[key]!;
      expect(drafts.a?.text).toBe("full a\nfull b");
      expect(drafts.a?.extra).toEqual([attachment]);
      expect(drafts.b).toBeUndefined();
      expect(ownerTimelineEntry(record("a", { preview: "old a" }), drafts.a).text).toBe("full a\nfull b");
      expect(app.getState().inputs[key]!.rev).toBe(sameRevision ? 2 : 3);
      return { result: { input: record("a", { rev: 3, stateRevision: 4, state: "accepted" }) } };
    });
    await app.getState().queueMergeInsert(items, "cutex.s1", "local");
    expect(mock.calls.find(call => call.method === "queueMerge")?.args).toEqual(["cutex.s1", { items: [{ queueId: "q-a", expectedRevision: 3 }, { queueId: "q-b", expectedRevision: 4 }] }]);
    expect(mock.calls.find(call => call.method === "queuePromote")?.args.slice(0, 4)).toEqual(["cutex.s1", "q-a", 9, true]);
    expect(mock.calls.some(call => ["queueMergeInsert", "queueRemove", "queueUpdate", "submit"].includes(call.method))).toBe(false);
    expect(app.getState().outbox).toEqual({});
  });

  it("lost atomic merge reply reconciles ids without inserting or repeating the merge", async () => {
    const items = ["a", "b"].map(id => ({ queueId: `q-${id}`, clientUserMessageId: id, revision: 1, input: [{ type: "text", text: id }] })) as any;
    mock.responses.set("queueMerge", () => { throw Error("lost merge reply"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await expect(app.getState().queueMergeInsert(items, "cutex.s1", "local")).rejects.toThrow("lost merge reply");
    expect(mock.calls.filter(call => call.method === "queueMerge")).toHaveLength(1);
    expect(mock.calls.filter(call => call.method === "inputGet").map(call => call.args[1])).toEqual([["a"], ["b"]]);
    expect(mock.calls.some(call => call.method === "queuePromote")).toBe(false);
  });

  it("a trimmed new-epoch host event fences a pending merge before its point read completes", async () => {
    app.setState({ hosts: { active: "local", hosts: [] } as any });
    mock.responses.set("hosts", () => ({ active: "local", hosts: [] }));
    app.getState().init();
    const items = ["a", "b"].map(id => ({ queueId: `q-${id}`, clientUserMessageId: id, revision: 1, input: [{ type: "text", text: id }] })) as any;
    let finish!: (result: any) => void;
    mock.responses.set("queueMerge", () => new Promise(resolve => { finish = resolve; }));
    const merging = app.getState().queueMergeInsert(items, "cutex.s1", "local");
    await Promise.resolve();
    mock.responses.set("inputGet", () => new Promise(() => {}));
    mock.responses.set("inputList", () => new Promise(() => {}));
    const { preview: _preview, actions: _actions, ...trimmed } = record("new", { stateRevision: 1 });
    mock.handlers.get("hostEvent")!({ hostId: "local", envelope: { cutexSessionId: "cutex.s1", cutex: { method: "cutex/input/stateChanged", params: { cutexSessionId: "cutex.s1", ledgerEpoch: "new-epoch", stateRevision: 1, record: trimmed } } } });
    expect(app.getState().inputs[key]!.generation).toBeGreaterThan(seed().generation);
    finish({ revision: 9, affectedQueueIds: ["q-a", "q-b"], item: items[0], inputs: [record("a", { rev: 2, stateRevision: 2 })] });
    await merging;
    expect(mock.calls.some(call => call.method === "queuePromote")).toBe(false);
    expect(app.getState().inputs[key]!.records.has("a")).toBe(false);
  });

  it("reconnect recovery: uncertain bus input with no turn stays listed, clearable and dismissed the normal way; a retired-deadline accepted stays accepted", async () => {
    const asker = { kind: "agent", id: "a", name: "Asker", host: null, cutexSessionId: "a" } as const;
    const uncertain = record("bus", { kind: "agentMessage", sender: asker, state: "uncertain", reason: "receiptTimeout", turnId: null, rev: 5, actions: ["retry", "dismiss"] });
    const pending = record("native-pending", { kind: "agentMessage", sender: asker, state: "accepted", turnId: null, deadline: null, actions: [] });
    const session = seed([uncertain, pending]);
    expect(missingTimelineRecords(session.records, []).map(r => r.inputId)).toEqual(expect.arrayContaining(["bus", "native-pending"]));
    expect(clearableUncertain(session).map(r => r.inputId)).toEqual(["bus"]);
    app.setState({ inputs: { [key]: session } });
    const dismissed = record("bus", { ...uncertain, rev: 6, stateRevision: 2, state: "discarded", actions: [] });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [dismissed], missing: [] }));
    await app.getState().dismissInput("cutex.s1", "bus", "local");
    expect(mock.calls.find(call => call.method === "inputDismiss")?.args).toEqual(["cutex.s1", "bus", 5]);
    expect(app.getState().inputs[key]!.records.get("bus")?.state).toBe("discarded");
    expect(app.getState().inputs[key]!.records.get("native-pending")?.state).toBe("accepted");
  });

  it("HTTP success with a failed dismiss remains a visible failure and reconciles", async () => {
    app.setState({ inputs: { [key]: seed([record("u", { state: "uncertain", actions: ["dismiss"] })]) } });
    mock.responses.set("inputDismiss", () => ({ failed: [{ inputId: "u", code: "revision_conflict", message: "changed", currentRev: 2 }] }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [record("u", { rev: 2, stateRevision: 2, state: "inContext" })], missing: [] }));
    await expect(app.getState().dismissInput("cutex.s1", "u", "local")).rejects.toThrow("revision_conflict: changed");
    expect(app.getState().inputs[key]!.records.get("u")?.state).toBe("inContext");
  });

  it("interrupts and sends an existing owner id only through the ledger action, including duplicate clicks", async () => {
    const original = record("existing", { rev: 8, state: "accepted", stage: "registered", turnId: "t1", runtimeGeneration: 7, actions: ["interruptSend"] });
    app.setState({ inputs: { [key]: interruptSeed([original]) } });
    let finish!: (result: unknown) => void;
    mock.responses.set("inputInterruptSend", () => new Promise(resolve => { finish = resolve; }));
    const continued = record("existing", { rev: 9, stateRevision: 2, state: "inContext", turnId: "t2", actions: [] });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [continued], missing: [] }));
    const first = app.getState().interruptSendInput("cutex.s1", "existing", "local");
    const second = app.getState().interruptSendInput("cutex.s1", "existing", "local");
    await Promise.resolve();
    expect(app.getState().inputs[key]!.records.get("existing")).toEqual(original);
    finish({ ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", record: record("existing", { rev: 9, stateRevision: 2, state: "sending", reason: "interruptSend" }) });
    await Promise.all([first, second]);
    expect(mock.calls.filter(call => call.method === "inputInterruptSend").map(call => call.args)).toEqual([["cutex.s1", { inputId: "existing", expectedRev: 8, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]]);
    expect(app.getState().inputs[key]!.records.get("existing")).toEqual(continued);
    expect(mock.calls.filter(call => call.method === "inputGet")).toHaveLength(1);
    expect(mock.calls.some(call => ["stopTurn", "submit", "inputRetry", "bootstrap"].includes(call.method))).toBe(false);
    expect(app.getState().ledgerOutbox[key] ?? []).toEqual([]);
    expect(app.getState().outbox).toEqual({});
  });
  it.each([
    ["held", "hostBusy", "held"],
    ["waiting", "turnRunning", "interrupted"],
    ["waiting", "turnFinishing", "agentOffline"],
    ["accepted", null, "alreadyInContext"],
  ] as const)("%s/%s uses active delivery CAS fields even without record turn metadata (%s)", async (state, reason, outcome) => {
    const original = record("existing", { rev: 8, state, reason, turnId: null, runtimeGeneration: null, actions: ["interruptSend"] });
    app.setState({ inputs: { [key]: interruptSeed([original]) } });
    const updated = record("existing", { rev: 9, stateRevision: 2, state: outcome === "alreadyInContext" ? "inContext" : outcome === "held" ? "held" : outcome === "agentOffline" ? "waiting" : "sending",
      reason: outcome === "alreadyInContext" ? null : outcome === "held" ? "hostBusy" : outcome === "agentOffline" ? "agentOffline" : "interruptSend", actions: [], surface: "timeline" });
    mock.responses.set("inputInterruptSend", () => ({ ledgerEpoch: "e", stateRevision: 2, outcome, interruptedTurnId: outcome === "alreadyInContext" ? null : "t1", record: updated }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [updated], missing: [] }));
    await app.getState().interruptSendInput("cutex.s1", "existing", "local");
    expect(mock.calls.find(call => call.method === "inputInterruptSend")?.args).toEqual(["cutex.s1", { inputId: "existing", expectedRev: 8, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]);
    expect(app.getState().inputs[key]!.records.get("existing")).toEqual(updated);
    expect(mock.calls.some(call => ["submit", "stopTurn", "inputRetry", "bootstrap"].includes(call.method))).toBe(false);
  });

  it.each([
    ["failed", "runtimeRefused"], ["failed", "interrupt_timeout"],
    ["uncertain", "turnInterrupted"], ["inContext", null],
  ] as const)("outcome interrupted renders authoritative %s/%s from the same-id record", async (state, reason) => {
    const original = record("existing", { rev: 8, state: "held", reason: "hostBusy", turnId: null, runtimeGeneration: null, actions: ["interruptSend"] });
    const initial = interruptSeed([original]);
    app.setState({ inputs: { [key]: { ...initial, delivery: { ...initial.delivery, state: "held", reason: "hostBusy" } } } });
    const authoritative = record("existing", { rev: 9, stateRevision: 2, state, reason, surface: "timeline", actions: state === "failed" ? ["retry"] : [], turnId: "t1" });
    mock.responses.set("inputInterruptSend", () => ({ ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", record: authoritative }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [authoritative], missing: [] }));
    mock.responses.set("inputList", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [authoritative], complete: false }));
    await app.getState().interruptSendInput("cutex.s1", "existing", "local");
    expect(mock.calls.find(call => call.method === "inputInterruptSend")?.args).toEqual(["cutex.s1", { inputId: "existing", expectedRev: 8, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]);
    expect(app.getState().inputs[key]!.records.get("existing")).toEqual(authoritative);
    expect(mock.calls.map(call => call.method)).toEqual(["inputInterruptSend", "inputGet", "inputList"]);
    expect(mock.calls.find(call => call.method === "inputList")?.args).toEqual(["cutex.s1", { sinceRevision: 1 }]);
  });

  it("a lost interruptSend reply reads its id and never repeats interrupt or copies its text", async () => {
    const original = record("existing", { state: "accepted", rev: 8, turnId: "t1", runtimeGeneration: 7, actions: ["interruptSend"] });
    app.setState({ inputs: { [key]: interruptSeed([original]) } });
    mock.responses.set("inputInterruptSend", () => { throw Error("lost action reply"); });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [original], missing: [] }));
    await expect(app.getState().interruptSendInput("cutex.s1", "existing", "local")).rejects.toThrow("lost action reply");
    expect(mock.calls.map(call => call.method)).toEqual(["inputInterruptSend", "inputGet"]);
    expect(app.getState().inputs[key]!.records.get("existing")?.surface).toBe("timeline");
  });
  it("ledger pending-row action uses offered records without requiring native timeline busy guesses", async () => {
    const original = record("existing", { state: "accepted", turnId: "t1", runtimeGeneration: 7, actions: ["interruptSend"] });
    app.setState({ inputs: { [key]: interruptSeed([original]) }, sessions: {} });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [original], missing: [] }));
    await app.getState().interruptAndSendSteers("cutex.s1", "local");
    expect(mock.calls.map(call => call.method)).toEqual(["inputInterruptSend", "inputGet"]);
  });
  it("ledger interrupt without a legal named input does not degrade to stop-only", async () => {
    await expect(app.getState().interruptAndSendSteers("cutex.s1", "local")).rejects.toThrow();
    expect(mock.calls).toEqual([]);
    app.setState({ features: new Set() });
    await app.getState().interruptSendInput("cutex.s1", "old", "local");
    expect(mock.calls).toEqual([]);
  });

  it("old queue snapshots cannot regress newer input records or delivery", async () => {
    const newest = record("u", { rev: 8, stateRevision: 8, state: "inContext" });
    app.setState({ inputs: { [key]: applyInputLedgerSnapshot(seed(), { ledgerEpoch: "e", stateRevision: 8, records: [newest], delivery: delivery("disconnected", 8), coverage: { kind: "partial" } }).session } });
    mock.responses.set("queueList", () => ({ items: [], ledgerEpoch: "e", stateRevision: 2, inputs: [record("u", { rev: 2, stateRevision: 2, state: "waiting", surface: "nextUp" })], delivery: delivery("turn", 2), admissionFresh: false }));
    await app.getState().refreshAdmission("cutex.s1", "local");
    expect(app.getState().inputs[key]!.records.get("u")).toEqual(newest);
    expect(app.getState().inputs[key]!.delivery?.state).toBe("disconnected");
  });
});

describe("D3 surface projection", () => {
  it.each(["offline", "starting"] as const)("%s O0 appears only in nextUp", state => {
    expect(predictedOwnerSurface({ strategy: "auto" }, delivery(state, 1))).toBe("nextUp");
  });
  it("queue and paused predict nextUp; idle hostBusy predicts timeline", () => {
    expect(predictedOwnerSurface({ strategy: "queue" }, delivery("turn", 1))).toBe("nextUp");
    expect(predictedOwnerSurface({ strategy: "auto" }, delivery("held", 1, { reason: "paused" }))).toBe("nextUp");
    expect(predictedOwnerSurface({ strategy: "auto" }, delivery("held", 1, { reason: "hostBusy" }), true)).toBe("timeline");
  });
  it("joins identical text only by id, and includes non-owner timeline records", () => {
    const owner = record("owner", { preview: "same text" });
    const result = record("result", { kind: "delegationResult", state: "accepted" });
    const hidden = record("queued", { surface: "nextUp" });
    const records = new Map([owner, result, hidden].map(item => [item.inputId, item]));
    expect(missingTimelineRecords(records, [{ kind: "user", id: "different", text: "same text", turnId: "t" }]).map(item => item.inputId)).toEqual(["owner", "result"]);
    expect(missingTimelineRecords(records, [ownerTimelineEntry(owner)]).map(item => item.inputId)).toEqual(["result"]);
  });
  it("joins a received bus item by its exact message id even before timelineItemId is populated", () => {
    const bus = record("bus-id", { kind: "agentMessage", state: "accepted", timelineItemId: null });
    const records = new Map([[bus.inputId, bus]]);
    const item = { kind: "received", id: "bus-id", turnId: "t", message: {} } as any;
    expect(missingTimelineRecords(records, [item])).toEqual([]);
    // Rendering the native item never changes the authoritative accepted state.
    expect(records.get("bus-id")?.state).toBe("accepted");
  });
});

describe("057 per-notice hold", () => {
  it.each([true, false])("uses current CAS and authoritative response for held=%s", async held => {
    const before = record("notice", { kind: "systemNotice", surface: "nextUp", rev: 7, state: "waiting", actions: [held ? "hold" : "releaseHold"], details: { ownerHold: !held } });
    const after = { ...before, rev: 8, stateRevision: 2, details: { ownerHold: held }, reason: held ? "ownerPause" : "afterTurn", actions: [held ? "releaseHold" : "hold"] } as typeof before;
    app.setState({ features: new Set(["input-ledger-v1", "owner-carries-v1"]), inputs: { [key]: seed([before]) } });
    mock.responses.set("inputHold", () => ({ ledgerEpoch: "e", stateRevision: 2, record: after }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [after], missing: [] }));
    await app.getState().holdInput("cutex.s1", "notice", held, "local");
    expect(mock.calls.find(c => c.method === "inputHold")?.args).toEqual(["cutex.s1", { inputId: "notice", expectedRev: 7, held }]);
    expect(app.getState().inputs[key]!.records.get("notice")).toEqual(after);
  });
  it("refuses old hosts, absent action, owner and delegation request", async () => {
    for (const kind of ["systemNotice", "owner", "delegationRequest"] as const) {
      const input = record("notice", { kind, surface: "nextUp", actions: ["hold"] });
      app.setState({ features: new Set(["input-ledger-v1"]), inputs: { [key]: seed([input]) } });
      await app.getState().holdInput("cutex.s1", "notice", true, "local");
      if (kind !== "systemNotice") {
        app.setState({ features: new Set(["input-ledger-v1", "owner-carries-v1"]) });
        await app.getState().holdInput("cutex.s1", "notice", true, "local");
      }
    }
    app.setState({ inputs: { [key]: seed([record("notice", { kind: "systemNotice", reason: "ownerPause", surface: "nextUp", actions: [] })]) } });
    await app.getState().holdInput("cutex.s1", "notice", false, "local");
    expect(mock.calls.some(c => c.method === "inputHold")).toBe(false);
  });
});
