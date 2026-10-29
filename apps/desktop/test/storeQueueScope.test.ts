// Queue / send paths of the store (2026-10-15 review): captured agent and host, flush handoff of a send still in the outbox,
// and interrupt & send on a non-focus host whose connection is replaced. Same fake per-host bridge as multiHostStore.test.ts.
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


const queueItem = (queueId: string, clientUserMessageId: string, text: string) => ({ queueId, clientUserMessageId, origin: { kind: "other", clientId: "desktop" }, input: [{ type: "text", text, text_elements: [] }], position: 0, revision: 1, state: "queued", createdAt: "", updatedAt: "" }) as never;
const sessionEvent = (id: string, event: EventEnvelope, hostId = "local") => fire("sessionEvent", { hostId, sessionId: id, envelope: event });
const draftsOf = async () => await import("../src/renderer/src/lib/composerDrafts");

describe("message settlement refresh keeps server admission authoritative", () => {
  it("removes the closed item using a server re-read while preserving its messaging audit and ignoring a duplicate event", async () => {
    const { settlementFixture, settlementAdmissionFixture } = await import("../src/renderer/src/modules/agent-bus/settlementFixture");
    const { MESSAGE_SETTLEMENT_EVENT } = await import("../src/shared/messageSettlement");
    const { useAgentMessages } = await import("../src/renderer/src/lib/agentMessageStore");
    await start();
    await store.getState().select("a1"); await settle();
    const settlement = settlementFixture();
    mock.responses.set("queueList", () => ({ items: [], admission: { revision: 1, items: [], nextStep: [settlementAdmissionFixture(settlement)] } }));
    await store.getState().refreshAdmission("a1", "local");
    expect(store.getState().sessions[viewKey("local", "a1")]!.admission!.nextStep).toHaveLength(1);
    const closed = { ...settlement, state: "closed", canClose: false, closure: { actor: "owner", closedAt: "2026-10-27T01:00:00Z", reason: "Reviewed separately", requestId: "owner-key" } };
    mock.responses.set("queueList", () => ({ items: [], admission: { revision: 2, items: [], nextStep: [] } }));
    const event = cutex("cutex.host", MESSAGE_SETTLEMENT_EVENT, { messageId: "m-settlement", requestId: "owner-key", settlement: closed });
    transport.host("local", event); await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]!.admission!.nextStep).toEqual([]);
    expect(useAgentMessages.getState().byId["m-settlement"]!.settlement).toEqual(closed);
    const byId = useAgentMessages.getState().byId;
    transport.host("local", event); await settle();
    expect(useAgentMessages.getState().byId).toBe(byId);
  });
});

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
    expect(store.getState().queueHidden[viewKey("local", "b2")] ?? []).toEqual([]);
  });
});

describe("放回输入框编辑 (queueTakeForEdit) keeps a queued message's images", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const withParts = (queueId: string, input: unknown[]) => ({ ...(queueItem(queueId, `cm-${queueId}`, "") as object), input }) as never;

  it("puts text, images (the same data URL / host path items) and skills into that agent's draft — never \"[image]\" text — then removes the item", async () => {
    await start();
    await store.getState().select("b2");
    await settle();
    mock.calls.length = 0;
    const attachment = "/home/alex/.cutex/attachments/a1/shot.png";
    const item = withParts("q1", [{ type: "text", text: "看这张", text_elements: [] }, { type: "image", url: PNG }, { type: "localImage", path: attachment }, { type: "skill", name: "review", path: "/skills/review" }]);
    await store.getState().queueTakeForEdit(item, "a1");
    await settle();
    const drafts = await draftsOf();
    const draft = drafts.composerDrafts.read(drafts.composerDraftKey("local", "a1"));
    expect(draft.text).toBe("看这张");
    expect(draft.images.map((i) => i.source)).toEqual([{ kind: "data", url: PNG }, { kind: "path", path: attachment }]);
    expect(draft.images[0]!.preview).toBe(PNG);
    expect(draft.pickedSkills).toEqual([{ name: "review", path: "/skills/review" }]);
    // Re-sending sends the same input items again (no local re-read of the attachment).
    const { imageInputItems } = await import("../src/shared/input");
    expect(imageInputItems(draft.images)).toEqual([{ type: "image", url: PNG }, { type: "localImage", path: attachment }]);
    expect(mock.calls.filter((c) => c.method === "queueRemove").map((c) => [c.host, c.args[0], c.args[1]])).toEqual([["local", "a1", "q1"]]);
    // The selected agent's draft is untouched.
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "b2")).text).toBe("");
  });

  it("an image-only message comes back as an image with no text", async () => {
    await start();
    await store.getState().queueTakeForEdit(withParts("q2", [{ type: "image", url: PNG }]), "a1");
    const drafts = await draftsOf();
    const draft = drafts.composerDrafts.read(drafts.composerDraftKey("local", "a1"));
    expect(draft.text).toBe("");
    expect(draft.images).toHaveLength(1);
  });

  it("a message with parts the composer cannot hold (a mention) stays queued", async () => {
    await start();
    mock.calls.length = 0;
    await store.getState().queueTakeForEdit(withParts("q3", [{ type: "text", text: "hi", text_elements: [] }, { type: "mention", name: "x", path: "app://x" }]), "a1");
    await settle();
    const drafts = await draftsOf();
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "a1")).text).toBe("");
    expect(mock.calls.filter((c) => c.method === "queueRemove")).toEqual([]);
  });
});

