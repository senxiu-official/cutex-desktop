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
const FEATURES = ["session-background-work", "owner-approvals", "owner-messages", "services"];
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

const work = (host: string, id: string, running: boolean, runtimeGeneration = 1) => transport.host(host,
  cutex(id, "cutex/session/backgroundWork/changed", { cutexSessionId: id, runtimeGeneration, backgroundWork: { running, shells: running ? 1 : 0, complete: true } }));
const workOf = (host = "local", id = "a1") => (host === mock.state.focus ? store.getState().sidebar : store.getState().byHost[host]?.sidebar)?.active.find(r => r.cutexSessionId === id)?.runtime.backgroundWork;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it("start/end patches only the target row, and 100 events issue no list RPC", async () => {
  await start();
  const before = store.getState().sidebar!;
  const remote = store.getState().byHost[WORKSTATION];
  mock.calls.length = 0;
  work("local", "a1", true);
  expect(workOf()?.running).toBe(true);
  expect(store.getState().sidebar!.active[1]).toBe(before.active[1]);
  expect(store.getState().sidebar!.retired).toBe(before.retired);
  expect(store.getState().sidebar!.hostRows).toBe(before.hostRows);
  for (let i = 0; i < 100; i++) work("local", "a1", i % 2 === 0);
  expect(workOf()?.running).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mock.calls.filter(c => ["sidebar", "sessions", "hostSessions"].includes(c.method))).toEqual([]);
  expect(store.getState().byHost[WORKSTATION]).toBe(remote);
});

it("an old read cannot overwrite start/end; a newer runtime snapshot retires its overlay", async () => {
  await start();
  const old = deferred<ReturnType<ReturnType<typeof sidebarOf>>>();
  mock.responses.set("local:sidebar", () => old.promise);
  const read = store.getState().refreshSidebar();
  await Promise.resolve();
  work("local", "a1", true); work("local", "a1", false);
  const snapshot = sidebarOf([["a1", "Alpha"], ["b2", "Beta"]])();
  (snapshot.active[0]!.runtime as any).backgroundWork = { running: true };
  old.resolve(snapshot); await read;
  expect(workOf()?.running).toBe(false);
  snapshot.active[0]!.runtime.runtimeGeneration = 2;
  delete (snapshot.active[0]!.runtime as any).backgroundWork;
  mock.responses.set("local:sidebar", () => snapshot);
  await store.getState().refreshSidebar();
  work("local", "a1", true, 1);
  expect(workOf()).toBeUndefined();
  work("local", "a1", true, 3);
  expect(workOf()).toBeUndefined();
  snapshot.active[0]!.runtime.runtimeGeneration = 3;
  await store.getState().refreshSidebar();
  expect(workOf()?.running).toBe(true);
});

it("isolates identical ids by host and preserves events across focus changes", async () => {
  mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["a1", "Remote Alpha"]]));
  await start();
  work(WORKSTATION, "a1", true);
  expect(workOf()).toBeUndefined();
  expect(workOf(WORKSTATION)?.running).toBe(true);
  transport.hosts(WORKSTATION); await settle();
  expect(workOf(WORKSTATION)?.running).toBe(true);
  work("local", "a1", true); work(WORKSTATION, "a1", false);
  expect(workOf("local")?.running).toBe(true);
  expect(workOf(WORKSTATION)?.running).toBe(false);
  transport.hosts("local"); await settle();
  expect(workOf()?.running).toBe(true);
});

it("disconnect invalidates old reads and events; reconnect and resync use fresh snapshots", async () => {
  await start(); work("local", "a1", true);
  const old = deferred<ReturnType<ReturnType<typeof sidebarOf>>>();
  mock.responses.set("local:sidebar", () => old.promise);
  const read = store.getState().refreshSidebar(); await Promise.resolve();
  fire("daemonState", { hostId: "local", epoch: "local-1", state: { kind: "unreachable", baseUrl: "fake://local", message: "gone" } });
  work("local", "a1", false);
  const before = store.getState().sidebar;
  old.resolve(sidebarOf([["a1", "Late"]])()); await read;
  expect(store.getState().sidebar).toBe(before);
  mock.responses.set("local:sidebar", sidebarOf([["a1", "Fresh"]]));
  fire("daemonState", { hostId: "local", epoch: "local-1", state: connected("local") }); await settle();
  expect(workOf()).toBeUndefined();
  work("local", "a1", true);
  fire("hostResync", { hostId: "local", epoch: "local-1", reason: "cursor_expired" }); await settle();
  expect(workOf()).toBeUndefined();
});

it("rejects events from a replaced host epoch and handles pre-snapshot events", async () => {
  await start();
  fire("hostEvent", { hostId: "local", epoch: "local-0", envelope: cutex("a1", "cutex/session/backgroundWork/changed", { cutexSessionId: "a1", runtimeGeneration: 1, backgroundWork: { running: true } }) });
  expect(workOf()).toBeUndefined();
  store.setState({ sidebar: null });
  work("local", "a1", true);
  await store.getState().refreshSidebar();
  expect(workOf()?.running).toBe(true);
});

it("access_changed resync preserves the fresh read started by accessChanged", async () => {
  await start(); work("local", "a1", true);
  const fresh = deferred<ReturnType<ReturnType<typeof sidebarOf>>>();
  mock.responses.set("local:sidebar", () => fresh.promise);
  fire("accessChanged", { hostId: "local", epoch: "local-1", changedAt: null });
  fire("hostResync", { hostId: "local", epoch: "local-1", reason: "access_changed" });
  fresh.resolve(sidebarOf([["a1", "New permission view"]])()); await settle();
  expect(store.getState().sidebar!.active[0]!.displayName).toBe("New permission view");
  expect(workOf()).toBeUndefined();
});

