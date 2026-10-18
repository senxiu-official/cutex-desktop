// Side agent view (「智能体」 side page): the store keeps N live session feeds — the selected agent and the
// agents shown in the right side area (docs/research/side-agent-view-20261018.md). Same transport harness
// as r244Acceptance.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { DaemonState, HostsState } from "../src/shared/ipc";
import type { NotifyOccurrence } from "../src/renderer/src/lib/notifyEvents";

const mock = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const calls: { method: string; args: unknown[] }[] = [];
  const responses = new Map<string, (...args: unknown[]) => unknown>();
  const api = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get: (_target, method) => {
      if (typeof method !== "string" || method === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ method, args });
        const respond = responses.get(method);
        return respond ? Promise.resolve().then(() => respond(...args)) : Promise.resolve(null);
      };
    },
  });
  return { listeners, calls, responses, api };
});
vi.mock("../src/renderer/src/bridge", () => ({
  api: mock.api,
  bridge: {
    api: mock.api,
    apiFor: () => mock.api,
    on: (name: string, callback: (value: unknown) => void) => {
      const set = mock.listeners.get(name) ?? new Set();
      set.add(callback);
      mock.listeners.set(name, set);
      return () => set.delete(callback);
    },
  },
}));

// ---------- transport (the only part that knows the event shapes) ----------
let epoch = 0;
let active = "local";
const fire = (name: string, payload: unknown) => {
  for (const listener of [...(mock.listeners.get(name) ?? [])]) listener(payload);
};
// Multi-host P0: the scope is one host, the only connected one; events carry that connection's tag.
function hostsState(host = active, fresh = false): HostsState {
  if (fresh) epoch++;
  active = host;
  const conn = { epoch: `epoch-${epoch}`, tunnel: null, daemon: { kind: "connecting", baseUrl: "" } as DaemonState, cutexBuild: null };
  const view = { id: host, kind: host === "local" ? ("local" as const) : ("ssh" as const), label: host, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, conn };
  return { scope: { kind: "host", id: host }, active: host, hosts: [view], groups: [], startOn: "local", tunnel: null, weakSecretStorage: false };
}
const tag = () => ({ hostId: active, epoch: `epoch-${epoch}` });
const transport = {
  hosts: (host?: string, fresh = false) => fire("hostsState", hostsState(host, fresh)),
  daemon: (state: DaemonState) => fire("daemonState", { ...tag(), state }),
  host: (envelope: EventEnvelope) => fire("hostEvent", { ...tag(), envelope }),
  session: (sessionId: string, envelope: EventEnvelope) => fire("sessionEvent", { ...tag(), sessionId, envelope }),
};

// ---------- fixtures ----------
const CONNECTED: DaemonState = { kind: "connected", baseUrl: "fake://local", hostId: "HOST-A" };
const resource = (id: string, name: string) => ({
  cutexSessionId: id,
  displayName: name,
  revision: 3,
  lifecycle: "active",
  native: { threadId: `thread-${id}` },
  runtime: { status: "online", runtimeGeneration: 1, activeTurnId: null, threadSettings: null },
  activity: null,
});
const sidebar = () => ({ active: [resource("a1", "Alpha"), resource("b2", "Beta"), resource("c3", "Gamma")], retired: [], projects: null, hostRows: { a1: { projectId: "p1" }, b2: { projectId: null }, c3: { projectId: null } } });
const boot = () => ({
  native: null,
  historyPage: null,
  checkpoint: { streamId: "stream", cursor: "c0" },
  cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], userInputQueuePause: null, asksPaused: null, pendingServerRequests: [], latestPlan: null, latestTokenUsage: null, agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
});
const FEATURES = ["owner-approvals", "owner-messages", "services", "queue-pause"];
const envelope = (sessionId: string, part: Partial<EventEnvelope>) => ({ cutexSessionId: sessionId, source: "cutex", correlation: {}, ...part }) as EventEnvelope;
const native = (sessionId: string, method: string, params: unknown) => envelope(sessionId, { source: "app_server", native: { kind: "notification", message: { method, params } } } as Partial<EventEnvelope>);
const request = (sessionId: string, id: number, method: string) => envelope(sessionId, { source: "app_server", native: { kind: "serverRequest", message: { id, method, params: {} } } } as Partial<EventEnvelope>);

