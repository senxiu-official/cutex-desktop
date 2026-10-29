import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { SidebarReadCache, SidebarRefresh } from "../src/main/sidebarReadCache";

const f = vi.hoisted(() => ({ feeds: [] as any[], clients: [] as any[], host: vi.fn(), sessions: vi.fn(), projects: vi.fn(), project: vi.fn(), hostSessions: vi.fn(), capabilities: vi.fn(), request: vi.fn(), cutex: vi.fn(), operatorAction: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class {
    dispose = vi.fn();
    constructor(public endpoint: unknown, public options: unknown) { f.clients.push(this); }
    host = f.host; sessions = f.sessions; projects = f.projects; project = f.project;
    hostSessions = f.hostSessions; capabilities = f.capabilities; request = f.request;
    cutex = f.cutex; operatorAction = f.operatorAction;
  },
  EventFeed: class {
    start = vi.fn(); stop = vi.fn(); reconnectNow = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: any) { f.feeds.push(this); }
  },
}));
import { CutexApiError, CutexUnreachableError } from "@cutex-desktop/cutex-client";
import { DaemonService, type DaemonEmit } from "../src/main/daemon";

const deferred = <T = any>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
const project = () => ({ project_id: "p", authority_epoch: 2, project_revision: 1, operator_count: 1, director_cutex_session_id: "director" });
const workspace = (operator = "member", authority = 2) => ({ project_id: "p", authority_epoch: authority, operator_grant_revision: 1,
  active_agents: [], retired_agents: [], agent_operators: [{ grant: { project_id: "p", operator_cutex_session_id: operator }, member: { agent: { cutex_session_id: operator }, lifecycle: "active" } }] });
