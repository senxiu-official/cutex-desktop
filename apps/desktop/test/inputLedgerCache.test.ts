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
function expectIdleBound() {
  const state = app.getState();
  const idle = Object.entries(state.inputs).filter(([k]) =>
    k !== key(state.selectedId!, state.selectedHost ?? "local") && !state.views[k]?.visible && !state.ledgerOutbox[k]?.length);
  // Store's local cache limits: four idle sessions and 4096 idle records; wanted sessions are exempt.
  expect(idle.length).toBeLessThanOrEqual(4);
  expect(idle.reduce((n, [, session]) => n + session.records.size, 0)).toBeLessThanOrEqual(4096);
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

describe("store input ledger cache lifecycle", () => {
  it.each(["closePage", "select"] as const)("page-hidden selected ledger stays idle until %s refreshes it fully", async reopen => {
    mount("selected", 2);
    await app.getState().select("selected", "local");
    app.getState().openPage("quick-chats.draft");
    expect(app.getState().view.kind).toBe("page");
    const old = app.getState().inputs[key("selected")];
    event("selected", "body-0");
    await settle();
    expect(app.getState().inputs[key("selected")]).toBe(old);
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
    mock.responses.set("inputList", (id: string) => list(id, 2, "visible again"));
    if (reopen === "closePage") app.getState().closePage();
    else await app.getState().select("selected", "local");
    await settle();
    expect(app.getState().view.kind).toBe("conversation");
    expect(calls("inputList").map(call => call.args)).toEqual([["selected", {}]]);
    expect(app.getState().inputs[key("selected")]!.records.get("body-0")?.preview).toBe("visible again");
    expect(app.getState().inputs[key("selected")]!.records.has("body-1")).toBe(false);
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("bootstrap")).toHaveLength(0);
  });

  it("a visible pane keeps a page-hidden selection wanted even with document focus false", async () => {
    mount("pane");
    await app.getState().select("pane", "local");
    app.getState().setViewVisible("local", "pane", true);
    app.getState().openPage("quick-chats.draft");
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, missing: [],
      records: [record("point", { cutexSessionId: "pane", rev: 2, stateRevision: 2, preview: "pane body" })] }));
    event("pane");
    await settle();
    expect(calls("inputGet").map(call => call.args)).toEqual([["pane", ["point"]]]);
    expect(calls("inputList")).toHaveLength(0);
    expect(app.getState().inputs[key("pane")]!.records.get("point")?.preview).toBe("pane body");
  });

  it.each(["closePage", "select"] as const)("opening a page prunes its hidden selection and %s loads the missing ledger fully", async reopen => {
    mount("selected");
    await app.getState().select("selected", "local");
    for (let i = 0; i < 4; i++) {
      mount(`idle-${i}`);
      app.getState().setViewVisible("local", `idle-${i}`, false);
    }
    app.getState().openPage("quick-chats.draft");
    // All five are idle now; openPage must enforce the four-session bound too.
    expect(Object.keys(app.getState().inputs)).toHaveLength(4);
    // More idle caches evict the former selection before it is shown again.
    for (let i = 4; i < 9; i++) {
      mount(`idle-${i}`);
      app.getState().setViewVisible("local", `idle-${i}`, false);
    }
    expect(app.getState().inputs[key("selected")]).toBeUndefined();
    if (reopen === "closePage") app.getState().closePage();
    else await app.getState().select("selected", "local");
    await settle();
    expect(app.getState().view.kind).toBe("conversation");
    expect(calls("inputList").map(call => call.args)).toEqual([["selected", {}]]);
    expect(app.getState().inputs[key("selected")]!.records.get("body-0")?.preview).toBe("fresh body");
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("bootstrap")).toHaveLength(0);
    expectIdleBound();
  });

  it.each([100, 1000])("%i unique unopened host events allocate no ledger and issue no reads", async count => {
    for (let i = 0; i < count; i++) event(`unopened-${i}`, `input-${i}`);
    await settle();
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
    expect(app.getState().inputs).toEqual({});
  });

  it("coalesces repeated trimmed active events until hydration resolves, then needs no further reads", async () => {
    mount("active");
    await app.getState().select("active", "local");
    const pending = deferred<any>();
    mock.responses.set("inputGet", () => pending.promise);
    for (let i = 0; i < 100; i++) event("active");
    await settle();
    expect(calls("inputGet").map(call => call.args)).toEqual([["active", ["point"]]]);
    expect(calls("inputList")).toHaveLength(0);
    pending.resolve({ ledgerEpoch: "e", stateRevision: 2, missing: [],
      records: [record("point", { cutexSessionId: "active", rev: 2, stateRevision: 2, preview: "complete body" })] });
    await settle();
    expect(app.getState().inputs[key("active")]!.records.get("point")?.preview).toBe("complete body");
    mock.calls.length = 0;
    for (let i = 0; i < 100; i++) event("active");
    await settle();
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
  });

  it("separates point reads by host, session, input and revision while each identity deduplicates", async () => {
    app.setState({ byHost: { remote: { epoch: 1, features: new Set(["input-ledger-v1"]), sidebar: null } as any } });
    for (const [host, id] of [["local", "a"], ["local", "b"], ["remote", "a"]]) {
      mount(id!, 1, host!);
      app.getState().setViewVisible(host!, id!, true);
    }
    const identities = [
      ["local", "a", "point", 2], ["local", "b", "point", 2],
      ["remote", "a", "point", 2], ["local", "a", "other", 2], ["local", "a", "point", 3],
    ] as const;
    const pending = identities.map(() => deferred<any>());
    let index = 0;
    mock.responses.set("inputGet", () => pending[index++]!.promise);
    for (const [host, id, input, rev] of identities) {
      event(id, input, rev, host); event(id, input, rev, host);
    }
    await settle();
    expect(calls("inputGet").map(({ host, args }) => [host, ...args])).toEqual(
      identities.map(([host, id, input]) => [host, id, [input]]));
    // Resolve newer versions first: an older pending response cannot replace their body.
    for (let i = identities.length - 1; i >= 0; i--) {
      const [host, id, input, rev] = identities[i]!;
      pending[i]!.resolve({ ledgerEpoch: "e", stateRevision: rev, missing: [], records: [
        record(input, { cutexSessionId: id, rev, stateRevision: rev, preview: `${host}/${id}/${input}/${rev}` }),
      ] });
      await settle();
    }
    expect(app.getState().inputs[key("a")]!.records.get("point")?.preview).toBe("local/a/point/3");
    expect(app.getState().inputs[key("b")]!.records.get("point")?.preview).toBe("local/b/point/2");
    expect(app.getState().inputs[key("a", "remote")]!.records.get("point")?.preview).toBe("remote/a/point/2");
    expect(app.getState().inputs[key("a")]!.records.get("other")?.preview).toBe("local/a/other/2");
    expect(calls("inputList")).toHaveLength(0);
  });

  it("ignoring an unopened ledger event still updates the host waiting projection", async () => {
    const emit = (native: any) => mock.handlers.get("hostEvent")!({ hostId: "local", envelope: {
      cutexSessionId: "unopened", cutex: { method: "cutex/input/stateChanged", params: {
        ledgerEpoch: "e", stateRevision: 1, record: record("point"),
      } }, native,
    } });
    emit({ kind: "serverRequest", message: { id: "request-1", method: "test/request", params: {} } });
    expect(app.getState().hostWaiting.unopened).toEqual(["test/request"]);
    emit({ kind: "notification", message: { method: "serverRequest/resolved", params: { requestId: "request-1" } } });
    expect(app.getState().hostWaiting.unopened).toBeUndefined();
    await settle();
    expect(app.getState().inputs).toEqual({});
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
  });

  it("assigns fresh generations to newly read and evicted/reopened ledger caches", async () => {
    const generations: number[] = [];
    for (let i = 0; i < 10; i++) {
      await app.getState().refreshInputs(`fresh-${i}`, "local");
      generations.push(app.getState().inputs[key(`fresh-${i}`)]!.generation);
      expectIdleBound();
      expect(app.getState().ledgerOutbox).toEqual({});
    }
    expect(new Set(generations).size).toBe(10);
    expect(app.getState().inputs[key("fresh-0")]).toBeUndefined();
    mock.responses.set("inputList", (id: string) => list(id, 2, "reopened body"));
    await app.getState().refreshInputs("fresh-0", "local");
    const reopened = app.getState().inputs[key("fresh-0")]!;
    expect(reopened.generation).toBeGreaterThan(Math.max(...generations));
    expect(reopened.records.get("body-0")?.preview).toBe("reopened body");
    expect(calls("inputList")).toHaveLength(11);
    expect(calls("inputList").every(call => Object.keys(call.args[1]).length === 0)).toBe(true);
    expect(calls("inputGet")).toHaveLength(0);
    expect(app.getState().ledgerOutbox).toEqual({});
    expectIdleBound();
  });

  it("also prunes empty baselines left by failed reads before retrying an old session", async () => {
    mock.responses.set("inputList", () => { throw Error("offline"); });
    for (let i = 0; i < 10; i++) {
      await expect(app.getState().refreshInputs(`failed-${i}`, "local")).rejects.toThrow("offline");
    }
    expect(app.getState().inputs).toEqual({});
    mock.responses.set("inputList", (id: string) => list(id));
    await app.getState().refreshInputs("probe", "local");
    const probeGeneration = app.getState().inputs[key("probe")]!.generation;
    await app.getState().refreshInputs("failed-0", "local");
    // If the private empty-baseline map retained failed-0, this retry would adopt its old generation.
    expect(app.getState().inputs[key("failed-0")]!.generation).toBeGreaterThan(probeGeneration);
    expect(calls("inputList")).toHaveLength(12);
    expect(calls("inputGet")).toHaveLength(0);
    expectIdleBound();
  });

  it.each([1, 1100])("ten select/visibility/close cycles bound idle caches (%i records/session)", async count => {
    for (let i = 0; i < 10; i++) {
      const id = `switch-${i}`;
      mount(id, count);
      await app.getState().select(id, "local");
      expectIdleBound();
      expect(app.getState().inputs[key(id)]!.records.size).toBe(count);
      const release = app.getState().retainView("local", id);
      app.getState().setViewVisible("local", id, true);
      expectIdleBound();
      app.getState().setViewVisible("local", id, false);
      release();
      expectIdleBound();
      expect(Object.keys(app.getState().inputs).length).toBeLessThanOrEqual(5);
    }
    expect(app.getState().inputs[key("switch-0")]).toBeUndefined();
    expect(calls("bootstrap")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
  });

  it("prunes confirmed empty outbox keys with their cache while preserving actual unconfirmed text", async () => {
    mount("confirmed");
    mount("pending");
    const entry = { inputId: "unsent", sessionId: "pending", hostId: "local", text: "keep the whole draft",
      extra: [], strategy: "auto" as const, createdAt: new Date(0).toISOString(), phase: "unconfirmed" as const };
    app.setState({ ledgerOutbox: {
      [key("confirmed")]: [{ ...entry, inputId: "body-0", sessionId: "confirmed", text: "now confirmed" }],
      [key("pending")]: [entry],
    } });
    // Let the real snapshot handler acknowledge the matching input before applying eviction pressure.
    await app.getState().refreshInputs("confirmed", "local");
    expect(app.getState().ledgerOutbox[key("confirmed")]).toEqual([]);
    expect(app.getState().inputs[key("confirmed")]).toBeDefined();
    for (let i = 0; i < 10; i++) {
      mount(`visit-${i}`);
      await app.getState().select(`visit-${i}`, "local");
    }
    expect(app.getState().inputs[key("confirmed")]).toBeUndefined();
    expect(app.getState().ledgerOutbox).not.toHaveProperty(key("confirmed"));
    expect(Object.keys(app.getState().ledgerOutbox)).toEqual([key("pending")]);
    expect(app.getState().ledgerOutbox[key("pending")]).toEqual([entry]);
    expect(app.getState().inputs[key("pending")]).toBeDefined();
    expectIdleBound();
    expect(calls("inputList").map(call => call.args)).toEqual([["confirmed", { sinceRevision: 1 }]]);
    expect(calls("inputGet")).toHaveLength(0);
  });

  it("keeps pending owner text and its ledger through eviction pressure and still processes its host event", async () => {
    mount("pending");
    const entry = { inputId: "unsent", sessionId: "pending", hostId: "local", text: "keep the whole draft",
      extra: [], strategy: "auto" as const, createdAt: new Date(0).toISOString(), phase: "unconfirmed" as const };
    app.setState({ ledgerOutbox: { [key("pending")]: [entry] } });
    for (let i = 0; i < 10; i++) { mount(`other-${i}`); await app.getState().select(`other-${i}`, "local"); }
    expectIdleBound();
    expect(app.getState().inputs[key("pending")]).toBeDefined();
    expect(app.getState().ledgerOutbox[key("pending")]).toEqual([entry]);
    mock.responses.set("inputGet", () => ({ ledgerEpoch: "e", stateRevision: 2, missing: [],
      records: [record("point", { cutexSessionId: "pending", rev: 2, stateRevision: 2 })] }));
    event("pending");
    await settle();
    expect(calls("inputGet")).toHaveLength(1);
    expect(app.getState().ledgerOutbox[key("pending")]).toEqual([entry]);
  });

  it("marks inactive cached events dirty and reopening visibly requests full authoritative bodies", async () => {
    mount("idle", 2);
    const old = app.getState().inputs[key("idle")];
    event("idle", "body-0");
    await settle();
    expect(app.getState().inputs[key("idle")]).toBe(old);
    expect(calls("inputGet")).toHaveLength(0);
    expect(calls("inputList")).toHaveLength(0);
    const pending = deferred<any>();
    mock.responses.set("inputList", () => pending.promise);
    app.getState().setViewVisible("local", "idle", true);
    await settle();
    expect(calls("inputList").map(call => call.args)).toEqual([["idle", {}]]);
    pending.resolve(list("idle", 2, "new authoritative body"));
    await settle();
    expect(app.getState().inputs[key("idle")]!.records.get("body-0")?.preview).toBe("new authoritative body");
    expect(app.getState().inputs[key("idle")]!.records.has("body-1")).toBe(false);
    app.getState().setViewVisible("local", "idle", false);
    app.getState().setViewVisible("local", "idle", true);
    await settle();
    expect(calls("inputList")).toHaveLength(1);
  });

  it.each(["point", "list"] as const)("pins an in-flight %s read through eviction pressure and releases after resolution", async kind => {
    mount("reading");
    app.getState().setViewVisible("local", "reading", true);
    const pending = deferred<any>();
    mock.responses.set(kind === "point" ? "inputGet" : "inputList", () => pending.promise);
    const refresh = kind === "list" ? app.getState().refreshInputs("reading", "local") : undefined;
    if (kind === "point") event("reading");
    await settle();
    app.getState().setViewVisible("local", "reading", false);
    for (let i = 0; i < 10; i++) { mount(`pressure-${i}`); await app.getState().select(`pressure-${i}`, "local"); }
    expect(app.getState().inputs[key("reading")]).toBeDefined();
    const authoritative = record("point", { cutexSessionId: "reading", rev: 2, stateRevision: 2, preview: "resolved body" });
    pending.resolve({ ledgerEpoch: "e", stateRevision: 2, records: [authoritative], missing: [], complete: true });
    await refresh;
    await settle();
    expect(app.getState().inputs[key("reading")]!.records.get("point")?.preview).toBe("resolved body");
    for (let i = 10; i < 16; i++) { mount(`pressure-${i}`); await app.getState().select(`pressure-${i}`, "local"); }
    expect(app.getState().inputs[key("reading")]).toBeUndefined();
    expectIdleBound();
    expect(calls(kind === "point" ? "inputGet" : "inputList")).toHaveLength(1);
  });
});
