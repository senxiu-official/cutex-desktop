// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PermanentRetirementReview, UpgradeIntent, UpgradeNode, UpgradePreviewApi, UpgradeResult, UpgradePanelSnapshot as UpgradeSnapshot } from "../src/renderer/src/modules/delegations/upgradeTypes";

type HostEvent = { hostId: string; envelope: { cutex?: { method: string; params?: { projectId?: string } } } };
const fx = vi.hoisted(() => ({
  apis: new Map<string, UpgradePreviewApi>(),
  listeners: new Set<(event: HostEvent) => void>(),
  apiFor: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: fx.apiFor, bridge: { on: fx.on } }));
import { unresolvedUpgradeActions } from "../src/renderer/src/modules/delegations/upgradeActions";
import { delegationUpgradeCapabilities } from "../src/renderer/src/modules/delegations/upgradeCapabilities";
const caps = delegationUpgradeCapabilities(["delegation-tree-stop-v1", "delegation-routing-v1", "project-run-control-v1", "delegation-continuation-v1", "agent-activity-v1", "agent-archive-kind-v1"]);
const TEST_ID = "00000000-0000-4000-8000-000000000001";
const receipt = () => ({ schema: "cutex.delegation-operation.v1" as const, actionId: TEST_ID, operationId: "operation-test", operation: "project.pause", requestDigest: "a".repeat(64), status: "completed" as const, effectState: "committed" as const, outcomeUnknown: false, revision: 1, updatedAt: "2026-10-27T00:00:00Z" });
import { useUpgradeProject } from "../src/renderer/src/modules/delegations/useUpgradeProject";

const mounted = new Set<() => void>();
// Keep the harness on the repo's existing React dependencies.
function renderHook<T, P = undefined>(hook: (props: P) => T, options?: { initialProps: P }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const result = { current: undefined as T };
  function Wrapper({ value }: { value: P }) {
    result.current = hook(value);
    return null;
  }
  const rerender = (value: P) => { act(() => root.render(createElement(Wrapper, { value }))); };
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    act(() => root.unmount());
    container.remove();
  };
  mounted.add(unmount);
  rerender(options?.initialProps as P);
  return { result, rerender, unmount };
}

const deferredCleanups: (() => void)[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  deferredCleanups.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
const node = (id: string, projectId = "project-a"): UpgradeNode => ({
  kind: "delegation", id, hostId: "host-a", projectId, ref: { hostId: "host-a", id },
  parent: null, parentState: "none", redactedParentRef: null,
  root: { hostId: "host-a", id }, rootState: "visible", redactedRootRef: null,
  followUp: null, followUpState: "none", parentId: null, rootId: id, followUpOf: null, parentAttemptId: null,
  lineageState: "verified", redactedParent: false, requester: null,
  target: { id: "worker", hostId: "host-a", name: "Worker" }, title: id,
  execution: "running", closed: null, lastActivityAt: null, resumeEvidence: { kind: "none" },
  continuation: null, routingApproval: null,
  allowedActions: { readAttempts: true, stop: true, stopSelf: true, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 1,
});
const snapshot = (over: Partial<UpgradeSnapshot> = {}): UpgradeSnapshot => ({
  projectId: "project-a", revision: "1", nodes: [], nextCursor: null, coverage: "complete", unresolvedEdges: [],
  parties: [], approvals: [],
  policy: { revision: 1, memberMode: "approvalRequired", allowedActions: { update: true } },
  runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: true, pauseAll: false, resume: false } },
  members: [{ id: "worker", hostId: "host-a", name: "Worker", director: false, lastActivityAt: null, observedAt: "2026-10-27T00:00:00Z", activityStatus: "unknown", archiveKind: "active", restorable: false, allowedActions: ["permanentRetire"], restoreBlockers: [] }], grants: { items: [], allowedActions: { create: false } }, interruptedDelegations: [],
  caller: { isOwner: true, canManageMembers: true, canOfflineMembers: true }, ...over,
});
const retirementReview = (): PermanentRetirementReview => ({
  confirmation_token: "opaque-review-token", cutex_session_id: "worker", formal_name: "Worker",
  revision: 4, runtime_generation: 2, expires_at_unix: 1792987500,
});
const intent: UpgradeIntent = { kind: "pause", mode: "afterTurn", scope: "members", expectedEpoch: 1 };
function api(hostId = "host-a") {
  const value = {
    delegationUpgradeSnapshot: vi.fn<UpgradePreviewApi["delegationUpgradeSnapshot"]>().mockImplementation(async projectId => snapshot({ projectId })),
    delegationUpgradeAction: vi.fn<UpgradePreviewApi["delegationUpgradeAction"]>().mockResolvedValue({ snapshot: snapshot({ revision: "2" }), effectState: "committed", receipt: receipt() }),
    delegationUpgradeApproval: vi.fn<NonNullable<UpgradePreviewApi["delegationUpgradeApproval"]>>(),
    delegationUpgradeOperation: vi.fn<NonNullable<UpgradePreviewApi["delegationUpgradeOperation"]>>(),
    delegationRetirementReview: vi.fn<UpgradePreviewApi["delegationRetirementReview"]>().mockResolvedValue(retirementReview()),
  };
  fx.apis.set(hostId, value);
  return value;
}
const mount = () => renderHook(({ hostId, projectId, enabled }) => useUpgradeProject(hostId, projectId, enabled, caps), {
  initialProps: { hostId: "host-a", projectId: "project-a", enabled: true },
});
const flush = () => act(async () => { await Promise.resolve(); });
function emit(hostId = "host-a", projectId: string | undefined = "project-a", method = "cutex/project/runControlChanged") {
  for (const listener of fx.listeners) listener({ hostId, envelope: { cutex: { method, params: { projectId } } } });
}

