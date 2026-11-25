// Review of perf audit 2026-11-24 #1 (f1bfdc587): a second hint for an already dirty row during the page walk, and a
// replacement store whose change sequences restart lower than the old one.
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

it("does not erase a second invalidation of an already dirty row while its stale catalog page is in flight", async () => {
  const h = host(12, 0);
  await h.catalog.read(); h.clear();
  h.catalog.invalidate("s0001"); h.catalog.invalidate();
  const original = h.source.page.getMockImplementation()!;
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => {
    const stale = await original(lifecycle, cursor);
    h.world.active.get("s0001")!.row = resource("s0001", "active", "changed while page in flight");
    h.catalog.invalidate("s0001");
    return stale;
  });
  await h.catalog.read();
  // The ordinary poll also has no new durable changes to rescue this runtime/presentation hint.
  const polled = await h.catalog.read();
  expect(polled.active.find(row => row.cutexSessionId === "s0001")!.displayName).toBe("changed while page in flight");
});

it("does not carry the old transport sequence into a replacement epoch's page cursor", async () => {
  const h = host(12, 0);
  h.world.changes = [{ key: "s0000", seq: 100, revision: 1, deleted: false }];
  await h.catalog.read(); h.clear();
  h.world.head = "new-epoch-head";
  const original = h.source.page.getMockImplementation()!;
  h.source.page.mockImplementationOnce(async (lifecycle, cursor) => {
    const snapshot = await original(lifecycle, cursor);
    h.world.active.get("s0001")!.row = resource("s0001", "active", "new epoch update");
    h.world.changes = [{ key: "s0001", seq: 1, revision: 2, deleted: false }];
    return snapshot;
  });
  h.catalog.invalidate();
  const next = await h.catalog.read();
  expect(h.source.changes).toHaveBeenCalledWith("new-epoch-head");
  expect(next.active.find(row => row.cutexSessionId === "s0001")!.displayName).toBe("new epoch update");
});

