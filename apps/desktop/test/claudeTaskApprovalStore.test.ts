// r295 declined-approval flag on background Claude subagent rows (audit-1124-ui P2-3): scoped by host and the
// parent runtime generation like the subagent task state; an older runtime replay never sets it; a re-read forgets it.
// Harness copied from streamBatching.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Warm the transform cache once (as backgroundWorkStore.test.ts): the first store import is slow under the full suite.
beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("document", { hasFocus: () => false });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
  await import("../src/renderer/src/store");
  await import("../src/renderer/src/lib/shell");
  await import("../src/renderer/src/lib/notifyEvents");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
}, 60_000);
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

const REF = "claude:native-a1:task:bg";
const bgItems = (): Item[] => [
  { type: "dynamicToolCall", id: "c1", namespace: "claude", tool: "Agent", arguments: { run_in_background: true }, status: "completed", contentItems: [], success: true, agentThreadId: REF },
  { type: "subAgentActivity", id: "s1", kind: "started", agentThreadId: REF, agentPath: "/claude/bg" },
];
const taskUpdate = (generation: number, denied: boolean) => {
  const e = native("a1", "claude/task/updated", { threadId: "thread-a1", task: { taskId: "bg", taskType: "local_agent", status: "running", ...(denied ? { approvalState: "deniedUnattended" } : {}) } });
  return { ...e, correlation: { runtimeGeneration: generation } } as EventEnvelope;
};

describe("declined-approval flag (lib/claudeTaskApprovals)", () => {
  it("an older runtime's replay never sets or clears it; the current runtime's does; a re-read forgets it", async () => {
    await startConnected();
    const t = thread("a1", [turn("t1", "inProgress", bgItems())]);
    threads.set("a1", { ...t, cutexState: { ...t.cutexState, runtime: { runtimeGeneration: 2 } } });
    mock.responses.set("bootstrap", bootById);
    await store.getState().select("a1");
    await settle();
    const approvals = await import("../src/renderer/src/lib/claudeTaskApprovals");
    const denied = () => !!approvals.useClaudeTaskApprovals.getState().byKey[approvals.claudeTaskApprovalKey("local", REF)];
    expect(store.getState().sessions[viewKey("local", "a1")]!.runtimeGeneration).toBe(2);
    transport.session("a1", taskUpdate(1, true));
    expect(denied()).toBe(false);
    transport.session("a1", taskUpdate(2, true));
    expect(denied()).toBe(true);
    // Keyed by host: the same task reference on another host is a different task.
    expect(approvals.useClaudeTaskApprovals.getState().byKey[approvals.claudeTaskApprovalKey("other", REF)]).toBeUndefined();
    transport.session("a1", taskUpdate(1, false));
    expect(denied()).toBe(true);
    // Reading the timeline again: what earlier feeds said is forgotten until the next update.
    await store.getState().reloadSession("a1", "local");
    await settle();
    expect(denied()).toBe(false);
    transport.session("a1", taskUpdate(2, true));
    expect(denied()).toBe(true);
    transport.session("a1", taskUpdate(2, false));
    expect(denied()).toBe(false);
  });
});