describe("编辑并重发 (editAndResend) keeps a sent message's images", () => {
  it("reverts, then puts its text, images (the data URL / host path cutex holds) and skills into that agent's draft", async () => {
    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    const attachment = "/home/alex/.cutex/attachments/a1/sent.png";
    await start();
    mock.calls.length = 0;
    mock.responses.set("revertHistory", () => ({}));
    // As the timeline row hands it over: the user entry's images / skills back as input items.
    const { entryFromItem } = await import("../src/renderer/src/lib/timeline");
    const { messageInputItems, imageInputItems } = await import("../src/shared/input");
    const sent = [{ type: "image", url: PNG }, { type: "localImage", path: attachment }, { type: "skill", name: "review", path: "/skills/review" }];
    const entry = entryFromItem({ type: "userMessage", id: "u1", content: [{ type: "text", text: "看这张" }, ...sent] }, "t1");
    if (entry.kind !== "user") throw new Error("not a user entry");
    await store.getState().editAndResend("a1", "t1", entry.text, "local", messageInputItems(entry.images, entry.skills));
    await settle();
    expect(mock.calls.filter((c) => c.method === "revertHistory").map((c) => [c.host, c.args[0], c.args[1]])).toEqual([["local", "a1", "t1"]]);
    const drafts = await draftsOf();
    const draft = drafts.composerDrafts.read(drafts.composerDraftKey("local", "a1"));
    expect(draft.text).toBe("看这张");
    expect(draft.images.map((i) => i.source)).toEqual([{ kind: "data", url: PNG }, { kind: "path", path: attachment }]);
    expect(draft.pickedSkills).toEqual([{ name: "review", path: "/skills/review" }]);
    // Re-sending sends the same items again: nothing is read from the local disk (or the host) for it.
    expect(imageInputItems(draft.images)).toEqual(sent.slice(0, 2));
    expect(mock.calls.filter((c) => /file|read/i.test(c.method)).map((c) => c.method)).toEqual([]);
  });
});

describe("cutex/userInput/submitted for a send still in the outbox", () => {
  it("turns the queued send into the pending new-turn bubble instead of skipping it", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const { newOutboxEntry } = await import("../src/renderer/src/lib/outbox");
    store.setState({ outbox: { [viewKey("local", "a1")]: [newOutboxEntry(null, { id: "cm-q", text: "later", strategy: "queue", placement: "queue" })] } });
    sessionEvent("a1", cutex("a1", "cutex/userInput/submitted", { clientUserMessageId: "cm-q", input: [{ type: "text", text: "later" }], disposition: "started", turnId: "t9" }));
    expect(store.getState().outbox[viewKey("local", "a1")]).toMatchObject([{ id: "cm-q", placement: "turn", state: "confirmed", turnId: "t9", promoted: true }]);
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
    const view = store.getState().sessions[viewKey(WORKSTATION, "w1")]!;
    view.timeline.activeTurnId = "turn-w";
    view.timeline.threadId = "thread-w1";
    store.setState({ pendingSteers: { [viewKey(WORKSTATION, "w1")]: [{ id: "steer-w", text: "steer text", turnId: "turn-w", baseline: 0, imageCount: 0, state: "waiting" }] } });
    let release!: (v: unknown) => void;
    mock.responses.set(`${WORKSTATION}:stopTurn`, () => new Promise((r) => (release = r)));
    const operation = store.getState().interruptAndSend("tail text", []);
    await settle();
    expect(store.getState().outbox[viewKey(WORKSTATION, "w1")]).toMatchObject([{ stage: "stopping" }]);
    // The workstation connection is replaced (focus stays local).
    epochs[WORKSTATION]!++;
    fire("hostsState", { ...hostsState("local"), scope: { kind: "all" } });
    await settle();
    release({ paused: true, alreadyPaused: false });
    expect(await operation).toBe(false);
    await settle();
    expect(store.getState().outbox[viewKey(WORKSTATION, "w1")] ?? []).toEqual([]);
    expect(store.getState().queueHandoff[viewKey(WORKSTATION, "w1")]).toBe(false);
    const drafts = await draftsOf();
    const draft = drafts.composerDrafts.read(drafts.composerDraftKey(WORKSTATION, "w1")).text;
    expect(draft).toContain("steer text");
    expect(draft).toContain("tail text");
    expect(draft.indexOf("steer text")).toBeLessThan(draft.indexOf("tail text"));
  });
});

