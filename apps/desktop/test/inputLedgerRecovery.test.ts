import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { record } from "../src/renderer/src/lib/inputLedger/testkit";
import { viewKey } from "../src/renderer/src/lib/viewKey";

const fx = vi.hoisted(() => ({ calls: [] as { host: string; method: string; args: any[] }[], records: [] as any[] }));
vi.mock("../src/renderer/src/bridge", () => {
  const apiFor = (host: string) => new Proxy({}, { get: (_, method: string) => async (...args: any[]) => {
    fx.calls.push({ host, method, args });
    if (method === "bootstrap") return { checkpoint: { streamId: "s", cursor: "c", sequence: 1 }, native: null,
      cutexState: { runtime: { status: "offline", runtimeGeneration: 1 }, pendingServerRequests: [], userInputQueue: [], agentBusMessages: [],
        ledgerEpoch: "e", stateRevision: 1, inputs: [], delivery: { state: "offline", reason: null, turn: null, lease: null, runtimeConnected: false, runtimeGeneration: 1, heldCount: 0, heldUntil: null, stateRevision: 1, observedAt: "2026-11-02T00:00:00Z" } } };
    if (method === "inputGet") return { ledgerEpoch: "e", stateRevision: 2, records: fx.records.filter(r => args[1].includes(r.inputId)), missing: args[1].filter((id: string) => !fx.records.some(r => r.inputId === id)) };
    if (method === "inputList") return { ledgerEpoch: "e", stateRevision: 2, records: fx.records, complete: true };
    if (method === "submit") throw Error("lost response");
    return undefined;
  } });
  return { api: apiFor("local"), apiFor, bridge: { on: () => () => {}, shell: { logError: () => {} } } };
});

function memory(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.get(k) ?? null,
    setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear() };
}
let storage: Storage;
const SID = "cutex.s1", key = viewKey("local", SID);
function save(inputId: string, hostId = "local") {
  const draft = { inputId, hostId, sessionId: SID, text: `Full text ${inputId}`, extra: [], strategy: "auto", createdAt: "2026-11-02T00:00:00Z", phase: "sending" };
  storage.setItem("cutex-desktop.inputLedger.o0.v1:" + JSON.stringify([hostId, SID, inputId]), JSON.stringify(draft));
}
async function app() {
  const { useApp } = await import("../src/renderer/src/store");
  const { emptyTimeline } = await import("../src/renderer/src/lib/timeline");
  useApp.setState({ features: new Set(["input-ledger-v1"]), selectedId: SID, selectedHost: "local", sessions: { [key]: { timeline: emptyTimeline(), version: 0 } as any } });
  return useApp;
}
beforeEach(() => {
  vi.resetModules(); fx.calls.length = 0; fx.records = [];
  storage = memory(); vi.stubGlobal("localStorage", storage); vi.stubGlobal("document", { hasFocus: () => false });
});
afterEach(() => vi.unstubAllGlobals());

describe("D5 store recovery", () => {
  it("restores O0, checks exact ids without resending, and retains missing messages", async () => {
    save("present"); save("missing"); save("missing", "hachimi");
    fx.records = [record("present", { state: "inContext", rev: 2, stateRevision: 2 })];
    const store = await app();
    await store.getState().reloadSession(SID, "local");
    expect(fx.calls.filter(c => c.method === "inputGet").map(c => c.args[1])).toContainEqual(["present", "missing"]);
    expect(fx.calls.filter(c => c.method === "submit")).toEqual([]);
    expect(store.getState().ledgerOutbox[key]).toEqual([expect.objectContaining({ inputId: "missing", phase: "unconfirmed", error: "input_not_found" })]);
    expect(storage.getItem('cutex-desktop.inputLedger.o0.v1:["local","cutex.s1","present"]')).toBeNull();
    expect(storage.getItem('cutex-desktop.inputLedger.o0.v1:["hachimi","cutex.s1","missing"]')).not.toBeNull();
    store.getState().discardLedgerOutbox(SID, "missing", "local");
    expect(storage.getItem('cutex-desktop.inputLedger.o0.v1:["local","cutex.s1","missing"]')).toBeNull();
  }, 60_000);

  it("persists before POST, keeps full intent on a lost reply, then clears on a ledger read", async () => {
    const store = await app();
    const joinDelegation = { askId: "a", expectedTurnId: "t" } as any;
    await store.getState().submit("Do not lose", "interrupt", [], { joinDelegation });
    const draft = store.getState().ledgerOutbox[key]![0]!;
    expect(draft).toMatchObject({ phase: "unconfirmed", joinDelegation });
    const storageKey = "cutex-desktop.inputLedger.o0.v1:" + JSON.stringify(["local", SID, draft.inputId]);
    expect(JSON.parse(storage.getItem(storageKey)!)).toMatchObject({ text: "Do not lose", strategy: "interrupt", joinDelegation });
    fx.records = [record(draft.inputId, { state: "accepted", stateRevision: 2 })];
    await store.getState().refreshInputs(SID, "local");
    // Initial full read can switch from the empty epoch; authoritative record owns the id afterward.
    expect(store.getState().ledgerOutbox[key]).toEqual([]);
    expect(storage.getItem(storageKey)).toBeNull();
  }, 60_000);
});