beforeEach(() => {
  unresolvedUpgradeActions.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(TEST_ID);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fx.apis.clear(); fx.listeners.clear();
  fx.apiFor.mockReset().mockImplementation((hostId: string) => fx.apis.get(hostId) ?? {});
  fx.off.mockReset();
  fx.on.mockReset().mockImplementation((channel: string, listener: (event: HostEvent) => void) => {
    expect(channel).toBe("hostEvent");
    fx.listeners.add(listener);
    return () => { fx.off(); fx.listeners.delete(listener); };
  });
});
afterEach(async () => {
  for (const unmount of mounted) unmount();
  await act(async () => { for (const cleanup of deferredCleanups.splice(0)) cleanup(); await Promise.resolve(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useUpgradeProject scope and request ordering", () => {
  it.each(["host", "project"] as const)("discards a late read after changing %s, even if its revision is higher", async scope => {
    const old = deferred<UpgradeSnapshot>();
    const first = api();
    first.delegationUpgradeSnapshot.mockReturnValueOnce(old.promise);
    const second = scope === "host" ? api("host-b") : first;
    const pending = deferred<UpgradeSnapshot>();
    second.delegationUpgradeSnapshot.mockReturnValueOnce(pending.promise);
    // For the shared API the first queued response still belongs to the initial render.
    const view = mount();
    const projectId = scope === "project" ? "project-b" : "project-a";
    view.rerender({ hostId: scope === "host" ? "host-b" : "host-a", projectId, enabled: true });
    expect(view.result.current.snapshot).toBeNull();
    expect(fx.off).toHaveBeenCalledTimes(1);
    expect(fx.listeners.size).toBe(1);
    const current = snapshot({ projectId, revision: "2", nodes: [node("current", projectId)] });
    await act(async () => pending.resolve(current));
    await act(async () => old.resolve(snapshot({ revision: "99", nodes: [node("obsolete")] })));
    expect(view.result.current.snapshot).toEqual(current);
    expect(view.result.current.notice).toBeNull();
  });

  it.each(["host", "project"] as const)("ignores an old read failure after changing %s", async scope => {
    const old = deferred<UpgradeSnapshot>();
    api().delegationUpgradeSnapshot.mockReturnValueOnce(old.promise);
    api("host-b");
    const view = mount();
    const projectId = scope === "project" ? "project-b" : "project-a";
    view.rerender({ hostId: scope === "host" ? "host-b" : "host-a", projectId, enabled: true });
    await flush();
    await act(async () => old.reject(new Error("old host disconnected")));
    expect(view.result.current.snapshot?.projectId).toBe(projectId);
    expect(view.result.current.notice).toBeNull();
  });

  it("uses the latest read when concurrent reads finish out of order", async () => {
    const first = deferred<UpgradeSnapshot>(), latest = deferred<UpgradeSnapshot>();
    api().delegationUpgradeSnapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const view = mount();
    let refresh!: Promise<void>;
    act(() => { refresh = view.result.current.refresh(); });
    expect(fx.apiFor("host-a").delegationUpgradeSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(snapshot({ revision: "99" })); await Promise.resolve(); });
    await act(async () => { latest.resolve(snapshot({ revision: "3" })); await refresh; });
    expect(view.result.current.snapshot?.revision).toBe("3");
  });

  it.each(["host", "project"] as const)("rejects saved actions and ignores saved refetch callbacks after changing %s", async scope => {
    const first = api();
    const second = scope === "host" ? api("host-b") : first;
    const uuid = vi.spyOn(crypto, "randomUUID");
    const view = mount(); await flush();
    const saved = view.result.current;
    const pending = deferred<UpgradeSnapshot>();
    second.delegationUpgradeSnapshot.mockReturnValueOnce(pending.promise);
    const projectId = scope === "project" ? "project-b" : "project-a";
    view.rerender({ hostId: scope === "host" ? "host-b" : "host-a", projectId, enabled: true });
    first.delegationUpgradeSnapshot.mockClear();
    second.delegationUpgradeSnapshot.mockClear();
    await act(async () => {
      await expect(saved.onAction(intent)).rejects.toThrow("action_unavailable");
      await saved.refresh();
      await saved.more();
    });
    expect(first.delegationUpgradeAction).not.toHaveBeenCalled();
    expect(second.delegationUpgradeAction).not.toHaveBeenCalled();
    expect(first.delegationUpgradeSnapshot).not.toHaveBeenCalled();
    expect(second.delegationUpgradeSnapshot).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({ snapshot: null, busy: false, notice: null });
    // An ignored old refetch must not increment the counter and invalidate this current read.
    const current = snapshot({ projectId, revision: "4", nodes: [node("current", projectId)] });
    await act(async () => pending.resolve(current));
    expect(view.result.current).toMatchObject({ snapshot: current, busy: false, notice: null });
  });

  it.each(["read", "mutation"] as const)("does not let an older read rejection overwrite a newer %s success", async operation => {
    const service = api(), oldRead = deferred<UpgradeSnapshot>();
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(snapshot()).mockReturnValueOnce(oldRead.promise);
    const current = snapshot({ revision: "5", nodes: [node("current")] });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(current);
    service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: current, effectState: "committed", receipt: receipt() });
    const view = mount(); await flush();
    let obsolete!: Promise<void>;
    act(() => { obsolete = view.result.current.refresh(); });
    await act(async () => {
      if (operation === "read") { oldRead.reject(new Error("obsolete read failed")); await obsolete; await view.result.current.refresh(); }
      else await view.result.current.onAction(intent);
    });
    const expectedNotice = operation === "read" ? null : "done";
    expect(view.result.current).toMatchObject({ snapshot: current, busy: false, notice: expectedNotice });
    await act(async () => { oldRead.reject(new Error("obsolete read failed")); await obsolete; });
    expect(view.result.current).toMatchObject({ snapshot: current, busy: false, notice: expectedNotice });
  });

  it("does not read or mutate while disabled or when the preview API is absent", async () => {
    const service = api();
    const view = renderHook(() => useUpgradeProject("host-a", "project-a", false, caps));
    await act(async () => {
      await view.result.current.refresh();
      await expect(view.result.current.onAction(intent)).rejects.toThrow("action_unavailable");
    });
    expect(service.delegationUpgradeSnapshot).not.toHaveBeenCalled();
    expect(service.delegationUpgradeAction).not.toHaveBeenCalled();
    const absent = renderHook(() => useUpgradeProject("old-host", "project-a", true, caps));
    await act(async () => { await expect(absent.result.current.onAction(intent)).rejects.toThrow("action_unavailable"); });
    expect(absent.result.current).toMatchObject({ snapshot: null, busy: false, notice: null });
  });
});