let service: DaemonService;
let emit: Mock<DaemonEmit>;
const event = (method: string, params = {}) => f.feeds.at(-1).handlers.event({ cutex: { method, params } });
const sidebar = async () => {
  const pending = service.sidebar();
  await vi.advanceTimersByTimeAsync(2000);
  return pending;
};
const open = async () => { service.useEndpoint({ baseUrl: "http://test.invalid", token: "token" }, { remote: true }); await settle(); };
beforeEach(() => {
  vi.useFakeTimers(); f.feeds.length = 0; f.clients.length = 0;
  for (const value of Object.values(f)) if (typeof value === "function") value.mockReset();
  f.host.mockResolvedValue({ hostId: "h" });
  f.sessions.mockResolvedValue({ sessions: [], management: null });
  f.projects.mockImplementation(async () => ({ projects: [project()] }));
  f.project.mockImplementation(async () => workspace());
  f.hostSessions.mockResolvedValue({ data: [], nextCursor: null });
  f.capabilities.mockResolvedValue({ featureList: [], userAccess: { isOwner: true } });
  emit = vi.fn<DaemonEmit>(); service = new DaemonService(emit);
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

it("opts into background scheduling and disposes the old connection", async () => {
  await open(); const old = f.clients[0];
  expect(old.options).toEqual({ backgroundReads: true });
  await open(); expect(old.dispose).toHaveBeenCalledOnce();
});

it("marks only host/sidebar polling as background, leaving session feeds foreground", async () => {
  await open();
  expect(f.host).toHaveBeenCalledWith(expect.not.objectContaining({ background: true }));
  expect(f.sessions).toHaveBeenCalledWith("active", expect.objectContaining({ background: true }));
  expect(f.feeds[0].options.background).toBe(true);
  await sidebar();
  expect(f.projects).toHaveBeenCalledWith({ background: true });
  expect(f.project).toHaveBeenCalledWith("p", { background: true });
  expect(f.hostSessions).toHaveBeenCalledWith("", undefined, 200, { background: true });
  await service.subscribe("agent", { streamId: "stream", after: "1" });
  expect(f.feeds.at(-1).options.cutexSessionId).toBe("agent");
  expect(f.feeds.at(-1).options.background).not.toBe(true);
});

it.each([429, 503])("a busy recovery probe (%s) keeps a connected host and existing feeds", async status => {
  await open();
  const feed = f.feeds[0];
  f.host.mockRejectedValue(new CutexApiError(status, "route_busy", "busy"));
  feed.handlers.status("retrying", new CutexUnreachableError("url", Error("lost")));
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.currentState.kind).toBe("connected");
  await vi.advanceTimersByTimeAsync(5000);
  expect(service.currentState.kind).toBe("connected");
  expect(f.feeds).toHaveLength(1);
  expect(feed.reconnectNow).not.toHaveBeenCalled();
});

it.each([403, 503])("keeps host feed identity/backoff on HTTP %s without probing or connected emissions", async status => {
  await open(); const feed = f.feeds[0]; emit.mockClear(); f.host.mockClear();
  for (let n = 0; n < 20; n++) feed.handlers.status("retrying", new CutexApiError(status, "route_busy", "busy"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.host).not.toHaveBeenCalled(); expect(f.feeds).toHaveLength(1);
  expect(feed.stop).not.toHaveBeenCalled(); expect(feed.reconnectNow).not.toHaveBeenCalled();
  expect(emit.mock.calls.filter(([name]) => name === "daemonState")).toEqual([]);
});

it("coalesces transport recovery probes and retains a reachable host's existing feed", async () => {
  await open(); const feed = f.feeds[0]; f.host.mockClear();
  const probe = deferred(); f.host.mockReturnValue(probe.promise);
  for (let n = 0; n < 20; n++) feed.handlers.status("retrying", new CutexUnreachableError("url", Error("offline")));
  await vi.advanceTimersByTimeAsync(5000); expect(f.host).toHaveBeenCalledOnce();
  for (let n = 0; n < 20; n++) feed.handlers.status("retrying", new CutexUnreachableError("url", Error("offline")));
  expect(f.host).toHaveBeenCalledOnce();
  probe.resolve({ hostId: "h" }); await settle();
  expect(service.currentState.kind).toBe("connected"); expect(f.feeds).toHaveLength(1); expect(feed.stop).not.toHaveBeenCalled();
});

it("recovers a genuinely unreachable host on bounded probes without replacing its feed", async () => {
  await open(); const feed = f.feeds[0];
  f.host.mockRejectedValueOnce(new CutexUnreachableError("url", Error("offline"))).mockResolvedValue({ hostId: "h" });
  feed.handlers.status("retrying", new CutexUnreachableError("url", Error("offline")));
  await vi.advanceTimersByTimeAsync(5000); expect(service.currentState.kind).toBe("unreachable");
  await vi.advanceTimersByTimeAsync(5000); expect(service.currentState.kind).toBe("connected");
  expect(f.feeds).toHaveLength(1);
});

it("shares concurrent sidebar reads and reuses stable parts across runtime traffic", async () => {
  await open(); f.sessions.mockClear();
  const block = deferred(); f.hostSessions.mockReturnValueOnce(block.promise);
  const pending = Array.from({ length: 50 }, () => service.sidebar());
  expect(f.sessions).toHaveBeenCalledTimes(2);
  block.resolve({ data: [], nextCursor: null }); await Promise.all(pending);
  event("cutex/runtime/state"); await sidebar();
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(1);
  expect(f.projects).toHaveBeenCalledOnce(); expect(f.project).toHaveBeenCalledOnce();
  expect(f.hostSessions).toHaveBeenCalledTimes(2);
});

it.each(["cutex/session/retired", "cutex/session/restored", "cutex/session/deleted", "cutex/sessions/changed", "cutex/project/operatorsChanged", "cutex/agentManagement/actionCompleted"])("invalidates canonical parts on %s, including equal-count operator replacements", async method => {
  await open(); await sidebar();
  f.project.mockResolvedValue(workspace("replacement"));
  f.sessions.mockImplementation(async lifecycle => ({ sessions: lifecycle === "retired" ? [{ cutexSessionId: "archived" }] : [] }));
  event(method);
  const result = await sidebar();
  expect(result.projectOperators).toEqual({ p: ["replacement"] });
  expect(result.retired).toEqual([{ cutexSessionId: "archived" }]);
  expect(f.projects).toHaveBeenCalledTimes(2);
});

it("does one trailing refresh for an invalidation burst, and never repopulates the new roster from old reads", async () => {
  await open(); const old = deferred(); f.projects.mockReturnValueOnce(old.promise);
  const pending = service.sidebar();
  for (let n = 0; n < 50; n++) event("cutex/sessions/changed");
  f.project.mockResolvedValue(workspace("new"));
  old.resolve({ projects: [{ ...project(), authority_epoch: 1 }] });
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending).projectOperators).toEqual({ p: ["new"] });
  expect(f.projects).toHaveBeenCalledTimes(2); expect(f.hostSessions).toHaveBeenCalledTimes(2);
  expect((await sidebar()).projectOperators).toEqual({ p: ["new"] });
});

