import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import type { HostsState } from "../src/shared/hosts";
import { delegationRefresh } from "../src/renderer/src/lib/delegationRefresh";

const mocks = vi.hoisted(() => ({
  asks: vi.fn<(filter: Record<string, unknown>) => Promise<unknown[] | null>>(),
  ask: vi.fn<(id: string) => Promise<unknown>>(),
  listeners: new Map<string, (value: any) => void>(),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: mocks, apiFor: () => mocks,
  bridge: { on: (name: string, fn: (value: any) => void) => {
    mocks.listeners.set(name, fn);
    return () => mocks.listeners.delete(name);
  } }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m,
}));
const { ASKS_FEATURE } = await import("../src/renderer/src/lib/delegations");
const store = await import("../src/renderer/src/lib/delegationStore");
const { focusHostId, hostKey } = await import("../src/renderer/src/lib/hostKeys");
const host = focusHostId();
const row = (askId: string, revision = 1): AskSummary => ({ askId, revision, closed: null, execution: "answered", review: "awaitingAcceptance", target: "worker", requester: { kind: "agent", cutexSessionId: "director" } }) as AskSummary;
const rows = (hostId = host) => store.hostDelegations(store.useDelegations.getState().byKey, hostId);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const event = () => mocks.listeners.get("hostEvent")!({ hostId: host, envelope: { cutex: { method: "cutex/ask/progress", params: {} } } });
let stop: () => void;
let state: ReturnType<typeof appState>;
const appState = () => ({ hosts: undefined as HostsState | undefined, features: new Set([ASKS_FEATURE]), selectedId: null, selectedHost: null, byHost: { remote: { features: new Set([ASKS_FEATURE]) } }, notify() {} });
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  mocks.asks.mockReset().mockResolvedValue([]);
  mocks.ask.mockReset().mockResolvedValue(null);
  state = appState();
  stop = store.startDelegationSync({ getState: () => state, subscribe: () => () => {} });
  await vi.advanceTimersByTimeAsync(0);
  store.useDelegations.getState().reset();
  mocks.asks.mockClear();
});
afterEach(() => { stop(); vi.useRealTimers(); });