describe("useUpgradeProject mutations", () => {
  it("blocks same-tick double clicks and further actions until the mutation settles", async () => {
    const service = api(), pending = deferred<UpgradeResult>();
    service.delegationUpgradeAction.mockReturnValueOnce(pending.promise);
    const view = mount(); await flush();
    let first!: Promise<void>, duplicate!: Promise<void>;
    act(() => { first = view.result.current.onAction(intent); duplicate = view.result.current.onAction(intent); });
    expect(view.result.current.busy).toBe(true);
    await act(async () => {
      await expect(duplicate).rejects.toThrow("action_unavailable");
      await expect(view.result.current.onAction({ kind: "archive", memberId: "worker" })).rejects.toThrow("action_unavailable");
    });
    expect(view.result.current).toMatchObject({ busy: true, notice: null });
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(service.delegationUpgradeAction).toHaveBeenCalledWith("project-a", { ...intent, actionId: expect.any(String) });
    await act(async () => { pending.resolve({ snapshot: snapshot({ revision: "2" }), effectState: "committed", receipt: receipt() }); await first; });
    expect(view.result.current).toMatchObject({ busy: false, notice: "done", snapshot: { revision: "2" } });
    await act(async () => { await view.result.current.onAction(intent); });
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(2);
  });

  it.each(["reject", "partial", "unknown"] as const)("rejects %s without resending or minting another actionId", async outcome => {
    const service = api();
    const uuid = vi.spyOn(crypto, "randomUUID");
    const failure = new Error("response lost after commit");
    if (outcome === "reject") service.delegationUpgradeAction.mockRejectedValueOnce(failure);
    else service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: snapshot({ revision: "2" }), effectState: outcome });
    const view = mount(); await flush();
    await act(async () => {
      const action = view.result.current.onAction(intent);
      if (outcome === "reject") await expect(action).rejects.toBe(failure);
      else await expect(action).rejects.toThrow("partial_result");
    });
    const sentId = service.delegationUpgradeAction.mock.calls[0]![1].actionId;
    expect(sentId).toBeTruthy();
    expect(view.result.current).toMatchObject({ busy: false, notice: outcome === "reject" ? "failed" : "partialResult" });
    // Partial/unknown still carry authoritative server data despite rejecting the action.
    expect(view.result.current.snapshot?.revision).toBe(outcome === "reject" ? "1" : "2");
    view.rerender({ hostId: "host-a", projectId: "project-a", enabled: true });
    await act(async () => { emit(); await view.result.current.refresh(); });
    await flush();
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(service.delegationUpgradeAction.mock.calls[0]![1].actionId).toBe(sentId);
    expect(uuid).toHaveBeenCalledTimes(1);
  });

  it.each(["host", "project"] as const)("an old mutation cannot replace data or unlock a new mutation after a %s change", async scope => {
    const old = deferred<UpgradeResult>(), current = deferred<UpgradeResult>();
    const first = api();
    first.delegationUpgradeAction.mockReturnValueOnce(old.promise);
    const second = scope === "host" ? api("host-b") : first;
    second.delegationUpgradeAction.mockReturnValueOnce(current.promise);
    const view = mount(); await flush();
    let oldAction!: Promise<void>, newAction!: Promise<void>;
    act(() => { oldAction = view.result.current.onAction(intent); });
    const projectId = scope === "project" ? "project-b" : "project-a";
    view.rerender({ hostId: scope === "host" ? "host-b" : "host-a", projectId, enabled: true });
    await flush();
    expect(view.result.current.busy).toBe(false);
    act(() => { newAction = view.result.current.onAction(intent); });
    await act(async () => {
      const rejected = expect(oldAction).rejects.toThrow("context_changed");
      old.resolve({ snapshot: snapshot({ revision: "99" }), effectState: "committed", receipt: receipt() });
      await rejected;
    });
    expect(view.result.current).toMatchObject({ busy: true, notice: null, snapshot: { projectId, revision: "1" } });
    await act(async () => { current.resolve({ snapshot: snapshot({ projectId, revision: "2" }), effectState: "committed", receipt: receipt() }); await newAction; });
    expect(view.result.current).toMatchObject({ busy: false, notice: "done", snapshot: { projectId, revision: "2" } });
  });

  it("invalidates reads started before a successful mutation, even with a higher read revision", async () => {
    const service = api(), oldRead = deferred<UpgradeSnapshot>();
    const view = mount(); await flush();
    service.delegationUpgradeSnapshot.mockReturnValueOnce(oldRead.promise);
    let refresh!: Promise<void>;
    act(() => { refresh = view.result.current.refresh(); });
    await act(async () => { await view.result.current.onAction(intent); });
    await act(async () => { oldRead.resolve(snapshot({ revision: "99" })); await refresh; });
    expect(view.result.current.snapshot?.revision).toBe("2");
  });
});

