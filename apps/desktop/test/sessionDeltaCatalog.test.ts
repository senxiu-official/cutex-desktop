import { expect, it, vi } from "vitest";
import { CutexClient, type SessionCatalogPage, type SessionChangePage } from "@cutex-desktop/cutex-client";
import type { HostSessionRow, SessionResource } from "@cutex-desktop/protocol";
import { SessionDeltaCatalog, type SessionCatalogSource } from "../src/main/sessionDeltaCatalog";

const resource = (id: string, lifecycle = "active"): SessionResource => ({
  cutexSessionId: id, lifecycle, displayName: id, visible: true, registrationClass: "persistent", revision: 9000,
} as SessionResource);
const hostRow = (id: string) => ({ id, name: id, projectId: "p" } as HostSessionRow);
const page = (ids: string[], changeCursor = "first", nextCursor: string | null = null): SessionCatalogPage => ({
  sessions: ids.map(cutexSessionId => ({ cutexSessionId, revision: 1 })), changeCursor, nextCursor, oversizeFirst: false,
  claudeRuntime: { selectedRelease: "claude-r20" },
  hostId: "h",
});
const changes = (ids: string[] = [], nextCursor = "next", more = false): SessionChangePage => ({
  resyncRequired: false, changes: ids.map((key, n) => ({ key, seq: n + 1, revision: 1, deleted: false })), nextCursor,
  watermark: ids.length, more, oversizeFirst: false, claudeRuntime: { selectedRelease: "claude-r20" }, hostId: "h",
});
function fixture() {
  const source = {
    page: vi.fn<SessionCatalogSource["page"]>(async lifecycle => page(lifecycle === "active" ? ["a", "b"] : ["r"])),
    changes: vi.fn<SessionCatalogSource["changes"]>(async () => changes()),
    session: vi.fn<SessionCatalogSource["session"]>(async (id, lifecycle) => resource(id, lifecycle)),
    hostRow: vi.fn<SessionCatalogSource["hostRow"]>(async id => hostRow(id)),
    retired: vi.fn<SessionCatalogSource["retired"]>(async () => [resource("r", "retired")]),
  };
  return { source, catalog: new SessionDeltaCatalog(source) };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

it("keeps the first head across both lifecycles and reconciles edits during pagination", async () => {
  const { source, catalog } = fixture();
  source.page.mockImplementation(async (lifecycle, cursor) => lifecycle === "active"
    ? cursor ? page(["b"], "later") : page(["a"], "first", "page2") : page(["r"], "last"));
  source.changes.mockResolvedValueOnce({ ...changes(["c"]), changes: [
    { key: "a", seq: 1, revision: 2, deleted: true }, { key: "c", seq: 2, revision: 2, deleted: false },
  ] });
  catalog.wantArchived();
  const result = await catalog.read();
  expect(source.changes).toHaveBeenCalledWith("first");
  expect(result.active.map(row => row.cutexSessionId)).toEqual(["b", "c"]);
  expect(result.retired.map(row => row.cutexSessionId)).toEqual(["r"]);
  expect(Object.keys(result.hostRows).sort()).toEqual(["b", "c"]);
  expect(result.claudeRuntime).toEqual({ selectedRelease: "claude-r20" });
});

it("drains pages, deduplicates transport sequences, applies tombstones and ignores presentation revisions", async () => {
  const { source, catalog } = fixture(); catalog.wantArchived(); await catalog.read(); source.session.mockClear();
  source.session.mockImplementation(async id => resource(id, "retired"));
  source.changes.mockResolvedValueOnce({ ...changes([], "more", true), changes: [
    { key: "a", seq: 10, revision: 2, deleted: false }, { key: "b", seq: 11, revision: 2, deleted: true },
  ] }).mockResolvedValueOnce({ ...changes([], "done"), changes: [
    { key: "b", seq: 11, revision: 2, deleted: false }, { key: "a", seq: 12, revision: 3, deleted: false },
  ] });
  const result = await catalog.read();
  expect(result.active).toEqual([]); expect(result.retired.map(row => row.cutexSessionId)).toEqual(["a", "r"]);
  expect(source.session).toHaveBeenCalledTimes(1); expect(source.changes).toHaveBeenLastCalledWith("more");
  expect(result.hostRows).toEqual({});
});

it("does not apply an older replayed tombstone over a newer committed row", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  source.changes.mockResolvedValueOnce({ ...changes(), changes: [{ key: "a", seq: 20, revision: 3, deleted: false }] });
  await catalog.read(); source.session.mockClear();
  source.changes.mockResolvedValueOnce({ ...changes(), changes: [{ key: "a", seq: 19, revision: 2, deleted: true }] });
  expect((await catalog.read()).active.map(row => row.cutexSessionId)).toEqual(["a", "b"]);
  expect(source.session).not.toHaveBeenCalled();
});

