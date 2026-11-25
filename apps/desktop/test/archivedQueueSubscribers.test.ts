// @vitest-environment jsdom
// Review 2026-11-24 (roster-bottom-review, 3b35d8136): a live queued page is never starved by another page leaving.
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { loadArchivedStats, resetArchivedStats, useArchivedStats } from "../src/renderer/src/modules/archive/archivedStats";

beforeEach(() => { resetArchivedStats(); localStorage.clear(); });
const session = (id: string) => ({ cutexSessionId: id, revision: 3 } as SessionResource);
const page = (ids: string[]) => ({ nextCursor: null, items: ids.map(id => ({ cutexSessionId: id, bytes: 10, files: 1 })) });

it.each([false, true])("a live queued page is not starved when the newest queued page leaves=%s", async (leave) => {
  let release!: (value: ReturnType<typeof page>) => void;
  const storageItems = vi.fn().mockImplementationOnce(() => new Promise(r => { release = r; })).mockResolvedValue(page(["a", "b"]));
  const api = { storageItems, usage: vi.fn() } as unknown as Parameters<typeof loadArchivedStats>[1];
  const survivor = new AbortController(), newest = new AbortController();
  const first = loadArchivedStats("local", api, [session("a")], { size: true, usage: false });
  const olderQueued = loadArchivedStats("local", api, [session("a"), session("b")], { size: true, usage: false }, { signal: survivor.signal });
  const newestQueued = loadArchivedStats("local", api, [session("a"), session("b")], { size: true, usage: false }, { signal: newest.signal });
  if (leave) newest.abort();
  release(page(["a"]));
  await Promise.all([first, olderQueued, newestQueued]);
  expect(survivor.signal.aborted).toBe(false);
  expect(Object.keys(useArchivedStats.getState().figures.local ?? {}).sort()).toEqual(["a@3", "b@3"]);
  expect(storageItems).toHaveBeenCalledTimes(2);
});
