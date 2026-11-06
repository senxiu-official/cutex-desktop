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


const row = (id = "agent", generation = 1) => ({ cutexSessionId: id, runtime: { runtimeGeneration: generation, backgroundWork: { running: false } } });
const changed = (running: boolean, generation = 1, id = "agent") => event("cutex/session/backgroundWork/changed", { cutexSessionId: id, runtimeGeneration: generation, backgroundWork: { running, shells: running ? 1 : 0, complete: true } });

it("patches an old in-flight active read without invalidation or whole-list follow-up", async () => {
  await open();
  const old = deferred();
  f.sessions.mockImplementation((kind: string) => kind === "active" ? old.promise : Promise.resolve({ sessions: [] }));
  const pending = sidebar();
  await settle(); await vi.advanceTimersByTimeAsync(2000);
  const calls = f.sessions.mock.calls.length;
  for (let i = 0; i < 100; i++) changed(i % 2 === 0);
  old.resolve({ sessions: [row(), row("other")] });
  const snapshot = await pending;
  expect(snapshot.active[0]!.runtime.backgroundWork).toEqual({ running: false, shells: 0, complete: true });
  expect(f.sessions.mock.calls).toHaveLength(calls);
  expect(emit.mock.calls.filter(([name]) => name === "hostEvent")).toHaveLength(100);
});

it("projects cached retired rows without another archive/projects RPC, fences old generations", async () => {
  f.sessions.mockImplementation(async (kind: string) => ({ sessions: kind === "retired" ? [row()] : [] }));
  await open(); await service.sidebarLoadArchived(); await sidebar();
  f.sessions.mockClear(); f.projects.mockClear(); f.hostSessions.mockClear();
  changed(true); const start = await sidebar();
  expect(start.retired[0]!.runtime.backgroundWork?.running).toBe(true);
  changed(false); changed(true, 0);
  const end = await sidebar();
  expect(end.retired[0]!.runtime.backgroundWork?.running).toBe(false);
  expect(f.sessions.mock.calls.filter(([kind]) => kind === "retired")).toHaveLength(0);
  expect(f.projects).not.toHaveBeenCalled();
  // These were explicitly requested snapshots, not event-triggered reads.
  expect(f.hostSessions).toHaveBeenCalledTimes(2);
});

it("discards connection and resync overlays; stale feed events cannot contaminate a new host", async () => {
  f.sessions.mockImplementation(async () => ({ sessions: [row()] }));
  await open(); const oldFeed = f.feeds.at(-1);
  changed(true); expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(true);
  await open();
  oldFeed.handlers.event({ cutex: { method: "cutex/session/backgroundWork/changed", params: { cutexSessionId: "agent", runtimeGeneration: 1, backgroundWork: { running: true } } } });
  expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(false);
  changed(true);
  f.feeds.at(-1).handlers.resync("cursor_expired"); await settle();
  expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(false);
});

it("resync recovery does not join an obsolete in-flight sidebar read", async () => {
  await open();
  const old = deferred();
  f.sessions.mockImplementation((kind: string) => kind === "active" ? old.promise : Promise.resolve({ sessions: [] }));
  const pending = service.sidebar();
  const rejected = expect(pending).rejects.toThrow("sidebar event scope changed");
  await vi.advanceTimersByTimeAsync(2000); await settle();
  f.sessions.mockResolvedValue({ sessions: [row()] });
  f.feeds.at(-1).handlers.resync("cursor_expired"); await settle();
  expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(false);
  old.resolve({ sessions: [row()] }); await rejected;
});

it("opts host feed into status only and recovers one snapshot after ephemeral stream loss", async () => {
  await open();
  const feed = f.feeds.at(-1);
  expect(feed.options.sessionStatus).toBe(true);
  expect(feed.options.liveDeltas).not.toBe(true);
  f.sessions.mockImplementation(async () => ({ sessions: [row()] }));
  changed(true); await sidebar();
  event("cutex/session/backgroundWork/changed", { cutexSessionId: "agent", runtimeGeneration: 1, backgroundWork: null });
  expect((await sidebar()).active[0]!.runtime.backgroundWork).toBeNull();
  changed(true);
  feed.handlers.status("retrying", new CutexApiError(503, "busy", "busy"));
  feed.handlers.status("retrying", new CutexApiError(503, "busy", "busy"));
  feed.handlers.status("live"); feed.handlers.status("live");
  expect(emit.mock.calls.filter(([name]) => name === "hostResync")).toEqual([["hostResync", { reason: "session_status_reconnected" }]]);
  expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(false);
  // A graceful SSE EOF reconnects without a retrying/error callback.
  feed.handlers.status("connecting"); feed.handlers.status("live");
  expect(emit.mock.calls.filter(([name]) => name === "hostResync")).toHaveLength(2);
});

it("closes the first-connect snapshot/subscription gap once and fences an older read", async () => {
  await open();
  const old = deferred();
  f.sessions.mockImplementation((kind: string) => kind === "active" ? old.promise : Promise.resolve({ sessions: [] }));
  const pending = service.sidebar();
  const rejected = expect(pending).rejects.toThrow("sidebar event scope changed");
  await vi.advanceTimersByTimeAsync(2000); await settle();
  // Work changed before the subscription: there is no replayable status event.
  f.sessions.mockResolvedValue({ sessions: [{ ...row(), runtime: { ...row().runtime, backgroundWork: { running: true } } }] });
  const feed = f.feeds.at(-1);
  feed.handlers.status("live"); feed.handlers.status("live");
  expect(emit.mock.calls.filter(([name]) => name === "hostResync")).toEqual([["hostResync", { reason: "session_status_reconnected" }]]);
  expect((await sidebar()).active[0]!.runtime.backgroundWork?.running).toBe(true);
  old.resolve({ sessions: [row()] }); await rejected;
});
