// Panes step 2 (docs/research/panes-20261019.md §3, §7): `core.conversation` multi-instance at the store
// level. Per-agent state and actions are keyed by host + id, so the same session id live on two hosts
// keeps two feeds, two outboxes and two queues, and an action names its host (no more refusal of the
// second host's same-id agent). The pane layout (lib/paneStore) follows the selection: open beside,
// focus, close, and the layout persisted per device and restored without gone agents. Same fake per-host
// bridge as storeQueueScope.test.ts.
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
  await import("../src/renderer/src/lib/paneStore");
  await import("../src/renderer/src/lib/paneLayout");
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


const queueItem = (queueId: string, clientUserMessageId: string, text: string) => ({ queueId, clientUserMessageId, origin: { kind: "other", clientId: "desktop" }, input: [{ type: "text", text, text_elements: [] }], position: 0, revision: 1, state: "queued", createdAt: "", updatedAt: "" }) as never;
const sessionEvent = (id: string, event: EventEnvelope, hostId = "local") => fire("sessionEvent", { hostId, sessionId: id, envelope: event });
const draftsOf = async () => await import("../src/renderer/src/lib/composerDrafts");


const allScope = () => fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
const boot = () => ({
  native: null,
  historyPage: null,
  checkpoint: { streamId: "stream", cursor: "c0" },
  cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], userInputQueuePause: null, asksPaused: null, pendingServerRequests: [], latestPlan: null, latestTokenUsage: null, agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
});
const callsOf = (method: string) => mock.calls.filter((c) => c.method === method).map((c) => [c.host, c.args[0]]);
/** Both hosts list an agent with the id "same" (and their own others). */
async function twoHostsSameId() {
  mock.responses.set("local:sidebar", sidebarOf([["same", "Local same"], ["a1", "Alpha"]]));
  mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["same", "Remote same"], ["w1", "Wave"]]));
  mock.responses.set("bootstrap", boot);
  await start();
  allScope();
  await settle();
  await settle();
}
/** A running turn on a view (what a bootstrap with a live native would give). */
function running(hostId: string, sessionId: string, turnId: string) {
  const view = store.getState().sessions[viewKey(hostId, sessionId)]!;
  view.timeline.threadId = `thread-${hostId}-${sessionId}`;
  view.timeline.activeTurnId = turnId;
}

