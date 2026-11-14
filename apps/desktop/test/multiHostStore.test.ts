// Multi-host P0 (docs/research/multi-host-rfc-20261009.md §6): the app shows one host (the focus) while
// other auto-connect hosts stay connected. Their attention (approvals, owner notes, waiting agents)
// and notifications keep working; switching the focus keeps both hosts' state; a host's reconnect or
// disconnect resets only that host. Runs the real store and sub-stores against a per-host fake bridge.
import { pendingTail, newOutboxEntry, confirmOutbox } from "../src/renderer/src/lib/legacyDelivery/outbox";
import observedInsertEvents from "./fixtures/r271-insert-items.json";
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

describe("a connected host outside the scope", () => {
  it("is followed through its own connection: counts, not the shown host's state", async () => {
    await start();
    const s = store.getState();
    expect(s.hosts?.active).toBe("local");
    expect(ids(s.sidebar?.active)).toEqual(["a1", "b2"]);
    expect(s.approvals?.map((a) => a.approvalId)).toEqual(["apr-1"]);
    const slice = s.byHost[WORKSTATION]!;
    expect(slice.epoch).toBe(`${WORKSTATION}-1`);
    expect(slice.daemon).toMatchObject({ kind: "connected" });
    expect(ids(slice.sidebar?.active)).toEqual(["w1"]);
    expect(slice.approvals?.map((a) => a.approvalId)).toEqual(["apr-t1"]);
    expect(Object.keys(s.byHost)).toEqual([WORKSTATION]);
    // Every call for workstation went through its own binding, none through the focus api.
    expect(mock.calls.filter((c) => c.host === WORKSTATION).map((c) => c.method).sort()).toEqual(["approvals", "capabilities", "daemonState", "ownerNotifications", "services", "sidebar"]);
    expect(Object.keys(notes.useOwnerNotify.getState().byId)).toEqual([]);
    expect(Object.keys(notes.useOwnerNotify.getState().others[WORKSTATION] ?? {})).toEqual(["ntf-t1"]);
    // local approval + workstation approval + workstation owner note
    expect(shell.appAttention()).toBe(3);
  });

  it("its approval requests, waiting agents and owner notes count and notify with the host's name; a click shows that host", async () => {
    await start();
    const focusSidebar = store.getState().sidebar;
    transport.host(WORKSTATION, cutex("cutex.host", "cutex/approvals/changed", { reason: "requested", approval: approval("apr-t2", "w1") }));
    expect(store.getState().byHost[WORKSTATION]!.approvals?.map((a) => a.approvalId).sort()).toEqual(["apr-t1", "apr-t2"]);
    expect(store.getState().approvals?.map((a) => a.approvalId)).toEqual(["apr-1"]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ key: "approval:apr-t2", hostId: WORKSTATION, agentId: "w1", agentName: "Wave" });
    expect(occurrences[0]!.title.startsWith("workstation · ")).toBe(true);
    expect(shell.appAttention()).toBe(4);

    transport.host(WORKSTATION, request("w1", 5, "item/commandExecution/requestApproval"));
    expect(store.getState().byHost[WORKSTATION]!.waiting).toEqual({ w1: ["5"] });
    expect(occurrences[1]).toMatchObject({ key: "req:w1:5", hostId: WORKSTATION, events: ["native.approval"], title: "workstation · Wave" });
    expect(shell.appAttention()).toBe(5);
    transport.host(WORKSTATION, resolved("w1", 5));
    expect(store.getState().byHost[WORKSTATION]!.waiting).toEqual({});
    expect(shell.appAttention()).toBe(4);

    transport.host(WORKSTATION, cutex("w1", "cutex/ownerNotify/created", { notification: note("ntf-t2", "w1") }));
    expect(Object.keys(notes.useOwnerNotify.getState().others[WORKSTATION]!).sort()).toEqual(["ntf-t1", "ntf-t2"]);
    expect(Object.keys(notes.useOwnerNotify.getState().byId)).toEqual([]);
    const ownerNote = occurrences.find((o) => o.key === "owner-notify:ntf-t2")!;
    expect(ownerNote).toMatchObject({ hostId: WORKSTATION, looking: false });
    expect(ownerNote.title.startsWith("workstation · ")).toBe(true);
    expect(shell.appAttention()).toBe(5);

    // Per host (needs-you 「其他主机 N 项」 = the hosts outside the scope).
    expect(shell.attentionByHost()).toEqual({ local: 1, [WORKSTATION]: 4 });

    // The shown host's view is untouched by the other host's feed.
    expect(store.getState().sidebar).toBe(focusSidebar);
    mock.calls.length = 0;
    // An approval of a host outside the scope: show 所有设备 (the merged 审批 page), not that host alone (RFC ★ Q14).
    occurrences[0]!.onClick!();
    await settle();
    expect(mock.calls.filter((c) => c.method === "switchHost")).toEqual([]);
    expect(mock.calls.filter((c) => c.method === "setScope").map((c) => [c.host, c.args])).toEqual([["local", [{ kind: "all" }]]]);
    // An agent's notification opens that agent on its host inside 所有设备 (the focus stays put).
    mock.calls.length = 0;
    occurrences[1]!.onClick!();
    await settle();
    expect(mock.calls.filter((c) => c.method === "switchHost")).toEqual([]);
    expect(mock.calls.filter((c) => c.method === "setScope").map((c) => [c.host, c.args])).toEqual([["local", [{ kind: "all" }]]]);
  });
});

