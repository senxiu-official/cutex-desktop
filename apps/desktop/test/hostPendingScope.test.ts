import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { HostsState, ExtraInput } from "../src/shared/ipc";
import type { SessionView } from "../src/renderer/src/store";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";
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
    queueResume: vi.fn(),
    createHumanSession: vi.fn(),
    sidebar: vi.fn(),
    collaborationModes: vi.fn(),
    updateThreadSettings: vi.fn(),
    setThreadGoal: vi.fn(),
    history: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
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
      same: view
    },
    features: new Set(["queue-pause"]),
    pendingSteers: {
      same: [{
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
      same: true
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
describe("pending operations retain their host and run", () => {
  it("returns a failed created chat to the current quick-chats module page", async () => {
    const { emptyPendingChat } = await import("../src/renderer/src/lib/pendingChat");
    const pending = {
      ...emptyPendingChat(null),
      sessionId: "same",
      drafts: [{ text: "retained draft", images: [], skills: [] }],
    };
    store.setState({
      pendingChat: pending,
      select: vi.fn(async () => { store.setState({ view: { kind: "conversation" } }); }),
      submit: vi.fn(async () => { throw Error("retryable send failure"); }),
    });
    store.getState().retryPendingChat();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(store.getState().view).toEqual({ kind: "page", page: "quick-chats.draft", params: {} });
    expect(store.getState().pendingChat).toEqual({ ...pending, error: "retryable send failure" });
    expect(store.getState().creatingChat).toBe(false);
    expect(mock.api.createHumanSession).not.toHaveBeenCalled();
  });

  it("a stale plan-mode switch during quick-chat creation stops quietly (no 'plan unavailable')", async () => {
    const { emptyPendingChat } = await import("../src/renderer/src/lib/pendingChat");
    const pending = { ...emptyPendingChat(null), sessionId: "same", plan: true, drafts: [{ text: "A", images: [], skills: [] }] };
    const submit = vi.fn(async () => null);
    store.setState({ pendingChat: pending, select: vi.fn(async () => {}), setCollabMode: vi.fn(async () => null), submit });
    store.getState().retryPendingChat();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(store.getState().pendingChat).toEqual(pending);
    expect(store.getState().pendingChat?.error ?? null).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(store.getState().creatingChat).toBe(false);
    // An actual refusal still reports.
    store.setState({ setCollabMode: vi.fn(async () => false) });
    store.getState().retryPendingChat();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(store.getState().pendingChat?.error).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([false, true])("old steer rejection cannot populate new-host state (ABA=%s)", async aba => {
    const sent = deferred<never>();
    mock.api.submit.mockReturnValue(sent.promise);
    store.setState({
      pendingSteers: {
        same: [{
          id: "old",
          text: "A private",
          extra: extras,
          turnId: "turn-a",
          baseline: 0,
          imageCount: 1,
          state: "undelivered"
        }]
      }
    });
    const operation = store.getState().resendSteer("old");
    switchHost("remote");
    if (aba) switchHost("local");
    const previous = store.getState();
    sent.reject(Error("host switched"));
    await operation;
    expect(store.getState().pendingSteers).toBe(previous.pendingSteers);
    expect(store.getState().notice).toBe(previous.notice);
  });
  it.each([false, true])("old create rejection cannot alter a newer pending chat (ABA=%s)", async aba => {
    const first = deferred<never>(),
      second = deferred<never>();
    mock.api.createHumanSession.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await store.getState().newQuickChat();
    store.getState().queuePendingChat({
      text: "A draft",
      images: [],
      skills: []
    });
    switchHost("remote");
    if (aba) switchHost("local");
    await store.getState().newQuickChat();
    store.getState().queuePendingChat({
      text: "B draft",
      images: [],
      skills: []
    });
    const pending = store.getState().pendingChat;
    first.reject(Error("host switched"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().pendingChat).toBe(pending);
    expect(store.getState().creatingChat).toBe(true);
    second.reject(Error("current failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().pendingChat?.error).toBe("current failure");
    expect(store.getState().creatingChat).toBe(false);
  });
  it("keeps same-host failed steer retry recoverable with attachments", async () => {
    mock.api.submit.mockRejectedValue(Error("offline"));
    store.setState({
      pendingSteers: {
        same: [{
          id: "old",
          text: "A private",
          extra: extras,
          turnId: "turn-a",
          baseline: 0,
          imageCount: 1,
          state: "undelivered"
        }]
      }
    });
    await store.getState().resendSteer("old");
    expect(store.getState().pendingSteers.same?.[0]?.extra).toEqual(extras);
    expect(store.getState().pendingSteers.same?.[0]?.state).toBe("undelivered");
    expect(mock.api.submit).toHaveBeenCalledWith("same", "A private", "auto", false, {
      extra: extras,
      clientUserMessageId: "old"
    });
  });
  it("ignores stale successful steer tracking even when the new host has the same session ID", async () => {
    const sent = deferred<unknown>();
    mock.api.submit.mockReturnValue(sent.promise);
    store.setState({
      pendingSteers: {
        same: [{
          id: "old",
          text: "A private",
          turnId: "turn-a",
          baseline: 0,
          imageCount: 0,
          state: "undelivered"
        }]
      }
    });
    const operation = store.getState().resendSteer("old");
    switchHost("remote");
    seed();
    const pending = store.getState().pendingSteers;
    sent.resolve({
      disposition: "steered",
      turnId: "turn-a"
    });
    await operation;
    expect(store.getState().pendingSteers).toBe(pending);
  });
  it("ignores stale successful creation instead of assigning its session to the new draft", async () => {
    const first = deferred<{
      cutexSessionId: string;
    }>();
    mock.api.createHumanSession.mockReturnValue(first.promise);
    await store.getState().newQuickChat();
    store.getState().queuePendingChat({
      text: "A",
      images: [],
      skills: []
    });
    switchHost("remote");
    await store.getState().newQuickChat();
    const pending = store.getState().pendingChat;
    first.resolve({
      cutexSessionId: "A-created"
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(store.getState().pendingChat).toBe(pending);
    expect(mock.api.sidebar).not.toHaveBeenCalled();
    expect(store.getState().creatingChat).toBe(false);
  });
  it.each(["select", "plan", "goal", "submit"])("stops an old pending run after %s without touching the new run", async stage => {
    const blocked = deferred<true>();
    const {
      emptyPendingChat
    } = await import("../src/renderer/src/lib/pendingChat");
    const pending = {
      ...emptyPendingChat(null),
      sessionId: "same",
      plan: stage === "plan",
      goal: stage === "goal" ? "A goal" : null,
      drafts: [{
        text: "A",
        images: [],
        skills: []
      }]
    };
    const select = vi.fn(async () => {}),
      plan = vi.fn(async () => true),
      goal = vi.fn(async () => {}),
      submit = vi.fn(async () => null);
    const methods = {
      select,
      setCollabMode: plan,
      setGoal: goal,
      submit
    };
    (stage === "select" ? select : stage === "plan" ? plan : stage === "goal" ? goal : submit).mockReturnValue(blocked.promise as never);
    store.setState({
      ...methods,
      pendingChat: pending
    });
    store.getState().retryPendingChat();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    switchHost("remote");
    const replacement = {
      ...emptyPendingChat(null),
      drafts: [{
        text: "B",
        images: [],
        skills: []
      }]
    };
    store.setState({
      pendingChat: replacement,
      creatingChat: true
    });
    blocked.resolve(true);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(store.getState().pendingChat).toBe(replacement);
    expect(store.getState().creatingChat).toBe(true);
    if (stage !== "submit") expect(submit).not.toHaveBeenCalled();
  });
  it.each([true, false])("a quick chat in 自动 gets the auto reviewer (cutex takes it in launch: %s)", async (supported) => {
    const { emptyPendingChat } = await import("../src/renderer/src/lib/pendingChat");
    mock.api.createHumanSession.mockResolvedValue({ cutexSessionId: "new" });
    const expectApprovalsReviewer = vi.fn();
    store.setState({
      features: new Set(supported ? ["launch-approvals-reviewer"] : []),
      pendingChat: { ...emptyPendingChat(null), launch: { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, permissionMode: "auto", drafts: [{ text: "hi", images: [], skills: [] }] },
      select: vi.fn(async () => {}),
      submit: vi.fn(async () => null),
      refreshHostSidebar: vi.fn(async () => {}),
      expectApprovalsReviewer,
    });
    store.getState().retryPendingChat();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const sent = (mock.api.createHumanSession.mock.calls[0] as unknown as [{ launch: Record<string, unknown> }])[0].launch;
    if (supported) {
      expect(sent).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" });
      expect(expectApprovalsReviewer).not.toHaveBeenCalled();
    } else {
      // An older cutex refuses unknown launch fields: set after creation instead.
      expect(sent).toEqual({ sandbox: "workspace-write", approvalPolicy: "on-request" });
      expect(expectApprovalsReviewer).toHaveBeenCalledWith("new", "local", "auto_review");
    }
  });

  it("an expected reviewer is set once the new thread loads live, then forgotten", async () => {
    const timeline = { turns: [], data: [] };
    mock.api.bootstrap.mockResolvedValue({
      native: { result: { thread: { id: "thread-new", turns: [] } } },
      cutexState: { pendingServerRequests: [], runtime: { runtimeGeneration: 1 }, userInputQueue: [], agentBusMessages: [], agentBusSentMessages: [], ownerNotifications: [] },
      checkpoint: { streamId: "s", cursor: 0 },
      historyPage: null,
      ...timeline,
    });
    mock.api.updateThreadSettings.mockResolvedValue(undefined);
    mock.api.subscribe.mockResolvedValue(undefined);
    mock.api.unsubscribe.mockResolvedValue(undefined);
    store.getState().expectApprovalsReviewer("fresh", "local", "auto_review");
    await store.getState().select("fresh", "local");
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(mock.api.updateThreadSettings).toHaveBeenCalledWith("fresh", "thread-new", { approvalsReviewer: "auto_review" });
    mock.api.updateThreadSettings.mockClear();
    await store.getState().reloadSession("fresh");
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(mock.api.bootstrap).toHaveBeenCalledTimes(2);
    expect(mock.api.updateThreadSettings).not.toHaveBeenCalled();
  });

  it("completes same-host creation and drafts appended during creation, without duplicating the create", async () => {
    const create = deferred<{
      cutexSessionId: string;
    }>();
    mock.api.createHumanSession.mockReturnValue(create.promise);
    const select = vi.fn(async () => {}),
      submit = vi.fn(async (_text: string) => null),
      refreshSidebar = vi.fn(async () => {});
    store.setState({
      select,
      submit,
      refreshSidebar
    });
    await store.getState().newQuickChat();
    store.getState().queuePendingChat({
      text: "one",
      images: [],
      skills: []
    });
    await store.getState().newQuickChat();
    store.getState().queuePendingChat({
      text: "two",
      images: [],
      skills: []
    });
    create.resolve({
      cutexSessionId: "new"
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mock.api.createHumanSession).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith("new", "local");
    expect(submit.mock.calls.map(x => x[0])).toEqual(["one", "two"]);
    expect(store.getState().pendingChat).toBeNull();
    expect(store.getState().creatingChat).toBe(false);
  });
  it.each([false, true])("actual collaboration mode helpers stop after stale list rejection (ABA=%s)", async aba => {
    const modes = deferred<never>();
    mock.api.collaborationModes.mockReturnValue(modes.promise);
    const operation = store.getState().setCollabMode("plan");
    switchHost("remote");
    if (aba) switchHost("local");
    seed();
    store.setState({
      collabModes: {
        same: [{
          name: "Plan",
          mode: "plan",
          model: "B-model",
          reasoning_effort: null
        }]
      }
    });
    modes.reject(Error("host switched"));
    // Stale: null (nothing applied, callers say nothing), not false ("plan unavailable").
    expect(await operation).toBeNull();
    expect(mock.api.updateThreadSettings).not.toHaveBeenCalled();
  });
  it("actual mode list success cannot seed another host", async () => {
    const modes = deferred<unknown>();
    mock.api.collaborationModes.mockReturnValue(modes.promise);
    const operation = store.getState().loadCollabModes();
    switchHost("remote");
    const previous = store.getState().collabModes;
    modes.resolve([{
      name: "Plan",
      mode: "plan"
    }]);
    await operation;
    expect(store.getState().collabModes).toBe(previous);
  });
  it("same-host selection change does not apply Plan to the newly selected session", async () => {
    const modes = deferred<unknown>();
    mock.api.collaborationModes.mockReturnValue(modes.promise);
    const operation = store.getState().setCollabMode("plan");
    store.setState({
      selectedId: "other"
    });
    modes.resolve([{
      name: "Plan",
      mode: "plan"
    }]);
    // Stale: null (nothing applied, callers say nothing), not false ("plan unavailable").
    expect(await operation).toBeNull();
    expect(mock.api.updateThreadSettings).not.toHaveBeenCalled();
  });
  it("actual goal completion leaves new-host same-ID view untouched", async () => {
    const goal = deferred<unknown>();
    mock.api.setThreadGoal.mockReturnValue(goal.promise);
    const operation = store.getState().setGoal({
      objective: "A"
    });
    switchHost("remote");
    seed();
    const previous = store.getState().sessions.same;
    goal.resolve({
      objective: "A",
      status: "active"
    });
    await operation;
    expect(store.getState().sessions.same).toBe(previous);
    expect(previous!.timeline.goal).toBeNull();
  });
  it("actual settings rejection leaves new-host same-ID view and notice untouched", async () => {
    const update = deferred<never>();
    mock.api.updateThreadSettings.mockReturnValue(update.promise);
    const operation = store.getState().updateSettings({
      model: "A"
    });
    switchHost("remote");
    seed();
    const previous = store.getState();
    update.reject(Error("host switched"));
    expect(await operation).toBe(false);
    expect(store.getState().sessions.same).toBe(previous.sessions.same);
    expect(store.getState().notice).toBe(previous.notice);
  });
  it("actual helpers still set Plan and goal on the current host", async () => {
    mock.api.collaborationModes.mockResolvedValue([{
      name: "Plan",
      mode: "plan",
      model: "current",
      reasoning_effort: null
    }]);
    mock.api.updateThreadSettings.mockResolvedValue(undefined);
    expect(await store.getState().setCollabMode("plan")).toBe(true);
    expect(mock.api.updateThreadSettings).toHaveBeenCalledWith("same", "thread-a", expect.objectContaining({
      collaborationMode: expect.objectContaining({
        mode: "plan"
      })
    }));
    mock.api.setThreadGoal.mockResolvedValue({
      objective: "current",
      status: "active"
    });
    await store.getState().setGoal({
      objective: "current"
    });
    expect(store.getState().sessions.same!.timeline.goal?.objective).toBe("current");
  });
  it("rolls back same-host rejected settings after the optimistic view replacement", async () => {
    const previous = store.getState().sessions.same!.timeline.settings;
    mock.api.updateThreadSettings.mockRejectedValue(Error("normal failure"));
    expect(await store.getState().updateSettings({
      model: "bad"
    })).toBe(false);
    expect(store.getState().sessions.same!.timeline.settings).toBe(previous);
    expect(store.getState().sessions.same!.error).toBe("normal failure");
  });
  it("keeps a same-thread goal reply when normal streaming replaces the view wrapper", async () => {
    const goal = deferred<unknown>();
    mock.api.setThreadGoal.mockReturnValue(goal.promise);
    const operation = store.getState().setGoal({
      objective: "current"
    });
    const view = store.getState().sessions.same!;
    store.setState({
      sessions: {
        same: {
          ...view,
          version: view.version + 1
        }
      }
    });
    goal.resolve({
      objective: "current",
      status: "active"
    });
    await operation;
    expect(store.getState().sessions.same!.timeline.goal?.objective).toBe("current");
  });
  it("actual select bootstrap rejection cannot set error on a new-host same-ID view", async () => {
    const boot = deferred<never>();
    mock.api.bootstrap.mockReturnValue(boot.promise);
    store.setState({
      selectedId: null
    });
    const operation = store.getState().select("same");
    switchHost("remote");
    seed();
    const previous = store.getState().sessions.same;
    boot.reject(Error("host switched"));
    await operation;
    expect(store.getState().sessions.same).toBe(previous);
  });
  it("actual select cannot start fallback history on the new host after old bootstrap", async () => {
    const boot = deferred<unknown>();
    mock.api.bootstrap.mockReturnValue(boot.promise);
    store.setState({
      selectedId: null
    });
    const operation = store.getState().select("same");
    switchHost("remote");
    seed();
    store.setState({
      features: new Set(["offline-history"])
    });
    boot.resolve({
      native: null
    });
    await operation;
    expect(mock.api.history).not.toHaveBeenCalled();
    expect(mock.api.subscribe).not.toHaveBeenCalled();
  });
});