describe("the same session id on two hosts (per-agent state keyed by host + id)", () => {
  it("both go live: the second host's same-id agent is no longer refused", async () => {
    await twoHostsSameId();
    await store.getState().select("same", "local");
    await settle();
    const release = store.getState().retainView(WORKSTATION, "same");
    await settle();
    expect(store.getState().views[viewKey(WORKSTATION, "same")]).toBeDefined();
    expect(store.getState().sessions[viewKey(WORKSTATION, "same")]).toBeDefined();
    expect(store.getState().sessions[viewKey("local", "same")]).toBeDefined();
    expect(callsOf("subscribe")).toEqual(expect.arrayContaining([["local", "same"], [WORKSTATION, "same"]]));
    release();
    await settle();
    // Releasing the other pane closes its feed only; the selected one stays.
    expect(callsOf("unsubscribe")).toEqual([[WORKSTATION, "same"]]);
  });

  it("a send names its host: it goes there, its optimistic row is that agent's only, and the other host's feed never settles it", async () => {
    await twoHostsSameId();
    await store.getState().select("same", "local");
    store.getState().retainView(WORKSTATION, "same");
    await settle();
    mock.calls.length = 0;
    mock.responses.set(`${WORKSTATION}:submit`, () => new Promise(() => {})); // in flight
    void store.getState().submit("to the remote one", "auto", [], { sessionId: "same", hostId: WORKSTATION });
    await settle();
    expect(callsOf("submit")).toEqual([[WORKSTATION, "same"]]);
    expect(store.getState().outbox[viewKey(WORKSTATION, "same")]?.map((e) => e.text)).toEqual(["to the remote one"]);
    expect(store.getState().outbox[viewKey("local", "same")] ?? []).toEqual([]);
    // A send without a host still means the selected agent (its host).
    mock.responses.set("local:submit", () => ({ disposition: "started", turnId: "t-local" }));
    await store.getState().submit("to the selected one", "auto");
    expect(callsOf("submit")).toEqual([[WORKSTATION, "same"], ["local", "same"]]);
  });

  it("stop, steers, queue rows and models of one host's agent leave the other's alone", async () => {
    await twoHostsSameId();
    await store.getState().select("same", "local");
    store.getState().retainView(WORKSTATION, "same");
    await settle();
    running("local", "same", "turn-l");
    running(WORKSTATION, "same", "turn-r");
    mock.calls.length = 0;
    await store.getState().interrupt("same", WORKSTATION);
    expect(callsOf("interrupt")).toEqual([[WORKSTATION, "same"]]);
    // A steer on the remote one: tracked under its key only.
    mock.responses.set(`${WORKSTATION}:submit`, () => ({ disposition: "steered", turnId: "turn-r" }));
    await store.getState().submit("steer remote", "auto", [], { sessionId: "same", hostId: WORKSTATION });
    await settle();
    expect(store.getState().pendingSteers[viewKey(WORKSTATION, "same")]?.map((p) => p.text)).toEqual(["steer remote"]);
    expect(store.getState().pendingSteers[viewKey("local", "same")] ?? []).toEqual([]);
    // Models are cached per agent of a host.
    mock.responses.set(`${WORKSTATION}:listModels`, () => [{ id: "m-r", model: "m-r", displayName: "Remote model", description: "" }]);
    mock.responses.set("local:listModels", () => [{ id: "m-l", model: "m-l", displayName: "Local model", description: "" }]);
    await store.getState().loadModels(false, "same", WORKSTATION);
    await store.getState().loadModels(false, "same", "local");
    expect(store.getState().models[viewKey(WORKSTATION, "same")]?.map((m) => m.model)).toEqual(["m-r"]);
    expect(store.getState().models[viewKey("local", "same")]?.map((m) => m.model)).toEqual(["m-l"]);
    // A queue row removal of the local one goes to the local host and hides only its row.
    mock.responses.set("local:queueRemove", () => new Promise(() => {}));
    void store.getState().queueRemove({ queueId: "q1", clientUserMessageId: "cm-1", revision: 1 } as never, "same", "local");
    await settle();
    expect(callsOf("queueRemove")).toEqual([["local", "same"]]);
    expect(store.getState().queueHidden[viewKey("local", "same")]).toEqual(["q1"]);
    expect(store.getState().queueHidden[viewKey(WORKSTATION, "same")] ?? []).toEqual([]);
  });

  it("notices and open requests name the conversation they are for", async () => {
    await twoHostsSameId();
    store.getState().notify("for the remote one", "error", { hostId: WORKSTATION, sessionId: "same" });
    expect(store.getState().notice).toMatchObject({ text: "for the remote one", tone: "error", agent: viewKey(WORKSTATION, "same") });
    store.getState().notify("for whoever has the focus");
    expect(store.getState().notice?.agent).toBeUndefined();
    store.getState().signal("goal", "edit", { hostId: "local", sessionId: "same" });
    expect(store.getState().uiSignal).toMatchObject({ target: "goal", arg: "edit", agent: viewKey("local", "same") });
  });
});