describe("useUpgradeProject v2 read-only fallback", () => {
  const omissions: { name: string; remove(value: UpgradeSnapshot): void }[] = [
    { name: "caller context", remove: value => { Reflect.deleteProperty(value, "caller"); } },
    { name: "caller owner evidence", remove: value => { Reflect.deleteProperty(value.caller, "isOwner"); } },
    { name: "caller management evidence", remove: value => { Reflect.deleteProperty(value.caller, "canManageMembers"); } },
    { name: "caller offline evidence", remove: value => { Reflect.deleteProperty(value.caller, "canOfflineMembers"); } },
    { name: "unresolved edges", remove: value => { Reflect.deleteProperty(value, "unresolvedEdges"); } },
    { name: "grant collection authorization", remove: value => { Reflect.deleteProperty(value.grants, "allowedActions"); } },
    { name: "pauseAll authorization", remove: value => { Reflect.deleteProperty(value.runControl.allowedActions, "pauseAll"); } },
    { name: "node relation state", remove: value => { const first = value.nodes[0]; if (first) Reflect.deleteProperty(first, "parentState"); } },
    { name: "node stopSelf authorization", remove: value => { const first = value.nodes[0]; if (first) Reflect.deleteProperty(first.allowedActions, "stopSelf"); } },
  ];
  it.each(omissions)("keeps an incomplete response read-only without guessing $name", async ({ remove }) => {
    const service = api(), incomplete = snapshot({ nodes: [node("visible")] });
    // Deliberately malformed wire data: remove a required field without hiding types behind a cast.
    remove(incomplete);
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(incomplete);
    const view = mount(); await flush();
    expect(view.result.current).toMatchObject({ snapshot: null, readOnly: true, busy: false, notice: "incomplete" });
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow(); });
    expect(service.delegationUpgradeAction).not.toHaveBeenCalled();
  });

  it("accepts complete false authorization evidence and recovers from an incomplete snapshot on refresh", async () => {
    const service = api(), incomplete = snapshot();
    Reflect.deleteProperty(incomplete, "caller");
    const complete = snapshot({ revision: "2", caller: { isOwner: false, canManageMembers: false, canOfflineMembers: false } });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(incomplete).mockResolvedValueOnce(complete);
    const view = mount(); await flush();
    expect(view.result.current).toMatchObject({ readOnly: true });
    await act(async () => { await view.result.current.refresh(); });
    expect(view.result.current).toMatchObject({ readOnly: false, snapshot: complete });
  });

  it("preserves confirmed mutation while clearing an incomplete follow-up read", async () => {
    const service = api(), incomplete = snapshot({ revision: "2" });
    Reflect.deleteProperty(incomplete.grants, "allowedActions");
    service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: incomplete, effectState: "committed", receipt: receipt() });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(intent)).resolves.toBeUndefined(); });
    expect(view.result.current).toMatchObject({ snapshot: null, readOnly: true, busy: false, notice: "done" });
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow("action_unavailable"); });
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
  });
});