it("coalesces fifty gap reads into one bounded resync, then resumes from the replacement cursor", async () => {
  const { source, catalog } = fixture(); await catalog.read(); source.page.mockClear();
  source.changes.mockResolvedValueOnce({ resyncRequired: true, reason: "BelowRetention" });
  source.page.mockImplementation(async lifecycle => page(lifecycle === "active" ? ["new"] : [], "replacement"));
  const results = await Promise.all(Array.from({ length: 50 }, () => catalog.read()));
  expect(source.page).toHaveBeenCalledTimes(2); expect(new Set(results).size).toBe(1);
  expect(results[0]!.active.map(row => row.cutexSessionId)).toEqual(["new"]);
  expect(source.changes).toHaveBeenLastCalledWith("replacement");
  await catalog.read(); expect(source.page).toHaveBeenCalledTimes(2);
});

it("bounds repeated epoch churn instead of retrying snapshots forever", async () => {
  const { source, catalog } = fixture();
  source.changes.mockResolvedValue({ resyncRequired: true, reason: "EpochChanged" });
  await expect(catalog.read()).rejects.toThrow("EpochChanged");
  expect(source.page).toHaveBeenCalledTimes(4);
});

it("serializes a dirty ID, keeps at most one follow-up and shares in-flight reads", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  const block = deferred<SessionResource>(); source.session.mockClear();
  source.session.mockImplementationOnce(() => block.promise).mockImplementation(async id => resource(id));
  catalog.invalidate("a"); const first = catalog.read(); const second = catalog.read();
  await vi.waitFor(() => expect(source.session).toHaveBeenCalledTimes(1));
  for (let n = 0; n < 100; n++) catalog.invalidate("a");
  expect(first).toBe(second); expect(source.session).toHaveBeenCalledTimes(1);
  block.resolve(resource("a")); await first;
  expect(source.session).toHaveBeenCalledTimes(2);
});

it("bounds catalog resource hydration to six concurrent reads", async () => {
  const { source, catalog } = fixture(); const gate = deferred<void>(); let active = 0, peak = 0;
  source.page.mockImplementation(async lifecycle => page(lifecycle === "active" ? Array.from({ length: 100 }, (_, n) => `id-${n}`) : []));
  source.session.mockImplementation(async id => {
    active++; peak = Math.max(peak, active); await gate.promise; active--; return resource(id);
  });
  const pending = catalog.read();
  await vi.waitFor(() => expect(source.session).toHaveBeenCalledTimes(6));
  gate.resolve(); expect((await pending).active).toHaveLength(100); expect(peak).toBe(6);
});

it("rehydrates runtime status after reconnect without re-enumerating keys or rereading retired rows", async () => {
  const { source, catalog } = fixture(); await catalog.read(); source.session.mockClear(); source.page.mockClear();
  catalog.invalidateActive(); await catalog.read();
  expect(source.session.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
  expect(source.page).not.toHaveBeenCalled();
});

it("does not publish an old authority's resource or host row after disposal", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  const block = deferred<SessionResource>(); source.session.mockReturnValueOnce(block.promise);
  catalog.invalidate("a"); const pending = catalog.read(); const rejected = expect(pending).rejects.toThrow("scope changed");
  await vi.waitFor(() => expect(source.session).toHaveBeenCalledTimes(3));
  catalog.dispose(); source.hostRow.mockClear(); block.resolve(resource("a")); await rejected;
  expect(source.hostRow).not.toHaveBeenCalled(); expect(() => catalog.read()).toThrow("scope changed");
});

it("keeps failed resource reads dirty and retries the unacknowledged transport cursor", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  source.changes.mockResolvedValue(changes(["a"], "updated"));
  // Every row of the read failed (twice each): the host is unreachable, the cursor is not acknowledged.
  source.session.mockRejectedValueOnce(new Error("host_busy")).mockRejectedValueOnce(new Error("host_busy"));
  await expect(catalog.read()).rejects.toThrow("host_busy");
  await catalog.read();
  expect(source.changes.mock.calls.slice(-2)).toEqual([["next"], ["next"]]);
});

