import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { HostsState, ExtraInput } from "../src/shared/ipc";
import type { SessionView } from "../src/renderer/src/store";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";
import { viewKey } from "../src/renderer/src/lib/viewKey";
const mock = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  api: {
    daemonState: vi.fn(async () => ({
      kind: "connecting"
    })),
    hosts: vi.fn(async () => ({
      active: "local",
      hosts: []
    })),
    submit: vi.fn(),
    stopTurn: vi.fn(),
    bootstrap: vi.fn(),
    queueList: vi.fn(),
    queueResume: vi.fn()
  }
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: mock.api,
  bridge: {
    on: (name: string, callback: (value: unknown) => void) => {
      mock.listeners.set(name, callback);
      return () => {};
    }
  }
}));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  startDelegationSync: () => {},
  useDelegations: {
    getState: () => ({
      reset() {}
    })
  }
}));
vi.mock("../src/renderer/src/lib/jobStore", () => ({
  startJobSync: () => {},
  useJobs: {
    getState: () => ({
      reset() {}
    })
  }
}));
vi.mock("../src/renderer/src/lib/runtimePackageStore", () => ({
  startRuntimePackageSync: () => {}
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({
  startOwnerNotifySync: () => {},
  seedOwnerNotes() {},
  useOwnerNotify: {
    getState: () => ({
      reset() {}
    })
  }
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return {
    promise,
    resolve,
    reject
  };
}
let store: (typeof import("../src/renderer/src/store"))["useApp"];
let drafts: typeof import("../src/renderer/src/lib/composerDrafts");
const extras: ExtraInput[] = [{
  type: "localImage",
  path: "/local/private.png"
}, {
  type: "skill",
  name: "review",
  path: "/local/SKILL.md"
}];
function switchHost(host: string) {
  mock.listeners.get("hostsState")!({
    scope: { kind: "host", id: host },
    active: host,
    hosts: [],
    groups: [],
    startOn: "local",
    tunnel: null,
    weakSecretStorage: false
  } satisfies HostsState);
}
/** The shown host "local" with connection `epoch` (multi-host P0: epochs are per host connection). */
function route(epoch: string): HostsState {
  return {
    ...store.getState().hosts!,
    scope: { kind: "host", id: "local" },
    groups: [],
    hosts: [{ id: "local", kind: "local", label: "local", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, conn: { epoch, tunnel: null, daemon: { kind: "connecting", baseUrl: "" }, cutexBuild: null } }]
  };
}
function seed() {
  const timeline = emptyTimeline();
  timeline.activeTurnId = "turn-a";
  timeline.threadId = "thread-a";
  const view: SessionView = {
    timeline,
    queue: [],
    queuePause: null,
    asksPaused: null,
    loading: false,
    error: null,
    resyncing: false,
    connection: "live",
    runtimeGeneration: 1,
    version: 0,
    historySource: "live",
    startError: null,
    older: null
  };
  store.setState({
    selectedId: "same",
    sessions: {
      [viewKey("local", "same")]: view
    },
    features: new Set(["queue-pause"]),
    pendingSteers: {
      [viewKey("local", "same")]: [{
        id: "steer-a",
        text: "accepted steer",
        turnId: "turn-a",
        baseline: 0,
        imageCount: 0,
        state: "waiting"
      }]
    }
  });
}
function sentinel() {
  store.setState({
    pendingSteers: {},
    outbox: {},
    queueHandoff: {
      [viewKey("local", "same")]: true
    }
  });
  return store.getState();
}
function expectUntouched(previous: ReturnType<typeof sentinel>) {
  expect(store.getState().pendingSteers).toBe(previous.pendingSteers);
  expect(store.getState().outbox).toBe(previous.outbox);
  expect(store.getState().queueHandoff).toBe(previous.queueHandoff);
  expect(mock.api.bootstrap).not.toHaveBeenCalled();
  expect(mock.api.queueResume).not.toHaveBeenCalled();
  expect(mock.api.queueList).not.toHaveBeenCalled();
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mock.listeners.clear();
  store = (await import("../src/renderer/src/store")).useApp;
  drafts = await import("../src/renderer/src/lib/composerDrafts");
  store.getState().init();
  await Promise.resolve();
  seed();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("host-scoped send continuations", () => {
  it.each([false, true])("cancels stop success across host change (ABA=%s), restoring only unsent tail once", async aba => {
    const stop = deferred<{
      paused: boolean;
      alreadyPaused: boolean;
    }>();
    mock.api.stopTurn.mockReturnValue(stop.promise);
    const operation = store.getState().interruptAndSend("tail", extras);
    switchHost("remote");
    if (aba) switchHost("local");
    const previous = sentinel();
    stop.resolve({
      paused: true,
      alreadyPaused: false
    });
    expect(await operation).toBe(false);
    await vi.runAllTimersAsync();
    expect(mock.api.submit).not.toHaveBeenCalled();
    expectUntouched(previous);
    const original = drafts.composerDrafts.read(drafts.composerDraftKey("local", "same"));
    expect(original.text).toBe("tail");
    expect(original.images).toHaveLength(1);
    expect(original.pickedSkills).toHaveLength(1);
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("remote", "same")).text).toBe("");
  });
  it("stale stop failure cannot execute current-host catch/finally effects", async () => {
    const stop = deferred<never>();
    mock.api.stopTurn.mockReturnValue(stop.promise);
    const operation = store.getState().interruptAndSend("tail", extras);
    switchHost("remote");
    const previous = sentinel();
    stop.reject(Error("stop failed"));
    expect(await operation).toBe(false);
    await vi.runAllTimersAsync();
    expectUntouched(previous);
  });
  it("marks only a submit waiting behind another acknowledgement and clears the phase on dispatch", async () => {
    const first = deferred<null>(), second = deferred<null>();
    mock.api.submit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(null);
    const one = store.getState().submit("first", "auto");
    const two = store.getState().submit("second", "auto");
    await Promise.resolve();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    const entries = store.getState().outbox[viewKey("local", "same")]!;
    expect(entries.find((entry) => entry.text === "first")?.waitingForPrevious).toBe(false);
    expect(entries.find((entry) => entry.text === "second")?.waitingForPrevious).toBe(true);
    first.resolve(null);
    await one;
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(mock.api.submit).toHaveBeenCalledTimes(2);
    expect(store.getState().outbox[viewKey("local", "same")]!.find((entry) => entry.text === "second")?.waitingForPrevious).toBe(false);
    second.resolve(null);
    await two;
    const three = store.getState().submit("third", "auto");
    expect(store.getState().outbox[viewKey("local", "same")]!.find((entry) => entry.text === "third")?.waitingForPrevious).not.toBe(true);
    await three;
    expect(mock.api.submit.mock.calls.map((call) => call[1])).toEqual(["first", "second", "third"]);
  });
  it.each([false, true])("never dispatches queued second send after first settles stale (success=%s)", async success => {
    const first = deferred<null>();
    mock.api.submit.mockReturnValue(first.promise);
    const one = store.getState().submit("already dispatched", "auto").catch(e => e);
    const two = store.getState().submit("still queued", "auto", extras).catch(e => e);
    await Promise.resolve();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    switchHost("remote");
    switchHost("local");
    const previous = sentinel();
    if (success) first.resolve(null);else first.reject(Error("acceptance unknown"));
    expect((await one).name).toBe("AbortError");
    expect((await two).name).toBe("AbortError");
    await vi.runAllTimersAsync();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    if (success) expectUntouched(previous);
    else {
      // Back on the same host (A → B → A): the failed, already-dispatched send is shown again as a
      // failed row under its original id (retry is deduped), never re-sent nor made a new draft.
      const sentId = (mock.api.submit.mock.calls[0]![4] as { clientUserMessageId: string }).clientUserMessageId;
      expect(store.getState().outbox[viewKey("local", "same")]).toMatchObject([{ id: sentId, text: "already dispatched", state: "failed", error: "acceptance unknown" }]);
      expect(store.getState().pendingSteers).toBe(previous.pendingSteers);
      expect(store.getState().queueHandoff).toBe(previous.queueHandoff);
    }
    const original = drafts.composerDrafts.read(drafts.composerDraftKey("local", "same"));
    expect(original.text).toBe("still queued");
    expect(original.images).toHaveLength(1);
    expect(original.pickedSkills).toHaveLength(1);
  });
  it("a dispatched send failing after a host switch comes back as a failed row on its host, not lost", async () => {
    const first = deferred<null>();
    mock.api.submit.mockReturnValue(first.promise);
    const one = store.getState().submit("in flight", "auto").catch(e => e);
    await Promise.resolve();
    const sentId = (mock.api.submit.mock.calls[0]![4] as { clientUserMessageId: string }).clientUserMessageId;
    switchHost("remote");
    first.reject(Error("connection closed"));
    expect((await one).name).toBe("AbortError");
    // Not on the other host, and no new-id draft anywhere.
    expect(store.getState().outbox).toEqual({});
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("");
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("remote", "same")).text).toBe("");
    switchHost("local");
    expect(store.getState().outbox[viewKey("local", "same")]).toMatchObject([{ id: sentId, text: "in flight", state: "failed" }]);
    // Restored once; from then on it is ordinary outbox state (a host switch resets it, O2).
    switchHost("remote");
    switchHost("local");
    expect(store.getState().outbox).toEqual({});
    await vi.runAllTimersAsync();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
  });

  it("cancels after a pending history check without re-sending an accepted steer", async () => {
    mock.api.stopTurn.mockResolvedValue({
      paused: true,
      alreadyPaused: false
    });
    const boot = deferred<never>();
    mock.api.bootstrap.mockReturnValue(boot.promise);
    const operation = store.getState().interruptAndSend("tail", extras);
    await Promise.resolve();
    expect(mock.api.bootstrap).toHaveBeenCalledTimes(1);
    switchHost("remote");
    const previous = sentinel();
    boot.reject(Error("old history unavailable"));
    expect(await operation).toBe(false);
    await vi.runAllTimersAsync();
    expect(mock.api.submit).not.toHaveBeenCalled();
    expect(mock.api.queueResume).not.toHaveBeenCalled();
    expect(store.getState().pendingSteers).toBe(previous.pendingSteers);
    expect(store.getState().queueHandoff).toBe(previous.queueHandoff);
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("tail");
  });
  it("does not turn a queued retry with unknown acceptance into a new-ID draft", async () => {
    mock.api.submit.mockRejectedValueOnce(Error("acceptance unknown"));
    await store.getState().submit("uncertain retry", "auto").catch(() => {});
    const failed = store.getState().outbox[viewKey("local", "same")]![0]!;
    const blocker = deferred<null>();
    mock.api.submit.mockReturnValue(blocker.promise);
    const blocking = store.getState().submit("blocker", "auto").catch(() => {});
    store.getState().retrySend("same", failed.id);
    await Promise.resolve();
    expect(mock.api.submit).toHaveBeenCalledTimes(2);
    switchHost("remote");
    blocker.resolve(null);
    await blocking;
    await vi.runAllTimersAsync();
    expect(mock.api.submit).toHaveBeenCalledTimes(2);
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("");
  });
  it("a queued merged send restores only its unsent tail once, not its earlier accepted steers", async () => {
    const blocker = deferred<null>();
    mock.api.submit.mockReturnValue(blocker.promise);
    const blocking = store.getState().submit("blocker", "auto").catch(() => {});
    await Promise.resolve();
    mock.api.stopTurn.mockResolvedValue({
      paused: true,
      alreadyPaused: false
    });
    mock.api.bootstrap.mockResolvedValue({
      native: null
    });
    const operation = store.getState().interruptAndSend("tail", extras);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    switchHost("remote");
    blocker.resolve(null);
    await blocking;
    expect(await operation).toBe(false);
    await vi.runAllTimersAsync();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    const original = drafts.composerDrafts.read(drafts.composerDraftKey("local", "same"));
    expect(original.text).toBe("tail");
    expect(original.images).toHaveLength(1);
    expect(original.pickedSkills).toHaveLength(1);
  });
  it("fresh routing epoch on the same host cancels a held stop and restores unsent tail", async () => {
    const host = route("route-1");
    store.setState({
      hosts: host
    });
    const stop = deferred<{
      paused: boolean;
      alreadyPaused: boolean;
    }>();
    mock.api.stopTurn.mockReturnValue(stop.promise);
    const operation = store.getState().interruptAndSend("tail", extras);
    mock.listeners.get("hostsState")!(route("route-2"));
    const previous = sentinel();
    stop.resolve({
      paused: true,
      alreadyPaused: false
    });
    expect(await operation).toBe(false);
    await vi.runAllTimersAsync();
    expectUntouched(previous);
    expect(mock.api.submit).not.toHaveBeenCalled();
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("tail");
  });
  it("same-host new route cancels a queued send, while same-route metadata preserves the operation", async () => {
    const host = route("route-1");
    store.setState({
      hosts: host
    });
    const first = deferred<null>();
    mock.api.submit.mockReturnValue(first.promise);
    const one = store.getState().submit("first", "auto").catch(e => e);
    const two = store.getState().submit("queued", "auto", extras).catch(e => e);
    await Promise.resolve();
    const current = store.getState();
    mock.listeners.get("hostsState")!({
      ...host,
      weakSecretStorage: true
    });
    expect(store.getState().sessions).toBe(current.sessions);
    expect(store.getState().outbox).toBe(current.outbox);
    mock.listeners.get("hostsState")!(route("route-2"));
    const previous = sentinel();
    first.resolve(null);
    expect((await one).name).toBe("AbortError");
    expect((await two).name).toBe("AbortError");
    await vi.runAllTimersAsync();
    expectUntouched(previous);
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("queued");
  });
  it("same routing epoch metadata does not cancel a held send", async () => {
    const host = route("route-1");
    store.setState({
      hosts: host
    });
    const first = deferred<null>();
    mock.api.submit.mockReturnValue(first.promise);
    const pending = store.getState().submit("same route", "auto");
    await Promise.resolve();
    mock.listeners.get("hostsState")!({
      ...host,
      weakSecretStorage: true
    });
    first.resolve(null);
    expect(await pending).toBeNull();
    expect(mock.api.submit).toHaveBeenCalledTimes(1);
    expect(drafts.composerDrafts.read(drafts.composerDraftKey("local", "same")).text).toBe("");
  });
});
