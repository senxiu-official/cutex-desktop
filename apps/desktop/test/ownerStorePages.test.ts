import { describe, expect, it } from "vitest";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { collectOwnerPages, ownerPageQuery } from "../src/main/ownerStorePages";

describe("owner-store bounded array collectors", () => {
  it("follows opaque cursors across short and empty pages until missing/null continuation", async () => {
    const seen: (string | undefined)[] = [];
    const rows = await collectOwnerPages(async cursor => {
      seen.push(cursor);
      if (!cursor) return { items: [1], nextCursor: "opaque+/=&" };
      if (cursor === "opaque+/=&") return { items: [], nextCursor: "last" };
      return { items: [2], nextCursor: null };
    });
    expect(rows).toEqual([1, 2]);
    expect(seen).toEqual([undefined, "opaque+/=&", "last"]);
  });
  it("preserves a caller's logical notification row limit across byte-short pages", async () => {
    const limits: number[] = [];
    const rows = await collectOwnerPages(async (cursor, limit) => {
      limits.push(limit);
      return { items: cursor ? [2] : [1], nextCursor: "next" };
    }, 2);
    expect(rows).toEqual([1, 2]);
    expect(limits).toEqual([2, 1]);
  });
  it("restarts a resynced view once and discards rows from the invalidated epoch", async () => {
    let first = 0;
    const rows = await collectOwnerPages(async cursor => {
      if (!cursor) return { items: [++first], nextCursor: first === 1 ? "old" : undefined };
      throw new CutexApiError(409, "resync_required", "new epoch");
    });
    expect(rows).toEqual([2]);
  });
  it("does not spin, mix partial results, or fall back to a full-list request", async () => {
    await expect(collectOwnerPages(async () => ({ items: [], nextCursor: "same" }))).rejects.toThrow("did not advance");
    let calls = 0;
    await expect(collectOwnerPages(async () => { calls++; throw new CutexApiError(409, "resync_required", "changed"); })).rejects.toThrow();
    expect(calls).toBe(2);
    await expect(collectOwnerPages(async () => { throw new CutexApiError(403, "forbidden", "denied"); })).rejects.toThrow();
    expect(await collectOwnerPages(async () => null)).toBeNull();
  });
  it("bounds every first-page query while leaving cursor contents opaque", () => {
    expect(ownerPageQuery()).toEqual({ limit: 100 });
    expect(ownerPageQuery({ limit: 9999, cursor: "opaque+/=" })).toEqual({ limit: 500, cursor: "opaque+/=" });
    expect(() => ownerPageQuery({ cursor: "" })).toThrow();
  });
});
