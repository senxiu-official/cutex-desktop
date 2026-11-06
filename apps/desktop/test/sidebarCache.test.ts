import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { cachedSidebar, dropCachedSidebar, keepCachedSidebars, saveSidebar, setSidebarCacheFactory } from "../src/renderer/src/lib/sidebarCache";

const row = (id: string) => ({ cutexSessionId: id, displayName: id, lifecycle: "active" }) as unknown as SidebarSnapshot["active"][number];
const list = (ids: string[], extra: Partial<SidebarSnapshot> = {}): SidebarSnapshot => ({ active: ids.map(row), retired: [row("old")], projects: null, hostRows: {}, ...extra });
const owner = (hostId: string) => ({ hostId, user: null });
const flush = async () => { await vi.advanceTimersByTimeAsync(20_000); for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); setSidebarCacheFactory(new IDBFactory()); });
afterEach(() => { setSidebarCacheFactory(null); vi.useRealTimers(); });

it("keeps a host's whole list per host and identity, without archived agents, and shows it as syncing", async () => {
  expect(await cachedSidebar("remote", owner("REMOTE"))).toBeNull();
  saveSidebar("remote", list(["a", "b"], { archivedPending: { count: 4 } }));
  await flush();
  const kept = await cachedSidebar("remote", owner("REMOTE"));
  expect(kept?.active.map((r) => r.cutexSessionId)).toEqual(["a", "b"]);
  expect(kept).toMatchObject({ retired: [], partial: true, cached: true, archivedPending: { count: 4 } });
  // Another desktop host never reads it.
  expect(await cachedSidebar("eva", owner("REMOTE"))).toBeNull();
});

it("never keeps a peek or a kept list, nor a host whose identity is not confirmed", async () => {
  saveSidebar("remote", list(["a"]));
  await cachedSidebar("remote", owner("REMOTE"));
  saveSidebar("remote", list(["a"], { loading: { loaded: 1, total: 9 } }));
  saveSidebar("remote", list(["a"], { cached: true }));
  await flush();
  expect(await cachedSidebar("remote", owner("REMOTE"))).toBeNull();
});

it("drops the list when the connection is someone else (another user or another cutex host)", async () => {
  await cachedSidebar("remote", owner("REMOTE"));
  saveSidebar("remote", list(["a"])); await flush();
  expect(await cachedSidebar("remote", { hostId: "REMOTE", user: { id: "guest", isOwner: false } })).toBeNull();
  // Gone for good, also for the owner again.
  expect(await cachedSidebar("remote", owner("REMOTE"))).toBeNull();
  saveSidebar("remote", list(["a"])); await flush();
  expect(await cachedSidebar("remote", owner("OTHER"))).toBeNull();
  expect(await cachedSidebar("remote", owner("REMOTE"))).toBeNull();
});

it("forgets a host on access change or removal, and writes a busy host at most every 10 s", async () => {
  for (const id of ["remote", "eva"]) await cachedSidebar(id, owner(id.toUpperCase()));
  saveSidebar("remote", list(["a"])); saveSidebar("eva", list(["e"])); await flush();
  await dropCachedSidebar("remote");
  await cachedSidebar("remote", owner("REMOTE"));
  expect(await cachedSidebar("remote", owner("REMOTE"))).toBeNull();
  expect(await cachedSidebar("eva", owner("EVA"))).not.toBeNull();
  await keepCachedSidebars(["remote"]);
  expect(await cachedSidebar("eva", owner("EVA"))).toBeNull();
  saveSidebar("remote", list(["1"]));
  saveSidebar("remote", list(["2"]));
  saveSidebar("remote", list(["3"]));
  await flush();
  expect((await cachedSidebar("remote", owner("REMOTE")))?.active.map((r) => r.cutexSessionId)).toEqual(["3"]);
});
