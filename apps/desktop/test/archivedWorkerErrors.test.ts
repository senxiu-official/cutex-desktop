// @vitest-environment jsdom
// Review 2026-11-25 (roster-bottom-review, 3b2ddd136): one parallel read failing stops the other; closing the page stops it.
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { loadArchivedStats, resetArchivedStats, useArchivedStats } from "../src/renderer/src/modules/archive/archivedStats";
beforeEach(() => { resetArchivedStats(); localStorage.clear(); });

it.each([false, true])("all subscribers leaving stops pagination after the other endpoint fails=%s", async failed => {
  let release!: (value: unknown) => void;
  const storageItems = vi.fn().mockImplementationOnce(() => new Promise(r => { release = r; }))
    .mockResolvedValue({ items: [], nextCursor: "more" });
  const usage = failed ? vi.fn().mockRejectedValue(new Error("usage unavailable")) : vi.fn().mockResolvedValue({ rows: [] });
  const api = { storageItems, usage } as unknown as Parameters<typeof loadArchivedStats>[1];
  const page = new AbortController();
  const session = { cutexSessionId: "a", revision: 3, createdAt: new Date(Date.now() - 86_400_000).toISOString() } as unknown as SessionResource;
  const pending = loadArchivedStats("local", api, [session], { size: true, usage: true }, { signal: page.signal });
  if (failed) {
    await pending;
    expect(useArchivedStats.getState().errors.local).toBe("usage unavailable");
  }
  page.abort();
  await pending;
  expect(storageItems).toHaveBeenCalledTimes(1);
  release({ items: [], nextCursor: "more" });
  await new Promise(r => setTimeout(r, 0));
  expect(storageItems).toHaveBeenCalledTimes(1);
});