describe("an agent of a host other than the focus (multi-host sidebar, P1 2a)", () => {
  beforeEach(() => {
    mock.responses.set("bootstrap", () => ({
      native: null,
      historyPage: null,
      checkpoint: { streamId: "s", cursor: 0 },
      cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
    }));
  });
  function allDevices(): void {
    const state = hostsState("local");
    fire("hostsState", { ...state, scope: { kind: "all" } });
  }

  it("opens through that host's binding; its events reach the view, the focus host's same id does not", async () => {
    await start();
    allDevices();
    await settle();
    mock.calls.length = 0;
    await store.getState().select("w1", WORKSTATION);
    await settle();
    const s = store.getState();
    expect(s.selectedId).toBe("w1");
    expect(s.selectedHost).toBe(WORKSTATION);
    expect(s.hosts?.active).toBe("local");
    // Every session call of the open went to workstation.
    const sessionCalls = mock.calls.filter((c) => (c.args[0] as unknown) === "w1");
    expect(sessionCalls.length).toBeGreaterThan(0);
    expect(sessionCalls.every((c) => c.host === WORKSTATION)).toBe(true);
    expect(sessionCalls.map((c) => c.method)).toContain("subscribe");
    // An event of the same id from the focus host is not this view's.
    const before = store.getState().sessions[viewKey(WORKSTATION, "w1")];
    expect(before).toBeDefined();
    fire("sessionStatus", { hostId: "local", epoch: "local-1", sessionId: "w1", status: "retrying" });
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]).toBe(before);
    fire("sessionStatus", { hostId: WORKSTATION, epoch: `${WORKSTATION}-1`, sessionId: "w1", status: "retrying" });
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]?.connection).toBe("retrying");
  });

  // Panes step 1c: views are keyed by host + id (lib/viewKey), so the same id on two hosts keeps two views.
  const BOOT = () => ({ native: null, historyPage: null, checkpoint: { streamId: "s", cursor: 0 }, cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] } });
  it("the same session id on two hosts keeps two views: opening one neither replaces nor evicts the other's", async () => {
    mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["a1", "Workstation Alpha"]]));
    mock.responses.set("bootstrap", BOOT);
    await start();
    allDevices();
    await settle();
    await store.getState().select("a1", "local");
    await settle();
    const local = store.getState().sessions[viewKey("local", "a1")];
    expect(local?.loading).toBe(false);
    mock.calls.length = 0;
    await store.getState().select("a1", WORKSTATION);
    await settle();
    let s = store.getState();
    expect(s.selectedHost).toBe(WORKSTATION);
    // The local view stays cached as it was; the workstation one is its own.
    expect(s.sessions[viewKey("local", "a1")]).toBe(local);
    const remote = s.sessions[viewKey(WORKSTATION, "a1")];
    expect(remote).toBeDefined();
    expect(remote).not.toBe(local);
    expect(mock.calls.filter((c) => c.method === "bootstrap").map((c) => c.host)).toEqual([WORKSTATION]);
    // An event of the local agent does not touch the workstation view (and vice versa).
    fire("sessionStatus", { hostId: "local", epoch: "local-1", sessionId: "a1", status: "retrying" });
    expect(store.getState().sessions[viewKey(WORKSTATION, "a1")]).toBe(remote);
    // Back to the local agent: its cached view shows at once (no "loading history").
    await store.getState().select("a1", "local");
    s = store.getState();
    expect(s.sessions[viewKey("local", "a1")]?.loading).toBe(false);
    expect(s.sessions[viewKey(WORKSTATION, "a1")]).toBeDefined();
  });

  it("retainView keys the live view by host; another host's agent with the same id keeps its own", async () => {
    mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["w1", "Wave"], ["b2", "Workstation Beta"]]));
    mock.responses.set("bootstrap", BOOT);
    await start();
    allDevices();
    await settle();
    await store.getState().select("w1", WORKSTATION);
    await settle();
    mock.calls.length = 0;
    const release = store.getState().retainView(WORKSTATION, "b2");
    await settle();
    expect(store.getState().views).toEqual({ [viewKey(WORKSTATION, "b2")]: { hostId: WORKSTATION, sessionId: "b2", visible: false } });
    expect(mock.calls.filter((c) => c.method === "subscribe").map((c) => [c.host, c.args[0]])).toEqual([[WORKSTATION, "b2"]]);
    expect(store.getState().sessions[viewKey(WORKSTATION, "b2")]).toBeDefined();
    expect(store.getState().sessions[viewKey("local", "b2")]).toBeUndefined();
    release();
    await settle();
    expect(store.getState().views).toEqual({});
    expect(mock.calls.filter((c) => c.method === "unsubscribe").map((c) => [c.host, c.args[0]])).toEqual([[WORKSTATION, "b2"]]);
    expect(store.getState().sessions[viewKey(WORKSTATION, "b2")]).toBeUndefined();
  });

  // 2026-10-13 (host-a): a Workstation agent opened from a link in a Workstation agent's timeline (delegation card,
  // party name: `select(id)` without a host) went to the focus host, whose cutex answered 404
  // session_not_found "the owner-visible cutex session does not exist on this host".
  it("opened without a host (timeline links), it goes to the host that lists it, not the focus host", async () => {
    await start();
    allDevices();
    await settle();
    mock.responses.set("local:bootstrap", () => Promise.reject(new Error("session_not_found: the owner-visible cutex session does not exist on this host")));
    mock.calls.length = 0;
    await store.getState().select("w1");
    await settle();
    const s = store.getState();
    expect(s.selectedHost).toBe(WORKSTATION);
    expect(s.sessions[viewKey(WORKSTATION, "w1")]?.error).toBeNull();
    const sessionCalls = mock.calls.filter((c) => (c.args[0] as unknown) === "w1");
    expect(sessionCalls.map((c) => c.method)).toContain("bootstrap");
    expect(sessionCalls.every((c) => c.host === WORKSTATION)).toBe(true);
  });

  it("a wrong explicit host is corrected when only another host of the scope lists the agent; its own host wins otherwise", async () => {
    await start();
    allDevices();
    await settle();
    mock.calls.length = 0;
    await store.getState().select("w1", "local");
    await settle();
    expect(store.getState().selectedHost).toBe(WORKSTATION);
    expect(mock.calls.filter((c) => c.method === "bootstrap").map((c) => [c.host, c.args[0]])).toEqual([[WORKSTATION, "w1"]]);
    // Listed by the given host: stays there. Listed by nobody (just created): the given host.
    await store.getState().select("a1", "local");
    await settle();
    expect(store.getState().selectedHost).toBe("local");
    await store.getState().select("new-1", WORKSTATION);
    await settle();
    expect(store.getState().selectedHost).toBe(WORKSTATION);
  });

  it("outside 所有设备 an agent of the followed host is not re-routed (openAgent widens the scope instead)", async () => {
    await start();
    mock.calls.length = 0;
    await store.getState().select("w1");
    await settle();
    expect(store.getState().selectedHost).toBe("local");
  });

  it("重新加载 after a failed load reads it from the host that lists it now", async () => {
    await start();
    allDevices();
    // workstation' snapshot has not arrived yet: nobody lists w1, so it opens on the focus host and fails there.
    mock.responses.set(`${WORKSTATION}:sidebar`, () => new Promise(() => {}));
    epochs[WORKSTATION]!++;
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
    await settle();
    mock.responses.set("local:bootstrap", () => Promise.reject(new Error("session_not_found: the owner-visible cutex session does not exist on this host")));
    await store.getState().select("w1");
    await settle();
    expect(store.getState().selectedHost).toBe("local");
    expect(store.getState().sessions[viewKey("local", "w1")]?.error).toMatch(/^session_not_found/);
    // Its snapshot arrives; 重新加载 moves the view to workstation.
    mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["w1", "Wave"]]));
    await store.getState().refreshHostSidebar(WORKSTATION);
    await settle();
    mock.calls.length = 0;
    await store.getState().reloadSession("w1");
    await settle();
    const s = store.getState();
    expect(s.selectedId).toBe("w1");
    expect(s.selectedHost).toBe(WORKSTATION);
    expect(s.sessions[viewKey(WORKSTATION, "w1")]?.error).toBeNull();
    expect(mock.calls.filter((c) => c.method === "bootstrap").map((c) => c.host)).toEqual([WORKSTATION]);
    expect(mock.calls.filter((c) => c.method === "unsubscribe").map((c) => [c.host, c.args[0]])).toEqual([["local", "w1"]]);
  });

  it("重新加载 on the right host reads it again from that host", async () => {
    await start();
    allDevices();
    await settle();
    let fail = true;
    mock.responses.set(`${WORKSTATION}:bootstrap`, () => (fail ? Promise.reject(new Error("cutex management API unreachable")) : { native: null, historyPage: null, checkpoint: { streamId: "s", cursor: 0 }, cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] } }));
    await store.getState().select("w1", WORKSTATION);
    await settle();
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]?.error).toMatch(/unreachable/);
    fail = false;
    mock.calls.length = 0;
    await store.getState().reloadSession("w1");
    await settle();
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]?.error).toBeNull();
    expect(mock.calls.filter((c) => c.method === "bootstrap").map((c) => c.host)).toEqual([WORKSTATION]);
  });

  it("a scope that no longer holds its host closes it and unsubscribes on that host", async () => {
    await start();
    allDevices();
    await settle();
    await store.getState().select("w1", WORKSTATION);
    await settle();
    mock.calls.length = 0;
    transport.hosts("local");
    await settle();
    expect(store.getState().selectedId).toBeNull();
    expect(mock.calls.filter((c) => c.method === "unsubscribe").map((c) => [c.host, c.args[0]])).toEqual([[WORKSTATION, "w1"]]);
  });

  it("a reconnect of its host closes it; openAgent outside the scope widens it to 所有设备", async () => {
    await start();
    allDevices();
    await settle();
    await store.getState().select("w1", WORKSTATION);
    await settle();
    epochs[WORKSTATION]!++;
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
    await settle();
    expect(store.getState().selectedId).toBeNull();
    // Back to one host: opening workstation' agent asks for 所有设备 first.
    transport.hosts("local");
    await settle();
    mock.calls.length = 0;
    void store.getState().openAgent("w1", WORKSTATION);
    await settle();
    expect(mock.calls.filter((c) => c.method === "setScope").map((c) => c.args)).toEqual([[{ kind: "all" }]]);
    expect(mock.calls.filter((c) => c.method === "switchHost")).toEqual([]);
  });
});

