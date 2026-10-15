// Multi-host P0 acceptance (docs/research/multi-host-rfc-20261009.md §6.4): with the view scope set to
// one host, the store behaves exactly as with the single-host desktop. These tests pin today's
// behaviour (API calls, state, notifications, attention count, host switch reset) through the real
// store and sub-stores. Only the `transport` helpers below know the IPC event shapes, so the
// multi-host change may adapt them but not the expectations.
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
const sidebar = () => ({ active: [resource("a1", "Alpha"), resource("b2", "Beta")], retired: [], projects: null, hostRows: { a1: { projectId: "p1" }, b2: { projectId: null } } });
const boot = () => ({
  native: null,
  historyPage: null,
  checkpoint: { streamId: "stream", cursor: "c0" },
  cutexState: { runtime: { runtimeGeneration: 1 }, userInputQueue: [], userInputQueuePause: null, asksPaused: null, pendingServerRequests: [], latestPlan: null, latestTokenUsage: null, agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
});
const approval = (id: string) => ({ approvalId: id, kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "a1", summary: `summary ${id}`, details: null, requestSha256: "x", state: "pending", createdAt: "2026-10-10T10:00:00Z" });
const note = (id: string) => ({ notificationId: id, agentId: "b2", agentName: "Beta", origin: "agent", text: "look", level: "attention", requestedLevel: "attention", downgraded: null, muted: false, channels: ["desktop"], needsReply: true, delegation: null, job: null, turnId: null, state: "open", createdAt: "2026-10-10T10:00:00.000Z", acknowledgedAt: null, reply: null, closedAt: null });
const FEATURES = ["owner-approvals", "owner-messages", "services", "queue-pause"];
const envelope = (sessionId: string, part: Partial<EventEnvelope>) => ({ cutexSessionId: sessionId, source: "cutex", correlation: {}, ...part }) as EventEnvelope;
const native = (sessionId: string, method: string, params: unknown) => envelope(sessionId, { source: "app_server", native: { kind: "notification", message: { method, params } } } as Partial<EventEnvelope>);
const request = (sessionId: string, id: number, method: string) => envelope(sessionId, { source: "app_server", native: { kind: "serverRequest", message: { id, method, params: {} } } } as Partial<EventEnvelope>);
const cutex = (sessionId: string, method: string, params: unknown) => envelope(sessionId, { cutex: { method, params } } as Partial<EventEnvelope>);

let store: (typeof import("../src/renderer/src/store"))["useApp"];
let shell: typeof import("../src/renderer/src/lib/shell");
let marks: typeof import("../src/renderer/src/lib/turnUnread");
let notes: typeof import("../src/renderer/src/lib/ownerNotifyStore");
let occurrences: NotifyOccurrence[];

const tracked = new Set(["hosts", "daemonState", "sidebar", "capabilities", "services", "approvals", "ownerNotifications", "bootstrap", "subscribe", "unsubscribe", "submit"]);
const callLog = () => mock.calls.filter((c) => tracked.has(c.method)).map((c) => c.method);
/** The same calls, order aside (independent requests may go out in either order). */
const callSet = () => callLog().sort();
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
  mock.responses.set("approvals", () => [approval("apr-1")]);
  mock.responses.set("ownerNotifications", () => []);
  mock.responses.set("bootstrap", boot);
  mock.responses.set("submit", () => ({ disposition: "started", turnId: "turn-x" }));
  store = (await import("../src/renderer/src/store")).useApp;
  shell = await import("../src/renderer/src/lib/shell");
  marks = await import("../src/renderer/src/lib/turnUnread");
  notes = await import("../src/renderer/src/lib/ownerNotifyStore");
  occurrences = [];
  (await import("../src/renderer/src/lib/notifyEvents")).setNotifyHandler((o) => void occurrences.push(o));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("single host: startup", () => {
  it("handshake, then sidebar + capabilities, then services / approvals / owner notes", async () => {
    await startConnected();
    expect(callLog().slice(0, 2)).toEqual(["hosts", "daemonState"]);
    expect(callSet()).toEqual(["approvals", "capabilities", "daemonState", "hosts", "ownerNotifications", "services", "sidebar"]);
    const s = store.getState();
    expect(s.hosts?.active).toBe("local");
    expect(s.daemon).toEqual(CONNECTED);
    expect(s.sidebar?.active.map((r) => r.cutexSessionId)).toEqual(["a1", "b2"]);
    expect([...s.features].sort()).toEqual([...FEATURES].sort());
    expect(s.featuresKnown).toBe(true);
    expect(s.services).toEqual([]);
    expect(s.approvals?.map((a) => a.approvalId)).toEqual(["apr-1"]);
    expect(s.selectedId).toBeNull();
  });
});

describe("single host: host feed", () => {
  it("a finished turn of an agent not looked at: unread mark + one notification that opens it", async () => {
    await startConnected();
    transport.host(native("a1", "turn/completed", { turn: { id: "t1", status: "completed" } }));
    // The mark waits for the host's decision (the handler leaves it when the level's `mark` is on).
    expect(marks.getTurnMarks().a1).toBeUndefined();
    expect(occurrences).toHaveLength(1);
    occurrences[0]!.mark!();
    expect(marks.getTurnMarks().a1).toMatchObject({ failed: false, turnId: "t1" });
    expect(occurrences[0]).toMatchObject({ key: "turn:a1:t1", events: ["turn.other.completed"], fallback: [], agentId: "a1", agentName: "Alpha", projectId: "p1", title: "Alpha", looking: false });
    mock.calls.length = 0;
    occurrences[0]!.onClick!();
    await settle();
    expect(store.getState().selectedId).toBe("a1");
    // bootstrap + subscribe of the opened agent; the turn event also refreshed the sidebar (coalesced).
    expect(callSet()).toEqual(["bootstrap", "sidebar", "subscribe"]);
    expect(marks.getTurnMarks().a1).toBeUndefined();
  });

  it("a native approval request notifies (needs input)", async () => {
    await startConnected();
    transport.host(request("b2", 7, "item/commandExecution/requestApproval"));
    expect(occurrences.map((o) => [o.key, o.events, o.fallback, o.agentName, o.projectId])).toEqual([["req:b2:7", ["native.approval"], ["desktop"], "Beta", null]]);
  });

  it("an owner approval request joins the list and notifies; the attention count follows", async () => {
    await startConnected();
    expect(shell.appAttention()).toBe(1);
    transport.host(cutex("cutex.host", "cutex/approvals/changed", { reason: "requested", approval: approval("apr-2") }));
    expect(store.getState().approvals?.map((a) => a.approvalId).sort()).toEqual(["apr-1", "apr-2"]);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ key: "approval:apr-2", events: ["ownerApproval.pending"], agentId: "a1", agentName: "Alpha", projectId: "p1" });
    expect(occurrences[0]!.title.startsWith("Alpha · ")).toBe(true);
    expect(shell.appAttention()).toBe(2);
    transport.host(cutex("b2", "cutex/ownerNotify/created", { notification: note("ntf-1") }));
    expect(Object.keys(notes.useOwnerNotify.getState().byId)).toEqual(["ntf-1"]);
    expect(occurrences.map((o) => o.key)).toEqual(["approval:apr-2", "owner-notify:ntf-1"]);
    expect(shell.appAttention()).toBe(3);
    transport.host(cutex("cutex.host", "cutex/approvals/changed", { reason: "approved", approval: { ...approval("apr-2"), state: "approved" } }));
    expect(shell.appAttention()).toBe(2);
  });

  it("services changes patch the registry from the host feed", async () => {
    await startConnected();
    const service = { slug: "web", status: "running" };
    transport.host(cutex("cutex.host", "cutex/services/changed", { reason: "started", slug: "web", service }));
    expect(store.getState().services).toEqual([service]);
  });
});