describe("delegation refresh load and lifecycle", () => {
  it.each([true, false])("settles a rejected helper run (immediate=%s) and permits a later request", async immediate => {
    const run = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("failed read")).mockResolvedValue(undefined);
    const refresh = delegationRefresh(run);
    const first = refresh.request(immediate);
    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toBeUndefined();
    const next = refresh.request();
    await vi.advanceTimersByTimeAsync(1000);
    await next;
    expect(run).toHaveBeenCalledTimes(2);
    refresh.dispose();
  });

  it("a rejected helper run preserves exactly one dirty trailing refresh", async () => {
    const read = deferred<void>();
    const run = vi.fn<() => Promise<void>>().mockReturnValueOnce(read.promise).mockResolvedValue(undefined);
    const refresh = delegationRefresh(run);
    const first = refresh.request(true);
    for (let i = 0; i < 100; i++) expect(refresh.request()).toBe(first);
    read.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(run).toHaveBeenCalledTimes(2);
    refresh.dispose();
  });

  it.each(["resolve", "reject"])("dispose settles active waiters; old %s cannot settle the replacement generation", async outcome => {
    const oldRead = deferred<void>();
    const oldRun = vi.fn(() => oldRead.promise);
    const old = delegationRefresh(oldRun);
    const done = old.request(true);
    old.request();
    old.dispose();
    await expect(done).resolves.toBeUndefined();
    const freshRead = deferred<void>();
    const fresh = delegationRefresh(() => freshRead.promise);
    let finished = false;
    const pending = fresh.request(true).then(() => { finished = true; });
    if (outcome === "resolve") oldRead.resolve();
    else oldRead.reject(new Error("old connection"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(finished).toBe(false);
    expect(oldRun).toHaveBeenCalledTimes(1);
    freshRead.resolve();
    await pending;
    expect(finished).toBe(true);
    fresh.dispose();
  });

  it.each(["missing", "empty", "failure"])("retains unknown rows when closed list is %s, then retries", async (mode) => {
    store.useDelegations.setState({ byKey: store.mergeHostRows({}, host, [row("unresolved")]) });
    mocks.asks.mockImplementation(async f => {
      if (f.state !== "closed") return [];
      if (mode === "failure") throw new Error("offline");
      return mode === "missing" ? null : [];
    });
    await store.refreshOpenDelegations();
    expect(rows().unresolved!.closed).toBeNull();
    mocks.asks.mockImplementation(async f => f.state === "closed" ? [{ ...row("unresolved", 2), closed: "completed" }] : []);
    const retry = store.refreshOpenDelegations();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(rows().unresolved!.closed).toBe("completed");
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("shares inflight and collapses a burst to one trailing refresh with no overlap", async () => {
    const first = deferred<unknown[]>();
    mocks.asks.mockReturnValueOnce(first.promise);
    const shared = store.refreshOpenDelegations();
    for (let i = 0; i < 100; i++) expect(store.refreshOpenDelegations()).toBe(shared);
    for (let i = 0; i < 100; i++) event();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.asks).toHaveBeenCalledTimes(1);
    first.resolve([]);
    await vi.advanceTimersByTimeAsync(299);
    expect(mocks.asks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await shared;
    expect(mocks.asks).toHaveBeenCalledTimes(2);
  });

  it("has bounded event latency and minimum intervals under a continuous event stream", async () => {
    const starts: number[] = [];
    mocks.asks.mockImplementation(async () => { starts.push(Date.now()); return []; });
    for (let i = 0; i < 65; i++) { event(); await vi.advanceTimersByTimeAsync(100); }
    expect(starts.length).toBeGreaterThanOrEqual(6);
    expect(starts[0]).toBe(1_000_300);
    expect(starts.slice(1).every((t, i) => t - starts[i]! === 1000)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    const count = starts.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(starts).toHaveLength(count);
  });

  it("isolates hosts and drops old reads even after the same host is watched again", async () => {
    const old = deferred<unknown[]>();
    mocks.asks.mockReturnValueOnce(old.promise);
    const unwatch = store.watchDelegationHost("remote");
    await store.refreshOpenDelegations(host);
    expect(mocks.asks).toHaveBeenCalledTimes(2);
    unwatch();
    const unwatchAgain = store.watchDelegationHost("remote");
    await vi.advanceTimersByTimeAsync(0);
    old.resolve([row("stale")]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rows("remote").stale).toBeUndefined();
    expect(store.useDelegations.getState().hostLoadedAt.remote).toBeDefined();
    unwatchAgain();
  });

  it.each(["reset", "reconnect", "dispose"])("rejects old open reads after %s and cancels their trailing work", async mode => {
    const old = deferred<unknown[]>();
    mocks.asks.mockReturnValueOnce(old.promise);
    const done = store.refreshOpenDelegations();
    event();
    if (mode === "reset") store.useDelegations.getState().reset();
    if (mode === "dispose") stop();
    if (mode === "reconnect") mocks.listeners.get("daemonState")!({ hostId: host, state: { kind: "connected" } });
    old.resolve([row("stale")]);
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(rows().stale).toBeUndefined();
    expect(mocks.asks.mock.calls.filter(([f]) => f.state === "open")).toHaveLength(mode === "reconnect" ? 2 : 1);
  });

  it.each(["reset", "dispose"])("cancels a pending event timer on %s", async mode => {
    event();
    await vi.advanceTimersByTimeAsync(200);
    if (mode === "reset") store.useDelegations.getState().reset();
    else stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.asks).not.toHaveBeenCalled();
    expect(store.useDelegations.getState().loadedAt).toBeNull();
  });

  it("does not apply an old closed reconciliation after reset", async () => {
    const closed = deferred<unknown[]>();
    store.useDelegations.setState({ byKey: store.mergeHostRows({}, host, [row("old")]) });
    mocks.asks.mockImplementation(f => f.state === "closed" ? closed.promise : Promise.resolve([]));
    const done = store.refreshOpenDelegations();
    await vi.advanceTimersByTimeAsync(0);
    store.useDelegations.getState().reset();
    closed.resolve([{ ...row("old", 2), closed: "completed" }]);
    await done;
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toEqual({});
  });

  it("guards session, overview and detail reads across reset", async () => {
    const session = deferred<unknown[]>();
    const overview = deferred<unknown[]>();
    const detail = deferred<unknown>();
    mocks.asks.mockImplementation(f => f.state === "closed" ? overview.promise : session.promise);
    mocks.ask.mockReturnValueOnce(detail.promise);
    const a = store.loadSessionDelegations("director");
    const b = store.loadClosedDelegations();
    const c = store.loadDelegationDetail(host, "old");
    store.useDelegations.getState().reset();
    mocks.ask.mockResolvedValueOnce({ askId: "new" });
    await store.loadDelegationDetail(host, "old");
    session.resolve([row("old")]); overview.reject(new Error("offline")); detail.resolve({ askId: "old" });
    await Promise.all([a, b, c]);
    expect(rows()).toEqual({});
    expect(store.useDelegations.getState().closedIds).toBeNull();
    expect(store.useDelegations.getState().details[hostKey(host, "old")]).toEqual({ askId: "new" });
  });

  it("ignores host epoch changes before reconnect notification and rejects old feed events", async () => {
    const hosts = (epoch: string) => ({ hosts: [{ id: host, conn: { epoch, daemon: { kind: "connected" } } }] }) as HostsState;
    state.hosts = hosts("first");
    const old = deferred<unknown[]>();
    mocks.asks.mockReturnValueOnce(old.promise);
    const done = store.refreshOpenDelegations();
    state.hosts = hosts("second");
    old.resolve([row("old-connection")]);
    await done;
    expect(rows()).toEqual({});
    await store.refreshOpenDelegations();
    mocks.asks.mockClear();
    mocks.listeners.get("hostEvent")!({ hostId: host, epoch: "first", envelope: { cutex: { method: "cutex/ask/progress", params: {} } } });
    mocks.listeners.get("daemonState")!({ hostId: host, epoch: "first", state: { kind: "connected" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.asks).not.toHaveBeenCalled();
  });

  it("old detail completion cannot unlock the new generation's inflight detail read", async () => {
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    mocks.ask.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const a = store.loadDelegationDetail(host, "same");
    store.useDelegations.getState().reset();
    const b = store.loadDelegationDetail(host, "same");
    old.resolve({ askId: "stale" });
    await a;
    const joined = store.loadDelegationDetail(host, "same");
    expect(joined).toBe(b);
    expect(mocks.ask).toHaveBeenCalledTimes(2);
    fresh.resolve({ askId: "fresh" });
    await b;
    expect(store.useDelegations.getState().details[hostKey(host, "same")]).toEqual({ askId: "fresh" });
  });

  it("reconnect releases a pending closed overview and its old failure cannot clear a new load", async () => {
    const old = deferred<unknown[]>();
    const fresh = deferred<unknown[]>();
    mocks.asks.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const a = store.loadClosedDelegations();
    mocks.listeners.get("daemonState")!({ hostId: host, state: { kind: "connected" } });
    old.reject(new Error("old connection"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.useDelegations.getState().closedLoading).toBe(true);
    fresh.resolve([row("fresh")]);
    await a; // the original expanded-bucket request follows the new connection itself
    expect(store.useDelegations.getState().closedIds).toEqual(["fresh"]);
  });

  it("retains rows and loadedAt on open read failure and retries on a subsequent event", async () => {
    store.useDelegations.setState({ byKey: store.mergeHostRows({}, host, [row("known")]), loadedAt: 99 });
    mocks.asks.mockRejectedValueOnce(new Error("offline"));
    await store.refreshOpenDelegations();
    expect(rows().known).toBeDefined();
    expect(store.useDelegations.getState().loadedAt).toBe(99);
    event();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.useDelegations.getState().loadedAt).toBe(1_001_000);
  });

  it("throttles panel resync and resets its cooldown on reset", async () => {
    expect(store.resyncDelegations(host, undefined, 100)).toBe(true);
    expect(store.resyncDelegations(host, undefined, 101)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    store.useDelegations.getState().reset();
    expect(store.resyncDelegations(host, undefined, 102)).toBe(true);
    expect(store.resyncDelegations("elsewhere", undefined, 100)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
  });
});