describe("switching the focus between connected hosts", () => {
  it("the old focus becomes a followed host and the new one is taken over: both hosts' counts stay", async () => {
    await start();
    transport.host(WORKSTATION, request("w1", 7, "item/commandExecution/requestApproval"));
    expect(shell.appAttention()).toBe(4);
    mock.calls.length = 0;
    transport.hosts(WORKSTATION);
    let s = store.getState();
    expect(s.hosts?.active).toBe(WORKSTATION);
    // Taken over from its slice (same connection): no reload needed to show its counts.
    expect(ids(s.sidebar?.active)).toEqual(["w1"]);
    expect(s.approvals?.map((a) => a.approvalId)).toEqual(["apr-t1"]);
    // Its features (they start the sub-stores' loads) follow once the notification is delivered.
    await Promise.resolve();
    expect(store.getState().featuresKnown).toBe(true);
    expect(Object.keys(s.byHost)).toEqual(["local"]);
    expect(s.byHost.local!.approvals?.map((a) => a.approvalId)).toEqual(["apr-1"]);
    expect(ids(s.byHost.local!.sidebar?.active)).toEqual(["a1", "b2"]);
    expect(Object.keys(notes.useOwnerNotify.getState().byId)).toEqual(["ntf-t1"]);
    await settle();
    s = store.getState();
    // local apr-1 + workstation apr-t1 + workstation note + the waiting request: taken over with the focus,
    // it still counts from the host feed although no timeline of it is open here (r244 issue 3).
    expect(store.getState().hostWaiting).toEqual({ w1: ["item/commandExecution/requestApproval"] });
    expect(shell.appAttention()).toBe(4);
    // The old focus keeps notifying, now with its name.
    transport.host("local", cutex("cutex.host", "cutex/approvals/changed", { reason: "requested", approval: approval("apr-2", "a1") }));
    expect(store.getState().byHost.local!.approvals?.map((a) => a.approvalId).sort()).toEqual(["apr-1", "apr-2"]);
    expect(occurrences.at(-1)).toMatchObject({ key: "approval:apr-2", hostId: "local" });
    expect(occurrences.at(-1)!.title.startsWith("HOST-A · ")).toBe(true);
    expect(shell.appAttention()).toBe(5);
    // And back: local is taken over again with what it gathered meanwhile; workstation' still pending
    // request (followed on its feed all along) counts again from the host feed.
    transport.hosts("local");
    expect(store.getState().approvals?.map((a) => a.approvalId).sort()).toEqual(["apr-1", "apr-2"]);
    expect(store.getState().byHost[WORKSTATION]!.approvals?.map((a) => a.approvalId)).toEqual(["apr-t1"]);
    expect(store.getState().byHost[WORKSTATION]!.waiting).toEqual({ w1: ["7"] });
    expect(shell.appAttention()).toBe(5);
  });
});

describe("one host's connection changes", () => {
  it("a reconnect of the followed host starts only that host over", async () => {
    await start();
    transport.host(WORKSTATION, request("w1", 5, "item/commandExecution/requestApproval"));
    const focus = store.getState();
    epochs[WORKSTATION]!++;
    transport.hosts("local");
    const s = store.getState();
    expect(s.sidebar).toBe(focus.sidebar);
    expect(s.approvals).toBe(focus.approvals);
    expect(s.byHost[WORKSTATION]!.epoch).toBe(`${WORKSTATION}-2`);
    expect(s.byHost[WORKSTATION]!.waiting).toEqual({});
    expect(s.byHost[WORKSTATION]!.featuresKnown).toBe(false);
    expect(notes.useOwnerNotify.getState().others[WORKSTATION]).toBeUndefined();
    await settle();
    expect(store.getState().byHost[WORKSTATION]!.approvals?.map((a) => a.approvalId)).toEqual(["apr-t1"]);
    expect(shell.appAttention()).toBe(3);
  });

  it("a closed connection takes the host's counts with it", async () => {
    await start();
    expect(shell.appAttention()).toBe(3);
    transport.hosts("local", ["local"]);
    expect(store.getState().byHost).toEqual({});
    expect(notes.useOwnerNotify.getState().others[WORKSTATION]).toBeUndefined();
    expect(shell.appAttention()).toBe(1);
    // Late events of the closed connection are not followed.
    transport.host(WORKSTATION, cutex("cutex.host", "cutex/approvals/changed", { reason: "requested", approval: approval("apr-t9", "w1") }));
    expect(occurrences).toEqual([]);
    expect(shell.appAttention()).toBe(1);
  });
});

describe("host-keyed pins (one-time migration)", () => {
  it("a legacy pin belongs to the first host whose sidebar lists it; each host shows its own", async () => {
    storage.set("cutex-desktop.pinned", JSON.stringify(["a1", "w1", "gone"]));
    await start();
    // local claimed a1, workstation claimed w1; "gone" stays legacy (shown everywhere) until it expires.
    expect(JSON.parse(storage.get("cutex-desktop.pinned")!).sort()).toEqual([JSON.stringify(["local", "a1"]), JSON.stringify([WORKSTATION, "w1"]), "gone"].sort());
    expect([...store.getState().pinned].sort()).toEqual(["a1", "gone"]);
    transport.hosts(WORKSTATION);
    expect([...store.getState().pinned].sort()).toEqual(["gone", "w1"]);
    store.getState().togglePin("w1");
    expect([...store.getState().pinned]).toEqual(["gone"]);
    transport.hosts("local");
    expect([...store.getState().pinned].sort()).toEqual(["a1", "gone"]);
  });
});