describe("the pane layout follows the selection (lib/paneStore)", () => {
  async function withPanes() {
    await twoHostsSameId();
    const panes = await import("../src/renderer/src/lib/paneStore");
    const layout = await import("../src/renderer/src/lib/paneLayout");
    const stop = panes.startPaneSync();
    return { panes, layout, stop };
  }
  const agentsOf = (p: typeof import("../src/renderer/src/lib/paneStore"), l: typeof import("../src/renderer/src/lib/paneLayout")) => {
    const layout = p.usePanes.getState().layout;
    return l.conversationPanes(layout).map((id) => l.paneBinding(layout, id));
  };

  it("plain select replaces the focused pane; open beside adds a column and selects it; focus and close move the selection", async () => {
    const { panes, layout, stop } = await withPanes();
    await store.getState().select("a1", "local");
    await settle();
    expect(agentsOf(panes, layout)).toEqual([{ hostId: "local", sessionId: "a1" }]);
    panes.openAgentBeside(WORKSTATION, "same");
    await settle();
    expect(agentsOf(panes, layout)).toEqual([{ hostId: "local", sessionId: "a1" }, { hostId: WORKSTATION, sessionId: "same" }]);
    expect([store.getState().selectedHost, store.getState().selectedId]).toEqual([WORKSTATION, "same"]);
    // The first column again: its agent is the selection.
    panes.focusConversationPane(layout.MAIN_PANE);
    await settle();
    expect([store.getState().selectedHost, store.getState().selectedId]).toEqual(["local", "a1"]);
    // Selecting the agent shown in the other column focuses that column (never two panes for one agent).
    await store.getState().select("same", WORKSTATION);
    await settle();
    const l = panes.usePanes.getState().layout;
    expect(l.focus).not.toBe(layout.MAIN_PANE);
    expect(agentsOf(panes, layout)).toHaveLength(2);
    // A plain select of a third agent replaces the focused (right) column only.
    await store.getState().select("w1", WORKSTATION);
    await settle();
    expect(agentsOf(panes, layout)).toEqual([{ hostId: "local", sessionId: "a1" }, { hostId: WORKSTATION, sessionId: "w1" }]);
    // Closing the focused column: the other one's agent becomes the selection.
    panes.closeConversationPane(panes.usePanes.getState().layout.focus!);
    await settle();
    expect(agentsOf(panes, layout)).toEqual([{ hostId: "local", sessionId: "a1" }]);
    expect([store.getState().selectedHost, store.getState().selectedId]).toEqual(["local", "a1"]);
    stop();
  });

  it("is stored per device and focus host, and restored without the agents that are gone", async () => {
    const { panes, stop } = await withPanes();
    await store.getState().select("a1", "local");
    await settle();
    panes.openAgentBeside(WORKSTATION, "same");
    await settle();
    panes.focusConversationPane("main");
    await settle();
    stop();
    const stored = JSON.parse(storage.get(panes.PANES_STORAGE_KEY)!) as { v: number; layouts: Record<string, unknown> };
    expect(stored.v).toBe(5); // §24.12 / §24.13: the file is v5 once the migrations ran (v2: Shelves, v3: 允许混排 reset, v4: Shelf chips → rails, v5: a Shelf per conversation)
    expect(Object.keys(stored.layouts)).toEqual(["host:local"]);
    // Next start: the remote "same" was deleted meanwhile; the focused local a1 is opened again.
    vi.resetModules();
    mock.listeners.clear();
    mock.calls.length = 0;
    store = (await import("../src/renderer/src/store")).useApp;
    mock.responses.set(`${WORKSTATION}:sidebar`, sidebarOf([["w1", "Wave"]]));
    mock.responses.set("hosts", () => ({ ...hostsState("local"), scope: { kind: "all" } }));
    const again = await import("../src/renderer/src/lib/paneStore");
    const layout = await import("../src/renderer/src/lib/paneLayout");
    const stop2 = again.startPaneSync();
    store.getState().init();
    await settle();
    await settle();
    await settle();
    expect([store.getState().selectedHost, store.getState().selectedId]).toEqual(["local", "a1"]);
    expect(agentsOf(again, layout)).toEqual([{ hostId: "local", sessionId: "a1" }]);
    stop2();
  });

  it("v1.17 (§24.4): a page opens in the focused pane over its conversation; focusing panes moves `view`; a plain open or closing it shows the conversation again; pages are never stored", async () => {
    const { panes, layout, stop } = await withPanes();
    await store.getState().select("a1", "local");
    await settle();
    panes.openAgentBeside(WORKSTATION, "same");
    await settle();
    const right = panes.usePanes.getState().layout.focus!;
    store.getState().openPage("projects.page", { tab: "agents" });
    expect(layout.panePage(panes.usePanes.getState().layout, right)).toEqual({ page: "projects.page", params: { tab: "agents" } });
    expect(layout.panePage(panes.usePanes.getState().layout, layout.MAIN_PANE)).toBeNull();
    // Still two conversation panes (the page is over the right one's conversation).
    expect(agentsOf(panes, layout)).toHaveLength(2);
    // The left pane: view = its conversation; back on the right: view = its page again.
    panes.focusConversationPane(layout.MAIN_PANE);
    await settle();
    expect(store.getState().view).toEqual({ kind: "conversation" });
    expect(layout.panePage(panes.usePanes.getState().layout, right)).not.toBeNull();
    panes.focusConversationPane(right);
    await settle();
    expect(store.getState().view).toMatchObject({ kind: "page", page: "projects.page", params: { tab: "agents" } });
    // Stored without the page tab.
    stop();
    const stored = JSON.parse(storage.get(panes.PANES_STORAGE_KEY)!) as { layouts: Record<string, { instances: Record<string, { kind: string }> }> };
    expect(Object.values(stored.layouts["host:local"]!.instances).some((i) => i.kind.startsWith("page:"))).toBe(false);
    const stop2 = panes.startPaneSync();
    // A plain open of an agent (select) closes the focused pane's page.
    await store.getState().select("w1", WORKSTATION);
    await settle();
    expect(layout.panePage(panes.usePanes.getState().layout, panes.usePanes.getState().layout.focus!)).toBeNull();
    store.getState().openPage("projects.page", {});
    panes.closePanePage(panes.usePanes.getState().layout.focus!);
    expect(store.getState().view).toEqual({ kind: "conversation" });
    stop2();
  });
});

