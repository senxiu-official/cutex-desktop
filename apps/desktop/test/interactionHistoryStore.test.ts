// Saved answered questions / approvals (session-interaction-history-v1) with the real store and a per-host fake
// bridge (harness from busHydrationLifecycle.test.ts): only hosts with the feature are read; the shown 回合 are read
// on load and the paged-in ones on loadOlder, 50 turn ids a read, every cursor followed, each 回合 once per
// timeline; a late result never lands in a rebuilt timeline; a failed read leaves the history; a reply here and the
// saved record converge to one row.
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


const T = (id: string) => ({ id, status: "completed", items: [{ type: "agentMessage", id: `m-${id}`, text: id }] });
const COMMAND = (id: number | string, turnId: string) => ({ id, method: "item/commandExecution/requestApproval", params: { kind: "command", threadId: "thread-a1", turnId, itemId: `m-${turnId}`, startedAtMs: 0, environmentId: null, command: "ls", cwd: "/w", reason: null, availableDecisions: ["accept", "decline"] } });
const saved = (id: number | string, turnId: string, over: Record<string, unknown> = {}) => ({ runtimeGeneration: 1, native: COMMAND(id, turnId), turnId, result: { decision: "decline" }, actor: { kind: "owner" }, answeredAt: "2026-11-25T06:30:00Z", redactedQuestionIds: [], ...over });
const page = (interactions: unknown[], nextCursor: string | null = null) => ({ contractVersion: 2, cutexSessionId: "a1", interactions, nextCursor });

function configure(turns: string[], opts: { feature?: boolean; older?: boolean; pending?: unknown[] } = {}) {
  mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "history-pages", ...(opts.feature === false ? [] : ["session-interaction-history-v1"])] }));
  mock.responses.set("bootstrap", () => ({
    native: { result: { thread: { id: "thread-a1", turns: turns.map(T) } } },
    historyPage: opts.older ? { limit: turns.length, nextCursor: "h1", hasMore: true } : { limit: turns.length, nextCursor: null, hasMore: false },
    checkpoint: { streamId: "s", cursor: 0 },
    cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: opts.pending ?? [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
  }));
  mock.responses.set("history", () => ({ native: { result: { thread: { id: "thread-a1", turns: [T("old1")] } } }, page: { limit: 1, nextCursor: null, hasMore: false } }));
}
const historyCalls = () => mock.calls.filter((c) => c.method === "interactionHistoryPage").map((c) => c.args[1] as { turnIds: string[]; cursor: string | null });
const rows = () => {
  const timeline = store.getState().sessions[viewKey("local", "a1")]?.timeline;
  return timeline ? [...timeline.entries.values()].filter((e) => e.kind === "interaction") : [];
};
const turnOf = (turnId: string) => store.getState().sessions[viewKey("local", "a1")]!.timeline.turns.find((t) => t.id === turnId)!.entryIds;

