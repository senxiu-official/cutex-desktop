import { expect, it } from "vitest";
import { CutexClient, RUNTIME_PRUNE_FEATURE } from "../src/index";

it("sends opaque IDs to the fixed route and enforces the batch bound", async () => {
  const calls: unknown[] = [];
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "owner" }, { fetch: async (input, init) => {
    calls.push([new URL(String(input)).pathname, init?.method, init?.body ? JSON.parse(String(init.body)) : null]);
    return Response.json(init?.method === "POST" ? { freedBytes: 12, results: [] } : { versions: [] });
  } });
  expect(RUNTIME_PRUNE_FEATURE).toBe("runtime-prune-v1");
  expect(await client.runtimePrunePlan()).toEqual({ versions: [] });
  expect((await client.pruneRuntimes(["opaque+/?雪"])).freedBytes).toBe(12);
  expect(calls).toEqual([["/v2/runtimes/prune", "GET", null], ["/v2/runtimes/prune", "POST", { ids: ["opaque+/?雪"] }]]);
  expect(() => client.pruneRuntimes(Array(101).fill("id"))).toThrow("1–100");
  expect(() => client.pruneRuntimes([])).toThrow("1–100");
  expect(calls).toHaveLength(2);
  client.dispose();
});

it("never retries an uncertain deletion", async () => {
  let calls = 0;
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "owner" }, { fetch: async () => {
    calls++; return Response.json({ error: { code: "unavailable", message: "failed" } }, { status: 503 });
  } });
  await expect(client.pruneRuntimes(["id"])).rejects.toThrow();
  expect(calls).toBe(1);
  client.dispose();
});