it("retries failed or stale-authority operator projections rather than caching absence", async () => {
  await open(); f.project.mockResolvedValueOnce(workspace("old", 1));
  expect((await sidebar()).projectOperators).toEqual({});
  expect((await sidebar()).projectOperators).toEqual({ p: ["member"] });
});

it("fences host switches during a sidebar read including the owner-only fallback", async () => {
  await open(); const old = deferred(); f.hostSessions.mockReturnValueOnce(old.promise);
  const pending = service.sidebar(); const rejected = expect(pending).rejects.toThrow("host switched");
  await open(); old.resolve({ data: [], nextCursor: null }); await rejected;
  await sidebar(); expect(f.projects).toHaveBeenCalledTimes(2);
});

it("caches capabilities per connection and invalidates on access changes before emitting", async () => {
  await open(); await Promise.all(Array.from({ length: 30 }, () => service.capabilities()));
  expect(f.capabilities).toHaveBeenCalledOnce();
  await sidebar();
  f.feeds[0].handlers.resync("access_changed"); await settle();
  await service.capabilities(); await sidebar();
  expect(f.capabilities).toHaveBeenCalledTimes(2); expect(f.projects).toHaveBeenCalledTimes(2);
  await open(); await service.capabilities(); expect(f.capabilities).toHaveBeenCalledTimes(3);
});

it("bounds a sustained invalidation storm to two reads and returns the latest completed snapshot", async () => {
  const refresh = new SidebarRefresh<number>(); let calls = 0;
  expect(await refresh.read(async () => { calls++; refresh.invalidate(); return calls; })).toBe(2);
  expect(calls).toBe(2); expect(await refresh.read(async () => 42)).toBe(42);
});

it("does not cache failed reads or replies overtaken by invalidation", async () => {
  const cache = new SidebarReadCache<number>(); const old = deferred<number>();
  const first = cache.read(() => old.promise); cache.invalidate();
  expect(await cache.read(async () => 2)).toBe(2); old.resolve(1); await first;
  expect(await cache.read(async () => 3)).toBe(2);
});

it("cancels a delayed unreachable probe when a route 503 proves reachability", async () => {
  await open(); const feed = f.feeds[0]; f.host.mockClear(); emit.mockClear();
  feed.handlers.status("retrying", new CutexUnreachableError("url", Error("down")));
  feed.handlers.status("retrying", new CutexApiError(503, "route_busy", "busy"));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.host).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
});

it("does not reset any feed's backoff or re-emit connected after a reachable transport probe", async () => {
  await open(); await service.subscribe("s", { streamId: "stream", after: null });
  const hostFeed = f.feeds[0], sessionFeed = f.feeds[1]; emit.mockClear();
  hostFeed.handlers.status("retrying", new CutexUnreachableError("url", Error("down")));
  await vi.advanceTimersByTimeAsync(5000);
  expect(hostFeed.reconnectNow).not.toHaveBeenCalled(); expect(sessionFeed.reconnectNow).not.toHaveBeenCalled();
  expect(emit.mock.calls.filter(([name]) => name === "daemonState")).toEqual([]);
});

it("gives stalled recovery probes a finite deadline and retries after it", async () => {
  await open(); f.host.mockImplementationOnce(({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("timeout")))));
  f.feeds[0].handlers.status("retrying", new CutexUnreachableError("url", Error("down")));
  await vi.advanceTimersByTimeAsync(20_000); expect(service.currentState.kind).toBe("error");
  await vi.advanceTimersByTimeAsync(5000); expect(service.currentState.kind).toBe("connected");
  expect(f.feeds).toHaveLength(1);
});

it("does not expose an old authority's roster when access changes during sidebar reads", async () => {
  await open(); const old = deferred(); f.projects.mockReturnValueOnce(old.promise);
  const pending = service.sidebar(); const rejected = expect(pending).rejects.toThrow("access changed");
  f.feeds[0].handlers.resync("access_changed"); await settle();
  f.projects.mockResolvedValue({ projects: [] }); old.resolve({ projects: [project()] });
  await rejected;
  expect((await sidebar()).projectOperators).toBeUndefined();
});