describe("插话 outcome unknown (owner 2026-10-26): the desktop resyncs and decides, never resends", () => {
  const RAW = "request_outcome_unknown: the cutex operation completed far enough that its durable outcome is unknown (originalCode: outcome_unknown)";
  const unknownAnswer = () => { throw new Error(`Error invoking remote method 'daemon:queuePromote': Error: queue_steer_refused:outcomeUnknown ${RAW}`); };
  const thread = (turns: unknown[]) => () => ({
    native: { method: "thread/read", result: { thread: { id: "thread-a1", turns } } },
    historyPage: null,
    checkpoint: { streamId: "s", cursor: 0 },
    cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
  });
  const userMessage = (id: string, text: string, clientId?: string) => ({ type: "userMessage", id, content: [{ type: "text", text }], ...(clientId ? { clientId } : {}) });
  const running = (items: unknown[] = []) => thread([{ id: "t1", status: "inProgress", items }]);
  const feedback = async () => {
    const { useQueueInsertFeedback, insertFeedbackOf } = await import("../src/renderer/src/lib/queueInsertFeedback");
    return insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState());
  };
  const sends = () => mock.calls.filter((c) => c.method === "submit" || c.method === "queuePromote" || c.method === "queueMergeInsert");
  /** `after`: cutex's state the resync will read (queue list, thread/read). */
  async function steerUnknown(after: () => void = () => {}, text = "hello") {
    await start();
    mock.responses.set("bootstrap", running());
    await store.getState().select("a1");
    await settle();
    mock.responses.set("queuePromote", unknownAnswer);
    after();
    mock.calls.length = 0;
    await store.getState().queueSendNow(queueItem("q-u", "cm-u", text), "a1", "local");
  }
  /** Promise callbacks only (no timers: the backoff and the delivered expiry wait). */
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  /** Every backoff attempt (and their reads) done. */
  const drain = async () => { for (let i = 0; i < 6; i++) { await settle(); await vi.advanceTimersByTimeAsync(2000); } };

  it("does not reinsert an owner input already proven in native history, even from a stale queued row", async () => {
    await start();
    mock.responses.set("bootstrap", running([userMessage("native-user", "hello", "cm-u")]));
    await store.getState().select("a1"); await settle();
    mock.calls.length = 0;
    await store.getState().queueSendNow(queueItem("q-u", "cm-u", "hello"), "a1", "local");
    expect(sends()).toEqual([]);
    expect(await feedback()).toMatchObject([{ state: "delivered", reason: undefined, detail: undefined }]);
  });
  it("manual admission refresh cannot resurrect a delivered owner's admission-only row after feedback expiry", async () => {
    await start();
    mock.responses.set("bootstrap", running([userMessage("native-user", "hello", "cm-u")]));
    await store.getState().select("a1"); await settle();
    const note = { id: "agent-note", deliveryKind: "tell", waitReason: "nativeReceipt", enqueuedAt: "2026-10-26T00:00:00Z" };
    const staleAdmission = { revision: 1, items: [{ kind: "owner", id: "q-u", position: 1, state: "waiting", enqueuedAt: "" }], nextStep: [note] };
    mock.responses.set("queueList", () => ({ items: [], admission: staleAdmission }));
    await store.getState().queueSendNow(queueItem("q-u", "cm-u", "hello"), "a1", "local");
    await store.getState().refreshAdmission("a1", "local");
    expect(store.getState().sessions[viewKey("local", "a1")]!.admission?.items).toEqual([]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await feedback()).toEqual([]);
    await store.getState().refreshAdmission("a1", "local");
    const after = store.getState().sessions[viewKey("local", "a1")]!;
    expect(after.queue).toEqual([]); expect(after.admission?.items).toEqual([]);
    expect(after.admission?.nextStep).toEqual([note]);
  });

  it("native delivery wins over a late delegation-busy refusal, without changing agent-bus nativeReceipt rows", async () => {
    await start(); mock.responses.set("bootstrap", running());
    await store.getState().select("a1"); await settle();
    let reject!: (error: Error) => void;
    mock.responses.set("queuePromote", () => new Promise((_resolve, fail) => { reject = fail; }));
    const item = queueItem("q-u", "cm-u", "hello");
    const view = store.getState().sessions[viewKey("local", "a1")]!;
    const agentNote = { id: "persistent-note", deliveryKind: "tell", enqueuedAt: "2026-10-26T00:00:00Z", waitReason: "nativeReceipt" } as const;
    store.setState({ sessions: { ...store.getState().sessions, [viewKey("local", "a1")]: { ...view, queue: [item], admission: { revision: 1, items: [{ id: "q-u", kind: "owner", position: 1, state: "waiting", enqueuedAt: "" }], nextStep: [agentNote] } } } });
    const operation = store.getState().queueSendNow(item, "a1", "local"); await flush();
    sessionEvent("a1", { receivedAt: new Date().toISOString(), correlation: { runtimeGeneration: 1 }, native: { kind: "notification", message: { method: "item/completed", params: { threadId: "thread-a1", turnId: "t1", item: userMessage("native-user", "hello", "cm-u") } } } } as never);
    reject(new Error("queue_steer_refused:delegationTurn delegated turn busy")); await operation;
    expect(await feedback()).toMatchObject([{ state: "delivered", reason: undefined, detail: undefined }]);
    const after = store.getState().sessions[viewKey("local", "a1")]!;
    expect(after.queue).toEqual([]); expect(after.admission?.items).toEqual([]);
    expect(after.admission?.nextStep).toEqual([agentNote]);
  });

  it("found in the re-read history by its clientUserMessageId → 已送达, then gone like a delivered steer", async () => {
    await steerUnknown(() => {
      mock.responses.set("queueList", () => ({ items: [] }));
      mock.responses.set("bootstrap", running([userMessage("u1", "hello", "cm-u")]));
    });
    await flush();
    expect((await feedback()).map((f) => f.state)).toEqual(["delivered"]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await feedback()).toEqual([]);
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("found as part of a merged user message (two steers read together) → 已送达", async () => {
    // a1 runs turn t1 (the steers' turn).
    mock.responses.set("local:sidebar", () => ({ ...sidebarOf([["a1", "Alpha"], ["b2", "Beta"]])(), active: [{ ...resource("a1", "Alpha"), runtime: { status: "online", runtimeGeneration: 1, activeTurnId: "t1", threadSettings: null } }, resource("b2", "Beta")] }));
    await start();
    mock.responses.set("bootstrap", running());
    await store.getState().select("a1");
    await settle();
    // An earlier steer of the same turn, still waiting; the runtime merged both into one message.
    store.setState({ pendingSteers: { [viewKey("local", "a1")]: [{ id: "s-first", text: "first part", turnId: "t1", baseline: 0, usersBefore: 0, imageCount: 0, state: "waiting" }] } });
    mock.responses.set("queuePromote", unknownAnswer);
    mock.calls.length = 0;
    mock.responses.set("queueList", () => ({ items: [] }));
    mock.responses.set("bootstrap", running([userMessage("u-merged", "first part\n\nsecond part", "runtime-merged")]));
    await store.getState().queueSendNow(queueItem("q-u", "cm-u", "second part"), "a1", "local");
    await flush();
    expect((await feedback()).map((f) => f.state)).toEqual(["delivered"]);
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("still listed in cutex's queue → a plain queued row again (no error, 插话 offered)", async () => {
    await steerUnknown(() => mock.responses.set("queueList", () => ({ items: [queueItem("q-u", "cm-u", "hello")] })));
    await flush();
    expect(await feedback()).toEqual([]);
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("neither → retried with backoff, then unsure; nothing is ever sent until 再发一次, which uses a NEW id", async () => {
    await steerUnknown(() => mock.responses.set("queueList", () => ({ items: [] })));
    await flush();
    expect((await feedback())[0]).toMatchObject({ state: "unknown", checking: true, detail: RAW });
    await drain();
    const [f] = await feedback();
    expect(f).toMatchObject({ state: "unknown", checking: false, reason: undefined, detail: RAW });
    // Re-read more than once (backoff), never re-sent.
    expect(mock.calls.filter((c) => c.method === "bootstrap").length).toBeGreaterThanOrEqual(3);
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
    // A turn ending re-checks it quietly; still nothing sent.
    sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "turn/completed", params: { turn: { id: "t1", status: "completed", items: [] } } } } } as Partial<EventEnvelope>));
    await drain();
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
    // 再发一次: a new message under a new clientUserMessageId, strategy auto.
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "steered", turnId: "t1", clientUserMessageId: (args[4] as { clientUserMessageId: string }).clientUserMessageId }));
    await store.getState().queueInsertDecide(f!.token, "resend", "a1", "local");
    await settle();
    const submits = mock.calls.filter((c) => c.method === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]!.args[1]).toBe("hello");
    expect(submits[0]!.args[2]).toBe("auto");
    const id = (submits[0]!.args[4] as { clientUserMessageId: string }).clientUserMessageId;
    expect(id).toBeTruthy();
    expect(id).not.toBe("cm-u");
    expect(await feedback()).toEqual([]);
  });

  it("still listed but its send unresolved (delivery unknown) → stays unsure, never a plain queued row", async () => {
    await steerUnknown(() => mock.responses.set("queueList", () => ({ items: [{ ...(queueItem("q-u", "cm-u", "hello") as object), delivery: "unknown" }] })));
    await drain();
    expect((await feedback())[0]).toMatchObject({ state: "unknown", checking: false });
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("events minutes late (Kestrel 2026-10-26): still unsure after many events, then the late user message → 已送达 by itself", async () => {
    await steerUnknown(() => mock.responses.set("queueList", () => ({ items: [] })));
    await drain();
    expect((await feedback())[0]).toMatchObject({ state: "unknown", checking: false });
    const turnDone = () => sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "turn/completed", params: { turn: { id: "t1", status: "completed", items: [] } } } } } as Partial<EventEnvelope>));
    // More events than the old cap of six: each still rechecks (at most every few seconds).
    for (let i = 0; i < 8; i++) { turnDone(); await drain(); }
    expect((await feedback())[0]).toMatchObject({ state: "unknown" });
    // Two minutes on, the native user message finally reaches the daemon.
    await vi.advanceTimersByTimeAsync(10_000);
    mock.responses.set("bootstrap", running([userMessage("u1", "hello", "cm-u")]));
    sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { threadId: "thread-a1", turnId: "t1", item: userMessage("u1", "hello", "cm-u") } } } } as Partial<EventEnvelope>));
    await drain();
    expect((await feedback()).map((f) => f.state)).not.toContain("unknown");
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("a stalled event stream: the quiet polls find it later without any event", async () => {
    let t0 = 0;
    await steerUnknown(() => {
      t0 = Date.now();
      mock.responses.set("queueList", () => ({ items: [] }));
      // The history shows it only after the fast checks (0 / 1.5 / 5 s) have given up.
      mock.responses.set("bootstrap", () => (Date.now() - t0 > 10_000 ? running([userMessage("u1", "hello", "cm-u")]) : running())());
    });
    await flush();
    expect((await feedback())[0]).toMatchObject({ state: "unknown" });
    await drain();
    await vi.advanceTimersByTimeAsync(20_000);
    await drain();
    expect((await feedback()).map((f) => f.state)).not.toContain("unknown");
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
  });

  it("再发一次 sends nothing while cutex's queue still lists it, or cannot be read", async () => {
    await steerUnknown(() => {
      mock.responses.set("queueList", () => { throw new Error("unreachable"); });
      mock.responses.set("bootstrap", () => { throw new Error("unreachable"); });
    });
    await drain();
    const [f] = await feedback();
    expect(f).toMatchObject({ state: "unknown", checking: false });
    await store.getState().queueInsertDecide(f!.token, "resend", "a1", "local");
    await settle();
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
    expect((await feedback())[0]).toMatchObject({ state: "unknown" });
    mock.responses.set("queueList", () => ({ items: [queueItem("q-u", "cm-u", "hello")] }));
    await store.getState().queueInsertDecide(f!.token, "resend", "a1", "local");
    await settle();
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);
    expect(await feedback()).toEqual([]);
  });

  it("已送达 marks it delivered locally and it leaves; 删除 hides it but keeps the duplicate guard", async () => {
    await steerUnknown(() => mock.responses.set("queueList", () => ({ items: [] })));
    await drain();
    const [f] = await feedback();
    await store.getState().queueInsertDecide(f!.token, "delivered", "a1", "local");
    expect((await feedback()).map((x) => x.state)).toEqual(["delivered"]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await feedback()).toEqual([]);
    expect(sends().map((c) => c.method)).toEqual(["queuePromote"]);

    mock.responses.set("queuePromote", unknownAnswer);
    await store.getState().queueSendNow(queueItem("q-v", "cm-v", "again"), "a1", "local");
    await drain();
    const [g] = await feedback();
    await store.getState().queueInsertDecide(g!.token, "forget", "a1", "local");
    expect((await feedback())[0]).toMatchObject({ state: "unknown", hidden: true });
    await store.getState().queueSendNow(queueItem("q-v", "cm-v", "again"), "a1", "local");
    expect(mock.calls.filter((c) => c.method === "queuePromote")).toHaveLength(2);
  });
});

