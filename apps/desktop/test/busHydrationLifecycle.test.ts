// bootstrap-bounded-bus hydration lifecycle with the real store and a per-host fake bridge (harness from
// multiHostStore.test.ts; the three cases are the d8ea11367 re-review repros by peer-review): a delayed
// page never restores settlement a newer authoritative read cleared; a finished read never hides another
// read's leftover (继续读取); a host switch drops the leftovers.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { DaemonState, HostsState } from "../src/shared/ipc";
import type { NotifyOccurrence } from "../src/renderer/src/lib/notifyEvents";
import { viewKey } from "../src/renderer/src/lib/viewKey";

const mock = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const calls: { host: string; method: string; args: unknown[] }[] = [];
  /** `<host>:<method>` first, then `<method>`. */
  const responses = new Map<string, (...args: unknown[]) => unknown>();
  // delivering: a hostsState notification is being handed to the listeners. Like preload, daemon
  // calls made meanwhile are refused (bindings are set once every listener ran); host calls are not.
  const state = { focus: "local", delivering: false };
  const HOST_CALLS = new Set(["hosts", "switchHost", "setScope", "reconnectHost", "connectHost", "setHostAutoConnect"]);
  const make = (host: () => string) =>
    new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
      get: (_target, method) => {
        if (typeof method !== "string" || method === "then") return undefined;
        return (...args: unknown[]) => {
          const h = host();
          if (state.delivering && !HOST_CALLS.has(method)) {
            calls.push({ host: h, method: `refused:${method}`, args });
            return Promise.reject(new Error("host binding unavailable or changed"));
          }
          calls.push({ host: h, method, args });
          const respond = responses.get(`${h}:${method}`) ?? responses.get(method);
          // The startup handshake: preload hands the reply to the hostsState listeners first.
          if (method === "hosts" && respond)
            return Promise.resolve().then(() => {
              const reply = respond(...args);
              state.delivering = true;
              try {
                for (const listener of [...(listeners.get("hostsState") ?? [])]) listener(reply);
              } finally {
                state.delivering = false;
              }
              return reply;
            });
          return respond ? Promise.resolve().then(() => respond(...args)) : Promise.resolve(null);
        };
      },
    });
  const api = make(() => state.focus);
  const perHost = new Map<string, ReturnType<typeof make>>();
  const apiFor = (hostId: string) => {
    if (!perHost.has(hostId)) perHost.set(hostId, make(() => hostId));
    return perHost.get(hostId)!;
  };
  return { listeners, calls, responses, state, api, apiFor, HOST_CALLS };
});
vi.mock("../src/renderer/src/bridge", () => ({
  api: mock.api,
  apiFor: mock.apiFor,
  bridge: {
    api: mock.api,
    apiFor: mock.apiFor,
    on: (name: string, callback: (value: unknown) => void) => {
      const set = mock.listeners.get(name) ?? new Set();
      set.add(callback);
      mock.listeners.set(name, set);
      return () => set.delete(callback);
    },
  },
}));

// ---------- transport ----------
const WORKSTATION = "ssh-t";
const LABEL: Record<string, string> = { local: "HOST-A", [WORKSTATION]: "workstation" };
const epochs: Record<string, number> = {};
const connected = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: `fake://${hostId}`, hostId: LABEL[hostId]!.toUpperCase() });
const fire = (name: string, payload: unknown) => {
  const hosts = name === "hostsState";
  if (hosts) mock.state.delivering = true;
  try {
    for (const listener of [...(mock.listeners.get(name) ?? [])]) listener(payload);
  } finally {
    if (hosts) mock.state.delivering = false;
  }
};
function hostsState(focus: string, up: readonly string[] = ["local", WORKSTATION]): HostsState {
  mock.state.focus = focus;
  const view = (id: string) => ({
    id, kind: id === "local" ? ("local" as const) : ("ssh" as const), label: LABEL[id]!, target: id === "local" ? null : "workstation", remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true,
    ...(up.includes(id) ? { conn: { epoch: `${id}-${epochs[id]}`, tunnel: null, daemon: connected(id), cutexBuild: null } } : {}),
  });
  return { scope: { kind: "host", id: focus }, active: focus, hosts: [view("local"), view(WORKSTATION)], groups: [], startOn: "last", tunnel: null, weakSecretStorage: false };
}
const transport = {
  hosts: (focus: string, up?: readonly string[]) => fire("hostsState", hostsState(focus, up)),
  host: (hostId: string, envelope: EventEnvelope) => fire("hostEvent", { hostId, epoch: `${hostId}-${epochs[hostId]}`, envelope }),
};