it("fences capability replies from the old grant and shares the replacement probe", async () => {
  await open(); const old = deferred(); f.capabilities.mockReturnValueOnce(old.promise);
  const pending = service.capabilities(); const rejected = expect(pending).rejects.toThrow("capability scope changed");
  f.feeds[0].handlers.resync("access_changed"); await settle();
  old.resolve({ featureList: ["live-text-deltas"] }); await rejected;
  await Promise.all([service.capabilities(), service.capabilities()]); expect(f.capabilities).toHaveBeenCalledTimes(2);
});

it("does not let an abandoned capability subscription poison the shared cache", async () => {
  await open(); const old = deferred(); f.capabilities.mockReturnValueOnce(old.promise);
  const subscription = service.subscribe("s", { streamId: "stream", after: null });
  await vi.advanceTimersByTimeAsync(1500); await subscription;
  await service.capabilities(); expect(f.capabilities).toHaveBeenCalledTimes(2);
  old.resolve({ featureList: ["live-text-deltas"] }); await settle();
  expect((await service.capabilities())?.featureList).toEqual([]);
});

it.each(["session", "operator", "project", "presentation"])("invalidates after %s mutations even if their outcome is uncertain", async kind => {
  await open(); await sidebar();
  const failure = Error("unknown outcome"); f.cutex.mockRejectedValue(failure); f.operatorAction.mockRejectedValue(failure); f.request.mockRejectedValue(failure);
  const mutation = kind === "session" ? service.sessionAction("s", "cutex/session/retire", {})
    : kind === "operator" ? service.operatorAction({} as any)
    : kind === "project" ? service.projectMutation("p", { authorityEpoch: 2, projectRevision: 1 }, {} as any)
    : service.projectPresentation("p", { authorityEpoch: 2, presentationRevision: 1 }, { display_name: "new", badge_label: "p", color: "blue" });
  await expect(mutation).rejects.toBe(failure);
  f.project.mockResolvedValue(workspace("replacement"));
  expect((await sidebar()).projectOperators).toEqual({ p: ["replacement"] });
});

it("keeps retired/project/roster reads cached under continuous slow active metadata traffic", async () => {
  await open(); await sidebar(); f.sessions.mockClear();
  f.hostSessions.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: [], nextCursor: null }), 2500)));
  const traffic = setInterval(() => event("cutex/session/metadata/update", { cutexSessionId: "active" }), 1000);
  const pending = service.sidebar();
  await vi.advanceTimersByTimeAsync(5000); await pending;
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(0);
  expect(f.projects).toHaveBeenCalledOnce(); expect(f.project).toHaveBeenCalledOnce();
  const next = service.sidebar(); await vi.advanceTimersByTimeAsync(5000); await next;
  clearInterval(traffic);
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "active")).toHaveLength(4);
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(0);
});

it("refreshes cached retired metadata while leaving unrelated active metadata cached", async () => {
  await open(); f.sessions.mockImplementation(async lifecycle => ({ sessions: lifecycle === "retired" ? [{ cutexSessionId: "old", displayName: "before" }] : [] }));
  expect((await sidebar()).retired[0]?.displayName).toBe("before");
  event("cutex/session/metadata/update", { cutexSessionId: "active" }); await sidebar();
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(1);
  f.sessions.mockImplementation(async lifecycle => ({ sessions: lifecycle === "retired" ? [{ cutexSessionId: "old", displayName: "after" }] : [] }));
  event("cutex/session/metadata/update", { cutexSessionId: "old" });
  expect((await sidebar()).retired[0]?.displayName).toBe("after");
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(2);
  expect(f.projects).toHaveBeenCalledOnce(); expect(f.project).toHaveBeenCalledOnce();
});

it("fences an in-flight privileged sidebar immediately on the first feed refusal", async () => {
  await open(); const block = deferred(); f.hostSessions.mockReturnValueOnce(block.promise);
  const pending = service.sidebar(); const rejected = expect(pending).rejects.toThrow("access changed");
  f.feeds[0].handlers.status("retrying", new CutexApiError(403, "access_pending", "refused"));
  block.resolve({ data: [], nextCursor: null }); await rejected;
});

it("active metadata mutations preserve the retired cache too", async () => {
  await open(); await sidebar();
  await service.sessionAction("active", "cutex/session/metadata/update", { displayName: "new" });
  await sidebar();
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(1);
  expect(f.projects).toHaveBeenCalledOnce(); expect(f.project).toHaveBeenCalledOnce();
});

