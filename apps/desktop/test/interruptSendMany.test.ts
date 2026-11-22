import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// 打断并发送 with several 插话: store behaviour against the bridge (harness from test/inputLedgerOwner.test.ts).
import { record, delivery } from "../src/renderer/src/lib/inputLedger/testkit";
import { applyInputLedgerSnapshot, emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
import { viewKey } from "../src/renderer/src/lib/viewKey";

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


// 打断并发送 with several 插话 (cutex interrupt-send-many-v1, r292): one interrupt for every unread 插话 of the turn.
const MANY = ["input-ledger-v1", "owner-idle-busy-timeline-v1", "interrupt-send-many-v1"];
const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 0, 0, s)).toISOString();
const steer = (id: string, s: number, patch: Parameters<typeof record>[1] = {}) => record(id, { kind: "owner", state: "accepted", turnId: "t1", runtimeGeneration: 7, createdAt: at(s), actions: ["interruptSend"], rev: s + 1, ...patch });
const three = () => [steer("c", 30), steer("a", 10), steer("b", 20)];
const calls = (method: string) => mock.calls.filter(call => call.method === method).map(call => call.args);
const batchAnswer = (ids: string[]) => ({ ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", inputIds: ids, records: ids.map(id => record(id, { state: "sending", reason: "interruptSend", surface: "timeline", stateRevision: 2, rev: 50 })), carrierInputId: ids.at(-1), alreadyInContext: [], submitted: ids });

describe("row 打断并发送", () => {
  it("on a host that sends several: one request naming every unread 插话 in send order, then reads them back", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) } });
    mock.responses.set("inputInterruptSend", (_id, params) => batchAnswer(params.inputIds));
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 2, records: [], missing: ids }));
    await expect(app.getState().interruptSendInput("cutex.s1", "b", "local")).resolves.toEqual({ ok: true });
    expect(calls("inputInterruptSend")).toEqual([["cutex.s1", { inputIds: ["a", "b", "c"], expectedRevs: { a: 11, b: 21, c: 31 }, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]]);
    expect(calls("inputGet")).toEqual([["cutex.s1", ["a", "b", "c"]]]);
    expect(app.getState().inputs[key]!.records.get("a")?.state).toBe("sending");
  });
  it("one unread 插话 alone keeps the singleton form (an older runtime pin takes it)", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed([steer("a", 10)]) } });
    mock.responses.set("inputInterruptSend", () => ({ ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", record: steer("a", 10, { state: "inContext" }) }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [], missing: [] }));
    await app.getState().interruptSendInput("cutex.s1", "a", "local");
    expect(calls("inputInterruptSend")).toEqual([["cutex.s1", { inputId: "a", expectedRev: 11, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]]);
  });
  it("an older host: the clicked one only, as before", async () => {
    app.setState({ inputs: { [key]: interruptSeed(three()) } });
    mock.responses.set("inputInterruptSend", () => ({ ledgerEpoch: "e", stateRevision: 2, outcome: "interrupted", interruptedTurnId: "t1", record: steer("b", 20, { state: "inContext" }) }));
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, records: [], missing: [] }));
    await app.getState().interruptSendInput("cutex.s1", "b", "local");
    expect(calls("inputInterruptSend")).toEqual([["cutex.s1", { inputId: "b", expectedRev: 21, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]]);
  });
  it("101 unread 插话: refused whole before any request (never cut to 100)", async () => {
    const many = Array.from({ length: 101 }, (_, i) => steer(`m${i}`, i));
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(many) } });
    const { translate } = await import("../src/renderer/src/i18n");
    await expect(app.getState().interruptSendInput("cutex.s1", "m5", "local")).rejects.toThrow(translate("interruptSend.tooMany", { max: 100 }));
    await expect(app.getState().interruptAndSendSteers("cutex.s1", "local")).rejects.toThrow(translate("interruptSend.tooMany", { max: 100 }));
    expect(mock.calls).toEqual([]);
  });
  it("a refused / lost batch reads the ids back and is never retried or split", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) } });
    mock.responses.set("inputInterruptSend", () => { throw new Error("interrupt_send_many_unsupported: pin"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await expect(app.getState().interruptSendInput("cutex.s1", "a", "local")).rejects.toThrow("interrupt_send_many_unsupported");
    expect(mock.calls.map(call => call.method)).toEqual(["inputInterruptSend", "inputGet"]);
  });
});

