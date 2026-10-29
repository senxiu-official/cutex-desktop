import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/client";
import { finiteRead } from "../src/readLoad";

const endpoint = { baseUrl: "http://daemon.test", token: null };
const busy = (hint = 250, header?: string) => new Response(JSON.stringify({ error: { code: "heavy_read_capacity_exceeded", retryable: true, details: { retryAfterMs: hint } } }), { status: 503, headers: header ? { "Retry-After": header } : {} });
afterEach(() => vi.useRealTimers());

describe("per-host background read admission", () => {
  it("holds two slots until bodies finish; queued reads do not start on headers alone", async () => {
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { bodies.push(c); } })));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const one = await client.fetchRaw(client.url("/v2/sessions"), {}, { background: true });
    const two = await client.fetchRaw(client.url("/v2/projects"), {}, { background: true });
    const third = client.fetchRaw(client.url("/v2/asks"), {}, { background: true });
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(2);
    await one.body!.cancel(); const three = await third;
    expect(fetch).toHaveBeenCalledTimes(3);
    await two.body!.cancel(); await three.body!.cancel();
  });

  it("does not hold finite-read slots for an open session watch or SSE", async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({})));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const streams = await Promise.all(["/v2/events/stream", "/v2/sessions/a/fs/watch", "/v2/terminals/a/output"].map(path =>
      client.fetchRaw(client.url(path), { headers: { Accept: "text/event-stream" } }, { background: true })));
    const finite = await client.fetchRaw(client.url("/v2/sessions"), {}, { background: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    await Promise.all([...streams, finite].map(r => r.body!.cancel()));
  });

  it("SSE connects while both finite response bodies are stalled", async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({})));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const one = await client.fetchRaw(client.url("/v2/sessions"), {}, { background: true });
    const two = await client.fetchRaw(client.url("/v2/asks"), {}, { background: true });
    const stream = await client.fetchRaw(client.url("/v2/events/stream"), { headers: { Accept: "text/event-stream" } }, { background: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    await Promise.all([one, two, stream].map(r => r.body!.cancel()));
  });

  it("side chat revision long polls cannot occupy both ordinary read slots", async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({})));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const one = await client.fetchRaw(client.url("/v2/sessions/a/side-chats/x", { waitMs: 25000 }), {}, { background: true });
    const two = await client.fetchRaw(client.url("/v2/sessions/a/side-chats/y", { waitMs: 25000 }), {}, { background: true });
    const finite = await client.fetchRaw(client.url("/v2/sessions"), {}, { background: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    await Promise.all([one, two, finite].map(r => r.body!.cancel()));
  });

  it.each([403, 404, 405, 200])("foreground missing/unsupported avatars stay outside background admission (%s)", async status => {
    const fetch = vi.fn(async () => new Response('{}', { status, headers: { 'Content-Type': 'application/json' } }));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    for (let i = 0; i < 4; i++) expect(await client.userAvatar('u-fixture')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("shares Retry-After and jitter across routes without delaying a mutation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST" ? new Response('{}') : fetch.mock.calls.length === 1 ? busy(4_000, "5") : new Response('{}'));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 1 });
    await expect(client.sessions("active", { background: true })).rejects.toMatchObject({ status: 503 });
    const waiting = client.projects({ background: true });
    await expect(client.request("POST", "/v2/stop", { body: {} })).resolves.toEqual({});
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_999); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); await waiting;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("aborts a queued request promptly without starting it or leaking a slot", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => busy(60_000));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    await expect(client.sessions("active", { background: true })).rejects.toMatchObject({ status: 503 });
    const abort = new AbortController();
    const waiting = client.request("GET", "/v2/asks", { signal: abort.signal, background: true });
    const refused = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await refused;
    await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps persistent overload attempts bounded instead of five retries per logical read", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => busy());
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const abort = new AbortController();
    const run = (async () => {
      while (!abort.signal.aborted) {
        try { await client.events({}, { signal: abort.signal, background: true }); } catch { /* next feed attempt */ }
      }
    })();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3); // at 0, 3 and 9 seconds; next at 21s
    abort.abort(); await run;
  });

  it("a different host is not blocked by this host's overload", async () => {
    vi.useFakeTimers();
    const bad = new CutexClient(endpoint, { fetch: async () => busy(), backgroundReads: true });
    const good = new CutexClient({ ...endpoint, baseUrl: "http://other.test" }, { fetch: async () => new Response('{}'), backgroundReads: true });
    await expect(bad.sessions("active", { background: true })).rejects.toMatchObject({ status: 503 });
    await expect(good.projects({ background: true })).resolves.toEqual({});
  });

  it("disposal cancels pending cooldown reads instead of waking the old connection later", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => busy());
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    await expect(client.sessions("active", { background: true })).rejects.toMatchObject({ status: 503 });
    const wait = client.projects({ background: true });
    const cancelled = expect(wait).rejects.toMatchObject({ name: "AbortError" });
    client.dispose(); await cancelled;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborting an admitted body rejects its consumer and frees the slot", async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({})));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const abort = new AbortController();
    const one = client.request("GET", "/v2/sessions", { signal: abort.signal, background: true });
    const refused = expect(one).rejects.toMatchObject({ name: "AbortError" });
    const two = await client.fetchRaw(client.url("/v2/asks"), {}, { background: true });
    const third = client.fetchRaw(client.url("/v2/projects"), {}, { background: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    abort.abort(); await refused;
    const three = await third;
    expect(fetch).toHaveBeenCalledTimes(3);
    await two.body!.cancel(); await three.body!.cancel();
  });

  it("recognizes host listing and native read envelopes without classifying user input as a read", () => {
    expect(finiteRead(endpoint.baseUrl + "/v2/host/sessions", { method: "POST", body: '{}' })).toBe(true);
    expect(finiteRead(endpoint.baseUrl + "/v2/sessions/a/cutex/requests", { method: "POST", body: JSON.stringify({ method: "cutex/userInput/queue/list" }) })).toBe(true);
    expect(finiteRead(endpoint.baseUrl + "/v2/sessions/a/app-server/requests", { method: "POST", body: JSON.stringify({ native: { message: { method: "thread/read" } } }) })).toBe(true);
    expect(finiteRead(endpoint.baseUrl + "/v2/sessions/a/cutex/requests", { method: "POST", body: JSON.stringify({ method: "cutex/userInput/submit" }) })).toBe(false);
    expect(finiteRead(endpoint.baseUrl + "/v2/sessions/a/cutex/requests", { method: "POST", body: JSON.stringify({ method: "custom/mark/read" }) })).toBe(false);
  });
});
