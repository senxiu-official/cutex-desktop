import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexApiError, CutexClient } from "../src/index";
import { HTTP_RETRY_BUDGET_MS, HTTP_RETRY_MAX_ATTEMPTS } from "../src/retry";

const overload = (...args: [status?: number, retryable?: unknown, hint?: unknown]) => new Response(JSON.stringify({
  contractVersion: 2, error: { source: "cutex", code: "heavy_read_capacity_exceeded", message: "busy", retryable: args.length > 1 ? args[1] : true, details: { retryAfterMs: args.length > 2 ? args[2] : 250 } },
}), { status: args[0] ?? 503 });
function setup(reply: (attempt: number) => Response | Promise<Response>, random = 0) {
  const calls: RequestInit[] = [], delays: number[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(init!);
    return reply(calls.length);
  });
  const client = new CutexClient({ baseUrl: "http://daemon.test", token: "test-token" }, {
    fetch, retryRandom: () => random, sleep: async ms => { delays.push(ms); },
  });
  return { client, fetch, calls, delays };
}
afterEach(() => vi.useRealTimers());

describe("HTTP overload retries", () => {
  it("quietly retries GETs under the server delay, retaining query, headers and signal", async () => {
    const f = setup(n => n < 3 ? overload() : new Response('{"ok":true}'));
    const signal = new AbortController().signal;
    expect(await f.client.request("GET", "/v2/sessions", { query: { limit: 20 }, signal })).toEqual({ ok: true });
    expect(f.delays).toEqual([250, 250]);
    expect(f.calls).toHaveLength(3);
    expect(f.calls.every(call => call === f.calls[0] && call.signal === signal)).toBe(true);
    expect(f.fetch.mock.calls.every(([url]) => url === "http://daemon.test/v2/sessions?limit=20")).toBe(true);
  });

  it.each([false, undefined, "true"])("does not treat retryable=%s as a 503 permission", async flag => {
    const f = setup(() => overload(503, flag));
    await expect(f.client.host()).rejects.toBeInstanceOf(CutexApiError);
    expect(f.calls).toHaveLength(1);
  });

  it("uses bounded positive jitter and exponential fallback when there is no hint", async () => {
    const f = setup(() => overload(503, true, undefined), 1);
    await expect(f.client.host()).rejects.toMatchObject({ code: "heavy_read_capacity_exceeded" });
    expect(f.delays).toEqual([120, 240, 480, 900]);
    expect(f.calls).toHaveLength(HTTP_RETRY_MAX_ATTEMPTS);
  });

  it("returns the final original API error after five attempts", async () => {
    const f = setup(() => overload());
    await expect(f.client.host()).rejects.toMatchObject({ status: 503, retryable: true, retryAfterMs: 250 });
    expect(f.calls).toHaveLength(5);
    expect(f.delays).toHaveLength(4);
  });

  it("does not shorten a server delay that cannot fit inside the five-second budget", async () => {
    const f = setup(() => overload(503, true, 2_000));
    await expect(f.client.host()).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(3);
    expect(f.delays).toEqual([2_000, 2_000]);
    expect(f.delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(HTTP_RETRY_BUDGET_MS);
    const long = setup(() => overload(503, true, 60_000));
    await expect(long.client.host()).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(long.calls).toHaveLength(1);
    expect(long.delays).toEqual([]);
  });

  it("counts time spent on the first attempt against the retry window", async () => {
    vi.useFakeTimers();
    const f = setup(() => { vi.setSystemTime(Date.now() + 5_001); return overload(); });
    await expect(f.client.host()).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(1);
  });

  it("does not retry after a delayed backoff wakes beyond the budget", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => overload());
    const client = new CutexClient({ baseUrl: "http://daemon.test", token: null }, {
      fetch, retryRandom: () => 0, sleep: async () => { vi.setSystemTime(Date.now() + 5_001); },
    });
    await expect(client.host()).rejects.toMatchObject({ status: 503, code: "heavy_read_capacity_exceeded" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries plain 429s with Retry-After, and prefers the typed millisecond hint", async () => {
    const f = setup(n => n === 1 ? new Response("rate limited", { status: 429, headers: { "Retry-After": "0.5" } }) : new Response("{}"));
    await f.client.host();
    expect(f.delays).toEqual([500]);
    const typed = setup(n => {
      if (n > 1) return new Response("{}");
      const response = overload(429, false, 250);
      response.headers.set("Retry-After", "3");
      return response;
    });
    await typed.client.host();
    expect(typed.delays).toEqual([250]);
  });

  it("does not retry raw 503s, other status codes, or uncertain transport errors", async () => {
    for (const reply of [() => new Response("busy", { status: 503 }), () => overload(500), () => { throw new Error("socket closed"); }]) {
      const f = setup(reply);
      await expect(f.client.host()).rejects.toBeInstanceOf(Error);
      expect(f.calls).toHaveLength(1);
    }
  });

  it("can explicitly disable retries", async () => {
    const f = setup(() => overload());
    await expect(f.client.request("GET", "/v2/host", { retryable: false })).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(1);
  });

  it("cancels backoff immediately and never sends another request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => overload());
    const client = new CutexClient({ baseUrl: "http://daemon.test", token: null }, { fetch });
    const controller = new AbortController();
    const result = client.host({ signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([429, 503])("never retries an unkeyed POST on %s even when opted in", async status => {
    const f = setup(() => overload(status));
    await expect(f.client.request("POST", "/v2/agents", { body: { name: "one" }, retryable: true })).rejects.toMatchObject({ status });
    expect(f.calls).toHaveLength(1);
  });

  it.each([429, 503])("reuses a POST action_id only on an explicit retryable %s refusal", async status => {
    const f = setup(n => n === 1 ? overload(status) : new Response("{}"));
    await f.client.request("POST", "/v2/actions", { body: { action_id: "one-action", value: 1 } });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.body).toBe(f.calls[0]!.body);
    const no = setup(() => overload(status, false));
    await expect(no.client.request("POST", "/v2/actions", { body: { action_id: "one-action" } })).rejects.toMatchObject({ status });
    expect(no.calls).toHaveLength(1);
  });

  it("honors an Idempotency-Key header without regenerating it", async () => {
    const f = setup(n => n === 1 ? overload() : new Response("{}"));
    await f.client.request("POST", "/v2/actions", { body: { value: 1 }, headers: { "idempotency-key": "one-key" } });
    expect(f.calls).toHaveLength(2);
    expect(new Headers(f.calls[1]!.headers).get("Idempotency-Key")).toBe("one-key");
  });

  it("keeps native requestId stable when retrying an overloaded read POST", async () => {
    const f = setup(n => n === 1 ? overload() : new Response('{"native":{"message":{"result":{"ok":true}}}}'));
    expect(await f.client.native("s", "thread/read", {})).toEqual({ ok: true });
    expect(f.calls[1]!.body).toBe(f.calls[0]!.body);
  });

  it("does not assume any arbitrary requestId is an idempotency key", async () => {
    const f = setup(() => overload());
    await expect(f.client.request("POST", "/v2/unkeyed", { body: { requestId: "resource-id" } })).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(1);
  });

  it("never replays a consumed stream body, even with a key", async () => {
    const f = setup(() => overload());
    const body = new ReadableStream({ start(controller) { controller.close(); } });
    const response = await f.client.fetchRaw(f.client.url("/v2/upload"), { method: "POST", headers: { "Idempotency-Key": "one" }, body });
    expect(response.status).toBe(503);
    expect(f.calls).toHaveLength(1);
  });

  it("retries an explicitly safe PUT but leaves an unmarked write alone", async () => {
    const f = setup(n => n === 1 ? overload() : new Response("{}"));
    await f.client.request("PUT", "/v2/value", { body: {}, retryable: true });
    expect(f.calls).toHaveLength(2);
    const no = setup(() => overload());
    await expect(no.client.request("PUT", "/v2/value", { body: {} })).rejects.toMatchObject({ status: 503 });
    expect(no.calls).toHaveLength(1);
  });

  it("covers raw SSE and media GETs without consuming a successful body", async () => {
    const stream = setup(n => n === 1 ? overload() : new Response("data: hello\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const response = await stream.client.summaryEvents();
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("data: hello\n\n");
    const image = setup(n => n === 1 ? overload() : new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/png" } }));
    expect(await image.client.userAvatar("owner")).toMatchObject({ contentType: "image/png", data: "AQI=" });
    expect(image.calls).toHaveLength(2);
  });
});
