// Perf audit 2026-11-24 #1: a whole-catalog reread (project / Agent Management events, status gaps) walks the
// catalog pages that carry each row's resource and host row, instead of two reads per row.
import { expect, it, vi } from "vitest";
import type { SessionCatalogPage, SessionChangePage } from "@cutex-desktop/cutex-client";
import type { HostSessionRow, SessionResource } from "@cutex-desktop/protocol";
import { SessionDeltaCatalog, type SessionCatalogSource } from "../src/main/sessionDeltaCatalog";

const resource = (id: string, lifecycle = "active", displayName = id): SessionResource => ({
  cutexSessionId: id, lifecycle, displayName, visible: true, registrationClass: "persistent", revision: 1,
} as SessionResource);
const hostRow = (id: string, projectId = "p") => ({ id, name: id, projectId } as HostSessionRow);
const noChanges = (nextCursor = "next"): SessionChangePage => ({
  resyncRequired: false, changes: [], nextCursor, watermark: 0, more: false, oversizeFirst: false, claudeRuntime: { selectedRelease: "claude-r20" }, hostId: "h",
});

/** A host of `n` active rows (and `archived` archived IDs) behind 50-row pages with resources, like the daemon's batch source. */
function host(n: number, archived = 1, pagedResources = true) {
  const world = {
    active: new Map(Array.from({ length: n }, (_, i) => { const id = `s${String(i).padStart(4, "0")}`; return [id, { row: resource(id), host: hostRow(id) }]; })),
    retired: new Set(Array.from({ length: archived }, (_, i) => `r${i}`)),
    head: "head-1",
    changes: [] as SessionChangePage["changes"],
  };
  const pageOf = (lifecycle: "active" | "retired", cursor?: string): SessionCatalogPage => {
    const ids = lifecycle === "active" ? [...world.active.keys()] : [...world.retired];
    const at = cursor ? Number(cursor.split(":")[1]) : 0, size = 50;
    const slice = ids.slice(at, at + size);
    return {
      sessions: slice.map(id => lifecycle === "active" && pagedResources
        ? { cutexSessionId: id, revision: 1, resource: world.active.get(id)!.row, hostRow: world.active.get(id)!.host }
        : { cutexSessionId: id, revision: 1 }),
      changeCursor: world.head, nextCursor: at + size < ids.length ? `${lifecycle}:${at + size}` : null, oversizeFirst: false,
      claudeRuntime: { selectedRelease: "claude-r20" }, hostId: "h",
    };
  };
  const source = {
    page: vi.fn<SessionCatalogSource["page"]>(async (lifecycle, cursor) => pageOf(lifecycle, cursor)),
    changes: vi.fn<SessionCatalogSource["changes"]>(async () => { const page = { ...noChanges(world.head), changes: world.changes }; world.changes = []; return page; }),
    session: vi.fn<SessionCatalogSource["session"]>(async id => world.active.get(id)?.row ?? (world.retired.has(id) ? resource(id, "retired") : null)),
    hostRow: vi.fn<SessionCatalogSource["hostRow"]>(async id => world.active.get(id)?.host ?? null),
    retired: vi.fn<SessionCatalogSource["retired"]>(async () => [...world.retired].map(id => resource(id, "retired"))),
    pagedResources,
  };
  const reads = () => ({ pages: source.page.mock.calls.length, changes: source.changes.mock.calls.length, resources: source.session.mock.calls.length + source.hostRow.mock.calls.length });
  const clear = () => { source.page.mockClear(); source.changes.mockClear(); source.session.mockClear(); source.hostRow.mockClear(); source.retired.mockClear(); };
  return { world, source, catalog: new SessionDeltaCatalog(source), reads, clear };
}

async function measure(n: number, pagedResources: boolean) {
  const h = host(n, 1, pagedResources);
  await h.catalog.read(); const initial = h.reads(); h.clear();
  h.catalog.invalidate(); await h.catalog.read(); const whole = h.reads(); h.clear();
  h.catalog.invalidate("s0001"); await h.catalog.read(); const single = h.reads(); h.clear();
  h.catalog.invalidateActive(); await h.catalog.read(); const gap = h.reads();
  return { n, pagedResources, initial, whole, single, gap };
}