describe("插入当前回合 (owner 2026-10-21): toast, and pending inserts survive a desktop restart", () => {
  const boot = (turns: unknown[]) => () => ({
    native: { method: "thread/read", result: { thread: { id: "thread-a1", turns } } },
    historyPage: null,
    checkpoint: { streamId: "s", cursor: 0 },
    cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
  });
  const userMessage = (id: string, text: string, clientId?: string) => ({ type: "userMessage", id, content: [{ type: "text", text }], ...(clientId ? { clientId } : {}) });
  const steer = (id: string, text: string, turnId: string) => ({ id, text, turnId, baseline: 0, imageCount: 0, state: "waiting" as const });
  const KEY = "cutex-desktop.pendingSteers.v1";
  /** A fresh renderer over the same localStorage (the app restarted). */
  async function restart() {
    mock.listeners.clear();
    vi.resetModules();
    store = (await import("../src/renderer/src/store")).useApp;
  }

  it("an insert and a new turn report on their own row, without a duplicate composer notice", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "hello" }], clientUserMessageId: "cm-1", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(queueItem("q1", "cm-1", "hello"), "a1");
    const { useQueueInsertFeedback, insertFeedbackOf } = await import("../src/renderer/src/lib/queueInsertFeedback");
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "inserted" }]);
    expect(store.getState().notice).toBeNull();
    store.setState({ notice: null });
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "go" }], clientUserMessageId: "cm-2", result: { disposition: "started", turnId: "t2" } }));
    await store.getState().queueSendNow(queueItem("q2", "cm-2", "go"), "a1");
    expect(store.getState().notice).toBeNull();
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "inserted" }, { state: "started" }]);
  });

  it("a native userMessage clientId confirms delivery, drops the steer, and expires its receipt without another action", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "hello" }], clientUserMessageId: "cm-delivered", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(queueItem("q-delivered", "cm-delivered", "hello"), "a1");
    const { useQueueInsertFeedback, insertFeedbackOf, DELIVERED_FEEDBACK_MS } = await import("../src/renderer/src/lib/queueInsertFeedback");
    const key = viewKey("local", "a1");
    sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { threadId: store.getState().sessions[key]!.timeline.threadId ?? "thread-a1", turnId: "t1", item: { type: "userMessage", id: "u-delivered", clientId: "cm-delivered", content: [{ type: "text", text: "hello" }] } } } } } as Partial<EventEnvelope>));
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "delivered" }]);
    expect(store.getState().pendingSteers[key] ?? []).toEqual([]);
    await vi.advanceTimersByTimeAsync(DELIVERED_FEEDBACK_MS);
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toEqual([]);
    expect([...store.getState().sessions[key]!.timeline.entries.values()]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "user", clientId: "cm-delivered" })]));
  });

  it("「已插入当前回合」 leaves like 已送达 when the history row has no clientId echo (matched by its text in the turn)", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "plain" }], clientUserMessageId: "cm-plain", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(queueItem("q-plain", "cm-plain", "plain"), "a1");
    const { useQueueInsertFeedback, insertFeedbackOf, DELIVERED_FEEDBACK_MS } = await import("../src/renderer/src/lib/queueInsertFeedback");
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "inserted" }]);
    const key = viewKey("local", "a1");
    sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { threadId: store.getState().sessions[key]!.timeline.threadId ?? "thread-a1", turnId: "t1", item: { type: "userMessage", id: "u-plain", content: [{ type: "text", text: "plain" }] } } } } } as Partial<EventEnvelope>));
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "delivered" }]);
    await vi.advanceTimersByTimeAsync(DELIVERED_FEEDBACK_MS);
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toEqual([]);
  });

  it("two inserts in a row merged into one history message: both 「已插入当前回合」 turn 已送达 and leave", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "first insert" }], clientUserMessageId: "cm-m1", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(queueItem("q-m1", "cm-m1", "first insert"), "a1");
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "second insert" }], clientUserMessageId: "cm-m2", result: { disposition: "steered", turnId: "t1" } }));
    await store.getState().queueSendNow(queueItem("q-m2", "cm-m2", "second insert"), "a1");
    const { useQueueInsertFeedback, insertFeedbackOf, DELIVERED_FEEDBACK_MS } = await import("../src/renderer/src/lib/queueInsertFeedback");
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "inserted" }, { state: "inserted" }]);
    const key = viewKey("local", "a1");
    // The runtime read both at one tool boundary: one user message, both lines, an id that is neither insert's.
    sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { threadId: store.getState().sessions[key]!.timeline.threadId ?? "thread-a1", turnId: "t1", item: { type: "userMessage", id: "u-merged", clientId: "runtime-merged", content: [{ type: "text", text: "first insert\nsecond insert" }] } } } } } as Partial<EventEnvelope>));
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "delivered" }, { state: "delivered" }]);
    expect(store.getState().pendingSteers[key] ?? []).toEqual([]);
    await vi.advanceTimersByTimeAsync(DELIVERED_FEEDBACK_MS);
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toEqual([]);
  });

  it("「已插入当前回合」 leaves when history carries the id cutex sent the insert under, even if it came before the reply", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const key = viewKey("local", "a1");
    // The userMessage arrives while queuePromote is still in flight, under cutex's id.
    mock.responses.set("queuePromote", () => {
      sessionEvent("a1", envelope("a1", { source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { threadId: store.getState().sessions[key]!.timeline.threadId ?? "thread-a1", turnId: "t1", item: { type: "userMessage", id: "u-sent", clientId: "cm-sent", content: [{ type: "text", text: "early" }] } } } } } as Partial<EventEnvelope>));
      return { input: [{ type: "text", text: "early" }], clientUserMessageId: "cm-sent", result: { disposition: "steered", turnId: "t1" } };
    });
    await store.getState().queueSendNow(queueItem("q-early", "cm-queued", "early"), "a1");
    const { useQueueInsertFeedback, insertFeedbackOf, DELIVERED_FEEDBACK_MS } = await import("../src/renderer/src/lib/queueInsertFeedback");
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "delivered" }]);
    await vi.advanceTimersByTimeAsync(DELIVERED_FEEDBACK_MS);
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toEqual([]);
  });

  it("keeps the original queue row while the request is pending, rejects repeat clicks, and shows a refusal locally", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    let reject!: (e: Error) => void;
    mock.responses.set("queuePromote", () => new Promise((_, no) => { reject = no; }));
    const item = queueItem("q-pending", "cm-pending", "hello");
    const pending = store.getState().queueSendNow(item, "a1");
    const { useQueueInsertFeedback, insertFeedbackOf } = await import("../src/renderer/src/lib/queueInsertFeedback");
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "requesting" }]);
    expect(store.getState().queueHidden[viewKey("local", "a1")] ?? []).not.toContain("q-pending");
    expect(store.getState().outbox[viewKey("local", "a1")] ?? []).toEqual([]);
    // Keeping the original row must still preserve the old in-flight-turn behavior for a
    // follow-up typed meanwhile: it belongs in the queue, not a second optimistic turn.
    let resolveFollow!: (value: unknown) => void;
    mock.responses.set("submit", () => new Promise((yes) => { resolveFollow = yes; }));
    const follow = store.getState().submit("follow up", "queue", [], { sessionId: "a1", hostId: "local" });
    expect(store.getState().outbox[viewKey("local", "a1")]).toMatchObject([{ text: "follow up", placement: "queue" }]);
    await settle();
    resolveFollow({ disposition: "queued" });
    await follow;
    await store.getState().queueSendNow(item, "a1");
    expect(mock.calls.filter((c) => c.method === "queuePromote")).toHaveLength(1);
    reject(new Error("queue_steer_refused:sessionOffline"));
    await pending;
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "rejected", reason: expect.any(String) }]);
    expect(store.getState().notice).toBeNull();
  });

  it("a lost response remains unknown, preserves queue state and cannot silently resubmit", async () => {
    await start();
    mock.responses.set("queuePromote", () => { throw new Error("request timed out"); });
    const item = queueItem("q-unknown", "cm-unknown", "hello");
    await store.getState().queueSendNow(item, "a1", "local");
    await store.getState().queueSendNow(item, "a1", "local");
    const { useQueueInsertFeedback, insertFeedbackOf } = await import("../src/renderer/src/lib/queueInsertFeedback");
    // No words of its own on the row: the transport error is its 详情; the desktop resyncs first.
    expect(insertFeedbackOf("local", "a1")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "unknown", reason: undefined, detail: "request timed out", checking: true }]);
    expect(mock.calls.filter((c) => c.method === "queuePromote")).toHaveLength(1);
    expect(store.getState().notice).toBeNull();
  });

  it("kept per (host, agent); after a restart restored, reconciled with the timeline (read ones drop, a lost one is re-checked), and 打断并发送 re-sends the rest", async () => {
    mock.responses.set("capabilities", () => ({ featureList: [...FEATURES, "queue-pause"], cutexBuild: { version: "0.1.0", release: "r219", commit: null, builtAt: null, profile: "release", channel: "main" } }));
    await start();
    store.setState({
      pendingSteers: {
        [viewKey("local", "a1")]: [steer("s-read", "read text", "t1"), steer("s-wait", "wait text", "t1"), steer("s-old", "old text", "t0")],
        [viewKey(WORKSTATION, "w1")]: [steer("s-w", "other host", "tw")],
      },
    });
    const saved = JSON.parse(storage.get(KEY)!);
    expect(Object.keys(saved).sort()).toEqual([viewKey("local", "a1"), viewKey(WORKSTATION, "w1")].sort());
    expect(saved[viewKey("local", "a1")].steers.map((p: { id: string }) => p.id)).toEqual(["s-read", "s-wait", "s-old"]);

    await restart();
    // t1 still runs and has read s-read; t0 is older than the loaded page (never shown, not running).
    mock.responses.set("bootstrap", boot([{ id: "t1", status: "inProgress", items: [userMessage("u1", "read text", "s-read")] }]));
    await start();
    expect(store.getState().pendingSteers[viewKey("local", "a1")]?.map((p) => p.id)).toEqual(["s-read", "s-wait", "s-old"]);
    await store.getState().select("a1");
    await settle();
    await settle();
    const after = store.getState().pendingSteers[viewKey("local", "a1")]!;
    expect(after.map((p) => [p.id, p.state])).toEqual([["s-wait", "waiting"], ["s-old", "undelivered"]]);
    // The other host's inserts are kept for when that agent loads.
    expect(store.getState().pendingSteers[viewKey(WORKSTATION, "w1")]?.map((p) => p.id)).toEqual(["s-w"]);

    // 打断并发送: stop, re-check, then the restored waiting insert + the composer text as one message.
    mock.responses.set("stopTurn", () => ({ paused: true, alreadyPaused: false }));
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "started", turnId: "t2", clientUserMessageId: (args[4] as { clientUserMessageId: string }).clientUserMessageId }));
    mock.calls.length = 0;
    expect(await store.getState().interruptAndSend("tail text", [], "a1", "local")).toBe(true);
    await settle();
    const submits = mock.calls.filter((c) => c.method === "submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]!.args[1]).toBe("wait text\n\ntail text");
    expect(mock.calls.some((c) => c.method === "stopTurn")).toBe(true);
    expect(store.getState().pendingSteers[viewKey("local", "a1")]?.map((p) => p.id)).toEqual(["s-old"]);
    expect(JSON.parse(storage.get(KEY)!)[viewKey("local", "a1")].steers.map((p: { id: string }) => p.id)).toEqual(["s-old"]);
  });
});

