// cutex r296 short-id lookup on the client: only id-like input reaches the route; the reply's shape is normalised.
import { describe, expect, it } from "vitest";
import { CutexClient } from "../src/client";

function client(reply: unknown, seen: { path: string; query: unknown }[]) {
  const c = Object.create(CutexClient.prototype) as CutexClient;
  (c as unknown as { request: unknown }).request = async (_m: string, path: string, opts: { query?: unknown }) => { seen.push({ path, query: opts.query }); return reply; };
  return c;
}

describe("askShortIdLookup", () => {
  it("sends idPrefix and a capped limit; normalises hasMore / asks", async () => {
    const seen: { path: string; query: unknown }[] = [];
    const r = await client({ hostId: "h", asks: [{ askId: "ask-1" }], hasMore: true }, seen).askShortIdLookup("47c47e", 99);
    expect(seen).toEqual([{ path: "/v2/asks", query: { idPrefix: "47c47e", limit: "20" } }]);
    expect(r).toEqual({ hostId: "h", asks: [{ askId: "ask-1" }], hasMore: true });
    expect(await client({}, []).askShortIdLookup("…f7b1e9")).toEqual({ hostId: null, asks: [], hasMore: false });
  });
  it("accepts hex 6–32 (… / ... suffix) and a full ask id; refuses anything else before a request", async () => {
    const seen: { path: string; query: unknown }[] = [];
    const c = client({ asks: [] }, seen);
    for (const ok of ["47C47E", "...47c47e", "…" + "a".repeat(32), "ask-" + "b".repeat(32)]) await expect(c.askShortIdLookup(ok)).resolves.toBeTruthy();
    for (const bad of ["47c47", "a".repeat(33), "#47c47e", "47c47g", "ask-47c47e", "47c47e&state=open", ""]) await expect(c.askShortIdLookup(bad)).rejects.toThrow("bad ask id prefix");
    expect(seen.length).toBe(4);
  });
});