describe("r265 D4 D-5: a restored pane of a host switched to", () => {
  it("opens its agent after the host notification is delivered, not during it (no 「host binding unavailable or changed」)", async () => {
    mock.responses.set("bootstrap", boot);
    // An earlier run: the workstation's layout has its agent w1 focused.
    await start("local");
    const panes = await import("../src/renderer/src/lib/paneStore");
    const stop = panes.startPaneSync();
    transport.hosts(WORKSTATION);
    await settle();
    await store.getState().select("w1", WORKSTATION);
    await settle();
    stop();
    expect(Object.keys((JSON.parse(storage.get(panes.PANES_STORAGE_KEY)!) as { layouts: Record<string, unknown> }).layouts)).toContain(`host:${WORKSTATION}`);
    // Next start on this machine's host; the workstation is connected outside the scope (its list is followed).
    vi.resetModules();
    mock.listeners.clear();
    mock.calls.length = 0;
    store = (await import("../src/renderer/src/store")).useApp;
    // This machine's cutex is down (no connection): nothing listed for it.
    mock.responses.set("hosts", () => hostsState("local", [WORKSTATION]));
    mock.responses.set("local:daemonState", () => ({ kind: "unreachable", baseUrl: "fake://local", message: "down" }));
    mock.responses.set("local:sidebar", () => { throw new Error("unreachable"); });
    const again = await import("../src/renderer/src/lib/paneStore");
    const stop2 = again.startPaneSync();
    store.getState().init();
    await settle();
    await settle();
    expect(store.getState().byHost[WORKSTATION]?.sidebar).toBeTruthy();
    // Switch: the restored pane's agent is listed by the adopted slice at once — its open waits for the delivery.
    expect(store.getState().sidebar).toBeNull();
    transport.hosts(WORKSTATION, [WORKSTATION]);
    await settle();
    await settle();
    expect([store.getState().selectedHost, store.getState().selectedId]).toEqual([WORKSTATION, "w1"]);
    expect(store.getState().sessions[viewKey(WORKSTATION, "w1")]?.error ?? null).toBeNull();
    expect(callsOf("bootstrap")).toContainEqual([WORKSTATION, "w1"]);
    stop2();
  });
});

