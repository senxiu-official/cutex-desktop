// 重新批准文件夹, main side (shared/creatorPaths): no daemon text or folder path reaches the renderer — a failed
// reapprove-paths crosses IPC as a fixed code, and a queued send's failed start (cutex/userInput/startFailed) refused
// for moved folders is reduced to its code and session id before main emits the event.
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";

const f = vi.hoisted(() => ({ feeds: [] as any[], host: vi.fn(), sessions: vi.fn(), projects: vi.fn(), project: vi.fn(), hostSessions: vi.fn(), capabilities: vi.fn(), request: vi.fn(), cutex: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class {
    dispose = vi.fn();
    constructor(public endpoint: unknown, public options: unknown) {}
    host = f.host; sessions = f.sessions; projects = f.projects; project = f.project;
    hostSessions = f.hostSessions; capabilities = f.capabilities; request = f.request; cutex = f.cutex;
  },
  EventFeed: class {
    start = vi.fn(); stop = vi.fn(); reconnectNow = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: any) { f.feeds.push(this); }
  },
}));
import { CutexApiError, CutexUnreachableError } from "@cutex-desktop/cutex-client";
import { DaemonService, type DaemonEmit } from "../src/main/daemon";
import { reapproveFailure, withoutCreatorPathsDetail } from "../src/shared/creatorPaths";

const settle = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
let service: DaemonService;
let emit: Mock<DaemonEmit>;
beforeEach(async () => {
  vi.useFakeTimers(); f.feeds.length = 0;
  for (const value of Object.values(f)) if (typeof value === "function") value.mockReset();
  f.host.mockResolvedValue({ hostId: "h" });
  f.sessions.mockResolvedValue({ sessions: [], management: null });
  f.projects.mockResolvedValue({ projects: [] });
  f.hostSessions.mockResolvedValue({ data: [], nextCursor: null });
  f.capabilities.mockResolvedValue({ featureList: [], userAccess: { isOwner: true } });
  emit = vi.fn<DaemonEmit>(); service = new DaemonService(emit);
  service.useEndpoint({ baseUrl: "http://test.invalid", token: "token" }, { remote: true });
  await settle();
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

it("posts {} to reapprove-paths and turns every failure into a fixed code without the daemon's text", async () => {
  f.request.mockResolvedValueOnce({ cutexSessionId: "cutex.child", ownerApproved: true, revision: 4, creatorPathSnapshot: { cwd: "D:/secret", writable_roots: [], owner_approved: true } });
  await expect(service.reapproveSessionPaths("cutex.child")).resolves.toEqual({ cutexSessionId: "cutex.child", revision: 4 });
  expect(f.request).toHaveBeenCalledWith("POST", "/v2/sessions/cutex.child/reapprove-paths", { body: {} });
  const cases: [unknown, string][] = [
    [new CutexApiError(409, "session_retired", "D:/secret/moved: session_retired"), "session_retired"],
    [new CutexApiError(409, "creator_paths_changed", "D:/secret exceeds the creator's writable paths", false, { cutexSessionId: "cutex.child" }), "creator_paths_changed"],
    [new CutexApiError(403, "owner_credential_required", "D:/secret"), "forbidden"],
    [new CutexApiError(500, "internal", "panicked at D:/secret"), "failed"],
    [new CutexUnreachableError("http://test.invalid", new Error("connect ECONNREFUSED D:/secret")), "unreachable"],
  ];
  for (const [error, code] of cases) {
    f.request.mockRejectedValueOnce(error);
    const thrown = await service.reapproveSessionPaths("cutex.child").catch((e: Error) => e);
    expect(String((thrown as Error).message)).not.toContain("secret");
    expect(reapproveFailure(thrown)).toBe(code);
  }
});

it("reduces a startFailed refused for moved folders to its code and session id before emitting it", async () => {
  const feed = f.feeds.at(-1);
  feed.handlers.event({ cutex: { method: "cutex/userInput/startFailed", params: { queueIds: ["q1"], error: { code: "creator_paths_changed", message: "D:/secret/moved is not D:/secret/created", retryable: false, details: { cutexSessionId: "cutex.child", created: "D:/secret/created" } } } }, cutexSessionId: "cutex.child" });
  const sent = emit.mock.calls.filter(([name]) => name === "hostEvent").at(-1)![1];
  expect(JSON.stringify(sent)).not.toContain("secret");
  expect(sent).toMatchObject({ cutex: { params: { queueIds: ["q1"], error: { code: "creator_paths_changed", message: "", details: { cutexSessionId: "cutex.child" } } } } });
  // Other failures and other events pass unchanged.
  const other = { cutex: { method: "cutex/userInput/startFailed", params: { error: { code: "runtime_start_failed", message: "no credentials" } } } };
  expect(withoutCreatorPathsDetail(other)).toBe(other);
  const unrelated = { cutex: { method: "cutex/userInput/submitted", params: { error: { code: "creator_paths_changed", message: "x" } } } };
  expect(withoutCreatorPathsDetail(unrelated)).toBe(unrelated);
});

it("every event main forwards (host feed, both session-feed paths) goes through the same reduction", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/main/daemon.ts", import.meta.url), "utf8");
  expect(source.split("withoutLiveImages(withoutCreatorPathsDetail(envelope))").length - 1).toBe(3);
  expect(source).not.toContain("withoutLiveImages(envelope)");
});