describe("owner rotation events (cutex/ownerRotation/updated)", () => {
  it("are kept under the host they came from; only the shown host's own event reloads its sidebar", async () => {
    mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "owner-rotation"], cutexBuild: { version: "0.1.0", release: "r219", commit: null, builtAt: null, profile: "release", channel: "main" } }));
    mock.responses.set("directorRotations", () => []);
    await start();
    const rotations = await import("../src/renderer/src/modules/projects/rotationStore");
    await rotations.loadProjectRotation("p1");
    expect(rotations.useRotations.getState().byProject).toEqual({ "local p1": null });
    const rotation = (id: string) => ({ rotationId: id, projectId: "p1", state: "done", revision: 1, createdAt: "2026-10-10T10:00:00Z" });
    mock.calls.length = 0;
    transport.host(WORKSTATION, cutex("cutex.host", "cutex/ownerRotation/updated", { rotation: rotation("rot-t") }));
    expect(rotations.useRotations.getState().byProject[`${WORKSTATION} p1`]).toMatchObject({ rotationId: "rot-t" });
    expect(rotations.useRotations.getState().byProject["local p1"]).toBeNull();
    await settle();
    // workstation' sidebar follows its own feed; the shown host's is not reloaded.
    expect(mock.calls.filter((c) => c.method === "sidebar").map((c) => c.host)).toEqual([WORKSTATION]);
    transport.host("local", cutex("cutex.host", "cutex/ownerRotation/updated", { rotation: rotation("rot-l") }));
    expect(rotations.useRotations.getState().byProject["local p1"]).toMatchObject({ rotationId: "rot-l" });
    await settle();
    expect(mock.calls.filter((c) => c.method === "sidebar").map((c) => c.host)).toContain("local");
  });
});

describe("runtime recovery after an offline-start conflict", () => {
  const error = "runtime generation changed; reload the session before retrying";
  const queued = (queueId: string) => ({ queueId, revision: 1, position: 0, input: [], state: "queued" });
  const boot = () => ({ native: null, historyPage: null, checkpoint: { streamId: "s", cursor: 0 }, cutexState: { runtime: { runtimeGeneration: 3 }, userInputQueue: [queued("q1")], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] } });
  const snapshot = (id: string, status = "offline", generation = 3) => ({ ...sidebarOf([[id, id]])(), active: [{ ...resource(id, id), runtime: { ...resource(id, id).runtime, status, runtimeGeneration: generation, appServerConnected: status === "online" } }] });
  const sessionEvent = (id: string, event: EventEnvelope, hostId = "local") => fire("sessionEvent", { hostId, sessionId: id, envelope: event });
  const failed = (id = "a1") => cutex(id, "cutex/userInput/startFailed", { error: { message: error }, queueIds: ["q1"] });
  const started = (id = "a1", generation = 3, threadId = `thread-${id}`) => envelope(id, {
    source: "app_server", correlation: { runtimeGeneration: generation },
    native: { kind: "notification", message: { method: "turn/started", params: { threadId, turn: { id: "t-new", status: "inProgress", items: [] } } } },
  } as Partial<EventEnvelope>);

  beforeEach(() => {
    mock.responses.set("bootstrap", boot);
    mock.responses.set("queueList", () => ({ items: [queued("q1")] }));
    mock.responses.set("local:sidebar", () => snapshot("a1"));
    mock.responses.set(`${WORKSTATION}:sidebar`, () => snapshot("w1"));
  });
  async function open() { await start(); await store.getState().select("a1", "local"); await settle(); }

  it("clears a startup failure when the current runtime starts a turn", async () => {
    await open();
    sessionEvent("a1", failed());
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
    sessionEvent("a1", started());
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBeNull();
  });

  it("does not let a replayed old-generation turn lower the runtime fence or dismiss a current failure", async () => {
    await open();
    sessionEvent("a1", failed());
    sessionEvent("a1", started("a1", 2));
    expect(store.getState().sessions[viewKey("local", "a1")]?.runtimeGeneration).toBe(3);
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
  });

  it("a child turn does not dismiss the parent's startup failure", async () => {
    await open();
    const view = store.getState().sessions[viewKey("local", "a1")]!;
    view.timeline.threadId = "thread-a1";
    sessionEvent("a1", failed());
    sessionEvent("a1", started("a1", 3, "child-thread"));
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
  });

  it.each(["cutex/runtime/online", "cutex/runtime/onlineRequested"])("clears failure on %s", async (method) => {
    await open();
    sessionEvent("a1", failed());
    sessionEvent("a1", { ...cutex("a1", method, {}), correlation: { runtimeGeneration: 4 } });
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBeNull();
  });

  it("a late failure without a generation rechecks runtime state and clears when another launch already succeeded", async () => {
    await open();
    mock.responses.set("local:sidebar", () => snapshot("a1", "online", 4));
    sessionEvent("a1", failed());
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBeNull();
    expect(store.getState().sidebar?.active[0]?.runtime.status).toBe("online");
  });

  it("keeps an actual failure when its runtime remains offline and its input remains queued", async () => {
    await open();
    sessionEvent("a1", failed());
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
    expect(store.getState().sessions[viewKey("local", "a1")]?.queue.map((q) => q.queueId)).toEqual(["q1"]);
    expect(mock.calls.filter((c) => c.method === "sessionAction" || c.method === "submitInput")).toEqual([]);
  });

  it.each([{ items: [] }, { items: [queued("q2")] }])("does not say the failed input is still queued after it leaves: %j", async ({ items }) => {
    await open();
    sessionEvent("a1", failed());
    await settle();
    mock.responses.set("queueList", () => ({ items }));
    sessionEvent("a1", cutex("a1", "cutex/userInput/removed", {}));
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBeNull();
  });

  it("reconciles on the agent's own host, leaving the focus host alone", async () => {
    await start();
    const hosts = hostsState("local");
    fire("hostsState", { ...hosts, scope: { kind: "all" } });
    await settle();
    await store.getState().select("w1", WORKSTATION);
    mock.calls.length = 0;
    mock.responses.set(`${WORKSTATION}:sidebar`, () => snapshot("w1", "online", 4));
    sessionEvent("w1", failed("w1"), WORKSTATION);
    await settle();
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]?.startError).toBeNull();
    expect(store.getState().byHost[WORKSTATION]?.sidebar?.active[0]?.runtime.status).toBe("online");
    expect(mock.calls.filter((c) => c.method === "sidebar").map((c) => c.host)).toEqual([WORKSTATION]);
  });

  it.each(["local", WORKSTATION])("ignores a stale sidebar reply arriving after recovery on %s", async (host) => {
    await open();
    const id = host === "local" ? "a1" : "w1";
    let finish!: (v: ReturnType<typeof snapshot>) => void;
    mock.responses.set(`${host}:sidebar`, () => new Promise((resolve) => { finish = resolve; }));
    const older = store.getState().refreshHostSidebar(host);
    await Promise.resolve();
    mock.responses.set(`${host}:sidebar`, () => snapshot(id, "online", 4));
    await store.getState().refreshHostSidebar(host);
    finish(snapshot(id, "offline", 3));
    await older;
    const sidebar = host === "local" ? store.getState().sidebar : store.getState().byHost[host]?.sidebar;
    expect(sidebar?.active[0]?.runtime).toMatchObject({ status: "online", runtimeGeneration: 4 });
  });

  it.each(["local", WORKSTATION])("keeps an agent created on %s when an older sidebar reply lands after, and can start it", async (host) => {
    await open();
    const before = host === "local" ? "a1" : "w1";
    let finish!: (v: ReturnType<typeof snapshot>) => void;
    mock.responses.set(`${host}:sidebar`, () => new Promise((resolve) => { finish = resolve; }));
    const older = store.getState().refreshHostSidebar(host);
    await Promise.resolve();
    mock.responses.set(`${host}:sidebar`, () => ({ ...snapshot(before), active: [...snapshot(before).active, ...snapshot("created").active] }));
    await store.getState().refreshHostSidebar(host);
    finish(snapshot(before));
    await older;
    const sidebar = host === "local" ? store.getState().sidebar : store.getState().byHost[host]?.sidebar;
    expect(sidebar?.active.map((row) => row.cutexSessionId)).toContain("created");
    await store.getState().sessionAction("created", "cutex/runtime/online", { openVisibleTerminal: false }, host);
    expect(mock.calls.some((c) => c.host === host && c.method === "sessionAction" && c.args[0] === "created")).toBe(true);
  });

  it("accepts a completed sidebar read while a newer one is pending on a slow host", async () => {
    await open();
    const replies: ((v: ReturnType<typeof snapshot>) => void)[] = [];
    mock.responses.set("local:sidebar", () => new Promise((resolve) => { replies.push(resolve); }));
    const older = store.getState().refreshSidebar();
    const newer = store.getState().refreshSidebar();
    await Promise.resolve();
    replies[0]!(snapshot("a1", "online", 4));
    await older;
    expect(store.getState().sidebar?.active[0]?.runtime.status).toBe("online");
    replies[1]!(snapshot("a1", "offline", 5));
    await newer;
    expect(store.getState().sidebar?.active[0]?.runtime.runtimeGeneration).toBe(5);
  });

  it("an old queue reply cannot clear a newer startup failure", async () => {
    await open();
    let finish!: (v: unknown) => void;
    mock.responses.set("queueList", () => new Promise((resolve) => { finish = resolve; }));
    sessionEvent("a1", cutex("a1", "cutex/userInput/removed", {}));
    await settle();
    sessionEvent("a1", failed());
    finish({ items: [] });
    // Do not run the newer queue timer yet: its authoritative reply still has q1.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
    mock.responses.set("queueList", () => ({ items: [queued("q1")] }));
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]?.startError).toBe(error);
  });

  it("refreshes a rejected runtime action without replaying the mutation", async () => {
    await open();
    mock.responses.set("sessionAction", () => { throw new Error(error); });
    mock.responses.set("local:sidebar", () => snapshot("a1", "online", 4));
    await expect(store.getState().sessionAction("a1", "cutex/runtime/online")).rejects.toThrow(error);
    expect(store.getState().sidebar?.active[0]?.runtime.runtimeGeneration).toBe(4);
    const mutations = mock.calls.filter((c) => c.method === "sessionAction");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.args[2]).toMatchObject({ expectedRuntimeGeneration: 3 });
  });
});