describe("useUpgradeProject v2 permanent retirement", () => {
  const retire: UpgradeIntent = { kind: "retire", payload: {
    cutex_session_id: "worker", confirmed_name: "Worker", confirmation_token: "opaque-review-token", expected_revision: 4,
  } };
  it.each(["nonOwner", "disabled", "missingAdapter"] as const)("refuses retirement review without an authorized available entry (%s)", async reason => {
    const service = api();
    if (reason === "nonOwner") service.delegationUpgradeSnapshot.mockResolvedValueOnce(snapshot({ caller: { isOwner: false, canManageMembers: true, canOfflineMembers: true } }));
    if (reason === "missingAdapter") Reflect.deleteProperty(service, "delegationRetirementReview");
    const view = mount(); await flush();
    if (reason === "disabled") view.rerender({ hostId: "host-a", projectId: "project-a", enabled: false });
    await act(async () => { await expect(view.result.current.reviewRetirement({ cutex_session_id: "worker" })).rejects.toThrow("review_unavailable"); });
    if (reason !== "missingAdapter") expect(service.delegationRetirementReview).not.toHaveBeenCalled();
    expect(service.delegationUpgradeAction).not.toHaveBeenCalled();
  });

  it.each([
    { retirementStage: undefined, effectState: "committed", receipt: receipt() },
    { retirementStage: "uncertain", effectState: "committed", receipt: receipt() },
    { retirementStage: "stopped_not_archived", effectState: "committed", receipt: receipt() },
    { retirementStage: "permanent_retirement_committed", effectState: "committed", receipt: receipt() },
    { retirementStage: "committed", effectState: "none" },
    { retirementStage: "committed", effectState: "partial" },
    { retirementStage: "committed", effectState: "unknown" },
  ] satisfies Pick<UpgradeResult, "retirementStage" | "effectState" | "receipt">[])("rejects retirement unless BOTH stage and effect are committed (%j)", async result => {
    const service = api(), uuid = vi.spyOn(crypto, "randomUUID");
    service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: snapshot({ revision: "2" }), ...result });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(retire)).rejects.toThrow(); });
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.notice).not.toBe("done");
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(uuid).toHaveBeenCalledTimes(1);
    await act(async () => { await view.result.current.refresh(); });
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(uuid).toHaveBeenCalledTimes(1);
  });

  it("resolves retirement only for the committed receipt and forwards the exact confirmation payload", async () => {
    const service = api();
    service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: snapshot({ revision: "2" }), effectState: "committed", retirementStage: "committed", retirementReceipt: { stage: "committed", request: { action_id: TEST_ID } } });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(retire)).resolves.toBeUndefined(); });
    expect(service.delegationUpgradeAction).toHaveBeenCalledWith("project-a", { ...retire, actionId: expect.any(String) });
    expect(view.result.current).toMatchObject({ busy: false, notice: "done" });
  });

  it.each(["host", "project"] as const)("routes reviews to the current project and rejects a saved review callback after a %s switch", async scope => {
    const first = api(), second = scope === "host" ? api("host-b") : first;
    const view = mount(); await flush();
    const saved = view.result.current.reviewRetirement;
    const projectId = scope === "project" ? "project-b" : "project-a";
    view.rerender({ hostId: scope === "host" ? "host-b" : "host-a", projectId, enabled: true });
    await flush();
    const request = { cutex_session_id: "worker" };
    await act(async () => { await expect(saved(request)).rejects.toThrow(); });
    expect(first.delegationRetirementReview).not.toHaveBeenCalled();
    expect(second.delegationRetirementReview).not.toHaveBeenCalled();
    await act(async () => { await expect(view.result.current.reviewRetirement(request)).resolves.toEqual(retirementReview()); });
    expect(second.delegationRetirementReview).toHaveBeenCalledExactlyOnceWith(projectId, request);
    expect(first.delegationUpgradeAction).not.toHaveBeenCalled();
    expect(second.delegationUpgradeAction).not.toHaveBeenCalled();
  });

  it("rejects a review response from an obsolete generation without changing current state", async () => {
    const first = api(), pending = deferred<PermanentRetirementReview>();
    first.delegationRetirementReview.mockReturnValueOnce(pending.promise);
    api("host-b");
    const view = mount(); await flush();
    let review!: Promise<PermanentRetirementReview>;
    act(() => { review = view.result.current.reviewRetirement({ cutex_session_id: "worker" }); });
    view.rerender({ hostId: "host-b", projectId: "project-b", enabled: true });
    await flush();
    await act(async () => {
      const rejected = expect(review).rejects.toThrow();
      pending.resolve(retirementReview());
      await rejected;
    });
    expect(view.result.current).toMatchObject({ busy: false, notice: null, snapshot: { projectId: "project-b" } });
  });
});