it("request counts: whole-catalog rereads walk the pages (28 / 280 rows)", async () => {
  const rows = [await measure(28, true), await measure(280, true), await measure(28, false), await measure(280, false)];
  console.info("perf-1124 #1 catalog reads", JSON.stringify(rows));
  const [small, big, smallPlain, bigPlain] = rows;
  // Batch pages: a whole-catalog reread costs what the first read costs (active pages + one archived page) and one drain.
  expect(big!.initial).toEqual({ pages: 7, changes: 1, resources: 0 });
  expect(big!.whole).toEqual({ pages: 7, changes: 1, resources: 0 });
  expect(small!.whole).toEqual({ pages: 2, changes: 1, resources: 0 });
  expect(big!.gap).toEqual({ pages: 7, changes: 1, resources: 0 });
  // One row: still its own two reads.
  expect(big!.single).toEqual({ pages: 0, changes: 1, resources: 2 });
  // Without resources in the pages (older hosts): unchanged, two reads per row.
  expect(bigPlain!.whole.resources).toBe(560); expect(smallPlain!.whole.resources).toBe(56);
  expect(bigPlain!.whole.pages).toBe(0);
});

it("a reread shows changed rows, new and deleted ones, archive moves and project moves", async () => {
  const h = host(120, 1); h.catalog.wantArchived();
  const first = await h.catalog.read(); const membership = h.catalog.membershipVersion;
  expect(first.active).toHaveLength(120); expect(first.retired.map(r => r.cutexSessionId)).toEqual(["r0"]);
  // A rename, a project move, a deletion, an archived agent and a new agent, none of them in the change feed.
  h.world.active.get("s0000")!.row = resource("s0000", "active", "renamed");
  h.world.active.get("s0001")!.host = hostRow("s0001", "q");
  h.world.active.delete("s0002");
  h.world.active.delete("s0003"); h.world.retired.add("s0003");
  h.world.active.set("s9999", { row: resource("s9999"), host: hostRow("s9999") });
  h.clear(); h.catalog.invalidate();
  const next = await h.catalog.read();
  const ids = next.active.map(r => r.cutexSessionId);
  expect(ids).toHaveLength(119); expect(ids).not.toContain("s0002"); expect(ids).not.toContain("s0003"); expect(ids).toContain("s9999");
  expect(next.active.find(r => r.cutexSessionId === "s0000")!.displayName).toBe("renamed");
  expect(next.hostRows.s0001!.projectId).toBe("q"); expect(next.hostRows.s0002).toBeUndefined(); expect(next.hostRows.s0003).toBeUndefined();
  // The archived list is read again (one list), so the newly archived agent shows there.
  expect(next.retired.map(r => r.cutexSessionId)).toEqual(["r0", "s0003"]); expect(h.source.retired).toHaveBeenCalledTimes(1);
  expect(h.catalog.membershipVersion).toBeGreaterThan(membership);
  expect(h.reads().resources).toBe(0);
});

it("an unchanged reread keeps membership; a reread before the archive is wanted keeps only archived IDs", async () => {
  const h = host(60, 2);
  const first = await h.catalog.read(); const membership = h.catalog.membershipVersion;
  expect(first.archivedPending).toBe(2);
  h.world.active.delete("s0005"); h.world.retired.add("s0005");
  h.catalog.invalidate(); await h.catalog.read();
  expect(h.catalog.membershipVersion).toBe(membership + 1);
  const again = await (h.catalog.invalidate(), h.catalog.read());
  expect(h.catalog.membershipVersion).toBe(membership + 1);
  expect(again.archivedPending).toBe(3); expect(again.retired).toEqual([]); expect(h.source.retired).not.toHaveBeenCalled();
});

it("writes made while paging are drained from the pages' head", async () => {
  const h = host(80, 0); await h.catalog.read(); h.clear();
  // The pages report head-2; the write after it arrives through the change feed from there.
  h.world.head = "head-2";
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => {
    const page = await (h.source.page.getMockImplementation()!)(lifecycle, cursor);
    h.world.active.get("s0070")!.row = resource("s0070", "active", "after the page");
    h.world.changes = [{ key: "s0070", seq: 99, revision: 2, deleted: false }];
    return page;
  });
  h.catalog.invalidate();
  const next = await h.catalog.read();
  expect(h.source.changes).toHaveBeenCalledWith("head-2");
  expect(next.active.find(r => r.cutexSessionId === "s0070")!.displayName).toBe("after the page");
  expect(h.source.session.mock.calls.map(([id]) => id)).toEqual(["s0070"]);
});