// ---------- fixtures ----------
const resource = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, revision: 3, lifecycle: "active", native: { threadId: `thread-${id}` }, runtime: { status: "online", runtimeGeneration: 1, activeTurnId: null, threadSettings: null }, activity: null });
const sidebarOf = (rows: [string, string][]) => () => ({ active: rows.map(([id, name]) => resource(id, name)), retired: [], projects: null, hostRows: Object.fromEntries(rows.map(([id]) => [id, { projectId: null }])) });
const approval = (id: string, requester: string) => ({ approvalId: id, kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: requester, summary: `summary ${id}`, details: null, requestSha256: "x", state: "pending", createdAt: "2026-10-10T10:00:00Z" });
const note = (id: string, agentId: string) => ({ notificationId: id, agentId, agentName: null, origin: "agent", text: "look", level: "attention", requestedLevel: "attention", downgraded: null, muted: false, channels: ["desktop"], needsReply: false, delegation: null, job: null, turnId: null, state: "open", createdAt: "2026-10-10T10:00:00.000Z", acknowledgedAt: null, reply: null, closedAt: null });
const FEATURES = ["owner-approvals", "owner-messages", "services"];
const envelope = (sessionId: string, part: Partial<EventEnvelope>) => ({ cutexSessionId: sessionId, source: "cutex", correlation: {}, ...part }) as EventEnvelope;
const cutex = (sessionId: string, method: string, params: unknown) => envelope(sessionId, { cutex: { method, params } } as Partial<EventEnvelope>);
const request = (sessionId: string, id: number, method: string) => envelope(sessionId, { source: "app_server", native: { kind: "serverRequest", message: { id, method, params: {} } } } as Partial<EventEnvelope>);
const resolved = (sessionId: string, requestId: number) => envelope(sessionId, { source: "app_server", native: { kind: "notification", message: { method: "serverRequest/resolved", params: { requestId } } } } as Partial<EventEnvelope>);

let store: (typeof import("../src/renderer/src/store"))["useApp"];
let shell: typeof import("../src/renderer/src/lib/shell");
let notes: typeof import("../src/renderer/src/lib/ownerNotifyStore");
let occurrences: NotifyOccurrence[];
let storage: Map<string, string>;

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.runOnlyPendingTimersAsync();
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
async function start(focus = "local") {
  mock.responses.set("hosts", () => hostsState(focus));
  store.getState().init();
  await settle();
  await settle();
}
const ids = (rows: { cutexSessionId: string }[] | undefined) => rows?.map((r) => r.cutexSessionId);

// Warm the transform cache once: each beforeEach resets modules and re-imports the store, and the
// first-ever load (~3 s) was billed to the first test's hook and timed out under the full suite's
// load. Same stubs as beforeEach (the store reads them at evaluation), undone like afterEach.
beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("document", { hasFocus: () => false });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  await import("../src/renderer/src/store");
  await import("../src/renderer/src/lib/shell");
  await import("../src/renderer/src/lib/ownerNotifyStore");
  await import("../src/renderer/src/lib/notifyEvents");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  epochs.local = 1;
  epochs[WORKSTATION] = 1;
  mock.state.focus = "local";
  mock.listeners.clear();
  mock.calls.length = 0;
  mock.responses.clear();
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  vi.stubGlobal("document", { hasFocus: () => false });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  mock.responses.set("local:daemonState", () => connected("local"));
  mock.responses.set(`${WORKSTATION}:daemonState`, () => connected(WORKSTATION));
  mock.responses.set("local:sidebar", sidebarOf([["a1", "Alpha"], ["b2", "Beta"]]));
  mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["w1", "Wave"]]));
  mock.responses.set("capabilities", () => ({ featureList: FEATURES, cutexBuild: { version: "0.1.0", release: "r219", commit: null, builtAt: null, profile: "release", channel: "main" } }));
  mock.responses.set("services", () => ({ services: [] }));
  mock.responses.set("local:approvals", () => [approval("apr-1", "a1")]);
  mock.responses.set(`${WORKSTATION}:approvals`, () => [approval("apr-t1", "w1")]);
  mock.responses.set("local:ownerNotifications", () => []);
  mock.responses.set(`${WORKSTATION}:ownerNotifications`, () => [note("ntf-t1", "w1")]);
  store = (await import("../src/renderer/src/store")).useApp;
  shell = await import("../src/renderer/src/lib/shell");
  notes = await import("../src/renderer/src/lib/ownerNotifyStore");
  occurrences = [];
  (await import("../src/renderer/src/lib/notifyEvents")).setNotifyHandler((o) => void occurrences.push(o));
});
afterEach(() => {
  // No daemon call may go out while a host notification is delivered (preload refuses it).
  expect(mock.calls.filter((c) => c.method.startsWith("refused:")).map((c) => `${c.host} ${c.method}`)).toEqual([]);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function configureBus() {
  mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "bootstrap-bounded-bus", "history-pages"] }));
  const native = (turnId: string) => ({ result: { thread: { id: "thread-a1", turns: [{ id: turnId, status: "completed", items: [] }] } } });
  mock.responses.set("bootstrap", () => ({ native: native("new"), historyPage: { limit: 1, nextCursor: "h1", hasMore: true }, checkpoint: { streamId: "s", cursor: 0 }, cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [], busMessagesPage: { received: { hasMore: true }, sent: { hasMore: false } } } }));
  mock.responses.set("history", (id, cursor) => ({ native: native(cursor === "h1" ? "old1" : "old2"), page: { limit: 1, nextCursor: cursor === "h1" ? "h2" : null, hasMore: cursor === "h1" } }));
}
const response = (messages: unknown[] = []) => ({ contractVersion: 2, cutexSessionId: "a1", direction: "received", messages, page: { limit: 200, hasMore: false, nextCursor: null } });