describe("useUpgradeProject pagination and revisions", () => {
  it("deduplicates same-revision nodes by full host/id and placeholders by their own token", async () => {
    const service = api(), local = node("same");
    const remote: UpgradeNode = { ...node("same"), hostId: "host-b", ref: { hostId: "host-b", id: "same" }, root: { hostId: "host-b", id: "same" } };
    const placeholder = {
      kind: "redactedAncestor", placeholderId: "same", labelKey: "delegation.ancestorRestricted",
      reason: "notVisible", expandable: false, allowedActions: {},
    } satisfies UpgradeSnapshot["nodes"][number];
    const first = snapshot({ revision: "7", nodes: [local, placeholder], nextCursor: "same-snapshot:page-2", coverage: "partial" });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(first)
      .mockResolvedValueOnce(snapshot({ revision: "7", nodes: [{ ...local }, remote, { ...placeholder }], coverage: "partial" }));
    const view = mount(); await flush();
    await act(async () => { await view.result.current.more(); });
    expect(view.result.current.snapshot?.nodes).toEqual([local, placeholder, remote]);
    expect(view.result.current.snapshot?.nextCursor).toBeNull();
    expect(first.nodes).toEqual([local, placeholder]);
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(2, "project-a", "same-snapshot:page-2");
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(2);
  });

  it("preserves earlier unresolved edges and deduplicates only matching full refs and relations", async () => {
    const service = api();
    const local: UpgradeNode = { ...node("legacy"), parentState: "unknown", rootState: "unknown", root: null, rootId: null, lineageState: "legacyUnknown" };
    const remote: UpgradeNode = { ...local, hostId: "host-b", ref: { hostId: "host-b", id: "legacy" } };
    const earlier = { from: local.ref, relation: "parent", reason: "legacyUnknown" } satisfies UpgradeSnapshot["unresolvedEdges"][number];
    const otherRelation = { from: local.ref, relation: "root", reason: "legacyUnknown" } satisfies UpgradeSnapshot["unresolvedEdges"][number];
    const otherHost = { from: remote.ref, relation: "parent", reason: "legacyUnknown" } satisfies UpgradeSnapshot["unresolvedEdges"][number];
    const first = snapshot({ revision: "4", nodes: [local], unresolvedEdges: [earlier], nextCursor: "edges:page-2", coverage: "unknown" });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(first)
      .mockResolvedValueOnce(snapshot({ revision: "4", nodes: [remote], unresolvedEdges: [{ ...earlier, from: { ...earlier.from } }, otherRelation, otherHost], coverage: "unknown" }));
    const view = mount(); await flush();
    await act(async () => { await view.result.current.more(); });
    expect(view.result.current.snapshot?.unresolvedEdges).toEqual([earlier, otherRelation, otherHost]);
    expect(view.result.current.snapshot?.nodes).toEqual([local, remote]);
    expect(first.unresolvedEdges).toEqual([earlier]);
  });

  it("drops stale pages and redacted placeholders before refetching page one after cursor invalidation", async () => {
    const service = api(), restart = deferred<UpgradeSnapshot>();
    const old = snapshot({ revision: "9", nextCursor: "permission-version:old:page-2", nodes: [node("obsolete"), {
      kind: "redactedAncestor", placeholderId: "old-placeholder", labelKey: "delegation.ancestorRestricted",
      reason: "notVisible", expandable: false, allowedActions: {},
    }], coverage: "partial", unresolvedEdges: [{ from: { hostId: "host-a", id: "obsolete" }, relation: "parent", reason: "redacted" }] });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(old)
      .mockRejectedValueOnce(Object.assign(new Error("invalid_or_stale_cursor"), { code: "invalid_or_stale_cursor" }))
      .mockReturnValueOnce(restart.promise);
    const view = mount(); await flush();
    let more!: Promise<void>;
    act(() => { more = view.result.current.more(); });
    await flush();
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(2, "project-a", "permission-version:old:page-2");
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(3, "project-a");
    expect(view.result.current.snapshot).toBeNull();
    const current = snapshot({ revision: "1", nodes: [node("fresh")] });
    // A fresh authorization snapshot may restart revision numbering; old revision cannot pin stale data.
    await act(async () => { restart.resolve(current); await more; });
    expect(view.result.current).toMatchObject({ snapshot: current, readOnly: false });
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(3);
  });

  it("does not restart an obsolete cursor request on the previous host after a scope change", async () => {
    const first = api(), oldPage = deferred<UpgradeSnapshot>();
    first.delegationUpgradeSnapshot.mockResolvedValueOnce(snapshot({ nextCursor: "old-cursor" })).mockReturnValueOnce(oldPage.promise);
    const second = api("host-b");
    const view = mount(); await flush();
    let more!: Promise<void>;
    act(() => { more = view.result.current.more(); });
    view.rerender({ hostId: "host-b", projectId: "project-b", enabled: true });
    await flush();
    await act(async () => { oldPage.reject(new Error("invalid_or_stale_cursor")); await more; });
    expect(first.delegationUpgradeSnapshot).toHaveBeenCalledTimes(2);
    expect(second.delegationUpgradeSnapshot).toHaveBeenCalledExactlyOnceWith("project-b", undefined);
    expect(view.result.current).toMatchObject({ snapshot: { projectId: "project-b" }, notice: null });
  });

  it("reports a failed cursor restart without looping or restoring old page data", async () => {
    const service = api();
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(snapshot({ nodes: [node("obsolete")], nextCursor: "expired" }))
      .mockRejectedValueOnce(new Error("invalid_or_stale_cursor"))
      .mockRejectedValueOnce(new Error("first page unavailable"));
    const view = mount(); await flush();
    await act(async () => { await view.result.current.more(); });
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(3);
    expect(view.result.current).toMatchObject({ snapshot: null, notice: "readFailed" });
  });

  it("appends pages using the server cursor and replaces accumulated nodes on refresh", async () => {
    const service = api();
    service.delegationUpgradeSnapshot
      .mockResolvedValueOnce(snapshot({ nodes: [node("parent")], nextCursor: "opaque:page-2", coverage: "partial" }))
      .mockResolvedValueOnce(snapshot({ nodes: [node("child")] }))
      .mockResolvedValueOnce(snapshot({ nodes: [node("refreshed")], revision: "3" }));
    const view = mount(); await flush();
    await act(async () => { await view.result.current.more(); });
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(2, "project-a", "opaque:page-2");
    expect(view.result.current.snapshot).toMatchObject({ revision: "1", nextCursor: null, coverage: "complete", nodes: [{ id: "parent" }, { id: "child" }] });
    await act(async () => { await view.result.current.refresh(); });
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(3, "project-a", undefined);
    expect(view.result.current.snapshot?.nodes?.map(n => n.kind === "delegation" ? n.id : n.placeholderId)).toEqual(["refreshed"]);
  });

  it.each(["refresh", "mutation"] as const)("accepts a newer %s response without ordering opaque snapshot tokens", async operation => {
    const service = api();
    const current = snapshot({ revision: "10", nodes: [node("current")], nextCursor: "next" });
    service.delegationUpgradeSnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(snapshot({ revision: "9", nodes: [node("stale")] }));
    service.delegationUpgradeAction.mockResolvedValueOnce({ snapshot: snapshot({ revision: "9" }), effectState: "committed", receipt: receipt() });
    const view = mount(); await flush();
    await act(async () => {
      if (operation === "mutation") await view.result.current.onAction(intent);
      else await view.result.current[operation]();
    });
    expect(view.result.current.snapshot?.revision).toBe("9");
  });

  it.each([9, 11])("restarts page one instead of merging a page from a different revision (%i)", async revision => {
    const service = api(), restart = deferred<UpgradeSnapshot>();
    service.delegationUpgradeSnapshot
      .mockResolvedValueOnce(snapshot({ revision: "10", nodes: [node("old-page")], nextCursor: "bound-to-revision-10" }))
      .mockResolvedValueOnce(snapshot({ revision: String(revision), nodes: [node("mismatched-page")] }))
      .mockReturnValueOnce(restart.promise);
    const view = mount(); await flush();
    let more!: Promise<void>;
    act(() => { more = view.result.current.more(); });
    await flush();
    expect(view.result.current.snapshot).toBeNull();
    expect(service.delegationUpgradeSnapshot).toHaveBeenNthCalledWith(3, "project-a");
    const fresh = snapshot({ revision: "12", nodes: [node("fresh-page-one")] });
    await act(async () => { restart.resolve(fresh); await more; });
    expect(view.result.current.snapshot).toEqual(fresh);
  });
});

