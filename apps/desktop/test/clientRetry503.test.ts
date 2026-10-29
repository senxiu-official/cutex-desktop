import { expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { createBrowserOwnerApi } from "../src/main/browser/ownerApi";

it("uses this worktree's package sources", () => {
  expect(realpathSync(resolve("node_modules/@cutex-desktop/cutex-client"))).toBe(realpathSync(resolve("../../packages/cutex-client")));
});

it("silently retries a direct main-process raw GET through the shared client", async () => {
  const delay = vi.fn(async (_ms: number) => {});
  const fetch = vi.fn(async () => fetch.mock.calls.length === 1
    ? new Response(JSON.stringify({ contractVersion: 2, error: { code: "heavy_read_capacity_exceeded", message: "busy", retryable: true, details: { retryAfterMs: 250 } } }), { status: 503, headers: { "Content-Type": "application/json" } })
    : new Response('{"items":[]}', { headers: { "Content-Type": "application/json" } }));
  const client = new CutexClient({ baseUrl: "http://daemon.test", token: null }, { fetch, sleep: delay, retryRandom: () => 0 });
  const check = vi.fn();
  const api = createBrowserOwnerApi({ client, check, decodeImage: () => { throw new Error("no image decode expected"); } });
  expect(await api.agents()).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(delay).toHaveBeenCalledExactlyOnceWith(250);
});
