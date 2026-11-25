// 项目 table batch, main side (shared/projectBatchOutcome, main/projectBatchLease): the IPC write methods check their
// payload at run time and build only the intended requests (archive / restore; a whole-project pause after the current
// 回合, or lifting the pause just read); anything else is refused without a request. One batch at a time across windows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ feeds: [] as any[], host: vi.fn(), sessions: vi.fn(), projects: vi.fn(), project: vi.fn(), hostSessions: vi.fn(), capabilities: vi.fn(), request: vi.fn(), cutex: vi.fn(), delegationControl: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class {
    dispose = vi.fn();
    constructor(public endpoint: unknown, public options: unknown) {}
    host = f.host; sessions = f.sessions; projects = f.projects; project = f.project;
    hostSessions = f.hostSessions; capabilities = f.capabilities; request = f.request; cutex = f.cutex; delegationControl = f.delegationControl;
  },
  EventFeed: class {
    start = vi.fn(); stop = vi.fn(); reconnectNow = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: any) { f.feeds.push(this); }
  },
}));
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { ProjectBatchLease, PROJECT_BATCH_LEASE_MS } from "../src/main/projectBatchLease";
import { checkLifecycleRequest, runControlRequest } from "../src/shared/projectBatchOutcome";

describe("payload checks", () => {
  it("takes only archive / restore with numeric expectations", () => {
    expect(checkLifecycleRequest("p1", { authorityEpoch: 2, projectRevision: 5 }, "archive")).toEqual({ projectId: "p1", expected: { authorityEpoch: 2, projectRevision: 5 }, kind: "archive" });
    for (const kind of ["rename", "delete", "move", undefined]) expect(() => checkLifecycleRequest("p1", { authorityEpoch: 2, projectRevision: 5 }, kind)).toThrow();
    expect(() => checkLifecycleRequest("p1", { authorityEpoch: "2", projectRevision: 5 }, "archive")).toThrow();
    expect(() => checkLifecycleRequest("p1", { authorityEpoch: 2, projectRevision: 5, director: true }, "archive")).toThrow();
    expect(() => checkLifecycleRequest("../p1", { authorityEpoch: 2, projectRevision: 5 }, "archive")).toThrow();
  });
  it("builds only a whole-project after-回合 pause or a resume of the pause read; other controls, modes, scopes and fields throw", () => {
    expect(runControlRequest("p1", { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "all" })).toEqual({ kind: "pause", projectId: "p1", body: { actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "all" } });
    expect(runControlRequest("p1", { kind: "resume", actionId: "a2", expectedEpoch: 3, pauseId: "pz" })).toEqual({ kind: "resume", projectId: "p1", body: { actionId: "a2", pauseId: "pz", expectedEpoch: 3 } });
    const bad = [
      { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "interrupt", scope: "all" },
      { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "members" },
      { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "all", nodeId: "x" },
      { kind: "stop", actionId: "a1", nodeId: "d1", cascade: "descendants", stopJobs: true, expectedRevision: 1 },
      { kind: "policy", actionId: "a1", memberMode: "open", expectedRevision: 1 },
      { kind: "resume", actionId: "a1", expectedEpoch: 3 },
      { kind: "resume", actionId: "a1", expectedEpoch: -1, pauseId: "pz" },
      null, "pause",
    ];
    for (const action of bad) expect(() => runControlRequest("p1", action)).toThrow();
  });
});