describe("single host: conversation", () => {
  it("select loads + subscribes; submit sends once on the selected agent", async () => {
    await startConnected();
    mock.calls.length = 0;
    await store.getState().select("a1");
    expect(callLog()).toEqual(["bootstrap", "subscribe"]);
    expect(mock.calls.find((c) => c.method === "subscribe")!.args).toEqual(["a1", { streamId: "stream", after: "c0" }]);
    mock.calls.length = 0;
    const result = await store.getState().submit("hello", "auto");
    expect(result).toEqual({ disposition: "started", turnId: "turn-x" });
    const sent = mock.calls.filter((c) => c.method === "submit");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args.slice(0, 4)).toEqual(["a1", "hello", "auto", false]);
    expect(store.getState().outbox.a1).toHaveLength(1);
    expect(store.getState().outbox.a1![0]).toMatchObject({ text: "hello", state: "confirmed" });
    // Session events of the selected agent reach its timeline.
    const before = store.getState().sessions.a1!.version;
    transport.session("a1", native("a1", "turn/started", { turn: { id: "turn-x", status: "inProgress" } }));
    expect(store.getState().sessions.a1!.version).toBe(before + 1);
    expect(store.getState().sessions.a1!.timeline.activeTurnId).toBe("turn-x");
  });

  it("a waiting agent (pending request in its timeline) counts for attention", async () => {
    await startConnected();
    await store.getState().select("a1");
    transport.session("a1", request("a1", 9, "item/commandExecution/requestApproval"));
    expect(shell.appAttention()).toBe(2);
  });
});