it("keeps the incomplete indicator when a concurrent hydration finishes successfully", async () => {
  configureBus();
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: (value: unknown) => void;
  mock.responses.set("busMessages", (_id, query) => {
    const q = query as { turnIds: string[] };
    if(q.turnIds.includes("old1")) return new Promise((_resolve, reject) => { rejectFirst = reject; });
    return new Promise(resolve => { resolveSecond = resolve; });
  });
  await start();
  await store.getState().select("a1", "local");
  await store.getState().loadOlder("a1");
  await settle();
  expect(store.getState().sessions[viewKey("local", "a1")]?.busHydration).toBe("reading");
  await store.getState().loadOlder("a1");
  await settle();
  rejectFirst(new Error("offline"));
  await settle();
  expect(store.getState().sessions[viewKey("local", "a1")]?.busHydration).toBe("incomplete");
  resolveSecond(response());
  await settle();
  // The old1 retry failed, so the old2 success must not hide its retry.
  expect(store.getState().sessions[viewKey("local", "a1")]?.busHydration).toBe("incomplete");
});

it("does not let an older page restore settlement evidence cleared by a newer authoritative read", async () => {
  const messages = (await import("../src/renderer/src/lib/agentMessageStore")).useAgentMessages;
  const fixture = (await import("../src/renderer/src/modules/agent-bus/settlementFixture")).settlementFixture;
  const stale = { ...fixture(), evidence: { ...fixture().evidence, observedAt: "2026-11-01T00:00:00Z" } };
  messages.getState().seed("a1", [{ messageId: "m", state: "inbox_accepted", settlement: stale }], []);
  messages.getState().applySettlementRead("m", undefined);
  expect(messages.getState().byId.m?.settlement).toBeUndefined();
  messages.getState().mergePage("a1", [{ messageId: "m", state: "inbox_accepted", settlement: stale }], []);
  expect(messages.getState().byId.m?.settlement).toBeUndefined();
});

it("drops completed-run leftovers when switching away from a host", async () => {
  configureBus();
  mock.responses.set("busMessages", () => { throw new Error("offline"); });
  await start();
  await store.getState().select("a1", "local");
  await store.getState().loadOlder("a1");
  await settle();
  expect(store.getState().sessions[viewKey("local", "a1")]?.busHydration).toBe("incomplete");
  transport.hosts(WORKSTATION);
  await settle();
  transport.hosts("local");
  await settle();
  await store.getState().select("a1", "local");
  mock.calls.length = 0;
  await store.getState().continueBusHydration("a1", "local");
  expect(mock.calls.filter(c => c.method === "busMessages")).toEqual([]);
});