describe("useUpgradeProject host SSE isolation", () => {
  it("refreshes only the matching host/project for each supported event and unsubscribes on unmount", async () => {
    const service = api(), remote = api("host-b");
    const view = mount(); await flush();
    await act(async () => {
      emit("host-b"); emit("host-a", "project-b"); emit("host-a", "project-a", "cutex/agent/changed");
      for (const listener of fx.listeners) {
        listener({ hostId: "host-a", envelope: {} });
        listener({ hostId: "host-a", envelope: { cutex: { method: "cutex/project/runControlChanged" } } });
      }
    });
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(1);
    expect(remote.delegationUpgradeSnapshot).not.toHaveBeenCalled();
    const methods = ["cutex/project/runControlChanged", "cutex/delegation/routingApprovalChanged", "cutex/delegation/lineageChanged", "cutex/delegation/continuationChanged"];
    for (const [index, method] of methods.entries()) {
      await act(async () => emit("host-a", "project-a", method));
      expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(index + 2);
    }
    view.unmount();
    expect(fx.off).toHaveBeenCalledTimes(1);
    expect(fx.listeners.size).toBe(0);
    emit();
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(5);
  });

  it("keeps simultaneous hook instances isolated by project on the same host", async () => {
    const service = api();
    const a = mount();
    const b = renderHook(() => useUpgradeProject("host-a", "project-b", true));
    await flush(); service.delegationUpgradeSnapshot.mockClear();
    await act(async () => emit("host-a", "project-b"));
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(1);
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledWith("project-b", undefined);
    expect(a.result.current.snapshot?.projectId).toBe("project-a");
    expect(b.result.current.snapshot?.projectId).toBe("project-b");
  });
});