it("keeps every other row when one row's read keeps failing, and reads only that one again next time", async () => {
  const { source, catalog } = fixture();
  source.page.mockImplementation(async lifecycle => page(lifecycle === "active" ? ["a", "b", "c"] : []));
  source.session.mockImplementation(async (id, lifecycle) => { if (id === "b") throw new Error("heavy_read_capacity_exceeded"); return resource(id, lifecycle); });
  const first = await catalog.read();
  expect(first.active.map(row => row.cutexSessionId)).toEqual(["a", "c"]); expect(first.missing).toBe(1);
  expect(source.session.mock.calls.filter(([id]) => id === "b")).toHaveLength(2);
  source.session.mockClear(); source.session.mockImplementation(async (id, lifecycle) => resource(id, lifecycle));
  const second = await catalog.read();
  expect(source.session.mock.calls.map(([id]) => id)).toEqual(["b"]);
  expect(second.active.map(row => row.cutexSessionId)).toEqual(["a", "b", "c"]); expect(second.missing).toBeUndefined();
});

it("after a status gap reads again only the active rows read before it", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  const gap = Date.now(); await new Promise(resolve => setTimeout(resolve, 5));
  source.session.mockClear(); catalog.invalidate("a"); await catalog.read();
  source.session.mockClear(); catalog.invalidateActive(gap); await catalog.read();
  expect(source.session.mock.calls.map(([id]) => id)).toEqual(["b"]);
});

it("reads the archived rows only once wanted, as one list, never one read each", async () => {
  const { source, catalog } = fixture();
  const first = await catalog.read();
  expect(first.retired).toEqual([]); expect(first.archivedPending).toBe(1);
  expect(source.session.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]); expect(source.retired).not.toHaveBeenCalled();
  expect(catalog.wantArchived()).toBe(true); source.session.mockClear();
  const second = await catalog.read();
  expect(second.retired.map(row => row.cutexSessionId)).toEqual(["r"]); expect(second.archivedPending).toBeUndefined();
  expect(source.retired).toHaveBeenCalledTimes(1); expect(source.session).not.toHaveBeenCalled();
  expect(catalog.wantArchived()).toBe(false);
  // A full refresh reads the archived rows again as one list.
  source.session.mockClear(); catalog.invalidate(); await catalog.read();
  expect(source.retired).toHaveBeenCalledTimes(2); expect(source.session.mock.calls.map(([id]) => id).sort()).toEqual(["a", "b"]);
});

it("before the archived rows are read, a changed archived agent keeps only its ID, and shows once restored", async () => {
  const { source, catalog } = fixture(); await catalog.read();
  source.changes.mockResolvedValueOnce(changes(["r"], "n1"));
  let result = await catalog.read();
  expect(source.session).toHaveBeenLastCalledWith("r", "retired");
  expect(result.retired).toEqual([]); expect(result.archivedPending).toBe(1);
  source.changes.mockResolvedValueOnce({ ...changes([], "n2"), changes: [{ key: "r", seq: 2, revision: 2, deleted: false }] });
  source.session.mockImplementation(async id => resource(id));
  result = await catalog.read();
  expect(result.active.map(row => row.cutexSessionId)).toEqual(["a", "b", "r"]); expect(result.archivedPending).toBe(0);
});

it("a failed archived list keeps the active rows and is tried again on the next read", async () => {
  const { source, catalog } = fixture(); catalog.wantArchived();
  source.retired.mockRejectedValueOnce(new Error("heavy_read_capacity_exceeded"));
  const first = await catalog.read();
  expect(first.active).toHaveLength(2); expect(first.archivedPending).toBe(1);
  const second = await catalog.read();
  expect(second.retired.map(row => row.cutexSessionId)).toEqual(["r"]); expect(source.retired).toHaveBeenCalledTimes(2);
});