it("reads nothing on a host without the feature (today's behaviour)", async () => {
  configure(["t1"], { feature: false });
  mock.responses.set("interactionHistoryPage", () => page([saved(7, "t1")]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  expect(historyCalls()).toEqual([]);
  expect(rows()).toEqual([]);
});

it("puts each saved row once in its own 回合 after its item, following the cursor", async () => {
  configure(["t1", "t2"]);
  mock.responses.set("interactionHistoryPage", (_id, q) => {
    const { cursor } = q as { cursor: string | null };
    return cursor ? page([saved(8, "t1", { answeredAt: "2026-11-25T06:00:00Z" })]) : page([saved(7, "t2"), saved(7, "t2")], "c2");
  });
  await start();
  await store.getState().select("a1", "local");
  await settle();
  expect(historyCalls()).toEqual([{ turnIds: ["t1", "t2"], cursor: null, limit: 50 }, { turnIds: ["t1", "t2"], cursor: "c2", limit: 50 }]);
  expect(rows()).toHaveLength(2);
  expect(turnOf("t2")).toEqual(["m-t2", 'interaction:[1,7]']);
  expect(turnOf("t1")).toEqual(["m-t1", 'interaction:[1,8]']);
  // Rendering again / selecting again reads nothing more for the same timeline.
  await store.getState().select("a1", "local");
  await settle();
  expect(historyCalls()).toHaveLength(2);
});

it("reads 50 turn ids at a time, and the paged-in 回合 on loadOlder only", async () => {
  const turns = Array.from({ length: 60 }, (_, i) => `t${i}`);
  configure(turns, { older: true });
  mock.responses.set("interactionHistoryPage", () => page([]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  expect(historyCalls().map((q) => q.turnIds.length)).toEqual([50, 10]);
  mock.responses.set("interactionHistoryPage", () => page([saved(5, "old1")]));
  await store.getState().loadOlder("a1");
  await settle();
  expect(historyCalls().slice(2).map((q) => q.turnIds)).toEqual([["old1"]]);
  expect(turnOf("old1")).toEqual(["m-old1", 'interaction:[1,5]']);
});

it("drops a late result after a reload, and a failed read leaves the history", async () => {
  configure(["t1"]);
  let release!: (value: unknown) => void;
  mock.responses.set("interactionHistoryPage", () => new Promise((resolve) => { release = resolve; }));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  const first = release;
  // Reload (resync): a new timeline; its read fails.
  mock.responses.set("interactionHistoryPage", () => { throw new Error("history store unavailable"); });
  await store.getState().reloadSession("a1", "local");
  await settle();
  first(page([saved(7, "t1")]));
  await settle();
  expect(rows()).toEqual([]);
  expect(turnOf("t1")).toEqual(["m-t1"]);
  expect(store.getState().sessions[viewKey("local", "a1")]?.error ?? null).toBeNull();
});

it("a reply here and its saved record converge to one row, upgraded in place", async () => {
  configure(["t1"], { pending: [{ runtimeGeneration: 1, native: COMMAND(7, "t1") }] });
  mock.responses.set("interactionHistoryPage", () => page([]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  // cutex commits the saved record only after the second refresh (the first read still finds nothing).
  let reads = 0;
  mock.responses.set("interactionHistoryPage", () => (++reads >= 2 ? page([saved(7, "t1")]) : page([])));
  await store.getState().respond(7, { result: { decision: "decline" } }, "a1", "local");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(rows().map((e) => e.kind === "interaction" && e.record.saved)).toEqual([undefined]);
  await vi.advanceTimersByTimeAsync(5000);
  await settle();
  expect(reads).toBe(2);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.kind === "interaction" && rows()[0]!.record.saved).toBe(true);
  expect(turnOf("t1")).toEqual(["m-t1", 'interaction:[1,7]']);
});

it("review 2026-11-25: reopening archived history restores already cached saved rows", async () => {
  configure(["t1"]);
  mock.responses.set("capabilities", () => ({featureList: [...FEATURES, "offline-history", "history-pages", "session-interaction-history-v1"]}));
  mock.responses.set("local:sidebar", () => ({ active: [], retired: [{...resource("a1", "Alpha"), lifecycle: "retired"}], projects: null, hostRows: {a1: {projectId: null}} }));
  mock.responses.set("history", () => ({native: {result: {thread: {id: "thread-a1", turns: [T("t1")]}}}, page: {limit: 1, hasMore: false, nextCursor: null}}));
  mock.responses.set("interactionHistoryPage", () => page([saved(7, "t1")]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  expect(rows()).toHaveLength(1);
  await store.getState().reloadSession("a1", "local");
  await settle();
  expect(historyCalls()).toHaveLength(2);
  expect(rows()).toHaveLength(1);
});

it("review 2026-11-25: a current request reusing an old generation id does not hide the old saved answer", async () => {
  configure(["t1", "t2"], {pending: [{runtimeGeneration: 2, native: COMMAND(7, "t2")}]});
  const initialBootstrap = mock.responses.get("bootstrap")!;
  mock.responses.set("bootstrap", (...args) => {
    const boot = initialBootstrap(...args) as any;
    boot.cutexState.runtime.runtimeGeneration = 2;
    return boot;
  });
  mock.responses.set("interactionHistoryPage", () => page([saved(7, "t1")]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  expect(store.getState().sessions[viewKey("local", "a1")]!.timeline.pending.has("7")).toBe(true);
  expect(rows()).toHaveLength(1);
});

it("review 2026-11-25: losing a reply race refreshes the answer saved by the other client", async () => {
  configure(["t1"], {pending: [{runtimeGeneration: 1, native: COMMAND(7, "t1")}]});
  mock.responses.set("interactionHistoryPage", () => page([]));
  await start();
  await store.getState().select("a1", "local");
  await settle();
  mock.responses.set("respond", () => {
    mock.responses.set("interactionHistoryPage", () => page([saved(7, "t1", {actor: {kind: "user", userId: "u1", name: "Other"}})]));
    fire("sessionEvent", {hostId: "local", sessionId: "a1", envelope: resolved("a1", 7)});
    throw new Error("server_request_resolved: another client already answered");
  });
  await store.getState().respond(7, {result: {decision: "accept"}}, "a1", "local");
  await vi.advanceTimersByTimeAsync(10000);
  await settle();
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.kind === "interaction" && rows()[0]!.record.saved).toBe(true);
});