describe("v3 approval, durable intent and read load regressions", () => {
  const full = () => ({ id: "approval-outside-page", projectId: "project-a", delegationRef: { hostId: "host-a", id: "not-loaded" }, state: "pending" as const,
    requestDigest: "sha256:" + "c".repeat(64), policyRevision: 4, authorityEpoch: 6, revision: 9,
    requestedBy: { kind: "owner" as const, hostId: null, sessionId: null, name: null, redacted: false as const },
    decidedBy: null, decisionAuthority: null, decisionNote: null, createdAt: "2026-10-27T00:00:00Z", decidedAt: null, allowedActions: { approve: true, deny: true } });
  const decision = () => ({ kind: "decision" as const, approvalId: full().id, decision: "approve" as const, expectedDigest: full().requestDigest, expectedRevision: 9 });
  it("reads fresh full approval outside the loaded tree, preserves exact digest/CAS and write success when refresh fails", async () => {
    const service = api();
    service.delegationUpgradeSnapshot.mockResolvedValue(snapshot({ nodes: [], approvals: [full()] }));
    service.delegationUpgradeApproval.mockResolvedValue(full());
    service.delegationUpgradeAction.mockResolvedValue({ effectState: "committed", receipt: { ...receipt(), operation: "approval.decide" }, readError: "snapshot_refresh_failed" });
    const view = mount(); await flush();
    await act(async () => view.result.current.onAction(decision()));
    expect(service.delegationUpgradeApproval).toHaveBeenCalledExactlyOnceWith(full().id);
    expect(service.delegationUpgradeAction).toHaveBeenCalledExactlyOnceWith("project-a", { ...decision(), actionId: TEST_ID });
    expect(view.result.current.notice).toBe("readFailed"); expect(view.result.current.readOnly).toBe(false);
  });
  it.each(["digest", "revision", "permission", "reference"])("does not write after fresh approval %s changes", async change => {
    const service = api(), value = full();
    service.delegationUpgradeSnapshot.mockResolvedValue(snapshot({ approvals: [full()] }));
    if (change === "digest") value.requestDigest = "sha256:" + "d".repeat(64);
    if (change === "revision") value.revision++;
    if (change === "permission") value.allowedActions.approve = false;
    if (change === "reference") value.delegationRef.hostId = "other-host";
    service.delegationUpgradeApproval.mockResolvedValue(value);
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(decision())).rejects.toThrow("approval_changed"); });
    expect(service.delegationUpgradeAction).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it.each(["unknown", "notFound"] as const)("restores blocked intent across remount and %s lookup without new ID", async status => {
    const service = api(); service.delegationUpgradeAction.mockRejectedValueOnce(new Error("connection_lost"));
    service.delegationUpgradeOperation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId: TEST_ID, status, outcomeUnknown: true, result: null });
    const first = mount(); await flush();
    await act(async () => { await expect(first.result.current.onAction(intent)).rejects.toThrow("connection_lost"); });
    first.unmount(); const second = mount(); await flush();
    await act(async () => { await second.result.current.refresh(); await expect(second.result.current.onAction(intent)).rejects.toThrow("outcome_unknown"); });
    expect(service.delegationUpgradeOperation).toHaveBeenCalledExactlyOnceWith(TEST_ID);
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1); expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(second.result.current.readOnly).toBe(true);
  });
  it("clears an uncertain control only for matching committed read receipt; GET never resends", async () => {
    const service = api(); service.delegationUpgradeAction.mockRejectedValueOnce(new Error("connection_lost"));
    service.delegationUpgradeOperation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId: TEST_ID, status: "found", outcomeUnknown: false, result: { receipt: receipt() } });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow(); });
    await act(async () => view.result.current.refresh());
    expect(view.result.current.readOnly).toBe(false); expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
  });
  it("coalesces 100 invalidations into one trailing snapshot; foreign host/project events do nothing", async () => {
    const service = api(), first = deferred<UpgradeSnapshot>(), tail = deferred<UpgradeSnapshot>();
    service.delegationUpgradeSnapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(tail.promise);
    const view = mount();
    act(() => { for (let n = 0; n < 100; n++) emit(); emit("other-host"); emit("host-a", "other-project"); });
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(snapshot({ revision: "opaque-z" })); await Promise.resolve(); });
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(2);
    await act(async () => tail.resolve(snapshot({ revision: "opaque-a" })));
    expect(view.result.current.snapshot?.revision).toBe("opaque-a"); expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(2);
    expect(service.delegationUpgradeAction).not.toHaveBeenCalled();
  });
  it("releases a durable refusal only for completed/none authority and never automatically retries", async () => {
    const service = api(); service.delegationUpgradeAction.mockResolvedValueOnce({ effectState: "none", receipt: { ...receipt(), effectState: "none" } });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow("action_not_applied"); });
    expect(view.result.current.readOnly).toBe(false); expect(unresolvedUpgradeActions.size).toBe(0);
    expect(view.result.current.notice).toBe("failed"); expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
  });
  it("r265 preserves asks/views/archive but makes zero upgrade calls", async () => {
    const r265 = ["agent-asks", "delegation-views", "delegation-tools", "agent-archive-kind-v1", "queue-pause", "owner-approvals"];
    const flags = delegationUpgradeCapabilities(r265), service = api();
    expect(flags.retirement).toBe(true);
    const view = renderHook(() => useUpgradeProject("host-a", "project-a", flags.treeStop, flags)); await flush();
    await act(async () => { await view.result.current.refresh(); await expect(view.result.current.onAction(intent)).rejects.toThrow("action_unavailable"); });
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("R2 exact pre-write adapter refusal recovery", () => {
  it.each(["run_control_changed", "delegation_changed", "continuation_changed", "grant_not_allowed", "pause_not_allowed",
    "resume_not_allowed", "member_scope_changed", "retirement_not_allowed", "lifecycle_not_allowed", "owner_delegation_context_required",
    "unsupported agent activity", "unsupported retirement lifecycle", "grant_revision_required"])("clears proven pre-write %s, refreshes, and waits for an explicit fresh intent", async code => {
    const service = api();
    const fresh = snapshot({ revision: "fresh-token", runControl: { epoch: 2, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: true, pauseAll: false, resume: false } } });
    service.delegationUpgradeSnapshot.mockResolvedValue(fresh).mockResolvedValueOnce(snapshot());
    service.delegationUpgradeAction.mockResolvedValue({ snapshot: fresh, effectState: "committed", receipt: receipt() }).mockRejectedValueOnce(new Error(code));
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow(code); });
    await flush();
    expect(unresolvedUpgradeActions.size).toBe(0);
    expect(JSON.parse(localStorage.getItem("cutex.delegation-pending-actions.v1")!)).toEqual([]);
    expect(view.result.current.readOnly).toBe(false);
    expect(view.result.current.snapshot?.runControl?.epoch).toBe(2);
    expect(service.delegationUpgradeSnapshot).toHaveBeenCalledTimes(2);
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(service.delegationUpgradeOperation).not.toHaveBeenCalled();
    await act(async () => view.result.current.onAction({ ...intent, expectedEpoch: 2 }));
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(2);
  });
  it.each(["connection_lost", "retirement_receipt_identity_mismatch", "delegation_receipt_identity_mismatch"])("keeps post-write/unknown %s fenced; notFound cannot release it", async code => {
    const service = api();
    service.delegationUpgradeAction.mockRejectedValueOnce(new Error(code));
    service.delegationUpgradeOperation.mockResolvedValue({ schema: "cutex.delegation-operation.v1", actionId: TEST_ID, status: "notFound", outcomeUnknown: true, result: null });
    const view = mount(); await flush();
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow(code); });
    await act(async () => view.result.current.refresh());
    await act(async () => { await expect(view.result.current.onAction(intent)).rejects.toThrow("outcome_unknown"); });
    expect(unresolvedUpgradeActions.size).toBe(1);
    expect(view.result.current.readOnly).toBe(true);
    expect(service.delegationUpgradeAction).toHaveBeenCalledTimes(1);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });
});
