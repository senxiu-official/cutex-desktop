import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { record, delivery } from "../src/renderer/src/lib/inputLedger/testkit";
import { applyInputLedgerSnapshot, emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
import { viewKey } from "../src/renderer/src/lib/viewKey";

const mock = vi.hoisted(() => ({
  calls: [] as { host: string; method: string; args: any[] }[],
  responses: new Map<string, (...args: any[]) => any>(),
  handlers: new Map<string, (value: any) => void>(),
}));
vi.mock("../src/renderer/src/bridge", () => {
  const apiFor = (host: string) => new Proxy({}, { get: (_, method: string) => (...args: any[]) => {
    mock.calls.push({ host, method, args });
    return Promise.resolve().then(() => mock.responses.get(method)?.(...args));
  } });
  return { api: apiFor("local"), apiFor, bridge: {
    on: (name: string, fn: (value: any) => void) => { mock.handlers.set(name, fn); return () => {}; },
    shell: { logError: () => {} },
  } };
});

let app: typeof import("../src/renderer/src/store").useApp;
const key = (id: string, host = "local") => viewKey(host, id);
const seed = (id: string, count = 1) => applyInputLedgerSnapshot(emptyInputLedgerSession(), {
  ledgerEpoch: "e", stateRevision: 1, generation: 0, coverage: { kind: "full" }, delivery: delivery("idle", 1),
  records: Array.from({ length: count }, (_, i) => record(`body-${i}`, { cutexSessionId: id })),
}).session;
const list = (id: string, revision = 1, preview = "fresh body") => ({
  ledgerEpoch: "e", stateRevision: revision, complete: true, delivery: delivery("idle", revision),
  records: [record("body-0", { cutexSessionId: id, rev: revision, stateRevision: revision, preview })],
});
const calls = (method: string) => mock.calls.filter(call => call.method === method);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
// Drain only the finite mock promise chain; no timers, polling, or implementation-private hooks.
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function event(id: string, inputId = "point", revision = 2, host = "local") {
  const { preview: _preview, actions: _actions, ...trimmed } = record(inputId, {
    cutexSessionId: id, rev: revision, stateRevision: revision,
  });
  mock.handlers.get("hostEvent")!({ hostId: host, envelope: {
    cutexSessionId: id, cutex: { method: "cutex/input/stateChanged", params: {
      cutexSessionId: id, ledgerEpoch: "e", stateRevision: revision, record: trimmed,
    } },
  } });
}
// A mounted timeline fixture makes select use its real live-view branch without unrelated bootstrap IO.
function mount(id: string, count = 1, host = "local") {
  const k = key(id, host);
  app.setState(state => ({
    inputs: { ...state.inputs, [k]: seed(id, count) },
    sessions: { ...state.sessions, [k]: { loading: false, error: null, timeline: { threadId: `thread-${id}` } } as any },
    views: { ...state.views, [k]: { hostId: host, sessionId: id, visible: false } },
  }));
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("document", { hasFocus: () => false });
  mock.calls.length = 0; mock.responses.clear(); mock.handlers.clear();
  mock.responses.set("hosts", () => ({ active: "local", hosts: [] }));
  mock.responses.set("inputList", (id: string) => list(id));
  app = (await import("../src/renderer/src/store")).useApp;
  app.getState().init();
  await settle();
  app.setState({ hosts: { active: "local", hosts: [] } as any, features: new Set(["input-ledger-v1"]),
    view: { kind: "conversation" },
    selectedId: null, selectedHost: "local", inputs: {}, views: {}, sessions: {}, byHost: {},
    ledgerOutbox: {}, ledgerOwnerDrafts: {}, outbox: {}, pendingSteers: {} });
  mock.calls.length = 0;
}, 60_000);
afterEach(() => vi.unstubAllGlobals());


// store.watchInputs (batch model dialog): the listed sessions' ledgers read through a bounded queue and kept live.
describe("store.watchInputs", () => {
  const ids = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
  it("never runs more than 6 reads at once; each finished read starts the next", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<unknown>>>();
    mock.responses.set("inputList", (id: string) => { const d = deferred<unknown>(); pending.set(id, d); return d.promise; });
    const release = app.getState().watchInputs(ids(1000), "local");
    await settle();
    expect(calls("inputList")).toHaveLength(6);
    pending.get("w-0")!.resolve(list("w-0"));
    await settle();
    expect(calls("inputList")).toHaveLength(7);
    expect(calls("inputList").map(call => call.args[0])).toEqual(ids(7));
    release();
    for (const d of pending.values()) d.resolve(list("x"));
    await settle();
  });
  it("release drops the queued reads; the running ones finish and start nothing more", async () => {
    const pending: ReturnType<typeof deferred<unknown>>[] = [];
    mock.responses.set("inputList", (id: string) => { const d = deferred<unknown>(); pending.push(d); void id; return d.promise; });
    const release = app.getState().watchInputs(ids(40), "local");
    await settle();
    expect(calls("inputList")).toHaveLength(6);
    release();
    for (const d of pending) d.resolve(list("w-0"));
    await settle();
    expect(calls("inputList")).toHaveLength(6);
    // A second release is a no-op.
    release();
  });
  it("a released watcher's queue does not hold back another watcher", async () => {
    const pending: ReturnType<typeof deferred<unknown>>[] = [];
    mock.responses.set("inputList", (id: string) => { const d = deferred<unknown>(); pending.push(d); void id; return d.promise; });
    const first = app.getState().watchInputs(ids(10, "a"), "local");
    const second = app.getState().watchInputs(ids(3, "b"), "local");
    await settle();
    first();
    for (const d of pending.splice(0)) d.resolve(list("a-0"));
    await settle();
    expect(calls("inputList").map(call => call.args[0])).toEqual([...ids(6, "a"), ...ids(3, "b")]);
    second();
    for (const d of pending.splice(0)) d.resolve(list("b-0"));
    await settle();
  });
  it("overlapping watchers and an opened session's own pin coexist; the last release leaves no pin behind", async () => {
    mount("shown");
    await app.getState().select("shown", "local");
    app.getState().setViewVisible("local", "shown", true);
    await settle();
    const a = app.getState().watchInputs(["shown", "both"], "local");
    const b = app.getState().watchInputs(["both", "only-b"], "local");
    await settle();
    // The shown session is already read and live: not fetched again.
    expect(new Set(calls("inputList").map(call => call.args[0]))).toEqual(new Set(["both", "only-b"]));
    mock.responses.set("inputGet", (id: string) => ({ ledgerEpoch: "e", stateRevision: 2, missing: [], records: [record("point", { cutexSessionId: id, rev: 2, stateRevision: 2 })] }));
    const pointReads = (id: string) => calls("inputGet").filter(call => call.args[0] === id).length;
    // a released: "both" is still watched by b, so its events apply (a point read).
    a();
    event("both", "point", 2); await settle();
    expect(pointReads("both")).toBe(1);
    // b released: nothing watches "both" / "only-b" any more — their events no longer read; the shown session's do.
    b();
    event("both", "point-2", 3); event("only-b", "point", 2); event("shown", "point", 2); await settle();
    expect(pointReads("both")).toBe(1);
    expect(pointReads("only-b")).toBe(0);
    expect(pointReads("shown")).toBe(1);
  });
  it("off a ledger host: nothing", async () => {
    app.setState({ features: new Set() });
    const release = app.getState().watchInputs(ids(3), "local");
    await settle();
    expect(calls("inputList")).toHaveLength(0);
    release();
  });
});