it("disconnect null event clears the row and survives an old sidebar response", async () => {
  await start(); work("local", "a1", true);
  const old = deferred<ReturnType<ReturnType<typeof sidebarOf>>>();
  mock.responses.set("local:sidebar", () => old.promise);
  const read = store.getState().refreshSidebar(); await Promise.resolve();
  transport.host("local", cutex("a1", "cutex/session/backgroundWork/changed", { cutexSessionId: "a1", runtimeGeneration: 1, backgroundWork: null }));
  expect(workOf()).toBeNull();
  const stale = sidebarOf([["a1", "Alpha"]])();
  (stale.active[0]!.runtime as any).backgroundWork = { running: true };
  old.resolve(stale); await read;
  expect(workOf()).toBeNull();
});

it("shows the rows of a host's first read as they arrive, never over a whole list", async () => {
  const local = deferred<unknown>(), remote = deferred<unknown>();
  mock.responses.set("local:sidebar", () => local.promise);
  mock.responses.set(`${WORKSTATION}:sidebar`, () => remote.promise);
  const peek = (rows: [string, string][], loaded: number, total: number) => () => ({ ...sidebarOf(rows)(), partial: true, archivedPending: { count: 0 }, loading: { loaded, total } });
  mock.responses.set("local:sidebarPeek", peek([["a1", "Alpha"]], 1, 2));
  mock.responses.set(`${WORKSTATION}:sidebarPeek`, peek([["w1", "Wave"]], 1, 3));
  await start();
  expect(store.getState().sidebar).toBeNull();
  fire("sidebarProgress", { hostId: "local", epoch: "local-1", loaded: 1, total: 2 });
  fire("sidebarProgress", { hostId: WORKSTATION, epoch: `${WORKSTATION}-1`, loaded: 1, total: 3 });
  await settle();
  expect(ids(store.getState().sidebar?.active)).toEqual(["a1"]); expect(store.getState().sidebar?.loading).toEqual({ loaded: 1, total: 2 });
  expect(ids(store.getState().byHost[WORKSTATION]?.sidebar?.active)).toEqual(["w1"]);
  // Another connection's progress is not this one's.
  mock.calls.length = 0;
  fire("sidebarProgress", { hostId: "local", epoch: "local-0", loaded: 2, total: 2 });
  await settle(); expect(mock.calls.filter(c => c.method === "sidebarPeek")).toEqual([]);
  local.resolve(sidebarOf([["a1", "Alpha"], ["b2", "Beta"]])());
  await settle();
  expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2"]); expect(store.getState().sidebar?.loading).toBeUndefined();
  // A late progress / peek never replaces the whole list.
  mock.calls.length = 0;
  fire("sidebarProgress", { hostId: "local", epoch: "local-1", loaded: 2, total: 2 });
  await settle();
  expect(mock.calls.filter(c => c.method === "sidebarPeek")).toEqual([]); expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2"]);
  remote.resolve(sidebarOf([["w1", "Wave"]])());
  await settle();
  expect(store.getState().byHost[WORKSTATION]?.sidebar?.loading).toBeUndefined();
});

it("after a restart shows each host's kept list once its capabilities confirm who it is, until its own list is read", async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  const idb = new IDBFactory();
  const caps = (hostId: string, user: unknown = null) => () => ({ featureList: FEATURES, hostId, user, cutexBuild: null });
  mock.responses.set("local:capabilities", caps("HOST-A"));
  mock.responses.set(`${WORKSTATION}:capabilities`, caps("WORKSTATION"));
  (await import("../src/renderer/src/lib/sidebarCache")).setSidebarCacheFactory(idb);
  await start();
  await vi.advanceTimersByTimeAsync(11_000); await settle();
  // Restart: a new renderer whose hosts are slow to list their agents.
  vi.resetModules(); mock.listeners.clear();
  const local = deferred<unknown>(), remote = deferred<unknown>();
  mock.responses.set("local:sidebar", () => local.promise);
  mock.responses.set(`${WORKSTATION}:sidebar`, () => remote.promise);
  mock.responses.set(`${WORKSTATION}:capabilities`, caps("WORKSTATION", { id: "guest", isOwner: false }));
  store = (await import("../src/renderer/src/store")).useApp;
  (await import("../src/renderer/src/lib/sidebarCache")).setSidebarCacheFactory(idb);
  await start();
  for (let i = 0; i < 5; i++) await settle();
  const shown = store.getState().sidebar;
  expect(ids(shown?.active)).toEqual(["a1", "b2"]); expect(shown?.cached).toBe(true); expect(shown?.partial).toBe(true);
  // The workstation connection is someone else now: its kept list is not shown.
  expect(store.getState().byHost[WORKSTATION]?.sidebar ?? null).toBeNull();
  // Progress moves the kept list's counter, never replaces it with a peek.
  mock.calls.length = 0;
  fire("sidebarProgress", { hostId: "local", epoch: "local-1", loaded: 1, total: 2 });
  await settle();
  expect(mock.calls.filter(c => c.method === "sidebarPeek")).toEqual([]);
  expect(store.getState().sidebar?.loading).toEqual({ loaded: 1, total: 2 }); expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2"]);
  local.resolve(sidebarOf([["a1", "Alpha"], ["c3", "Gamma"]])());
  await settle();
  expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "c3"]); expect(store.getState().sidebar?.cached).toBeUndefined();
  remote.resolve(sidebarOf([["w1", "Wave"]])()); await settle();
});