it("reports a first read's progress and lets the rows read so far be peeked at", async () => {
  const { source } = fixture(); const progress: [number, number][] = [];
  const catalog = new SessionDeltaCatalog(source, (loaded, total) => progress.push([loaded, total]));
  const gate = deferred<SessionResource>();
  source.session.mockImplementation(async id => id === "b" ? gate.promise : resource(id));
  expect(catalog.peek()).toBeUndefined();
  const pending = catalog.read();
  await vi.waitFor(() => expect(progress).toEqual([[0, 2], [1, 2]]));
  const peek = catalog.peek()!;
  expect(peek.active.map(row => row.cutexSessionId)).toEqual(["a"]); expect(peek.loading).toEqual({ loaded: 1, total: 2 });
  expect(peek.archivedPending).toBe(1);
  gate.resolve(resource("b")); await pending;
  expect(progress.at(-1)).toEqual([2, 2]); expect(catalog.peek()).toBeUndefined();
  // Later reads are not first reads: no progress.
  progress.length = 0; catalog.invalidate("a"); await catalog.read(); expect(progress).toEqual([]);
});

it("uses per-ID visibility authority, retaining persistent hidden agents and excluding missing/local-only rows", async () => {
  const { source, catalog } = fixture();
  source.page.mockImplementation(async lifecycle => page(lifecycle === "active" ? ["persistent", "local", "foreign"] : []));
  source.session.mockImplementation(async id => id === "foreign" ? null : { ...resource(id), visible: false, registrationClass: id === "local" ? "local" : "persistent" });
  expect((await catalog.read()).active.map(row => row.cutexSessionId)).toEqual(["persistent"]);
  await catalog.read(); expect(source.page).toHaveBeenCalledTimes(2);
});

it("advances receipt-only cursors without resources or a new sidebar projection", async () => {
  const { source, catalog } = fixture(); const initial = await catalog.read(); source.session.mockClear();
  source.changes.mockResolvedValue(changes([], "receipt-head"));
  expect(await catalog.read()).toBe(initial); expect(source.session).not.toHaveBeenCalled();
  await catalog.read(); expect(source.changes).toHaveBeenLastCalledWith("receipt-head");
});

it("updates the authoritative selected Claude runtime even without a canonical session change", async () => {
  const { source, catalog } = fixture(); await catalog.read(); source.session.mockClear();
  source.changes.mockResolvedValue({ ...changes(), claudeRuntime: { selectedRelease: null } });
  expect((await catalog.read()).claudeRuntime).toEqual({ selectedRelease: null });
  expect(source.session).not.toHaveBeenCalled(); expect(source.page).toHaveBeenCalledTimes(2);
});

it("rechecks an absent store until it acquires a durable head, then retains that cursor", async () => {
  const { source, catalog } = fixture();
  source.page.mockResolvedValueOnce({ ...page([]), changeCursor: null }).mockResolvedValueOnce({ ...page([]), changeCursor: null });
  expect((await catalog.read()).active).toEqual([]); expect(source.changes).not.toHaveBeenCalled();
  expect((await catalog.read()).active.map(row => row.cutexSessionId)).toEqual(["a", "b"]);
  expect(source.changes).toHaveBeenCalledWith("first");
  source.page.mockClear(); await catalog.read(); expect(source.page).not.toHaveBeenCalled();
});

/** Real client encoding + serialized JSON response byte accounting; no live daemon/ports. */
async function measure(size: number) {
  const ids = Array.from({ length: size }, (_, n) => `cutex.${String(n).padStart(6, "0")}`);
  let mode: "bootstrap" | "changed" | "idle" = "bootstrap";
  let gap = false;
  let count = 0, bytes = 0, fullLists = 0;
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "fixture" }, { fetch: async (input, init) => {
    const url = new URL(String(input)); let body: unknown;
    if (url.pathname === "/v2/sessions/page") {
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      body = url.searchParams.get("lifecycle") === "retired" ? page([]) : page(ids.slice(offset, offset + 200), "head", offset + 200 < size ? String(offset + 200) : null);
    } else if (url.pathname === "/v2/sessions/changes") {
      body = gap ? { resyncRequired: true, reason: "BelowRetention", hostId: "h", claudeRuntime: { selectedRelease: "claude-r20" } } : changes(mode === "changed" ? [ids[0]!] : [], "head");
      gap = false;
    }
    else if (url.pathname.startsWith("/v2/host/sessions/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!); body = { schema: "cutex/host-sessions/v1", data: [hostRow(id)], nextCursor: null };
    } else if (url.pathname.startsWith("/v2/sessions/")) body = resource(decodeURIComponent(url.pathname.split("/").at(-1)!));
    else { fullLists++; throw new Error(`unexpected full read: ${url}`); }
    const json = JSON.stringify(body); count++; bytes += new TextEncoder().encode(json).byteLength;
    return new Response(json, { headers: { "content-type": "application/json" } });
  } });
  const catalog = new SessionDeltaCatalog({
    page: (lifecycle, cursor) => client.sessionPage({ lifecycle, cursor, limit: 200, maxBytes: 262144 }),
    changes: cursor => client.sessionChanges(cursor, { limit: 1000, maxBytes: 65536 }),
    session: (id, lifecycle) => client.session(id, lifecycle),
    hostRow: id => client.hostSession(id),
    retired: async () => (await client.sessions("retired")).sessions,
  });
  await catalog.read(); const bootstrap = { requests: count, bytes }; count = bytes = 0;
  mode = "changed"; await catalog.read(); const update = { requests: count, bytes }; count = bytes = 0;
  mode = "idle"; for (let n = 0; n < 100; n++) await catalog.read();
  const idle = { requests: count, bytes, fullLists }; count = bytes = 0;
  gap = true; await Promise.all(Array.from({ length: 50 }, () => catalog.read()));
  const resync = { requests: count, bytes }; catalog.dispose(); client.dispose();
  return { size, bootstrap, update, idle, resync };
}

