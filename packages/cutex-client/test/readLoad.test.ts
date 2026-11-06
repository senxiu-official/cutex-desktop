import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/client";
import { finiteRead } from "../src/readLoad";
import { createServer } from "node:http";

const endpoint = { baseUrl: "http://daemon.test", token: null };
const busy = (hint = 250, header?: string) => new Response(JSON.stringify({ error: { code: "heavy_read_capacity_exceeded", retryable: true, details: { retryAfterMs: hint } } }), { status: 503, headers: header ? { "Retry-After": header } : {} });
afterEach(() => vi.useRealTimers());

describe("per-host background read admission", () => {
  it("carries native read priority over a real loopback HTTP connection", async () => {
    const received: (string | string[] | undefined)[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers["x-cutex-read-priority"]);
      request.resume();
      response.setHeader("Content-Type", "application/json");
      response.end('{"data":[]}');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing loopback address");
      const client = new CutexClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: null });
      for (const background of [true, false]) {
        await client.request("POST", "/v2/sessions/a/app-server/requests", {
          background, body: { native: { message: { method: "thread/turns/list", params: { limit: 10 } } } },
        });
      }
      expect(received).toEqual(["background", undefined]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it.each([false, true])("marks explicit background reads independently of local admission (%s)", async backgroundReads => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}'));
    const client = new CutexClient({ ...endpoint, token: "test-token" }, { fetch, backgroundReads });
    await client.sessions("active", { background: true });
    const background = new Headers(fetch.mock.calls[0]![1]!.headers);
    expect(background.get("X-Cutex-Read-Priority")).toBe("background");
    expect(background.get("Authorization")).toBe("Bearer test-token");
    await client.sessions("active");
    expect(new Headers(fetch.mock.calls[1]![1]!.headers).has("X-Cutex-Read-Priority")).toBe(false);
  });

  it("does not mark mutations and clears stale caller markers on foreground reads", async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}'));
    const client = new CutexClient(endpoint, { fetch });
    for (const method of ["GET", "POST"] as const) {
      await client.fetchRaw(client.url("/v2/stop"), { method, headers: { "X-Cutex-Read-Priority": "background" } }, { background: method === "POST" });
      expect(new Headers(fetch.mock.calls.at(-1)![1]!.headers).has("X-Cutex-Read-Priority")).toBe(false);
    }
  });

  it("holds direct native turn-page slots through real body decoding while interrupts proceed", async () => {
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const method = JSON.parse(init!.body as string).native.message.method;
      return method === "turn/interrupt" ? new Response('{}') : new Response(new ReadableStream<Uint8Array>({ start(c) { bodies.push(c); } }));
    });
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true });
    const page = () => client.request<{ data: unknown[] }>("POST", "/v2/sessions/a/app-server/requests", {
      background: true, body: { native: { message: { method: "thread/turns/list", params: { threadId: "t", limit: 10 } } } },
    });
    const one = page(); const two = page(); const third = page();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await client.request("POST", "/v2/sessions/a/app-server/requests", {
      background: true, body: { native: { message: { method: "turn/interrupt" } } },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const bytes = new TextEncoder().encode(JSON.stringify({ data: Array.from({ length: 10 }, (_, id) => ({ id, text: "page body ".repeat(100) })) }));
    bodies[0]!.enqueue(bytes); bodies[0]!.close();
    expect((await one).data).toHaveLength(10);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    for (const body of bodies.slice(1)) { body.enqueue(bytes); body.close(); }
    expect((await two).data).toHaveLength(10); expect((await third).data).toHaveLength(10);
  });

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