let store: (typeof import("../src/renderer/src/store"))["useApp"];
let shell: typeof import("../src/renderer/src/lib/shell");
let occurrences: NotifyOccurrence[];

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.runOnlyPendingTimersAsync();
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function startConnected() {
  store.getState().init();
  await settle();
  transport.daemon(CONNECTED);
  await settle();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  epoch = 0;
  active = "local";
  mock.listeners.clear();
  mock.calls.length = 0;
  mock.responses.clear();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  vi.stubGlobal("document", { hasFocus: () => false });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  mock.responses.set("hosts", () => hostsState("local", true));
  mock.responses.set("daemonState", () => ({ kind: "connecting", baseUrl: "" }));
  mock.responses.set("sidebar", sidebar);
  mock.responses.set("capabilities", () => ({ featureList: FEATURES, cutexBuild: { version: "0.1.0", release: "r219", commit: null, builtAt: null, profile: "release", channel: "main" } }));
  mock.responses.set("services", () => ({ services: [] }));
  mock.responses.set("approvals", () => []);
  mock.responses.set("ownerNotifications", () => []);
  mock.responses.set("bootstrap", boot);
  mock.responses.set("submit", () => ({ disposition: "started", turnId: "turn-x" }));
  store = (await import("../src/renderer/src/store")).useApp;
  shell = await import("../src/renderer/src/lib/shell");
  occurrences = [];
  (await import("../src/renderer/src/lib/notifyEvents")).setNotifyHandler((o) => void occurrences.push(o));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


// ---------- native thread fixtures ----------
type Item = Record<string, unknown>;
const user = (id: string, text: string, clientId?: string): Item => ({ type: "userMessage", id, content: [{ type: "text", text }], ...(clientId ? { clientId } : {}) });
const reply = (id: string, text: string): Item => ({ type: "agentMessage", id, text });
const turn = (id: string, status: string, items: Item[]) => ({ id, status, startedAt: 1, completedAt: status === "inProgress" ? null : 2, items });
const thread = (id: string, turns: ReturnType<typeof turn>[], pending: unknown[] = []) => ({
  ...boot(),
  native: { result: { thread: { id: `thread-${id}`, turns } } },
  cutexState: { ...boot().cutexState, pendingServerRequests: pending },
});


// Every agent answers its own bootstrap (the harness keys responses by method only).
const threads = new Map<string, ReturnType<typeof thread>>();
const bootById = (id: unknown) => threads.get(String(id)) ?? thread(String(id), []);
const calls = (method: string, id?: string) => mock.calls.filter((c) => c.method === method && (id === undefined || c.args[0] === id));
const started = (id: string, turnId: string) => native(id, "turn/started", { threadId: `thread-${id}`, turn: { id: turnId, status: "inProgress", items: [] } });
const completed = (id: string, turnId: string) => native(id, "turn/completed", { threadId: `thread-${id}`, turn: { id: turnId, status: "completed", items: [] } });
const item = (id: string, turnId: string, value: Item) => native(id, "item/completed", { threadId: `thread-${id}`, turnId, item: value });

async function twoLive() {
  await startConnected();
  threads.set("a1", thread("a1", [turn("t1", "inProgress", [])]));
  threads.set("b2", thread("b2", [turn("s1", "inProgress", [])]));
  mock.responses.set("bootstrap", bootById);
  await store.getState().select("a1");
  const release = store.getState().retainSideAgent("b2", "local");
  await settle();
  return release;
}

describe("side agent view: N live session feeds (docs/research/side-agent-view-20261018.md)", () => {
  it("the main and the side agent are both subscribed and both get their events", async () => {
    await twoLive();
    expect(calls("subscribe", "a1")).toHaveLength(1);
    expect(calls("subscribe", "b2")).toHaveLength(1);
    expect(store.getState().sideAgents).toEqual({ b2: { hostId: "local", visible: false } });
    transport.session("a1", item("a1", "t1", reply("m-a", "from alpha")));
    transport.session("b2", item("b2", "s1", reply("m-b", "from beta")));
    transport.session("b2", completed("b2", "s1"));
    const s = store.getState();
    expect(s.sessions.a1!.timeline.entries.has("m-a")).toBe(true);
    expect(s.sessions.b2!.timeline.entries.has("m-b")).toBe(true);
    expect(s.sessions.a1!.timeline.entries.has("m-b")).toBe(false);
    expect(s.sessions.b2!.timeline.activeTurnId).toBeNull();
    expect(s.sessions.a1!.timeline.activeTurnId).toBe("t1");
  });

  it("moving the main area on keeps the side agent live; leaving the side page unsubscribes it", async () => {
    const release = await twoLive();
    await store.getState().select("c3");
    await settle();
    expect(calls("unsubscribe", "a1")).toHaveLength(1);
    expect(calls("unsubscribe", "b2")).toHaveLength(0);
    // Still live after the main area moved: events keep arriving.
    transport.session("b2", item("b2", "s1", reply("m-b2", "still here")));
    expect(store.getState().sessions.b2!.timeline.entries.has("m-b2")).toBe(true);
    release();
    await settle();
    expect(calls("unsubscribe", "b2")).toHaveLength(1);
    expect(store.getState().sideAgents).toEqual({});
    // Not a recently viewed agent: its view goes with the side page.
    expect(store.getState().sessions.b2).toBeUndefined();
    // A second release is a no-op.
    release();
    expect(calls("unsubscribe", "b2")).toHaveLength(1);
  });

  it("selecting the side agent reuses its live view; releasing it then keeps the main feed", async () => {
    const release = await twoLive();
    mock.calls.length = 0;
    await store.getState().select("b2");
    await settle();
    // Already current: no second bootstrap / subscribe; the previous main agent's feed closes.
    expect(calls("bootstrap", "b2")).toHaveLength(0);
    expect(calls("subscribe", "b2")).toHaveLength(0);
    expect(calls("unsubscribe", "a1")).toHaveLength(1);
    release();
    await settle();
    expect(calls("unsubscribe", "b2")).toHaveLength(0);
    expect(store.getState().sessions.b2).toBeDefined();
  });

  it("the selected agent opened in the side too stays live when the main area moves on", async () => {
    await twoLive();
    const releaseA = store.getState().retainSideAgent("a1", "local");
    await settle();
    // Live already (selected): not subscribed twice.
    expect(calls("subscribe", "a1")).toHaveLength(1);
    await store.getState().select("c3");
    await settle();
    expect(calls("unsubscribe", "a1")).toHaveLength(0);
    releaseA();
    await settle();
    expect(calls("unsubscribe", "a1")).toHaveLength(1);
  });

  it("steers and optimistic sends settle for both agents from their own feeds", async () => {
    await twoLive();
    mock.responses.set("submit", () => ({ disposition: "steered", turnId: "t1" }));
    await store.getState().submit("to alpha", "auto");
    mock.responses.set("submit", () => ({ disposition: "steered", turnId: "s1" }));
    await store.getState().submit("to beta", "auto", [], { sessionId: "b2" });
    await settle();
    const sa = store.getState().pendingSteers.a1?.[0];
    const sb = store.getState().pendingSteers.b2?.[0];
    expect(sa).toMatchObject({ text: "to alpha", turnId: "t1" });
    expect(sb).toMatchObject({ text: "to beta", turnId: "s1" });
    expect(calls("submit", "b2")).toHaveLength(1);
    transport.session("a1", item("a1", "t1", user("u-a", "to alpha", sa!.id)));
    transport.session("b2", item("b2", "s1", user("u-b", "to beta", sb!.id)));
    await settle();
    expect(store.getState().pendingSteers.a1 ?? []).toEqual([]);
    expect(store.getState().pendingSteers.b2 ?? []).toEqual([]);
    expect(store.getState().outbox.a1 ?? []).toEqual([]);
    expect(store.getState().outbox.b2 ?? []).toEqual([]);
  });

  it("answers and stops go to the side agent when it is named", async () => {
    await twoLive();
    transport.session("b2", request("b2", 9, "item/commandExecution/requestApproval"));
    expect(store.getState().sessions.b2!.timeline.pending.size).toBe(1);
    await store.getState().respond(9, { decision: "accept" } as never, "b2");
    expect(calls("respond", "b2")).toHaveLength(1);
    expect(calls("respond", "a1")).toHaveLength(0);
    await store.getState().interrupt("b2");
    expect(calls("stopTurn", "b2")).toHaveLength(1);
    expect(calls("stopTurn", "a1")).toHaveLength(0);
  });

  it("notifications treat a visible side agent as looked at, a hidden one not", async () => {
    vi.stubGlobal("document", { hasFocus: () => true });
    await twoLive();
    store.getState().setSideAgentVisible("b2", true);
    transport.host(completed("b2", "s1"));
    expect(occurrences.at(-1)).toMatchObject({ agentId: "b2", looking: true });
    store.getState().setSideAgentVisible("b2", false);
    transport.host(completed("b2", "s2"));
    expect(occurrences.at(-1)).toMatchObject({ agentId: "b2", looking: false });
    // An agent neither selected nor in the side.
    transport.host(completed("c3", "x1"));
    expect(occurrences.at(-1)).toMatchObject({ agentId: "c3", looking: false });
    // The main agent as before.
    transport.host(completed("a1", "t1"));
    expect(occurrences.at(-1)).toMatchObject({ agentId: "a1", looking: true });
  });

  it("a host switch drops the side agents; the side page retains them again", async () => {
    const release = await twoLive();
    transport.hosts("remote", true);
    await settle();
    expect(store.getState().sideAgents).toEqual({});
    // The stale release does nothing (no unsubscribe on the new host).
    mock.calls.length = 0;
    release();
    expect(calls("unsubscribe")).toHaveLength(0);
  });
});