describe("single host: switching the host", () => {
  it("another host: everything of the old one is forgotten, then the new one loads", async () => {
    await startConnected();
    await store.getState().select("a1");
    store.getState().openSettings("hosts");
    mock.responses.set("sidebar", () => ({ active: [resource("r1", "Remote")], retired: [], projects: null, hostRows: {} }));
    mock.responses.set("approvals", () => []);
    mock.calls.length = 0;
    transport.hosts("ssh-1", true);
    const s = store.getState();
    expect(s.hosts?.active).toBe("ssh-1");
    expect(s.selectedId).toBeNull();
    expect(s.sessions).toEqual({});
    expect(s.sidebar).toBeNull();
    expect(s.features.size).toBe(0);
    expect(s.featuresKnown).toBe(false);
    expect(s.approvals).toBeNull();
    expect(s.services).toBeNull();
    expect(s.view).toEqual({ kind: "page", page: "shell.settings", params: { tab: "hosts" } });
    expect(shell.appAttention()).toBe(0);
    transport.daemon({ kind: "connecting", baseUrl: "ssh://remote" });
    transport.daemon({ kind: "connected", baseUrl: "fake://remote", hostId: "WORKSTATION" });
    await settle();
    expect(callSet()).toEqual(["approvals", "capabilities", "ownerNotifications", "services", "sidebar"]);
    expect(store.getState().sidebar?.active.map((r) => r.cutexSessionId)).toEqual(["r1"]);
    expect(store.getState().daemon).toMatchObject({ kind: "connected", hostId: "WORKSTATION" });
  });

  it("a fresh connection to the same host also starts over; a metadata update does not", async () => {
    await startConnected();
    await store.getState().select("a1");
    transport.hosts("local", false);
    expect(store.getState().selectedId).toBe("a1");
    expect(store.getState().sidebar).not.toBeNull();
    transport.hosts("local", true);
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().sidebar).toBeNull();
  });

  it("a send that fails after the switch comes back as a failed row on its own host", async () => {
    await startConnected();
    await store.getState().select("a1");
    let fail!: (e: Error) => void;
    mock.responses.set("submit", () => new Promise((_, reject) => (fail = reject)));
    const sending = store.getState().submit("lost?", "auto").catch((e: Error) => e.name);
    await settle();
    transport.hosts("ssh-1", true);
    fail(new Error("socket closed"));
    expect(await sending).toBe("AbortError");
    expect(store.getState().outbox).toEqual({});
    transport.hosts("local", true);
    expect(store.getState().outbox.a1?.map((e) => [e.text, e.state])).toEqual([["lost?", "failed"]]);
  });
});