describe("multi-window P3: each window's own layout and selection, one copy per agent", () => {
  const DESK = "d000000000001";
  async function withDesk() {
    await twoHostsSameId();
    const panes = await import("../src/renderer/src/lib/paneStore");
    const layout = await import("../src/renderer/src/lib/paneLayout");
    const scope = await import("../src/renderer/src/lib/windowScope");
    const route = await import("../src/renderer/src/lib/windowRoute");
    const desks = await import("../src/renderer/src/lib/deskStore");
    const actions = await import("../src/renderer/src/lib/deskActions");
    (await import("../src/renderer/src/store")).setOpenRouter(route.routeOpen);
    const stopMain = panes.startPaneSync();
    await store.getState().select("a1", "local");
    await settle();
    // A desk window is open (lib/deskSync registers it, then its layout follows the app), seeded with w1.
    desks.useDesks.setState({ desks: [{ deskId: DESK, handle: { deskId: DESK, win: {} as Window, root: null as never, dispose: () => {} }, content: { kind: "conversation", hostId: WORKSTATION, sessionId: "w1" } }] });
    panes.seedWindowLayout(DESK, layout.defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: WORKSTATION, sessionId: "w1" }));
    const stopDesk = panes.startPaneSync(DESK);
    await settle();
    const agents = (key: string) => {
      const l = panes.usePanes.of(key).getState().layout;
      return layout.conversationPanes(l).map((id) => layout.paneBinding(l, id));
    };
    return { panes, layout, scope, route, desks, actions, agents, stop: () => (stopDesk(), stopMain()) };
  }
  const selected = () => [store.getState().selectedHost, store.getState().selectedId];

  it("a desk has its own layout and kept selection; coming to it makes its selection the store's", async () => {
    const { panes, scope, route, agents, stop } = await withDesk();
    expect(panes.usePanes.of(DESK).getState().scope).toBe(`host:local/desk:${DESK}`);
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "w1" }]);
    expect(selected()).toEqual(["local", "a1"]);
    expect(scope.keptSelection(DESK)).toMatchObject({ selectedHost: WORKSTATION, selectedId: "w1" });
    route.activateWindow(DESK);
    await settle();
    expect(selected()).toEqual([WORKSTATION, "w1"]);
    expect(scope.keptSelection("main")).toMatchObject({ selectedHost: "local", selectedId: "a1" });
    // A plain open in the desk replaces the desk's column; the main window is left alone.
    await store.getState().openAgent("same", WORKSTATION);
    await settle();
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "same" }]);
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    route.activateWindow("main");
    await settle();
    expect(selected()).toEqual(["local", "a1"]);
    stop();
  });

  it("an open of an agent shown in the other window jumps there (no second copy); open nowhere → the window asked in", async () => {
    const { scope, route, agents, stop } = await withDesk();
    route.activateWindow(DESK);
    await settle();
    // a1 is in the main window's column: asked in the desk, the main window becomes the active one, on a1.
    await store.getState().openAgent("a1", "local");
    await settle();
    expect(scope.useActiveWindow.getState().key).toBe("main");
    expect(selected()).toEqual(["local", "a1"]);
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "w1" }]);
    expect(route.agentPlaces("local", "a1")).toEqual([{ window: "main", paneId: "main", kind: "column" }]);
    // Ctrl+click (beside) of w1 from the main window: w1 is the desk's — the desk comes forward instead.
    const { openAgentBeside } = await import("../src/renderer/src/lib/paneStore");
    openAgentBeside(WORKSTATION, "w1");
    await settle();
    expect(scope.useActiveWindow.getState().key).toBe(DESK);
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    stop();
  });

  it("a sidebar / ⌘K row (agentEffect 替换 or 并排) of an agent in the other window's column jumps there too (dual-screen run 2026-10-28)", async () => {
    const { scope, route, agents, stop } = await withDesk();
    const { agentEffect } = await import("../src/renderer/src/lib/workspaceEffects");
    for (const mode of ["replace", "beside"] as const) {
      route.activateWindow("main");
      await settle();
      // w1 is the desk's: the preview says where it goes (no outline on this window), the click goes there.
      const effect = agentEffect({ hostId: WORKSTATION, key: "w1" }, mode);
      expect(effect.foretell).toMatchObject({ tone: "open", marks: [] });
      effect.run();
      await settle();
      expect(scope.useActiveWindow.getState().key).toBe(DESK);
      expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
      expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "w1" }]);
    }
    // Shown in no other window: this window's own plan (a plain open replaces the desk's column).
    agentEffect({ hostId: "local", key: "b2" }, "replace").run();
    await settle();
    expect(agents(DESK)).toEqual([{ hostId: "local", sessionId: "b2" }]);
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    stop();
  });

  it("「在 桌子 N 打开」 moves an agent; a closed desk gives its conversations back as chips; both layouts are stored per window", async () => {
    const { panes, layout, desks, actions, agents, stop } = await withDesk();
    actions.openInWindow(DESK, "local", "b2");
    await settle();
    expect(agents(DESK)).toEqual([{ hostId: "local", sessionId: "b2" }]);
    actions.openInWindow(DESK, "local", "a1");
    await settle();
    // a1 left the main window (its only column shows nothing now) and replaced the desk's focused column.
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: null }]);
    expect(agents(DESK)).toEqual([{ hostId: "local", sessionId: "a1" }]);
    stop();
    const stored = JSON.parse(storage.get(panes.PANES_STORAGE_KEY)!) as { layouts: Record<string, unknown> };
    expect(Object.keys(stored.layouts).sort()).toEqual(["host:local", `host:local/desk:${DESK}`]);
    // The desk closes: it leaves the open list, then hands back what it showed (columns and chips) as main's chips.
    const content = desks.useDesks.getState().desks[0]!.content;
    desks.useDesks.setState({ desks: [] });
    actions.giveBackToMain(content, DESK);
    await settle();
    const main = panes.usePanes.of("main").getState().layout;
    expect(main.chips.map((id) => layout.paneBinding(main, id))).toEqual(expect.arrayContaining([{ hostId: "local", sessionId: "a1" }]));
  });

  // P3.5: a restart whose stored layouts show one agent in two windows keeps exactly one copy.
  async function withDuplicate() {
    const env = await withDesk();
    const { panes, layout } = env;
    // The main window's stored layout also shows the desk's w1 (beside a1): two live copies after a restart.
    panes.usePanes.of("main").setState({ layout: layout.openBeside(panes.usePanes.of("main").getState().layout, { hostId: WORKSTATION, sessionId: "w1" }, 1, { room: true })! });
    expect(env.agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }, { hostId: WORKSTATION, sessionId: "w1" }]);
    return env;
  }

  it("restart, last active window = the desk (stored): the desk keeps the agent, the main window's column of it closes", async () => {
    const { actions, route, agents, stop } = await withDuplicate();
    const dropped = actions.dedupeAtStart(DESK);
    await settle();
    expect(dropped.map((p) => p.window)).toEqual(["main"]);
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "w1" }]);
    expect(route.agentPlaces(WORKSTATION, "w1").filter((p) => p.kind === "column")).toHaveLength(1);
    // The main window (active) still has its own agent selected.
    expect(selected()).toEqual(["local", "a1"]);
    stop();
  });

  it("restart, last active window = the main window: the main window keeps it, the desk's only column shows nothing", async () => {
    const { actions, agents, stop } = await withDuplicate();
    actions.dedupeAtStart("main");
    await settle();
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }, { hostId: WORKSTATION, sessionId: "w1" }]);
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: null }]);
    stop();
  });

  it("restart, nothing stored: the desk wins (the agent was moved there on purpose); the stored last window is the active one", async () => {
    const { actions, route, agents, stop } = await withDuplicate();
    expect(route.readStoredActive()).toBeNull();
    actions.dedupeAtStart(route.readStoredActive());
    await settle();
    expect(agents("main")).toEqual([{ hostId: "local", sessionId: "a1" }]);
    expect(agents(DESK)).toEqual([{ hostId: WORKSTATION, sessionId: "w1" }]);
    route.activateWindow(DESK);
    expect(route.readStoredActive()).toBe(DESK);
    route.activateWindow("main");
    expect(route.readStoredActive()).toBe("main");
    // No duplicates: nothing to do.
    expect(actions.dedupeAtStart(DESK)).toEqual([]);
    stop();
  });

  it("quitting does not change the stored last window: the focus moving to the main window and a desk going away are not remembered (dual-screen run 2026-10-28)", async () => {
    const { scope, route, stop } = await withDesk();
    // The owner pressed in the desk last.
    route.activateWindow(DESK);
    expect(route.readStoredActive()).toBe(DESK);
    // Quit: the desks close, the main window gets the focus — it becomes the active one, but is not stored.
    route.activateWindow("main", { remember: false });
    expect(scope.useActiveWindow.getState().key).toBe("main");
    expect(route.readStoredActive()).toBe(DESK);
    route.activateWindow(DESK, { remember: false });
    route.windowGone(DESK);
    expect(scope.useActiveWindow.getState().key).toBe("main");
    expect(route.readStoredActive()).toBe(DESK);
    // A press in the main window is stored, also when it already is the active one.
    route.activateWindow("main");
    expect(route.readStoredActive()).toBe("main");
    stop();
  });

  it("only remembered desks coming back are de-duplicated (a desk opened now is not)", async () => {
    const actions = await import("../src/renderer/src/lib/deskActions");
    const desks = await import("../src/renderer/src/lib/deskStore");
    storage.set(desks.DESKS_STORAGE_KEY, JSON.stringify([{ deskId: DESK, hostId: "local", sessionId: "a1" }]));
    // No desk bridge here: the window does not open, but the desk was marked as restoring first.
    vi.stubGlobal("window", {});
    await actions.reopenDesks(() => true);
    vi.unstubAllGlobals();
    expect(actions.takeRestoring(DESK)).toBe(true);
    expect(actions.takeRestoring(DESK)).toBe(false);
    expect(actions.takeRestoring("d000000000002")).toBe(false);
  });
});

