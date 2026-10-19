// r244 acceptance, issue 2 (2026-10-18): a message steered into a running turn showed 「接下来 1 · ↳ … 下一步」
// long after that turn had ended. The owner left the agent before the native recorded the steer: only
// the open agent's session feed is subscribed, so the userMessage landed unseen, and re-opening the
// agent re-read the history without settling the pending steer. Now load() settles them.
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
const sidebar = () => ({ active: [resource("a1", "Alpha"), resource("b2", "Beta")], retired: [], projects: null, hostRows: { a1: { projectId: "p1" }, b2: { projectId: null } } });
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

describe("r244 issue 2: a steer that landed while the agent was not open", () => {
  it("re-opening the agent settles it: no 「接下来 · ↳ … 下一步」 row after its turn ended", async () => {
    await startConnected();
    // The Director is running turn t1; the owner sends 删掉了，已经 (Enter while busy = steer).
    mock.responses.set("bootstrap", () => thread("a1", [turn("t1", "inProgress", [user("u0", "总之：OK", "c0")])]));
    await store.getState().select("a1");
    mock.responses.set("submit", () => ({ disposition: "steered", turnId: "t1" }));
    await store.getState().submit("删掉了，已经", "auto");
    await settle();
    const steer = store.getState().pendingSteers[viewKey("local", "a1")]?.[0];
    expect(steer).toMatchObject({ text: "删掉了，已经", turnId: "t1", state: "waiting" });
    // The owner opens another agent before cute-codex reads the steer (its next sampling step):
    // the Director's feed is closed, so the userMessage and turn/completed are not seen here.
    mock.responses.set("bootstrap", () => thread("b2", []));
    await store.getState().select("b2");
    expect(mock.calls.some((c) => c.method === "unsubscribe" && c.args[0] === "a1")).toBe(true);
    // Back on the Director: its history has the steer in t1, which finished with the final report.
    mock.responses.set("bootstrap", () => thread("a1", [turn("t1", "completed", [user("u0", "总之：OK", "c0"), user("u1", "删掉了，已经", steer!.id), reply("m1", "验收完成")])]));
    mock.calls.length = 0;
    await store.getState().select("a1");
    await settle();
    expect(store.getState().sessions[viewKey("local", "a1")]!.timeline.activeTurnId).toBeNull();
    expect(store.getState().pendingSteers[viewKey("local", "a1")] ?? []).toEqual([]);
    // Recorded in the history it was read with: no second history read (the lost-steer check).
    expect(mock.calls.filter((c) => c.method === "bootstrap")).toHaveLength(1);
  });

  it("a steer its (ended) turn did not record is re-checked, not left waiting", async () => {
    await startConnected();
    mock.responses.set("bootstrap", () => thread("a1", [turn("t1", "inProgress", [])]));
    await store.getState().select("a1");
    mock.responses.set("submit", () => ({ disposition: "steered", turnId: "t1" }));
    await store.getState().submit("lost", "auto");
    await settle();
    mock.responses.set("bootstrap", () => thread("b2", []));
    await store.getState().select("b2");
    // t1 was interrupted (cute-codex drops unread steers): the history has no such message.
    mock.responses.set("bootstrap", () => thread("a1", [turn("t1", "interrupted", [])]));
    await store.getState().select("a1");
    await settle();
    expect(store.getState().pendingSteers[viewKey("local", "a1")]?.map((p) => [p.text, p.state])).toEqual([["lost", "undelivered"]]);
  });
});

describe("r244 issue 3: an approval of an agent that is not open", () => {
  it("shows at once (needs-you rows, attention count) and goes when answered elsewhere or its turn ends", async () => {
    await startConnected();
    mock.responses.set("bootstrap", () => thread("a1", []));
    await store.getState().select("a1");
    expect(shell.appAttention()).toBe(0);
    // 乙 (b2, never opened) asks to run a tool: only the host feed carries it.
    transport.host(request("b2", 7, "item/commandExecution/requestApproval"));
    expect(store.getState().hostWaiting).toEqual({ b2: ["item/commandExecution/requestApproval"] });
    expect(shell.appAttention()).toBe(1);
    const { pendingByAgent } = await import("../src/renderer/src/lib/sidebar");
    const { focusSessionViews } = await import("../src/renderer/src/store");
    expect(pendingByAgent(focusSessionViews(store.getState()), store.getState().hostWaiting)).toEqual({ b2: ["item/commandExecution/requestApproval"] });
    // A question keeps its method (the 需要你 reason is 回答, not 确认).
    transport.host(request("b2", 8, "item/tool/requestUserInput"));
    expect(store.getState().hostWaiting.b2).toEqual(["item/commandExecution/requestApproval", "item/tool/requestUserInput"]);
    transport.host(native("b2", "serverRequest/resolved", { requestId: 7 }));
    expect(store.getState().hostWaiting).toEqual({ b2: ["item/tool/requestUserInput"] });
    transport.host(native("b2", "turn/completed", { turn: { id: "t9", status: "interrupted" } }));
    expect(store.getState().hostWaiting).toEqual({});
    expect(shell.appAttention()).toBe(0);
  });

  it("a cached view of an agent opened earlier neither hides a new request nor keeps an answered one", async () => {
    await startConnected();
    mock.responses.set("bootstrap", () => thread("b2", []));
    await store.getState().select("b2");
    mock.responses.set("bootstrap", () => thread("a1", []));
    await store.getState().select("a1");
    // b2's cached view (no pending, feed closed) stays; a new request still counts.
    expect(store.getState().sessions[viewKey("local", "b2")]).toBeDefined();
    transport.host(request("b2", 3, "item/fileChange/requestApproval"));
    expect(shell.appAttention()).toBe(1);
    // Opened again: its view has the request (bootstrap) — one agent, counted once.
    mock.responses.set("bootstrap", () => thread("b2", [turn("t2", "inProgress", [])], [{ runtimeGeneration: 1, native: { id: 3, method: "item/fileChange/requestApproval", params: {} } }]));
    await store.getState().select("b2");
    mock.responses.set("bootstrap", () => thread("a1", []));
    await store.getState().select("a1");
    expect(store.getState().sessions[viewKey("local", "b2")]!.timeline.pending.size).toBe(1);
    expect(shell.appAttention()).toBe(1);
    // Answered on the phone while b2 is not open: its cached view lets go of it too.
    transport.host(native("b2", "serverRequest/resolved", { requestId: 3 }));
    expect(store.getState().sessions[viewKey("local", "b2")]!.timeline.pending.size).toBe(0);
    expect(shell.appAttention()).toBe(0);
  });
});