describe("one batch across windows", () => {
  it("grants one lease, names the batch holding it, and frees it on end or when it is not renewed", () => {
    let now = 0;
    const lease = new ProjectBatchLease(() => now);
    const a = lease.handle({ op: "begin", kind: "archive", total: 3 });
    expect(a.ok).toBe(true);
    expect(lease.handle({ op: "begin", kind: "pause", total: 1 })).toEqual({ ok: false, busy: { kind: "archive", total: 3 } });
    now += PROJECT_BATCH_LEASE_MS - 1;
    expect(lease.handle({ op: "renew", token: (a as { token: string }).token }).ok).toBe(true);
    now += PROJECT_BATCH_LEASE_MS - 1;
    expect(lease.handle({ op: "begin", kind: "pause", total: 1 }).ok).toBe(false);
    expect(lease.handle({ op: "end", token: "someone-else" }).ok).toBe(false);
    expect(lease.handle({ op: "end", token: (a as { token: string }).token }).ok).toBe(true);
    const b = lease.handle({ op: "begin", kind: "pause", total: 1 });
    expect(b.ok).toBe(true);
    // A window that reloaded mid-batch stops renewing: the lease lapses.
    now += PROJECT_BATCH_LEASE_MS;
    expect(lease.handle({ op: "begin", kind: "restore", total: 2 }).ok).toBe(true);
    expect(lease.handle({ op: "renew", token: (b as { token: string }).token }).ok).toBe(false);
    expect(() => lease.handle({ op: "begin", kind: "delete", total: 1 } as never)).toThrow();
    expect(() => lease.handle({ op: "begin", kind: "archive", total: 0 })).toThrow();
  });
});

describe("main write methods", () => {
  const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
  let service: DaemonService;
  beforeEach(async () => {
    vi.useFakeTimers(); f.feeds.length = 0;
    for (const value of Object.values(f)) if (typeof value === "function") value.mockReset();
    f.host.mockResolvedValue({ hostId: "h" });
    f.sessions.mockResolvedValue({ sessions: [], management: null });
    f.projects.mockResolvedValue({ projects: [] });
    f.hostSessions.mockResolvedValue({ data: [], nextCursor: null });
    f.capabilities.mockResolvedValue({ featureList: [], userAccess: { isOwner: true } });
    service = new DaemonService(vi.fn());
    service.useEndpoint({ baseUrl: "http://test.invalid", token: "token" }, { remote: true });
    await settle();
  });
  afterEach(() => { service.stop(); vi.useRealTimers(); });

  it("archives with the checked kind only, and refuses anything else without a request", async () => {
    f.request.mockResolvedValue({});
    expect(await service.projectLifecycle("p1", { authorityEpoch: 1, projectRevision: 4 }, "archive")).toEqual({ outcome: "done" });
    expect(f.request).toHaveBeenCalledWith("POST", "/v2/agent-management/project-mutations", expect.objectContaining({ body: expect.objectContaining({ project_id: "p1", operation: { kind: "archive" } }) }));
    f.request.mockClear();
    expect(await service.projectLifecycle("p1", { authorityEpoch: 1, projectRevision: 4 }, "rename" as never)).toEqual({ outcome: "refused", code: "bad_request" });
    expect(f.request).not.toHaveBeenCalled();
    // An unstructured 4xx (a proxy's, say) is not a refusal.
    f.request.mockRejectedValueOnce(CutexApiError.fromBody(404, "<html>not found</html>"));
    expect((await service.projectLifecycle("p1", { authorityEpoch: 1, projectRevision: 4 }, "restore")).outcome).toBe("unknown");
  });

  it("sends only the request it builds for a pause / resume", async () => {
    f.delegationControl.mockResolvedValue({ receipt: null });
    await service.projectBatchControl("p1", { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "all" });
    expect(f.delegationControl).toHaveBeenCalledExactlyOnceWith({ kind: "pause", projectId: "p1", body: { actionId: "a1", expectedEpoch: 3, mode: "afterTurn", scope: "all" } });
    f.delegationControl.mockClear();
    for (const action of [
      { kind: "pause", actionId: "a1", expectedEpoch: 3, mode: "interrupt", scope: "all" },
      { kind: "stop", actionId: "a1", nodeId: "d1", cascade: "descendants", stopJobs: true, expectedRevision: 1 },
    ]) expect(await service.projectBatchControl("p1", action as never)).toEqual({ outcome: "refused", code: "bad_request" });
    expect(f.delegationControl).not.toHaveBeenCalled();
  });
});
