// 百度网盘 (modules/baidu-pan): the pure model, the per-host store (connection, login poll, browse, search,
// downloads, the ref-counted event feed) and main's request checks (main/panApi.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanConnection, PanDownload, PanFile, PanResult } from "../src/shared/baiduPan";

const listeners = new Map<string, ((payload: never) => void)[]>();
vi.mock("../src/renderer/src/bridge", () => ({
  api: {},
  apiFor: () => ({}),
  bridge: {
    on: (event: string, f: (payload: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), f]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((g) => g !== f));
    },
  },
}));

const S = await import("../src/renderer/src/modules/baidu-pan/store");
const M = await import("../src/renderer/src/modules/baidu-pan/model");
const { panApi, panPath, scrub } = await import("../src/main/panApi");
const { CutexApiError } = await import("@cutex-desktop/cutex-client");

const fire = (event: string, payload: unknown) => (listeners.get(event) ?? []).forEach((f) => f(payload as never));
const ok = <T,>(value: T): PanResult<T> => ({ ok: true, value });
const conn = (state: PanConnection["state"]): PanConnection => ({ configured: true, state, appId: "1", clientId: "k", account: state === "connected" ? { id: "9", name: "me", vipType: 2 } : null, expiresAt: null });
const file = (path: string, isDir = false): PanFile => ({ id: path, path, name: path.split("/").pop()!, isDir, size: 10, modifiedAt: 1 });
const dl = (id: string, patch: Partial<PanDownload> = {}): PanDownload => ({ id, requestId: "r" + id, remote: "/a/" + id, targetDir: "D:\\x", targetPath: "D:\\x\\" + id, state: "downloading", downloadedBytes: 0, totalBytes: 100, bytesPerSecond: 0, caller: { kind: "owner", id: null }, createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", error: null, ...patch });
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeDaemon() {
  return {
    panConnection: vi.fn(async () => ok(conn("connected"))),
    panConfigure: vi.fn(async () => ok(conn("needsAuth"))),
    panDisconnect: vi.fn(async () => ok({ disconnected: true as const })),
    panAuthStart: vi.fn(async () => ok({ id: "a1", state: "pending" as const, verificationUrl: "https://openapi.baidu.com/device", userCode: "ABCD", expiresAt: new Date(Date.now() + 300_000).toISOString(), intervalSeconds: 5 })),
    panAuthPoll: vi.fn(async (): Promise<PanResult<{ id: string; state: "pending" | "connected" | "expired" | "failed"; connection?: PanConnection }>> => ok({ id: "a1", state: "pending" })),
    panAuthCode: vi.fn(async () => ok(conn("connected"))),
    panFiles: vi.fn(async (dir: string, start = 0) => ok({ files: start ? [file(dir + "/c"), file(dir + "/b")] : [file(dir + "/a", true), file(dir + "/b")], hasMore: !start, nextStart: start ? null : 2 })),
    panSearch: vi.fn(async (key: string) => ok({ files: [file("/x/" + key)], hasMore: true })),
    panMeta: vi.fn(async (path: string) => ok({ file: { ...file(path), size: 999 } })),
    panDownloads: vi.fn(async () => ok({ downloads: [dl("d1")] })),
    panStartDownload: vi.fn(async (req: { remote: string; targetDir: string }) => ok({ download: dl("d2", { remote: req.remote, targetDir: req.targetDir, state: "queued", createdAt: "2026-11-11T01:00:00Z" }) })),
    panDownloadAction: vi.fn(async (id: string, action: string) => ok({ download: dl(id, { state: action === "pause" ? "paused" : "cancelled", updatedAt: "2026-11-11T02:00:00Z" }) })),
    watchPan: vi.fn(async () => "w1"),
    unwatchPan: vi.fn(async () => undefined),
  };
}
let d: ReturnType<typeof fakeDaemon>;
beforeEach(() => {
  S.resetPanStore();
  listeners.clear();
  d = fakeDaemon();
  S.setPanDaemon(() => d as never);
});
afterEach(() => S.setPanDaemon(null));

describe("model", () => {
  it("breadcrumbs, parents and names", () => {
    expect(M.crumbs("/")).toEqual([{ name: "", path: "/" }]);
    expect(M.crumbs("/研究资料/论文")).toEqual([{ name: "", path: "/" }, { name: "研究资料", path: "/研究资料" }, { name: "论文", path: "/研究资料/论文" }]);
    expect(M.parentOf("/a/b")).toBe("/a");
    expect(M.parentOf("/a")).toBe("/");
    expect(M.baseName("D:\\x\\y.zip")).toBe("y.zip");
  });
  it("sizes, speed and time left (only while it means something)", () => {
    expect(M.fmtBytes(512)).toBe("512 B");
    expect(M.fmtBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
    expect(M.fmtBytes(182 * 1024 ** 3)).toBe("182 GiB");
    expect(M.fmtBytes(null)).toBe("—");
    expect(M.etaSeconds(dl("a", { totalBytes: 1000, downloadedBytes: 400, bytesPerSecond: 100 }))).toBe(6);
    expect(M.etaSeconds(dl("a", { bytesPerSecond: 0 }))).toBeNull();
    expect(M.etaSeconds(dl("a", { state: "paused", bytesPerSecond: 50 }))).toBeNull();
    expect(M.etaSeconds(dl("a", { totalBytes: null, bytesPerSecond: 50 }))).toBeNull();
    expect(M.fmtEta(3725)).toBe("1h 02m");
    expect(M.progressOf(dl("a", { totalBytes: null, state: "completed" }))).toBe(100);
    expect(M.progressOf(dl("a", { totalBytes: null }))).toBeNull();
  });
  it("merges rows newest first and ignores an older copy of a row", () => {
    const a = dl("a", { createdAt: "2026-11-11T00:00:00Z" });
    const b = dl("b", { createdAt: "2026-11-11T05:00:00Z" });
    let list = M.mergeDownload(M.mergeDownload([], a), b);
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
    list = M.mergeDownload(list, { ...a, updatedAt: "2026-11-11T09:00:00Z", downloadedBytes: 50 });
    expect(list.find((x) => x.id === "a")!.downloadedBytes).toBe(50);
    expect(M.mergeDownload(list, { ...a, updatedAt: "2026-11-11T01:00:00Z", downloadedBytes: 5 }).find((x) => x.id === "a")!.downloadedBytes).toBe(50);
  });
  it("offers the contract's controls per state", () => {
    expect(M.controlsOf(dl("a"))).toEqual({ pause: true, resume: false, cancel: true });
    expect(M.controlsOf(dl("a", { state: "paused" }))).toEqual({ pause: false, resume: true, cancel: true });
    expect(M.controlsOf(dl("a", { state: "failed", error: { code: "pan_network_error", message: "", retryable: true } }))).toEqual({ pause: false, resume: true, cancel: false });
    expect(M.controlsOf(dl("a", { state: "failed", error: { code: "pan_permission_denied", message: "", retryable: false } })).resume).toBe(false);
    expect(M.controlsOf(dl("a", { state: "completed" }))).toEqual({ pause: false, resume: false, cancel: false });
  });
  it("checks a target folder and words errors plainly", () => {
    expect(M.targetDirProblem("")).toBe("empty");
    expect(M.targetDirProblem("downloads")).toBe("relative");
    expect(M.targetDirProblem("D:\\a\\..\\b")).toBe("dots");
    expect(M.targetDirProblem("D:\\Data\\baidu")).toBeNull();
    expect(M.targetDirProblem("/srv/data/x")).toBeNull();
    expect(M.targetDirProblem("\\\\nas\\share")).toBeNull();
    const t = (k: string) => `T:${k}`;
    expect(M.errorText(t as never, { code: "pan_rate_limited", message: "errno 20012" })).toBe("T:baidu-pan.error.rateLimited");
    expect(M.errorText(t as never, { code: "weird", message: "raw words" })).toBe("raw words");
  });
});

describe("store", () => {
  it("reads the connection and, connected, the root folder", async () => {
    await S.loadConnection("h1");
    await tick();
    const h = S.hostPan("h1");
    expect(h.connection?.state).toBe("connected");
    expect(d.panFiles).toHaveBeenCalledWith("/", 0, 100);
    expect(h.listing.files.map((f) => f.name)).toEqual(["a", "b"]);
  });
  it("pages a folder without duplicates and drops an answer for a folder left meanwhile", async () => {
    await S.openDir("h1", "/r");
    await S.loadMore("h1");
    expect(S.hostPan("h1").listing.files.map((f) => f.name)).toEqual(["a", "b", "c"]);
    expect(S.hostPan("h1").listing.hasMore).toBe(false);
    let release!: () => void;
    d.panFiles.mockImplementationOnce(() => new Promise((r) => (release = () => r(ok({ files: [file("/old/z")], hasMore: false, nextStart: null })))));
    const slow = S.openDir("h1", "/old");
    await S.openDir("h1", "/new");
    release();
    await slow;
    expect(S.hostPan("h1").listing.dir).toBe("/new");
    expect(S.hostPan("h1").listing.files.some((f) => f.path === "/old/z")).toBe(false);
  });
  it("searches the current folder, says when Baidu cut the results, and clears", async () => {
    await S.openDir("h1", "/r");
    await S.search("h1", "  mof ");
    expect(d.panSearch).toHaveBeenCalledWith("mof", "/r");
    expect(S.hostPan("h1").search).toMatchObject({ key: "mof", dir: "/r", hasMore: true });
    S.clearSearch("h1");
    expect(S.hostPan("h1").search).toBeNull();
  });
  it("shows a selected file at once and refreshes it from meta", async () => {
    S.select("h1", file("/r/b"));
    expect(S.hostPan("h1").selected?.size).toBe(10);
    await tick();
    expect(S.hostPan("h1").selected?.size).toBe(999);
  });
  it("starts a download with a fresh request id and controls it", async () => {
    await S.startDownload("h1", file("/r/b"), " D:\\Data ");
    const req = d.panStartDownload.mock.calls[0]![0] as { requestId: string; remote: string; targetDir: string };
    expect(req.remote).toBe("/r/b");
    expect(req.targetDir).toBe("D:\\Data");
    expect(req.requestId).toMatch(/^dl-/);
    expect(S.hostPan("h1").downloads[0]!.id).toBe("d2");
    await S.control("h1", "d2", "pause");
    expect(S.hostPan("h1").downloads[0]!.state).toBe("paused");
  });
  it("keeps main's refusal as an error instead of throwing", async () => {
    d.panStartDownload.mockImplementationOnce(() => { throw new Error("invalid target folder"); });
    expect(await S.startDownload("h1", file("/r/b"), "x")).toBeNull();
    expect(S.hostPan("h1").startError?.code).toBe("invalid_request");
  });
});

describe("login poll", () => {
  it("stays pending, then takes the connection and opens the root", async () => {
    await S.startAuth("h1");
    expect(S.hostPan("h1").authPhase).toBe("pending");
    await S.pollAuth("h1");
    expect(S.hostPan("h1").authPhase).toBe("pending");
    d.panAuthPoll.mockResolvedValueOnce(ok({ id: "a1", state: "connected", connection: conn("connected") }));
    await S.pollAuth("h1");
    await tick();
    expect(S.hostPan("h1")).toMatchObject({ authPhase: "idle", auth: null, connection: { state: "connected" } });
    expect(d.panFiles).toHaveBeenCalled();
  });
  it("expires by the clock without asking, and fails on a final error", async () => {
    await S.startAuth("h1");
    await S.pollAuth("h1", Date.now() + 400_000);
    expect(S.hostPan("h1").authPhase).toBe("expired");
    expect(d.panAuthPoll).not.toHaveBeenCalled();
    await S.startAuth("h1");
    d.panAuthPoll.mockResolvedValueOnce({ ok: false, code: "pan_permission_denied", message: "no", retryable: false });
    await S.pollAuth("h1");
    expect(S.hostPan("h1").authPhase).toBe("failed");
  });
  it("the authorization-code fallback sends the code once (oob by default) and opens the root", async () => {
    expect(await S.submitAuthCode("h1", "  abc123 ", "")).toBe(true);
    expect(d.panAuthCode).toHaveBeenCalledWith("abc123", "oob");
    await tick();
    expect(S.hostPan("h1").connection?.state).toBe("connected");
    expect(d.panFiles).toHaveBeenCalledWith("/", 0, 100);
    d.panAuthCode.mockResolvedValueOnce({ ok: false, code: "pan_needs_auth", message: "bad", retryable: false });
    expect(await S.submitAuthCode("h1", "x", "https://example.org/cb")).toBe(false);
    expect(S.hostPan("h1")).toMatchObject({ authPhase: "failed", authError: { code: "pan_needs_auth" } });
  });
  it("a retryable error keeps waiting", async () => {
    await S.startAuth("h1");
    d.panAuthPoll.mockResolvedValueOnce({ ok: false, code: "unreachable", message: "x", retryable: true });
    await S.pollAuth("h1");
    expect(S.hostPan("h1").authPhase).toBe("pending");
    expect(S.hostPan("h1").authError?.code).toBe("unreachable");
  });
});

describe("event feed", () => {
  it("one watch per host for any number of pages; rows merge; live re-reads; the last release stops it", async () => {
    const r1 = S.acquireFeed("h1");
    const r2 = S.acquireFeed("h1");
    await tick();
    expect(d.watchPan).toHaveBeenCalledTimes(1);
    expect(d.panDownloads).toHaveBeenCalledTimes(1);
    fire("panEvents", { hostId: "h1", watchId: "w1", kind: "download", download: dl("d9", { downloadedBytes: 40 }) });
    fire("panEvents", { hostId: "h1", watchId: "other", kind: "download", download: dl("dx") });
    fire("panEvents", { hostId: "h2", watchId: "w1", kind: "download", download: dl("dy") });
    expect(S.hostPan("h1").downloads.map((x) => x.id).sort()).toEqual(["d1", "d9"]);
    fire("panEvents", { hostId: "h1", watchId: "w1", kind: "status", status: "live" });
    await tick();
    expect(S.hostPan("h1").feed).toBe("live");
    expect(d.panDownloads).toHaveBeenCalledTimes(2);
    r1();
    r1();
    expect(d.unwatchPan).not.toHaveBeenCalled();
    r2();
    expect(d.unwatchPan).toHaveBeenCalledWith("w1");
    expect(S.hostPan("h1").feed).toBe("off");
  });
  it("a watch id that arrives after the release is stopped at once", async () => {
    let answer!: (id: string) => void;
    d.watchPan.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const release = S.acquireFeed("h1");
    release();
    answer("late");
    await tick();
    expect(d.unwatchPan).toHaveBeenCalledWith("late");
  });
});

describe("main/panApi", () => {
  const client = (impl?: (method: string, path: string, opts: unknown) => unknown) => ({ request: vi.fn(async (m: string, p: string, o: unknown) => (impl ? impl(m, p, o) : {})) });
  it("checks paths and folders before calling cutex", () => {
    expect(panPath("/a/b")).toBe("/a/b");
    expect(() => panPath("a/b")).toThrow();
    expect(() => panPath("/a/../b")).toThrow();
    const c = client();
    const api = panApi(c as never);
    expect(() => api.panStartDownload({ requestId: "r1", remote: "/a", targetDir: "relative/dir" })).toThrow(/target folder/);
    expect(() => api.panStartDownload({ requestId: "bad id!", remote: "/a", targetDir: "/tmp" })).toThrow(/request id/);
    expect(() => api.panSearch("x".repeat(31), "/")).toThrow(/too long/);
    expect(() => api.panDownloadAction("d1", "delete" as never)).toThrow();
    expect(() => api.panAuthCode("c", "localhost/cb")).toThrow(/redirect/);
    expect(() => api.panAuthCode("", "oob")).toThrow(/code/);
    expect(c.request).not.toHaveBeenCalled();
  });
  it("sends only known fields, clamps paging, and maps errors", async () => {
    const c = client();
    const api = panApi(c as never);
    await api.panConfigure({ appId: " 41785023 ", clientId: "k", clientSecret: "s3cret", extra: 1 } as never);
    expect(c.request).toHaveBeenLastCalledWith("PUT", "/v2/pan/connection", { body: { appId: "41785023", clientId: "k", clientSecret: "s3cret" } });
    await api.panAuthCode(" c0de ", "oob");
    expect(c.request).toHaveBeenLastCalledWith("POST", "/v2/pan/auth/code", { body: { code: "c0de", redirectUri: "oob" } });
    await api.panFiles("/", 0, 5000);
    expect(c.request).toHaveBeenLastCalledWith("GET", "/v2/pan/files", { query: { dir: "/", start: 0, limit: 1000 } });
    await api.panDownloadAction("d 1".replace(" ", ""), "resume");
    expect(c.request).toHaveBeenLastCalledWith("POST", "/v2/pan/downloads/d1/resume", { body: {} });
    const missing = panApi(client(() => { throw new CutexApiError(404, "not_found", "no route"); }) as never);
    expect(await missing.panConnection()).toMatchObject({ ok: false, code: "unsupported" });
    const limited = panApi(client(() => { throw new CutexApiError(429, "pan_rate_limited", "20012"); }) as never);
    expect(await limited.panFiles("/")).toEqual({ ok: false, code: "pan_rate_limited", message: "20012", retryable: true });
  });
  it("never passes a credential-like key through", () => {
    expect(scrub({ a: 1, clientSecret: "x", nested: [{ dlink: "u", ok: true }], accessToken: "t" })).toEqual({ a: 1, nested: [{ ok: true }] });
  });
});