it("keeps 1x/10x warm update and 100 unrelated wake request/byte budgets constant", async () => {
  const one = await measure(100), ten = await measure(1000);
  expect(ten.update).toEqual(one.update); expect(one.update.requests).toBe(3);
  expect(ten.idle).toEqual(one.idle); expect(one.idle.requests).toBe(100); expect(one.idle.fullLists).toBe(0);
  expect(ten.bootstrap.requests).toBeGreaterThan(one.bootstrap.requests);
  expect(one.resync.requests).toBe(one.bootstrap.requests + 1);
  expect(ten.resync.requests).toBe(ten.bootstrap.requests + 1);
  console.info("058 C2 request/JSON-byte budgets", JSON.stringify([one, ten]));
});

it("batch projections preserve null authority, page progress, and archived-on-demand", async () => {
  const { source } = fixture(); const gate = deferred<SessionCatalogPage>();
  const projected = (id: string, eligible = true) => ({ cutexSessionId: id, revision: 1, resource: eligible ? resource(id) : null, hostRow: eligible ? hostRow(id) : null });
  source.page.mockImplementation(async (lifecycle, cursor) => lifecycle === "retired" ? page(["r"]) : cursor ? gate.promise : { ...page([], "first", "p2"), sessions: [projected("a"), projected("ineligible", false)] });
  const progress = vi.fn(); const catalog = new SessionDeltaCatalog(source, progress);
  const pending = catalog.read();
  await vi.waitFor(() => expect(catalog.peek()?.active.map(row => row.cutexSessionId)).toEqual(["a"]));
  gate.resolve({ ...page([]), sessions: [{ ...projected("b"), hostRow: null }] });
  const result = await pending;
  expect(result.active.map(row => row.cutexSessionId)).toEqual(["a", "b"]);
  expect(Object.keys(result.hostRows)).toEqual(["a"]); expect(result.archivedPending).toBe(1);
  expect(source.session).not.toHaveBeenCalled(); expect(source.hostRow).not.toHaveBeenCalled(); expect(source.retired).not.toHaveBeenCalled();
  expect(source.changes).toHaveBeenCalledWith("first"); expect(progress).toHaveBeenCalledWith(3, 3);
  catalog.wantArchived(); expect((await catalog.read()).retired).toHaveLength(1);
});

it("reads after an own write during a batch page request and keeps its dirty hint", async () => {
  const { source } = fixture(); const gate = deferred<SessionCatalogPage>();
  source.page.mockImplementation(async lifecycle => lifecycle === "active" ? gate.promise : page([]));
  const catalog = new SessionDeltaCatalog(source); const before = catalog.read();
  catalog.invalidate("a"); catalog.noteWrite(); const after = catalog.read(); expect(after).not.toBe(before);
  gate.resolve({ ...page([]), sessions: [{ cutexSessionId: "a", revision: 1, resource: resource("a"), hostRow: hostRow("a") }] });
  source.session.mockResolvedValue({ ...resource("a"), displayName: "after write" });
  await before; expect((await after).active[0]?.displayName).toBe("after write");
  expect(source.session).toHaveBeenCalledWith("a", "active"); expect(source.changes).toHaveBeenCalledTimes(2);
});