describe("multi-window P3.5: restart winner (lib/windowRoute, pure)", () => {
  it("the last active window when it holds the agent, else the first remembered desk, else the main window", async () => {
    const { startWinner, startDuplicates } = await import("../src/renderer/src/lib/windowRoute");
    const { defaultLayout, openBeside } = await import("../src/renderer/src/lib/paneLayout");
    const A = "d000000000001";
    const B = "d000000000002";
    expect(startWinner(["main", A], A, [A, B])).toBe(A);
    expect(startWinner(["main", A], "main", [A, B])).toBe("main");
    expect(startWinner(["main", A], B, [A, B])).toBe(A);
    expect(startWinner(["main", B, A], null, [A, B])).toBe(A);
    expect(startWinner(["main"], null, [])).toBe("main");
    // Two desks and the main window all show x; y only in B; z twice in the main window.
    const one = (s: string) => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: s });
    const layouts: Record<string, ReturnType<typeof one>> = { main: openBeside(one("x"), { hostId: "local", sessionId: "m" }, 1, { room: true })!, [A]: one("x"), [B]: openBeside(one("x"), { hostId: "local", sessionId: "y" }, 1, { room: true })! };
    const drop = startDuplicates(["main", A, B], (k) => layouts[k]!, B, [A, B]);
    expect(drop.map((p) => p.window).sort()).toEqual([A, "main"].sort());
    expect(startDuplicates(["main", A, B], (k) => layouts[k]!, null, [A, B]).map((p) => p.window).sort()).toEqual([B, "main"].sort());
  });
});