describe("explicit owner join submit", () => {
  it("keeps a refused direct join as a failed row with a readable owner-only reason", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    mock.responses.set("submit", () => { throw new Error("owner_required: this route is the host owner's"); });
    await expect(store.getState().submit("shared", "auto", [], { sessionId: "a1", hostId: "local", joinDelegation: join })).rejects.toThrow("owner_required");
    expect(store.getState().outbox[viewKey("local", "a1")]).toEqual([expect.objectContaining({ text: "shared", state: "failed", error: "只有主机所有者可以加入此委托" })]);
    expect(mock.calls.filter(c => c.method === "submit")).toHaveLength(1);
  });

  it("shows a non-owner queue insert as rejected rather than unknown and retains the queue row", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const feedback = await import("../src/renderer/src/lib/queueInsertFeedback");
    feedback.useQueueInsertFeedback.setState({ byView: {} });
    const item = queueItem("permission-denied", "cm-denied", "shared");
    mock.responses.set("queuePromote", () => { throw new Error("queue_steer_refused:ownerRequired"); });
    const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    await store.getState().queueSendNow(item, "a1", "local", join);
    const state = feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState());
    expect(state).toEqual([expect.objectContaining({ state: "rejected", reason: "只有主机所有者可以加入此委托" })]);
    expect(store.getState().queueHidden[viewKey("local", "a1")] ?? []).not.toContain("permission-denied");
    feedback.useQueueInsertFeedback.setState({ byView: {} });
  });

  it("keeps captured consent across the send chain and confirms a refusal as queued", async () => {
    await start();
    await store.getState().select("a1");
    await settle();
    const join = { askId: "ask-a", attempt: 2, expectedTurnId: "turn-a", runtimeGeneration: 7 };
    mock.responses.set("submit", () => ({ disposition: "queued", queue: queueItem("joined", "cm", "shared"), joinRefusal: "runtimeNoSteer" }));
    const result = await store.getState().submit("shared", "auto", [], { sessionId: "a1", hostId: "local", joinDelegation: join });
    expect(result).toMatchObject({ disposition: "queued", joinRefusal: "runtimeNoSteer" });
    const call = mock.calls.filter(call => call.method === "submit").at(-1)!;
    expect(call.host).toBe("local");
    expect(call.args[0]).toBe("a1");
    expect(call.args[2]).toBe("auto");
    expect(call.args[3]).toBe(false);
    expect(call.args[4]).toMatchObject({ joinDelegation: join });
    expect(Object.values(store.getState().outbox).flat().every(entry => entry.state !== "failed")).toBe(true);
  });
});