// Whole-branch review repro (peer-review, 715c17c7c): a re-open keeps older turns; their bus state is read again.
it("refreshes bus status of the older turns kept on reopening an online cached view", async () => {
  configureBus();
  const fixture = (await import("../src/renderer/src/modules/agent-bus/settlementFixture")).settlementFixture;
  const unresolved = fixture();
  let closedOnHost = false;
  const baseBoot = mock.responses.get("bootstrap")!;
  mock.responses.set("bootstrap", (...args) => {
    const boot = baseBoot(...args) as { cutexState: { agentBusMessages: unknown[] } };
    // The initial bounded bootstrap must include all unresolved messages, even outside its native window.
    if (args[0] === "a1" && !closedOnHost) boot.cutexState.agentBusMessages = [{ messageId: "old-message", fromCutexSessionId: "sender", state: "inbox_accepted", contextTurnId: "old1", settlement: unresolved }];
    return boot;
  });
  mock.responses.set("busMessages", () => response([{ messageId: "old-message", fromCutexSessionId: "sender", state: "inbox_accepted", contextTurnId: "old1", settlement: closedOnHost
    ? { ...unresolved, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T05:00:00Z", reason: "done", requestId: "close" } }
    : unresolved }]));
  await start();
  await store.getState().select("a1", "local");
  await store.getState().loadOlder("a1");
  await settle();
  const messages = (await import("../src/renderer/src/lib/agentMessageStore")).useAgentMessages;
  expect(messages.getState().byId["old-message"]?.settlement?.state).toBe("outcome_unknown");
  await store.getState().select("b2", "local");
  // The desktop did not receive this settlement event. The authoritative current host record is closed.
  // Bounded bootstrap excludes it because its older turn is outside the returned native window.
  closedOnHost = true;
  mock.calls.length = 0;
  await store.getState().select("a1", "local");
  await settle();
  expect(store.getState().sessions[viewKey("local", "a1")]?.timeline.turns.map(t => t.id)).toEqual(["old1", "new"]);
  expect(messages.getState().byId["old-message"]?.settlement?.state).toBe("closed");
});

it("re-reads by id a cached unresolved message the bounded re-open no longer lists, even outside the shown turns", async () => {
  configureBus();
  const fixture = (await import("../src/renderer/src/modules/agent-bus/settlementFixture")).settlementFixture;
  const unresolved = fixture();
  let closedOnHost = false;
  const baseBoot = mock.responses.get("bootstrap")!;
  mock.responses.set("bootstrap", (...args) => {
    const boot = baseBoot(...args) as { cutexState: { agentBusMessages: unknown[] } };
    if (args[0] === "a1" && !closedOnHost) boot.cutexState.agentBusMessages = [{ messageId: "far", fromCutexSessionId: "sender", state: "inbox_accepted", contextTurnId: "gone", settlement: unresolved }];
    return boot;
  });
  const queries: { turnIds?: string[]; itemIds?: string[] }[] = [];
  mock.responses.set("busMessages", (_id, query) => {
    queries.push(query as { turnIds?: string[]; itemIds?: string[] });
    return response([{ messageId: "far", fromCutexSessionId: "sender", state: "inbox_accepted", contextTurnId: "gone", settlement: { ...unresolved, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T05:00:00Z", reason: "done", requestId: "close" } } }]);
  });
  await start();
  await store.getState().select("a1", "local");
  await settle();
  const messages = (await import("../src/renderer/src/lib/agentMessageStore")).useAgentMessages;
  expect(messages.getState().byId.far?.settlement?.state).toBe("outcome_unknown");
  await store.getState().select("b2", "local");
  closedOnHost = true;
  await store.getState().select("a1", "local");
  await settle();
  expect(queries.some((q) => q.itemIds?.includes("far"))).toBe(true);
  expect(messages.getState().byId.far?.settlement?.state).toBe("closed");
});

it("on a full (old) host a re-open reads no bus pages: its full bootstrap carries the new state", async () => {
  configureBus();
  mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "history-pages"] }));
  const fixture = (await import("../src/renderer/src/modules/agent-bus/settlementFixture")).settlementFixture;
  const unresolved = fixture();
  let closedOnHost = false;
  const baseBoot = mock.responses.get("bootstrap")!;
  mock.responses.set("bootstrap", (...args) => {
    const boot = baseBoot(...args) as { cutexState: { agentBusMessages: unknown[]; busMessagesPage?: unknown } };
    delete boot.cutexState.busMessagesPage;
    const settlement = closedOnHost ? { ...unresolved, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-11-16T05:00:00Z", reason: "done", requestId: "close" } } : unresolved;
    if (args[0] === "a1") boot.cutexState.agentBusMessages = [{ messageId: "old-message", fromCutexSessionId: "sender", state: "inbox_accepted", contextTurnId: "old1", settlement }];
    return boot;
  });
  await start();
  await store.getState().select("a1", "local");
  await store.getState().loadOlder("a1");
  await settle();
  await store.getState().select("b2", "local");
  closedOnHost = true;
  mock.calls.length = 0;
  await store.getState().select("a1", "local");
  await settle();
  const messages = (await import("../src/renderer/src/lib/agentMessageStore")).useAgentMessages;
  expect(mock.calls.filter((c) => c.method === "busMessages")).toEqual([]);
  expect(store.getState().sessions[viewKey("local", "a1")]?.timeline.turns.map((t) => t.id)).toEqual(["old1", "new"]);
  expect(messages.getState().byId["old-message"]?.settlement?.state).toBe("closed");
  expect(mock.calls.filter((c) => c.method === "bootstrap").every((c) => (c.args[2] as { boundedBus?: boolean } | undefined)?.boundedBus !== true)).toBe(true);
});