describe("r271 open view after a runtime upgrade: input progress is not interruption", () => {
  const turnId = "68ecd547-0718-4f1f-8498-543a4366d1f8";
  const threadId = "4e3bbf83-b32a-4ca1-b30d-7608ff6f2928";
  const inputIds = ["7a522aeb-17b2-4538-8a3a-1ae61bfbac60", "53a8cbc1-df71-4b91-9c60-51bcf4b7b0f7", "f0796a9f-754d-4392-b2c9-a00df7811e6b"];
  const view = () => store.getState().sessions[viewKey("local", "a1")]!;
  const emit = (method: string, params: unknown, generation?: number) => fire("sessionEvent", {
    hostId: "local", sessionId: "a1", envelope: envelope("a1", {
      source: "app_server", correlation: generation === undefined ? {} : { runtimeGeneration: generation },
      native: { kind: "notification", message: { method, params } },
    } as Partial<EventEnvelope>),
  });
  const side = (generation: number, offline = false) => ({ ...sidebarOf([["a1", "Aria"]])(), active: [{
    ...resource("a1", "Aria"), native: { threadId, schema: { protocol: "claude-app-server-subset" } },
    runtime: { ...resource("a1", "Aria").runtime, backend: "claude", status: offline ? "offline" : "online", appServerConnected: !offline, runtimeGeneration: generation, activeTurnId: offline ? null : turnId },
  }] });
  async function open() {
    mock.responses.set("local:sidebar", () => side(6));
    mock.responses.set("bootstrap", () => ({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "inProgress", items: [] }] } } },
      checkpoint: { streamId: "s", cursor: 0 }, cutexState: { runtime: { runtimeGeneration: 6 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] } }));
    mock.responses.set("queueList", () => ({ items: [] }));
    await start(); await store.getState().select("a1", "local"); await settle();
    mock.calls.length = 0;
  }
  it("replays three registered/offered inputs then the terminal persisted burst without false loss or resending", async () => {
    await open();
    let next = 0;
    vi.stubGlobal("crypto", { randomUUID: () => inputIds[next++]! });
    mock.responses.set("submit", (_id, _text, _strategy, _offline, options) => ({ disposition: "steered", turnId, clientUserMessageId: (options as { clientUserMessageId: string }).clientUserMessageId }));
    // A sidebar can observe the upgraded runtime before this still-open view.
    mock.responses.set("local:sidebar", () => side(7));
    for (const [index, id] of inputIds.entries()) {
      await store.getState().submit(`insert ${index}`, "auto", [], { sessionId: "a1", hostId: "local" });
      emit("claude/input/stageChanged", { threadId, turnId, clientId: id, messageId: `steer-${id}`, stage: "registered" });
      await store.getState().refreshHostSidebar("local");
      emit("claude/input/stageChanged", { threadId, turnId, clientId: id, messageId: `steer-${id}`, stage: "offered" });
      await settle();
      expect(view().timeline.activeTurnId).toBe(turnId);
      expect(view().timeline.turns[0]?.status).toBe("inProgress");
      expect(store.getState().pendingSteers[viewKey("local", "a1")]?.every(p => p.state === "waiting")).toBe(true);
      expect(store.getState().notice?.tone).not.toBe("error");
    }
    expect(mock.calls.filter(c => c.method === "bootstrap")).toHaveLength(0);
    for (const id of inputIds) emit("claude/input/stageChanged", { threadId, turnId, clientId: id, stage: "contextPersisted" }, 7);
    expect(store.getState().pendingSteers[viewKey("local", "a1")] ?? []).toEqual([]);
    emit("turn/completed", { threadId, turn: { id: turnId, status: "completed", error: null } }, 7);
    await settle();
    expect(view().timeline.turns[0]?.status).toBe("completed");
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(3);
  });
  it.each(["steered", "queued", "steered-untagged"] as const)("keeps an idle optimistic send in the timeline across a late %s acceptance", async disposition => {
    await open();
    view().timeline.activeTurnId = null;
    view().timeline.turns[0]!.status = "completed";
    const id = "idle-to-steer-race";
    vi.stubGlobal("crypto", { randomUUID: () => id });
    let answer!: (result: unknown) => void;
    mock.responses.set("submit", () => new Promise(resolve => { answer = resolve; }));
    const sending = store.getState().submit("owner racing background input", "auto", [], { sessionId: "a1", hostId: "local" });
    for (let n = 0; n < 8; n++) await Promise.resolve();
    const tail = () => pendingTail(store.getState().outbox[viewKey("local", "a1")], view().timeline);
    expect(tail().map(e => e.id)).toEqual([id]);
    emit("turn/started", { threadId, turn: { id: "background-turn", status: "inProgress", items: [] } });
    if (disposition === "queued") fire("sessionEvent", { hostId: "local", sessionId: "a1", envelope: cutex("a1", "cutex/userInput/submitted", { clientUserMessageId: id, disposition: "started", turnId: "background-turn" }) });
    answer({ disposition: disposition === "steered-untagged" ? "steered" : disposition, turnId: "background-turn", clientUserMessageId: id });
    await sending;
    expect(tail().map(e => e.id)).toEqual([id]);
    emit("item/completed", { threadId, turnId: "background-turn", item: { id: "owner-item", type: "userMessage", ...(disposition === "steered-untagged" ? {} : { clientId: id }), content: [{ type: "text", text: "owner racing background input" }] } });
    expect(tail()).toEqual([]);
    expect(store.getState().pendingSteers[viewKey("local", "a1")] ?? []).toEqual([]);
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(1);
  });
  it("replays the exact recorded item/stage order with a synthetic stale generation", async () => {
    await open();
    mock.responses.set("local:sidebar", () => side(7));
    for (const e of observedInsertEvents) {
      const clientId = e.clientId;
      if (e.stage === "registered" && clientId) {
        store.setState({ pendingSteers: { [viewKey("local", "a1")]: [...(store.getState().pendingSteers[viewKey("local", "a1")] ?? []),
          { id: clientId, text: "sanitized insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
        await store.getState().refreshHostSidebar("local");
      }
      const params = { threadId, turnId, ...(e.stage ? { clientId, stage: e.stage } : {}),
        ...(e.item ? { item: { ...e.item, content: [] } } : {}), ...(e.turn ? { turn: e.turn } : {}) };
      emit(e.method, params);
      if (e.method !== "turn/completed") expect(view().timeline.activeTurnId).toBe(turnId);
      if (e.item) expect(store.getState().pendingSteers[viewKey("local", "a1")]?.some(p => p.id === e.item?.clientId)).toBe(false);
    }
    await settle();
    expect(view().timeline.turns[0]?.status).toBe("completed");
    expect(store.getState().pendingSteers[viewKey("local", "a1")] ?? []).toEqual([]);
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "bootstrap" || c.method === "submit")).toHaveLength(0);
  });
  it("a newer correlated generation is not a terminal, while confirmed offline still ends the old running turn", async () => {
    await open();
    emit("claude/input/stageChanged", { threadId, turnId, clientId: inputIds[0], stage: "registered" }, 7);
    expect(view().runtimeGeneration).toBe(7);
    expect(view().timeline.activeTurnId).toBe(turnId);
    mock.responses.set("local:sidebar", () => side(6, true));
    await store.getState().refreshHostSidebar("local");
    expect(view().timeline.activeTurnId).toBe(turnId);
    mock.responses.set("local:sidebar", () => side(7, true));
    await store.getState().refreshHostSidebar("local");
    expect(view().timeline.turns[0]?.status).toBe("interrupted");
  });
  it("a persisted receipt beating a negative history reply cannot resurrect loss or show an error", async () => {
    await open();
    const id = inputIds[0]!;
    store.setState({ pendingSteers: { [viewKey("local", "a1")]: [{ id, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    let reply!: (value: unknown) => void;
    mock.responses.set("bootstrap", () => new Promise(resolve => { reply = resolve; }));
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    for (let n = 0; n < 4; n++) await Promise.resolve();
    expect(reply).toBeTypeOf("function");
    emit("claude/input/stageChanged", { threadId, turnId, clientId: id, stage: "contextPersisted" }, 6);
    reply({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "interrupted", items: [] }] } } } });
    await settle();
    expect(store.getState().pendingSteers[viewKey("local", "a1")] ?? []).toEqual([]);
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it.each([false, true])("releases the retained echo after terminal history verification (recorded=%s)", async recorded => {
    await open();
    const id = inputIds[0]!;
    const entry = newOutboxEntry(view().timeline, { id, text: "unread insert", strategy: "auto", placement: "turn" });
    const key = viewKey("local", "a1");
    store.setState({ outbox: { [key]: confirmOutbox([entry], id, { disposition: "steered", turnId } as never, 1) },
      pendingSteers: { [key]: [{ id, text: "unread insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => ({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "interrupted", items: recorded ? [{ id: "history-only", type: "userMessage", clientId: id, content: [] }] : [] }] } } } }));
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]?.state).toBe(recorded ? undefined : "undelivered");
    expect(pendingTail(store.getState().outbox[key], view().timeline)).toEqual([]);
  });
  it("hands retained timeline steers to the single merged echo before interrupt-and-send", async () => {
    await open();
    store.setState({ features: new Set([...store.getState().features, "queue-pause"]) });
    const id = inputIds[0]!;
    const entry = newOutboxEntry(view().timeline, { id, text: "unread insert", strategy: "auto", placement: "turn" });
    const key = viewKey("local", "a1");
    store.setState({ outbox: { [key]: confirmOutbox([entry], id, { disposition: "steered", turnId } as never, 1) },
      pendingSteers: { [key]: [{ id, text: "unread insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    let stopped!: (value: unknown) => void;
    mock.responses.set("stopTurn", () => new Promise(resolve => { stopped = resolve; }));
    mock.responses.set("submit", () => ({ disposition: "started", turnId: "merged-turn" }));
    const merging = store.getState().interruptAndSend("new tail", [], "a1", "local");
    for (let n = 0; n < 4; n++) await Promise.resolve();
    const tail = pendingTail(store.getState().outbox[key], view().timeline);
    expect(tail).toHaveLength(1);
    expect(tail[0]?.id).not.toBe(id);
    expect(tail[0]?.text).toContain("unread insert");
    expect(tail[0]?.text).toContain("new tail");
    stopped({ paused: false, alreadyPaused: false });
    await merging;
    expect(store.getState().outbox[key]?.some(e => e.id === id)).toBe(false);
  });
  it.each([null, {}, { native: { result: {} } }, { native: { result: { thread: { id: "other-thread", turns: [] } } } },
    { native: { result: { thread: { id: threadId, turns: [{ id: "newer-page-only", status: "completed", items: [] }] } } } }])("missing or irrelevant history is not proof of a lost input: %j", async response => {
    await open();
    const key = viewKey("local", "a1");
    store.setState({ pendingSteers: { [key]: [{ id: inputIds[0]!, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => response);
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]).toMatchObject({ state: "checking", checkFailed: true });
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it("a failed history read can be explicitly checked again without resending", async () => {
    await open();
    const key = viewKey("local", "a1"), id = inputIds[0]!;
    store.setState({ pendingSteers: { [key]: [{ id, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => { throw new Error("temporary read failure"); });
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]).toMatchObject({ state: "checking", checkFailed: true });
    mock.responses.set("bootstrap", () => ({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "interrupted", items: [{ id: "read-back", type: "userMessage", clientId: id, content: [] }] }] } } } }));
    await store.getState().recheckSteer(id, "a1", "local");
    expect(store.getState().pendingSteers[key] ?? []).toEqual([]);
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it("a hung history read exposes a check retry instead of hanging forever", async () => {
    await open();
    const key = viewKey("local", "a1");
    store.setState({ pendingSteers: { [key]: [{ id: inputIds[0]!, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => new Promise(() => {}));
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]).toMatchObject({ state: "checking", checkFailed: true });
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it("hands an uncertain retained timeline echo to the check-retry row atomically", async () => {
    await open();
    const key = viewKey("local", "a1"), id = inputIds[0]!;
    const entry = newOutboxEntry(view().timeline, { id, text: "uncertain insert", strategy: "auto", placement: "turn" });
    store.setState({ outbox: { [key]: confirmOutbox([entry], id, { disposition: "steered", turnId } as never, 1) },
      pendingSteers: { [key]: [{ id, text: "uncertain insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    const snapshots: { failed: boolean; echo: boolean }[] = [];
    const stop = store.subscribe(state => snapshots.push({ failed: !!state.pendingSteers[key]?.[0]?.checkFailed, echo: pendingTail(state.outbox[key], view().timeline).length > 0 }));
    try {
      mock.responses.set("bootstrap", () => { throw new Error("read unavailable"); });
      emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
      await settle();
      expect(store.getState().pendingSteers[key]?.[0]?.checkFailed).toBe(true);
      expect(pendingTail(store.getState().outbox[key], view().timeline)).toEqual([]);
      expect(snapshots.some(s => s.failed && s.echo)).toBe(false);
    } finally { stop(); }
  });
  it("a live history snapshot cannot prove the input was dropped after an older terminal event", async () => {
    await open();
    const key = viewKey("local", "a1");
    store.setState({ pendingSteers: { [key]: [{ id: inputIds[0]!, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => ({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "inProgress", items: [] }] } } } }));
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]?.state).toBe("waiting");
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it("a timed-out check cannot overwrite a newer explicit recheck's positive evidence", async () => {
    await open();
    const key = viewKey("local", "a1"), id = inputIds[0]!;
    store.setState({ pendingSteers: { [key]: [{ id, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    let oldReply!: (value: unknown) => void;
    mock.responses.set("bootstrap", () => new Promise(resolve => { oldReply = resolve; }));
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[key]?.[0]?.checkFailed).toBe(true);
    let newReply!: (value: unknown) => void;
    mock.responses.set("bootstrap", () => new Promise(resolve => { newReply = resolve; }));
    const checking = store.getState().recheckSteer(id, "a1", "local");
    await store.getState().recheckSteer(id, "a1", "local");
    const requests = mock.calls.filter(c => c.method === "bootstrap");
    expect(requests).toHaveLength(2);
    newReply({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "interrupted", items: [{ id: "recorded", type: "userMessage", clientId: id, content: [] }] }] } } } });
    await checking;
    oldReply({ native: { result: { thread: { id: threadId, turns: [{ id: turnId, status: "interrupted", items: [] }] } } } });
    await settle();
    expect(store.getState().pendingSteers[key] ?? []).toEqual([]);
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
  it.each([{ host: "local", session: "b2" }, { host: WORKSTATION, session: "a1" }])("legacy interrupt-and-send consent stays on its host/session when turn IDs collide: %j", async otherAgent => {
    await open();
    const { cloneTimeline } = await import("../src/renderer/src/lib/historyPages");
    const other = cloneTimeline(view().timeline); other.threadId = "other-thread";
    const a = viewKey("local", "a1"), b = viewKey(otherAgent.host, otherAgent.session);
    store.setState(state => ({ sessions: { ...state.sessions, [b]: { ...view(), timeline: other } }, pendingSteers: {
      [a]: [{ id: inputIds[0]!, text: "owner allowed resend", imageCount: 0, turnId, baseline: 0, state: "waiting" }],
      [b]: [{ id: "other-input", text: "never authorized resend", imageCount: 0, turnId, baseline: 0, state: "waiting" }],
    } }));
    mock.responses.set("bootstrap", session => ({ native: { result: { thread: { id: session === "b2" ? "other-thread" : threadId,
      turns: [{ id: turnId, status: "interrupted", items: [] }] } } } }));
    if (otherAgent.host !== "local") mock.responses.set(`${otherAgent.host}:bootstrap`, () => ({ native: { result: { thread: { id: "other-thread", turns: [{ id: turnId, status: "interrupted", items: [] }] } } } }));
    mock.responses.set("submit", (_session, _text, _strategy, options) => ({ disposition: "started", turnId: "retry-turn", clientUserMessageId: (options as { clientUserMessageId: string }).clientUserMessageId }));
    await store.getState().interruptAndSendSteers("a1", "local");
    fire("sessionEvent", { hostId: otherAgent.host, sessionId: otherAgent.session, envelope: envelope(otherAgent.session, { source: "app_server", correlation: { runtimeGeneration: 6 },
      native: { kind: "notification", message: { method: "turn/completed", params: { threadId: "other-thread", turn: { id: turnId, status: "interrupted" } } } } } as Partial<EventEnvelope>) });
    await settle();
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
    expect(store.getState().pendingSteers[b]?.[0]?.state).toBe("undelivered");
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(mock.calls.filter(c => c.method === "submit").map(c => c.args[0])).toEqual(["a1"]);
  });
  it("unreadable history does not assert non-delivery or authorize a resend", async () => {
    await open();
    store.setState({ pendingSteers: { [viewKey("local", "a1")]: [{ id: inputIds[0]!, text: "insert", imageCount: 0, turnId, baseline: 0, state: "waiting" }] } });
    mock.responses.set("bootstrap", () => { throw new Error("temporary read failure"); });
    emit("turn/completed", { threadId, turn: { id: turnId, status: "interrupted" } }, 6);
    await settle();
    expect(store.getState().pendingSteers[viewKey("local", "a1")]?.[0]?.state).toBe("checking");
    expect(store.getState().notice?.tone).not.toBe("error");
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(0);
  });
});

describe("an agent created by a Director (agent_create, cutex Agent Bus process)", () => {
  const toolCompleted = (sessionId: string, tool: string) => envelope(sessionId, {
    source: "app_server",
    native: { kind: "notification", message: { method: "item/completed", params: { threadId: `thread-${sessionId}`, turnId: "t1", item: { id: "call-1", type: "mcpToolCall", server: "cutex", tool, status: "completed" } } } },
  } as Partial<EventEnvelope>);
  const created = sidebarOf([["a1", "Alpha"], ["b2", "Beta"], ["n3", "New"]]);

  it("shows up after the Director's tool call completes (r238: no live event of the new agent)", async () => {
    await start();
    mock.responses.set("local:sidebar", created);
    transport.host("local", toolCompleted("a1", "agent_create"));
    await settle();
    expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2", "n3"]);
  });

  it("shows up on cutex/sessions/changed (host session-change event)", async () => {
    await start();
    mock.responses.set("local:sidebar", created);
    transport.host("local", cutex("cutex.host", "cutex/sessions/changed", { added: ["n3"], removed: [], changed: [], projectsChanged: true, hostId: "HOST-A" }));
    await settle();
    expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2", "n3"]);
  });

  it("an event during an in-flight sidebar read gets a trailing read", async () => {
    await start();
    let finish!: (v: ReturnType<ReturnType<typeof sidebarOf>>) => void;
    mock.responses.set("local:sidebar", () => new Promise((resolve) => { finish = resolve; }));
    transport.host("local", cutex("a1", "cutex/runtime/online", {}));
    await vi.advanceTimersByTimeAsync(400);
    expect(mock.calls.filter((c) => c.method === "sidebar" && c.host === "local").length).toBeGreaterThan(0);
    // The agent is committed and announced while that read is still pending; the pending read is old.
    mock.responses.set("local:sidebar", created);
    transport.host("local", cutex("cutex.host", "cutex/sessions/changed", { added: ["n3"], removed: [], changed: [], projectsChanged: false, hostId: "HOST-A" }));
    finish(sidebarOf([["a1", "Alpha"], ["b2", "Beta"]])());
    await vi.advanceTimersByTimeAsync(2500);
    await settle();
    expect(ids(store.getState().sidebar?.active)).toEqual(["a1", "b2", "n3"]);
  });
});


describe("r260 mixed-host live frames", () => {
  it("batches live text, isolates host/epoch, repairs gaps and retains legacy durable deltas", async () => {
    mock.responses.set("local:capabilities", () => ({ featureList: [...FEATURES, "live-text-deltas"] }));
    mock.responses.set(`${WORKSTATION}:capabilities`, () => ({ featureList: FEATURES }));
    mock.responses.set("bootstrap", (id: unknown) => ({
      native: { result: { thread: { id: `thread-${id}`, turns: [] } } }, historyPage: null,
      checkpoint: { streamId: "stream", cursor: "c0" },
      cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
    }));
    await start();
    await store.getState().select("a1", "local"); await settle();
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } }); await settle();
    await store.getState().select("w1", WORKSTATION); await settle();
    let seq = 0;
    const native = (hostId: string, sessionId: string, method: string, params: unknown) => fire("sessionEvent", {
      hostId, epoch: `${hostId}-1`, sessionId,
      envelope: { contractVersion: 2, streamId: "stream", sequence: ++seq, cursor: `c${seq}`, eventId: `e${seq}`, hostId: LABEL[hostId], cutexSessionId: sessionId, receivedAt: "", source: "app_server", correlation: { runtimeGeneration: 1 }, native: { kind: "notification", message: { method, params } } },
    });
    for (const [host, session] of [["local", "a1"], [WORKSTATION, "w1"]] as const) {
      native(host, session, "turn/started", { turn: { id: "turn", status: "inProgress" } });
      native(host, session, "item/started", { threadId: `thread-${session}`, turnId: "turn", item: { id: "reply", type: "agentMessage", text: "" } });
    }
    const live = (hostId: string, sessionId: string, delta: string, offset: number, revision: number, extra: object = {}, epoch = `${hostId}-1`) => fire("sessionLiveDelta", {
      hostId, epoch, sessionId,
      frame: { version: 1, kind: "delta", cutexSessionId: sessionId, hostId: LABEL[hostId], runtimeGeneration: 1, threadId: `thread-${sessionId}`, turnId: "turn", itemId: "reply", method: "item/agentMessage/delta", producerEpoch: "producer", revision, startOffset: offset, endOffset: offset + new TextEncoder().encode(delta).byteLength, anchor: { streamId: "stream", sequence: seq }, params: { delta }, ...extra },
    });
    const key = viewKey("local", "a1");
    const version = store.getState().sessions[key]!.version;
    live("local", "a1", "你好", 0, 1);
    live("local", "a1", "🧪", 6, 3);
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "你好🧪" });
    expect(store.getState().sessions[key]!.version).toBe(version);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getState().sessions[key]!.version).toBe(version + 1);
    live("local", "a1", "wrong epoch", 10, 4, {}, "local-stale");
    live(WORKSTATION, "w1", "not enabled", 0, 1);
    native(WORKSTATION, "w1", "item/agentMessage/delta", { itemId: "reply", turnId: "turn", delta: "legacy" });
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]!.timeline.entries.get("reply")).toMatchObject({ text: "legacy" });
    live("local", "a1", "", 10, 4, { kind: "gap", gapScope: "subscription" });
    live("local", "a1", "missing tail", 10, 5);
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "你好🧪", liveIncomplete: true });
    const full = envelope("a1", {
      source: "app_server", hostId: LABEL.local, streamId: "stream", sequence: ++seq, eventId: "completed", cursor: "complete-cursor",
      correlation: { runtimeGeneration: 1 }, native: { kind: "notification", message: { method: "item/completed", params: { threadId: "thread-a1", turnId: "turn", item: { id: "reply", type: "agentMessage", text: "authoritative full text" } } } },
    });
    const pending = { ...full, native: { ...full.native!, message: { ...full.native!.message, _cutexFullText: { type: "cutexBlob" }, _cutexTruncated: { reason: "event_size_limit", resyncRequired: true } } } };
    fire("sessionEvent", { hostId: "local", epoch: "local-1", sessionId: "a1", envelope: pending });
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "你好🧪", streaming: false, liveIncomplete: true });
    fire("sessionFullText", { hostId: "local", epoch: "old", sessionId: "a1", envelope: full });
    fire("sessionFullText", { hostId: "local", epoch: "local-1", sessionId: "a1", envelope: { ...full, correlation: { runtimeGeneration: 0 } } });
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "你好🧪" });
    fire("sessionFullText", { hostId: "local", epoch: "local-1", sessionId: "a1", envelope: full });
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "authoritative full text", streaming: false });
    native("local", "a1", "item/completed", { threadId: "thread-a1", turnId: "turn", item: { id: "reply", type: "agentMessage", text: "newer authoritative item" } });
    fire("sessionFullText", { hostId: "local", epoch: "local-1", sessionId: "a1", envelope: full });
    live("local", "a1", "late", 10, 6);
    expect(store.getState().sessions[key]!.timeline.entries.get("reply")).toMatchObject({ text: "newer authoritative item", streaming: false });
  });
});

describe("remote capabilities survive sidebar failures", () => {
  it("publishes successful capabilities even when the initial sidebar request fails", async () => {
    mock.responses.set(`${WORKSTATION}:capabilities`, () => ({ featureList: [...FEATURES, "alarms-api"] }));
    mock.responses.set(`${WORKSTATION}:sidebar`, () => Promise.reject(new Error("temporary sidebar failure")));
    await start();
    expect(store.getState().byHost[WORKSTATION]!.featuresKnown).toBe(true);
    expect(store.getState().byHost[WORKSTATION]!.features.has("alarms-api")).toBe(true);
  });
  it("refreshes the remote capability list after a daemon restart independently of its sidebar", async () => {
    await start();
    mock.responses.set(`${WORKSTATION}:capabilities`, () => ({ featureList: [...FEATURES, "alarms-api", "new-after-restart"] }));
    mock.responses.set(`${WORKSTATION}:sidebar`, () => Promise.reject(new Error("sidebar not ready after restart")));
    fire("daemonState", { hostId: WORKSTATION, epoch: `${WORKSTATION}-${epochs[WORKSTATION]}`, state: { kind: "disconnected" } });
    fire("daemonState", { hostId: WORKSTATION, epoch: `${WORKSTATION}-${epochs[WORKSTATION]}`, state: connected(WORKSTATION) });
    await settle();
    expect(store.getState().byHost[WORKSTATION]!.features.has("new-after-restart")).toBe(true);
  });
});