it.each(["stream_changed", "cursor_expired", "stream_reset"])("refreshes capabilities and negotiated media/delta flags on same-endpoint %s", async reason => {
  await open();
  f.capabilities.mockResolvedValueOnce({ featureList: ["live-text-deltas", "history-media-refs"] });
  await service.capabilities();
  expect((service as any).liveDeltasClient).toBe(f.clients[0]);
  expect((service as any).mediaRefsClient).toBe(f.clients[0]);
  f.feeds[0].handlers.resync(reason);
  expect((service as any).liveDeltasClient).toBeNull();
  expect((service as any).mediaRefsClient).toBeNull();
  f.capabilities.mockResolvedValue({ featureList: ["new-feature"] });
  expect((await service.capabilities())?.featureList).toEqual(["new-feature"]);
  expect(f.capabilities).toHaveBeenCalledTimes(2); expect(f.clients).toHaveLength(1);
});

it.each(["cutex/components/updated", "cutex/features/changed", "cutex/featureFlags/updated", "cutex/settings/updated", "cutex/capabilities/changed", "cutex/users/changed", "cutex/access/changed"])("invalidates capabilities on dynamic event %s", async method => {
  await open(); await service.capabilities();
  f.capabilities.mockResolvedValue({ featureList: ["changed"] }); event(method);
  expect((await service.capabilities())?.featureList).toEqual(["changed"]);
  expect(f.capabilities).toHaveBeenCalledTimes(2);
});

it("does not memoize a missing capability route across an in-place upgrade", async () => {
  await open(); f.capabilities.mockResolvedValueOnce(null);
  expect(await service.capabilities()).toBeNull();
  expect((service as any).liveDeltasClient).toBeNull();
  f.capabilities.mockResolvedValue({ featureList: ["upgraded"] });
  expect((await service.capabilities())?.featureList).toEqual(["upgraded"]);
  expect(f.capabilities).toHaveBeenCalledTimes(2);
});

it("prevents capability reads overtaken by a component change from restoring old flags", async () => {
  await open(); const old = deferred(); f.capabilities.mockReturnValueOnce(old.promise);
  const pending = service.capabilities(); const rejected = expect(pending).rejects.toThrow("capability scope changed");
  event("cutex/components/updated");
  await service.capabilities(); old.resolve({ featureList: ["live-text-deltas", "history-media-refs"] }); await rejected;
  expect((service as any).liveDeltasSupported).toBe(false); expect((service as any).mediaRefsClient).toBeNull();
  expect((await service.capabilities())?.featureList).toEqual([]);
});

it("paces all daemon sidebar starts including trailing reads to 30/min under 1Hz metadata", async () => {
  await open(); f.sessions.mockClear();
  const starts: number[] = [];
  f.sessions.mockImplementation(async lifecycle => {
    if (lifecycle === "active") starts.push(Date.now());
    return { sessions: [] };
  });
  f.hostSessions.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: [], nextCursor: null }), 1500)));
  const origin = Date.now();
  const pending: Promise<unknown>[] = [service.sidebar()];
  const traffic = setInterval(() => event("cutex/session/metadata/update", { cutexSessionId: "active" }), 1000);
  const ticks = setInterval(() => { pending.push(service.sidebar()); }, 2000);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(starts).toHaveLength(30);
  expect(starts.every((start, i) => start === origin + i * 2000)).toBe(true);
  expect(f.sessions.mock.calls.filter(([lifecycle]) => lifecycle === "retired")).toHaveLength(1);
  expect(f.projects).toHaveBeenCalledOnce(); expect(f.project).toHaveBeenCalledOnce();
  clearInterval(traffic); clearInterval(ticks);
  await vi.advanceTimersByTimeAsync(5000); await Promise.all(pending);
});

it("shares paced waits and includes events received before a read starts without another trailing pass", async () => {
  const refresh = new SidebarRefresh<number>(2000); const load = vi.fn(async () => 1);
  expect(await refresh.read(load)).toBe(1);
  const pending = refresh.read(load);
  await vi.advanceTimersByTimeAsync(1000); refresh.invalidate();
  expect(refresh.read(load)).toBe(pending);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toBe(1); expect(load).toHaveBeenCalledTimes(2);
});

it("never starts a paced old-host read after the connection generation changes", async () => {
  await open(); await service.sidebar();
  const pending = service.sidebar(); const rejected = expect(pending).rejects.toThrow("host switched");
  await open(); const reads = f.sessions.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000); await rejected;
  expect(f.sessions).toHaveBeenCalledTimes(reads);
});
