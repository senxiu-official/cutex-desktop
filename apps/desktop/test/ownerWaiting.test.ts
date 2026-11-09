// services.activity.subscribeOwnerWaiting (lib/ownerWaiting.ts): what waits on the owner, item by item, on every
// connected host; agent ↔ agent traffic is not in it; no work without a subscriber.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appListeners = new Set<(s: unknown, p: unknown) => void>();
let appState: Record<string, unknown>;
vi.mock("../src/renderer/src/store", () => ({
  useApp: { getState: () => appState, subscribe: (l: (s: unknown, p: unknown) => void) => (appListeners.add(l), () => appListeners.delete(l)) },
}));
const noteListeners = new Set<(s: unknown, p: unknown) => void>();
let notes: { byId: Record<string, unknown>; others: Record<string, Record<string, unknown>> } = { byId: {}, others: {} };
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({
  useOwnerNotify: { getState: () => notes, subscribe: (l: (s: unknown, p: unknown) => void) => (noteListeners.add(l), () => noteListeners.delete(l)) },
}));
let onScreen = new Set<string>();
vi.mock("../src/renderer/src/lib/workspaces", () => ({ isOnScreen: (ref: { hostId: string; key: string }) => onScreen.has(`${ref.hostId}/${ref.key}`) }));
vi.mock("../src/renderer/src/lib/paneStore", () => ({ usePanes: { subscribe: () => () => {} } }));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({ useSide: { subscribe: () => () => {} } }));

const { ownerWaitingOf, subscribeOwnerWaiting } = await import("../src/renderer/src/lib/ownerWaiting");
const { OWNER_NOTIFY_FEATURE } = await import("../src/shared/ownerNotify");

const view = (...pending: string[]) => ({ timeline: { pending: new Map(pending.map((id) => [id, { method: "item/tool/requestUserInput" }])) } });
const note = (agentId: string, notificationId: string, state = "open") => ({ agentId, notificationId, state, needsReply: true, channels: ["desktop"], origin: "agent", createdAt: "2026-11-08T00:00:00Z" });
const base = () => ({
  hosts: { active: "local", hosts: [] },
  sessions: { "local\na1": view("r1"), "local\na2": view(), "other\nz": view("r9") },
  hostWaiting: { a3: ["item/commandExecution/requestApproval"], a1: ["item/tool/requestUserInput"] },
  approvals: [{ approvalId: "p1", requesterCutexSessionId: "a4" }],
  features: new Set([OWNER_NOTIFY_FEATURE]),
  byHost: { remote: { waiting: { t1: ["q7"] }, approvals: [], features: new Set([OWNER_NOTIFY_FEATURE]) } },
});

beforeEach(() => {
  vi.useFakeTimers();
  appState = base();
  notes = { byId: { n1: note("a5", "n1"), n2: note("a6", "n2", "answered") }, others: { remote: { n3: note("t2", "n3") } } };
  onScreen = new Set();
});
afterEach(() => vi.useRealTimers());

describe("owner waiting", () => {
  it("requests, approvals and pending owner messages of every connected host, one item each", () => {
    const keys = ownerWaitingOf(appState as never).map((i) => `${i.hostId}/${i.agentId}/${i.key.split("\n")[2]}`);
    expect(keys.sort()).toEqual([
      "local/a1/request:r1",
      "local/a3/requests:item/commandExecution/requestApproval",
      "local/a4/approval:p1",
      "local/a5/note:n1",
      "remote/t1/request:q7",
      "remote/t2/note:n3",
    ]);
  });

  it("nothing listens without a subscriber; it answers at once, then on changes, with on-screen", async () => {
    expect(appListeners.size + noteListeners.size).toBe(0);
    const got: { key: string; onScreen: boolean }[][] = [];
    const off = subscribeOwnerWaiting((items) => got.push(items.map((i) => ({ key: i.key, onScreen: i.onScreen }))));
    expect(got).toHaveLength(1);
    expect(got[0]!.every((i) => !i.onScreen)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    onScreen.add("local/a1");
    const prev = appState;
    appState = { ...prev, approvals: [] };
    for (const l of appListeners) l(appState, prev);
    await vi.advanceTimersByTimeAsync(200);
    const last = got.at(-1)!;
    expect(last.some((i) => i.key.includes("approval"))).toBe(false);
    expect(last.find((i) => i.key.includes("r1"))?.onScreen).toBe(true);
    off();
    expect(appListeners.size + noteListeners.size).toBe(0);
  });
});