describe("images in steers (r264 image-input-steering)", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const IMAGE_FEATURES = [...FEATURES, "queue-steer", "image-input-steering"];
  const withSteering = (steering: "pathText" | "nativeImage" | "unsupported") => () => ({
    active: [{ ...resource("a1", "Alpha"), native: { threadId: "thread-a1", schema: { protocol: "claude-app-server-subset", capabilities: { features: { imageInputSteering: { busyBehaviorDefault: "queue", steering, requiresTargetHostPath: steering === "pathText" } } } } } }],
    retired: [], projects: null, hostRows: { a1: { projectId: null } },
  });
  const imageItem = (queueId: string, clientUserMessageId: string) => ({ queueId, clientUserMessageId, origin: { kind: "other", clientId: "desktop" }, input: [{ type: "text", text: "look", text_elements: [] }, { type: "localImage", path: "/host/attachments/a.png" }], position: 0, revision: 1, state: "queued", createdAt: "", updatedAt: "" }) as never;
  const running = () => ({
    native: { method: "thread/read", result: { thread: { id: "thread-a1", turns: [{ id: "t1", status: "inProgress", items: [] }] } } },
    historyPage: null,
    checkpoint: { streamId: "s", cursor: 0 },
    cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], pendingServerRequests: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
  });
  async function open(steering: "pathText" | "nativeImage" | "unsupported") {
    mock.responses.set("capabilities", () => ({ featureList: IMAGE_FEATURES, cutexBuild: null }));
    mock.responses.set("local:sidebar", withSteering(steering));
    mock.responses.set("bootstrap", running);
    await start();
    await store.getState().select("a1");
    await settle();
    const feedback = await import("../src/renderer/src/lib/queueInsertFeedback");
    feedback.useQueueInsertFeedback.setState({ byView: {} });
    return feedback;
  }

  it("an explicit 插话 of a draft with images: cutex queues it, then that queue item is steered under the same clientUserMessageId (never starting a turn); the receipt says 已以文件路径插入", async () => {
    const feedback = await open("pathText");
    let sentId = "";
    mock.responses.set("submit", (...args: unknown[]) => {
      sentId = (args[4] as { clientUserMessageId: string }).clientUserMessageId;
      return { disposition: "queued", turnId: null, queue: imageItem("q-img", sentId) };
    });
    mock.responses.set("queuePromote", () => ({ input: [{ type: "text", text: "look" }, { type: "localImage", path: "/host/attachments/a.png" }], clientUserMessageId: sentId, result: { disposition: "steered", turnId: "t1", imageDelivery: "pathText" } }));
    mock.calls.length = 0;
    const result = await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local", steerImages: true });
    expect(result).toMatchObject({ disposition: "queued" });
    await settle();
    const submit = mock.calls.find((c) => c.method === "submit")!;
    expect(submit.args[2]).toBe("auto");
    const promote = mock.calls.filter((c) => c.method === "queuePromote");
    expect(promote).toHaveLength(1);
    expect(promote[0]!.args).toEqual(["a1", "q-img", 1, true, undefined, { ifIdle: "fail" }]);
    const [f] = feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState());
    expect(f).toMatchObject({ state: "inserted", imageDelivery: "pathText" });
    expect(f!.item.clientUserMessageId).toBe(sentId);
    expect(feedback.queueInsertLabel(f!)).toBe("queue.insert.pathText");
    expect(store.getState().pendingSteers[viewKey("local", "a1")]).toEqual([expect.objectContaining({ id: sentId, imageCount: 1, imageDelivery: "pathText" })]);
    feedback.useQueueInsertFeedback.setState({ byView: {} });
  });

  it("an ordinary send (no steerImages) that cutex queues is never steered by the desktop", async () => {
    await open("pathText");
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "queued", turnId: null, queue: imageItem("q-plain", (args[4] as { clientUserMessageId: string }).clientUserMessageId) }));
    mock.calls.length = 0;
    await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local" });
    await settle();
    expect(mock.calls.some((c) => c.method === "queuePromote")).toBe(false);
  });

  it("a refused image steer (imagePathRequired) keeps the message queued and says 需要先上传; nothing is removed", async () => {
    const feedback = await open("pathText");
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "queued", turnId: null, queue: imageItem("q-fail", (args[4] as { clientUserMessageId: string }).clientUserMessageId) }));
    mock.responses.set("queuePromote", () => { throw new Error("Error invoking remote method: Error: queue_steer_refused:imagePathRequired"); });
    mock.calls.length = 0;
    await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local", steerImages: true });
    await settle();
    const [f] = feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState());
    expect(f).toMatchObject({ state: "rejected", reason: "图片需要先上传到这台主机才能插入当前回合：已留在队列，本回合结束后发送" });
    expect(mock.calls.some((c) => c.method === "queueRemove")).toBe(false);
    expect(store.getState().queueHidden[viewKey("local", "a1")] ?? []).not.toContain("q-fail");
    // The sent text and image stay in this agent's queue (the confirmed queued send), not lost.
    expect(store.getState().outbox[viewKey("local", "a1")]).toEqual([expect.objectContaining({ text: "look", state: "confirmed", placement: "queue" })]);
    feedback.useQueueInsertFeedback.setState({ byView: {} });
  });

  it("a paused queue (after 停止) is respected: a draft queued behind it is not steered", async () => {
    await open("pathText");
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "queued", paused: true, turnId: null, queue: imageItem("q-paused", (args[4] as { clientUserMessageId: string }).clientUserMessageId) }));
    mock.calls.length = 0;
    await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local", steerImages: true });
    await settle();
    expect(mock.calls.some((c) => c.method === "queuePromote")).toBe(false);
  });

  it("the turn ended before the steer (noActiveTurn with ifIdle fail): it waits in the queue, not a refusal", async () => {
    const feedback = await open("nativeImage");
    mock.responses.set("submit", (...args: unknown[]) => ({ disposition: "queued", turnId: null, queue: imageItem("q-late", (args[4] as { clientUserMessageId: string }).clientUserMessageId) }));
    mock.responses.set("queuePromote", () => { throw new Error("queue_steer_refused:noActiveTurn"); });
    await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local", steerImages: true });
    await settle();
    expect(feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState())).toEqual([expect.objectContaining({ state: "queued" })]);
    feedback.useQueueInsertFeedback.setState({ byView: {} });
  });

  it("the queue row's 插话 on a runtime that declares unsupported: refused before any request, kept queued, the image wording", async () => {
    const feedback = await open("unsupported");
    mock.calls.length = 0;
    await store.getState().queueSendNow(imageItem("q-unsup", "cm-unsup"), "a1");
    expect(mock.calls.some((c) => c.method === "queuePromote")).toBe(false);
    expect(feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState())).toEqual([expect.objectContaining({ state: "rejected", reason: "这个运行时不能把图片插入正在进行的回合：已留在队列，本回合结束后连同原图发送" })]);
    // A text-only item on the same runtime is not refused locally (cutex decides).
    mock.responses.set("queuePromote", () => { throw new Error("queue_steer_refused:runtimeNoSteer"); });
    await store.getState().queueSendNow(queueItem("q-text", "cm-text", "plain"), "a1");
    expect(feedback.insertFeedbackOf("local", "a1")(feedback.useQueueInsertFeedback.getState())[1]).toMatchObject({ state: "rejected", reason: "这个运行时只在回合之间接收新消息：已留在队列，本回合结束后发送" });
    feedback.useQueueInsertFeedback.setState({ byView: {} });
  });

  it("cutex/userInput/submitted with imageDelivery marks the pending steer; without it nothing is said", async () => {
    await open("nativeImage");
    mock.responses.set("submit", () => ({ disposition: "steered", turnId: "t1" }));
    const result = await store.getState().submit("look", "auto", [{ type: "image", url: PNG }], { sessionId: "a1", hostId: "local" });
    expect(result).toMatchObject({ disposition: "steered" });
    const key = viewKey("local", "a1");
    const [pending] = store.getState().pendingSteers[key]!;
    expect(pending!.imageDelivery).toBeUndefined();
    sessionEvent("a1", cutex("a1", "cutex/userInput/submitted", { clientUserMessageId: pending!.id, disposition: "steered", turnId: "t1", imageDelivery: "nativeImage" }));
    expect(store.getState().pendingSteers[key]).toEqual([expect.objectContaining({ id: pending!.id, imageDelivery: "nativeImage" })]);
  });
});