it("hints from before the pages are covered by them; hints during the pages are read after", async () => {
  const h = host(80, 0); await h.catalog.read(); h.clear();
  h.catalog.invalidate("s0001"); h.catalog.invalidate();
  let open!: () => void; const gate = { promise: new Promise<void>(resolve => { open = resolve; }), resolve: () => open() };
  const original = h.source.page.getMockImplementation()!;
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => { await gate.promise; return original(lifecycle, cursor); });
  const pending = h.catalog.read();
  await vi.waitFor(() => expect(h.source.page).toHaveBeenCalledTimes(1));
  h.catalog.invalidate("s0002"); gate.resolve();
  await pending;
  expect(h.source.session.mock.calls.map(([id]) => id)).toEqual(["s0002"]);
});

it("a whole-catalog hint during a paged reread waits for the next read; nothing is read row by row", async () => {
  const h = host(80, 0); await h.catalog.read(); h.clear();
  let open!: () => void; const gate = { promise: new Promise<void>(resolve => { open = resolve; }), resolve: () => open() };
  const original = h.source.page.getMockImplementation()!;
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => { await gate.promise; return original(lifecycle, cursor); });
  h.catalog.invalidate(); const pending = h.catalog.read();
  await vi.waitFor(() => expect(h.source.page).toHaveBeenCalledTimes(1));
  h.catalog.invalidate(); gate.resolve(); await pending;
  expect(h.reads()).toEqual({ pages: 3, changes: 1, resources: 0 });
  h.clear(); await h.catalog.read();
  expect(h.reads()).toEqual({ pages: 3, changes: 1, resources: 0 });
  h.clear(); await h.catalog.read();
  expect(h.reads()).toEqual({ pages: 0, changes: 1, resources: 0 });
});

it("a status gap with few stale rows still reads them one by one; many stale rows reread by pages", async () => {
  const h = host(80, 0); await h.catalog.read();
  const gap = Date.now(); await new Promise(resolve => setTimeout(resolve, 5));
  // 75 rows read again after the gap, 5 left stale: per row.
  for (let i = 5; i < 80; i++) h.catalog.invalidate(`s${String(i).padStart(4, "0")}`);
  await h.catalog.read(); h.clear();
  h.catalog.invalidateActive(gap); await h.catalog.read();
  expect(h.reads()).toEqual({ pages: 0, changes: 1, resources: 10 });
  h.clear(); h.catalog.invalidateActive(); await h.catalog.read();
  expect(h.reads()).toEqual({ pages: 3, changes: 1, resources: 0 });
});

it("a failed page keeps the whole-catalog hint for the next read and the old rows meanwhile", async () => {
  const h = host(80, 0); await h.catalog.read(); h.clear();
  h.world.active.get("s0000")!.row = resource("s0000", "active", "renamed");
  h.source.page.mockRejectedValueOnce(new Error("host_busy"));
  h.catalog.invalidate();
  await expect(h.catalog.read()).rejects.toThrow("host_busy");
  const next = await h.catalog.read();
  expect(next.active.find(r => r.cutexSessionId === "s0000")!.displayName).toBe("renamed");
  expect(h.reads().resources).toBe(0);
});

it("a resync while rereading starts over from a fresh first read", async () => {
  const h = host(80, 0); await h.catalog.read(); h.clear();
  h.source.page.mockResolvedValueOnce({ resyncRequired: true, reason: "BelowRetention" });
  h.catalog.invalidate();
  const next = await h.catalog.read();
  expect(next.active).toHaveLength(80); expect(h.reads().resources).toBe(0);
});

it("rows a page does not carry a resource for are read on their own", async () => {
  const h = host(10, 0); await h.catalog.read(); h.clear();
  const original = h.source.page.getMockImplementation()!;
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => {
    const page = await original(lifecycle, cursor) as SessionCatalogPage;
    return { ...page, sessions: page.sessions.map((s, i) => i === 3 ? { cutexSessionId: s.cutexSessionId, revision: 1 } : s) };
  });
  h.catalog.invalidate(); await h.catalog.read();
  expect(h.source.session.mock.calls.map(([id]) => id)).toEqual(["s0003"]);
});