describe("grouped 打断并发送 (cli Esc)", () => {
  it("several unread on a host that sends several: the batch", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) }, sessions: {} });
    mock.responses.set("inputInterruptSend", (_id, params) => batchAnswer(params.inputIds));
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 2, records: [], missing: ids }));
    await app.getState().interruptAndSendSteers("cutex.s1", "local");
    expect(calls("inputInterruptSend")[0]![1]).toMatchObject({ inputIds: ["a", "b", "c"] });
  });
  it("several unread on an older host: said plainly, nothing sent", async () => {
    app.setState({ inputs: { [key]: interruptSeed(three()) }, sessions: {} });
    const { translate } = await import("../src/renderer/src/i18n");
    await expect(app.getState().interruptAndSendSteers("cutex.s1", "local")).rejects.toThrow(translate("interruptSend.oneAtATime"));
    expect(mock.calls).toEqual([]);
  });
  it("one unread on an older host: sent (the cli Esc fix that needs no new backend)", async () => {
    app.setState({ inputs: { [key]: interruptSeed([steer("a", 10)]) }, sessions: {} });
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: [] }));
    await app.getState().interruptAndSendSteers("cutex.s1", "local");
    expect(calls("inputInterruptSend")).toEqual([["cutex.s1", { inputId: "a", expectedRev: 11, expectedTurnId: "t1", expectedRuntimeGeneration: 7 }]]);
  });
});

describe("Ctrl+Shift+Enter (submit, strategy interrupt)", () => {
  const started = (_id: string, _text: string, _strategy: string, _start: boolean, options: { clientUserMessageId: string }) => ({ disposition: "started", input: record(options.clientUserMessageId, { state: "inContext", stateRevision: 3 }) });
  it("takes the unread 插话 along before the draft on a host that sends several; reads them back", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) } });
    mock.responses.set("submit", started);
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 3, records: [], missing: ids }));
    await app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" });
    const options = calls("submit")[0]![4] as { interruptSend?: unknown };
    expect(options.interruptSend).toEqual({ inputIds: ["a", "b", "c"], expectedRevs: { a: 11, b: 21, c: 31 }, expectedTurnId: "t1", expectedRuntimeGeneration: 7 });
    expect(calls("inputGet").some(args => JSON.stringify(args[1]) === JSON.stringify(["a", "b", "c"]))).toBe(true);
  });
  it("an older runtime pin refuses the batch (nothing sent): said plainly, the draft stays unconfirmed", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) } });
    const notify = vi.fn(); app.setState({ notify } as never);
    mock.responses.set("submit", () => { throw new Error("interrupt_send_many_unsupported: pin lacks ownerInputBatch"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await expect(app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" })).resolves.toBeNull();
    const { translate } = await import("../src/renderer/src/i18n");
    expect(notify).toHaveBeenCalledWith(translate("interruptSend.manyUnsupported"), "error", { hostId: "local", sessionId: "cutex.s1" });
    expect(calls("submit")).toHaveLength(1);
  });
  it("a blocked batch (owner_batch_not_submitted): said plainly, each row carries the reason", async () => {
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(three()) } });
    const notify = vi.fn(); app.setState({ notify } as never);
    mock.responses.set("submit", () => { throw new Error("owner_batch_not_submitted: hook_blocked"); });
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 1, records: [], missing: ids }));
    await app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" });
    const { translate } = await import("../src/renderer/src/i18n");
    expect(notify).toHaveBeenCalledWith(translate("interruptSend.notSubmitted"), "error", { hostId: "local", sessionId: "cutex.s1" });
    expect(calls("submit")).toHaveLength(1);
  });
  it("100 unread 插话 plus the draft: refused whole, no POST (never the draft alone or a cut selection)", async () => {
    const many = Array.from({ length: 100 }, (_, i) => steer(`m${i}`, i));
    app.setState({ features: new Set(MANY), inputs: { [key]: interruptSeed(many) } });
    const notify = vi.fn(); app.setState({ notify } as never);
    await expect(app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" })).resolves.toBeNull();
    const { translate } = await import("../src/renderer/src/i18n");
    expect(notify).toHaveBeenCalledWith(translate("interruptSend.tooMany", { max: 99 }), "error", { hostId: "local", sessionId: "cutex.s1" });
    expect(mock.calls).toEqual([]);
    expect(app.getState().ledgerOutbox[key] ?? []).toEqual([]);
  });
  it("an older host, another strategy or nothing unread: the draft alone, as before", async () => {
    mock.responses.set("submit", started);
    mock.responses.set("inputGet", (_id, ids) => ({ ledgerEpoch: "e", stateRevision: 3, records: [], missing: ids }));
    app.setState({ inputs: { [key]: interruptSeed(three()) } });
    await app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" });
    app.setState({ features: new Set(MANY) });
    await app.getState().submit("draft", "auto", [], { sessionId: "cutex.s1", hostId: "local" });
    app.setState({ inputs: { [key]: interruptSeed([]) } });
    await app.getState().submit("draft", "interrupt", [], { sessionId: "cutex.s1", hostId: "local" });
    expect(calls("submit").map(args => (args[4] as { interruptSend?: unknown }).interruptSend)).toEqual([undefined, undefined, undefined]);
  });
});
