// Queue / send paths of the store (2026-10-15 review): captured agent and host, flush handoff of a send still in the outbox,
// and interrupt & send on a non-focus host whose connection is replaced. Same fake per-host bridge as multiHostStore.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { DaemonState, HostsState } from "../src/shared/ipc";
import type { NotifyOccurrence } from "../src/renderer/src/lib/notifyEvents";

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


const queueItem = (queueId: string, clientUserMessageId: string, text: string) => ({ queueId, clientUserMessageId, origin: { kind: "other", clientId: "desktop" }, input: [{ type: "text", text, text_elements: [] }], position: 0, revision: 1, state: "queued", createdAt: "", updatedAt: "" }) as never;
const sessionEvent = (id: string, event: EventEnvelope, hostId = "local") => fire("sessionEvent", { hostId, sessionId: id, envelope: event });
const draftsOf = async () => await import("../src/renderer/src/lib/composerDrafts");

describe("queue row actions act on the agent they were clicked for", () => {
  it("queueSendNow / queueRemove use the given agent, not the one selected when they run", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    await store.getState().select("b2");
    await settle();
    mock.calls.length = 0;
    const item = queueItem("q1", "cm-1", "hello");
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "hello" }], clientUserMessageId: "cm-1", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(item, "a1");
    await store.getState().queueRemove(queueItem("q2", "cm-2", "bye"), "a1");
    const calls = mock.calls.filter((c) => c.method === "queuePromote" || c.method === "queueRemove");
    expect(calls.map((c) => [c.host, c.method, c.args[0]])).toEqual([["local", "queuePromote", "a1"], ["local", "queueRemove", "a1"]]);
    expect(store.getState().queueHidden.b2 ?? []).toEqual([]);
  });
});

describe("cutex/userInput/submitted for a send still in the outbox", () => {
  it("turns the queued send into the pending new-turn bubble instead of skipping it", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const { newOutboxEntry } = await import("../src/renderer/src/lib/outbox");
    store.setState({ outbox: { a1: [newOutboxEntry(null, { id: "cm-q", text: "later", strategy: "queue", placement: "queue" })] } });
    sessionEvent("a1", cutex("a1", "cutex/userInput/submitted", { clientUserMessageId: "cm-q", input: [{ type: "text", text: "later" }], disposition: "started", turnId: "t9" }));
    expect(store.getState().outbox.a1).toMatchObject([{ id: "cm-q", placement: "turn", state: "confirmed", turnId: "t9", promoted: true }]);
  });
});

describe("interrupt & send on a followed host whose connection is replaced during the stop", () => {
  it("leaves no message at 正在停止… and loses no steer: the view gone, steers and tail go to that agent's draft", async () => {
    mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "queue-pause"], cutexBuild: { version: "0.1.0", release: "r219", commit: null, builtAt: null, profile: "release", channel: "main" } }));
    await start();
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
    await settle();
    await store.getState().select("w1", WORKSTATION);
    await settle();
    const view = store.getState().sessions.w1!;
    view.timeline.activeTurnId = "turn-w";
    view.timeline.threadId = "thread-w1";
    store.setState({ pendingSteers: { w1: [{ id: "steer-w", text: "steer text", turnId: "turn-w", baseline: 0, imageCount: 0, state: "waiting" }] } });
    let release!: (v: unknown) => void;
    mock.responses.set(`${WORKSTATION}:stopTurn`, () => new Promise((r) => (release = r)));
    const operation = store.getState().interruptAndSend("tail text", []);
    await settle();
    expect(store.getState().outbox.w1).toMatchObject([{ stage: "stopping" }]);
    // The workstation connection is replaced (focus stays local).
    epochs[WORKSTATION]!++;
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
    await settle();
    release({ paused: true, alreadyPaused: false });
    expect(await operation).toBe(false);
    await settle();
    expect(store.getState().outbox.w1 ?? []).toEqual([]);
    expect(store.getState().queueHandoff.w1).toBe(false);
    const drafts = await draftsOf();
    const draft = drafts.composerDrafts.read(drafts.composerDraftKey(WORKSTATION, "w1")).text;
    expect(draft).toContain("steer text");
    expect(draft).toContain("tail text");
    expect(draft.indexOf("steer text")).toBeLessThan(draft.indexOf("tail text"));
  });
});
