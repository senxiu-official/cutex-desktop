// Streamed deltas re-render once per frame (lib/streamBatch, perf baseline 2026-10-20 fix order 4): the
// timeline takes every delta at once and in order; only the view's version waits for the frame, and any
// other event (turn end, approval, error) bumps it at once. Same transport harness as sideAgentStore.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { DaemonState, HostsState } from "../src/shared/ipc";
import type { NotifyOccurrence } from "../src/renderer/src/lib/notifyEvents";
import { viewKey } from "../src/renderer/src/lib/viewKey";

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
  const release = store.getState().retainView("local", "b2");
  await settle();
  return release;
}


const delta = (id: string, turnId: string, itemId: string, text: string) => native(id, "item/agentMessage/delta", { threadId: `thread-${id}`, turnId, itemId, delta: text });
const versionOf = (id: string) => store.getState().sessions[viewKey("local", id)]!.version;
const textOf = (id: string, itemId: string) => (store.getState().sessions[viewKey("local", id)]!.timeline.entries.get(itemId) as { text?: string } | undefined)?.text;

async function streaming() {
  await startConnected();
  threads.set("a1", thread("a1", [turn("t1", "inProgress", [])]));
  mock.responses.set("bootstrap", bootById);
  await store.getState().select("a1");
  await settle();
}

describe("stream batching (lib/streamBatch)", () => {
  it("keeps a truncated approval out of pending requests and host notifications until canonical resync", async () => {
    await streaming();
    occurrences.length = 0;
    const partial = request("a1", 71, "item/commandExecution/requestApproval");
    Object.assign(partial.native!.message, { _cutexTruncated: { reason: "event_size_limit", resyncRequired: true } });
    transport.host(partial);
    transport.session("a1", partial);
    const view = store.getState().sessions[viewKey("local", "a1")]!;
    expect(view.timeline.pending.has("71")).toBe(false);
    expect([...view.timeline.entries.values()]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "notice", media: true })]));
    expect(occurrences).toEqual([]);
    // The complete pending request read by resync is still accepted normally.
    transport.session("a1", request("a1", 71, "item/commandExecution/requestApproval"));
    expect(view.timeline.pending.has("71")).toBe(true);
  });
  it("applies every delta at once and in order, and moves the version once per frame", async () => {
    await streaming();
    const v0 = versionOf("a1");
    const parts = ["Hel", "lo, ", "wor", "ld", "!"];
    for (const p of parts) transport.session("a1", delta("a1", "t1", "m1", p));
    // Nothing held back or reordered: the timeline has the whole text already.
    expect(textOf("a1", "m1")).toBe("Hello, world!");
    // …but no re-render yet.
    expect(versionOf("a1")).toBe(v0);
    await vi.advanceTimersByTimeAsync(0); // the frame (requestAnimationFrame → setTimeout 0 here)
    expect(versionOf("a1")).toBe(v0 + 1);
    // More deltas: one more bump for the next frame, none lost.
    transport.session("a1", delta("a1", "t1", "m1", " More"));
    transport.session("a1", delta("a1", "t1", "m1", " text."));
    await vi.advanceTimersByTimeAsync(0);
    expect(versionOf("a1")).toBe(v0 + 2);
    expect(textOf("a1", "m1")).toBe("Hello, world! More text.");
    await vi.advanceTimersByTimeAsync(100);
    expect(versionOf("a1")).toBe(v0 + 2);
  });

  it("flushes at most 50 ms later when frames do not run (hidden window)", async () => {
    await streaming();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const v0 = versionOf("a1");
    transport.session("a1", delta("a1", "t1", "m1", "quiet"));
    await vi.advanceTimersByTimeAsync(49);
    expect(versionOf("a1")).toBe(v0);
    await vi.advanceTimersByTimeAsync(1);
    expect(versionOf("a1")).toBe(v0 + 1);
  });

  it("the turn's end bumps at once and takes the waiting bump with it", async () => {
    await streaming();
    const v0 = versionOf("a1");
    transport.session("a1", delta("a1", "t1", "m1", "last words"));
    transport.session("a1", completed("a1", "t1"));
    // Immediately: the end and the text before it.
    expect(versionOf("a1")).toBe(v0 + 1);
    const view = store.getState().sessions[viewKey("local", "a1")]!;
    expect(view.timeline.activeTurnId).toBeNull();
    expect(textOf("a1", "m1")).toBe("last words");
    await vi.advanceTimersByTimeAsync(100);
    expect(versionOf("a1")).toBe(v0 + 1);
  });

  it("an approval request and an error show at once, mid-stream", async () => {
    await streaming();
    const v0 = versionOf("a1");
    transport.session("a1", delta("a1", "t1", "m1", "about to run"));
    transport.session("a1", request("a1", 7, "item/commandExecution/requestApproval"));
    expect(versionOf("a1")).toBe(v0 + 1);
    expect(store.getState().sessions[viewKey("local", "a1")]!.timeline.pending.has("7")).toBe(true);
    transport.session("a1", delta("a1", "t1", "m1", " and failed"));
    transport.session("a1", native("a1", "error", { threadId: "thread-a1", turnId: "t1", willRetry: false, error: { message: "boom" } }));
    expect(versionOf("a1")).toBe(v0 + 2);
    expect(textOf("a1", "m1")).toBe("about to run and failed");
    await vi.advanceTimersByTimeAsync(100);
    expect(versionOf("a1")).toBe(v0 + 2);
  });

  it("batches two streaming views into one update per frame", async () => {
    await streaming();
    threads.set("b2", thread("b2", [turn("s1", "inProgress", [])]));
    store.getState().retainView("local", "b2");
    await settle();
    const a0 = versionOf("a1");
    const b0 = versionOf("b2");
    let updates = 0;
    const off = store.subscribe(() => void updates++);
    for (let i = 0; i < 5; i++) {
      transport.session("a1", delta("a1", "t1", "m1", `a${i}`));
      transport.session("b2", delta("b2", "s1", "n1", `b${i}`));
    }
    expect(updates).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    off();
    expect(updates).toBe(1);
    expect([versionOf("a1") - a0, versionOf("b2") - b0]).toEqual([1, 1]);
    expect(textOf("a1", "m1")).toBe("a0a1a2a3a4");
    expect(textOf("b2", "n1")).toBe("b0b1b2b3b4");
  });
});
