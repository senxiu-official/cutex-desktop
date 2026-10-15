import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_EVENT, type EventEnvelope } from "@cutex-desktop/protocol";
import { CutexClient } from "../src/client";
import { EventFeed, type FeedResyncReason } from "../src/feed";
import { FakeDaemon } from "./fake-daemon";

let daemon: FakeDaemon;
let client: CutexClient;

beforeEach(async () => {
  daemon = new FakeDaemon();
  await daemon.start();
  client = new CutexClient({ baseUrl: daemon.baseUrl, token: daemon.token, configPath: "test" });
});

afterEach(async () => {
  await daemon.close();
});

function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("EventFeed", () => {
  it("aborts a catch-up request on stop without retrying or reporting a resync", async () => {
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")));
    }));
    const source = new CutexClient(client.endpoint, { fetch });
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(source, { event, resync, status });
    feed.start();
    expect(signal).toBeDefined();
    feed.stop();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(event).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
    expect(status.mock.calls).toEqual([["connecting"]]);
  });

  it("drops a late catch-up page after stop even if its transport ignores abort", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn(() => response.promise);
    const source = new CutexClient(client.endpoint, { fetch });
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(source, { event, resync, status });
    feed.start();
    feed.stop();
    response.resolve(Response.json({ streamId: "stream-1", events: [daemon.emit()], nextCursor: "c1", hasMore: true }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1); // neither another page nor an SSE stream
    expect(event).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
    expect(status.mock.calls).toEqual([["connecting"]]);
    expect(feed.position).toEqual({ streamId: undefined, after: undefined });
  });

  it("stops delivering the rest of a catch-up page when an event consumer stops the feed", async () => {
    const events = [daemon.emit(), daemon.emit()];
    const fetch = vi.fn(async () => Response.json({ streamId: "stream-1", events, nextCursor: "c2", hasMore: false }));
    const source = new CutexClient(client.endpoint, { fetch });
    const seen: EventEnvelope[] = [];
    const feed = new EventFeed(source, { event: (event) => { seen.push(event); feed.stop(); }, resync() {} });
    feed.start();
    await flush();
    expect(seen).toHaveLength(1);
    expect(feed.position.after).toBe("c1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a late SSE response after stop without emitting live status", async () => {
    const response = deferred<Response>();
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) return Promise.resolve(Response.json({ streamId: "stream-1", events: [], nextCursor: null, hasMore: false }));
      signal = init?.signal;
      return response.promise; // intentionally ignores abort
    });
    const source = new CutexClient(client.endpoint, { fetch });
    const status = vi.fn(), event = vi.fn(), resync = vi.fn();
    const feed = new EventFeed(source, { event, resync, status });
    feed.start();
    await until(() => fetch.mock.calls.length === 2);
    feed.stop();
    expect(signal?.aborted).toBe(true);
    response.resolve(new Response(new ReadableStream({ cancel })));
    await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(status.mock.calls).toEqual([["connecting"]]);
    expect(event).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["headers", "body"])("retries a stalled catch-up page %s without advancing its cursor", async (phase) => {
    vi.useFakeTimers();
    const late = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      if (fetch.mock.calls.length > 1) return new Promise<Response>(() => {});
      return phase === "headers" ? late.promise : Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(c) { bodyController = c; } })));
    });
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(new CutexClient(client.endpoint, { fetch }), { event, resync, status },
      { streamId: "stream-1", after: "c1", requestTimeoutMs: 20, minBackoffMs: 10 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(20);
      expect(signal?.aborted).toBe(true);
      expect(status.mock.calls.map(([s]) => s)).toEqual(["connecting", "retrying"]);
      await vi.advanceTimersByTimeAsync(10);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[1]![0])).toContain("after=c1");
      const stale = JSON.stringify({ streamId: "stream-1", events: [daemon.emit(), daemon.emit()], nextCursor: "c2", hasMore: false });
      if (phase === "headers") late.resolve(new Response(stale));
      else { bodyController!.enqueue(new TextEncoder().encode(stale)); bodyController!.close(); }
      await vi.advanceTimersByTimeAsync(0);
      expect(event).not.toHaveBeenCalled();
      expect(resync).not.toHaveBeenCalled();
      expect(feed.position).toEqual({ streamId: "stream-1", after: "c1" });
      feed.stop();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { feed.stop(); vi.useRealTimers(); }
  });

  it("times out stalled SSE headers and cancels a late response before reconnecting from the same cursor", async () => {
    vi.useFakeTimers();
    const late = deferred<Response>();
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) return Promise.resolve(Response.json({ streamId: "stream-1", events: [], nextCursor: "c1", hasMore: false }));
      signal = init?.signal;
      return late.promise;
    });
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(new CutexClient(client.endpoint, { fetch }), { event, resync, status },
      { requestTimeoutMs: 20, minBackoffMs: 1000 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20);
      expect(signal?.aborted).toBe(true);
      expect(status.mock.calls.map(([s]) => s)).toEqual(["connecting", "retrying"]);
      late.resolve(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(event).not.toHaveBeenCalled();
      expect(resync).not.toHaveBeenCalled();
      expect(feed.position).toEqual({ streamId: "stream-1", after: "c1" });
      feed.reconnectNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(String(fetch.mock.calls[2]![0])).toContain("after=c1");
    } finally { feed.stop(); vi.useRealTimers(); }
  });

  it("cancels a stalled live reader on idle timeout and replays the next event once", async () => {
    vi.useFakeTimers();
    const first = daemon.emit(), second = daemon.emit();
    const cancel = vi.fn();
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      switch (fetch.mock.calls.length) {
        case 1: return Response.json({ streamId: "stream-1", events: [first], nextCursor: "c1", hasMore: false });
        case 2: return new Response(new ReadableStream({ cancel }));
        case 3: return Response.json({ streamId: "stream-1", events: [first, second], nextCursor: "c2", hasMore: false });
        default: return new Response(new ReadableStream());
      }
    });
    const seen: number[] = [], status = vi.fn();
    const feed = new EventFeed(new CutexClient(client.endpoint, { fetch }), { event: (e) => seen.push(e.sequence), resync() {}, status },
      { idleTimeoutMs: 20, requestTimeoutMs: 100, minBackoffMs: 10 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(20);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(status.mock.calls.map(([s]) => s)).toEqual(["connecting", "live", "retrying"]);
      await vi.advanceTimersByTimeAsync(10);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(seen).toEqual([1, 2]);
      expect(feed.position.after).toBe("c2");
    } finally { feed.stop(); vi.useRealTimers(); }
  });

  it("reports numeric SSE chunk traffic without letting diagnostics interrupt delivery", async () => {
    const first = daemon.emit(), second = daemon.emit();
    const chunk = (events: EventEnvelope[]) => new TextEncoder().encode(events.map((e) => `event: ${SSE_EVENT}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
    const firstChunk = chunk([first]), secondChunk = chunk([first, second]);
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetch = vi.fn(async () => fetch.mock.calls.length === 1
      ? Response.json({ streamId: "stream-1", events: [], nextCursor: null, hasMore: false })
      : new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } })));
    const traffic = vi.fn(() => { throw new Error("diagnostic sink failed"); });
    const seen: number[] = [];
    const feed = new EventFeed(new CutexClient(client.endpoint, { fetch }), { event: (e) => seen.push(e.sequence), resync() {}, traffic });
    try {
      feed.start();
      await until(() => !!stream);
      stream!.enqueue(firstChunk);
      stream!.enqueue(secondChunk);
      await until(() => traffic.mock.calls.length === 2);
      expect(seen).toEqual([1, 2]);
      expect(traffic.mock.calls).toEqual([[{ bytes: firstChunk.byteLength, events: 1 }], [{ bytes: secondChunk.byteLength, events: 1 }]]);
    } finally { feed.stop(); }
  });

  it("replays backlog, then follows live events, without duplicates", async () => {
    daemon.emit();
    daemon.emit();
    const seen: EventEnvelope[] = [];
    const feed = new EventFeed(client, { event: (e) => seen.push(e), resync: () => {} });
    feed.start();
    await until(() => seen.length === 2);
    daemon.emit();
    await until(() => seen.length === 3);
    feed.stop();
    expect(seen.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("filters by session", async () => {
    daemon.emit("s1");
    daemon.emit("s2");
    daemon.emit("s1");
    const seen: EventEnvelope[] = [];
    const feed = new EventFeed(client, { event: (e) => seen.push(e), resync: () => {} }, { cutexSessionId: "s1" });
    feed.start();
    await until(() => seen.length === 2);
    feed.stop();
    expect(seen.every((e) => e.cutexSessionId === "s1")).toBe(true);
  });

  it("fromLatest skips the retained backlog", async () => {
    daemon.emit();
    daemon.emit();
    const seen: EventEnvelope[] = [];
    let live = false;
    const feed = new EventFeed(
      client,
      { event: (e) => seen.push(e), resync: () => {}, status: (s) => (live ||= s === "live") },
      { fromLatest: true },
    );
    feed.start();
    await until(() => live);
    daemon.emit();
    await until(() => seen.length === 1);
    feed.stop();
    expect(seen[0]!.sequence).toBe(3);
  });

  it("reconnects after the server drops the stream and catches up missed events", async () => {
    const seen: EventEnvelope[] = [];
    let opens = 0;
    const feed = new EventFeed(
      client,
      { event: (e) => seen.push(e), resync: () => {}, status: (s) => s === "live" && opens++ },
      { minBackoffMs: 10 },
    );
    feed.start();
    await until(() => opens === 1);
    daemon.dropLive();
    daemon.emit(); // emitted while disconnected
    await until(() => seen.length === 1 && opens >= 2);
    daemon.emit();
    await until(() => seen.length === 2);
    feed.stop();
    expect(seen.map((e) => e.sequence)).toEqual([1, 2]);
    const streamRequest = daemon.requests.filter((r) => r.url.startsWith("/v2/events/stream")).at(-1);
    expect(streamRequest?.headers["last-event-id"]).toBe("c1");
  });

  it("reconnectNow ends a long reconnect wait at once", async () => {
    const seen: EventEnvelope[] = [];
    let opens = 0;
    const feed = new EventFeed(
      client,
      { event: (e) => seen.push(e), resync: () => {}, status: (s) => s === "live" && opens++ },
      { minBackoffMs: 60_000, maxBackoffMs: 60_000 },
    );
    feed.start();
    await until(() => opens === 1);
    daemon.dropLive();
    daemon.emit(); // emitted while the feed waits 60 s before reconnecting
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(0);
    feed.reconnectNow();
    await until(() => seen.length === 1 && opens === 2, 1000);
    feed.reconnectNow(); // live: nothing happens
    await new Promise((r) => setTimeout(r, 50));
    expect(opens).toBe(2);
    feed.stop();
  });

  it("asks for resync when the stream identity changes", async () => {
    daemon.emit();
    const reasons: FeedResyncReason[] = [];
    const feed = new EventFeed(client, { event: () => {}, resync: (r) => reasons.push(r) }, { minBackoffMs: 10 });
    feed.start();
    await until(() => feed.position.after === "c1");
    daemon.streamId = "stream-2";
    daemon.dropLive();
    await until(() => reasons.length === 1);
    expect(reasons).toEqual(["stream_changed"]);
  });

  it("always sends streamId with a nonzero cursor (page and stream)", async () => {
    daemon.emit("s1");
    const seen: EventEnvelope[] = [];
    const feed = new EventFeed(client, { event: (e) => seen.push(e), resync: () => {} }, { cutexSessionId: "s1", streamId: "stream-1", after: "c1", minBackoffMs: 10 });
    feed.start();
    await until(() => daemon.requests.some((r) => r.url.startsWith("/v2/events/stream")));
    daemon.emit("s1");
    await until(() => seen.length === 1);
    daemon.dropLive();
    daemon.emit("s1");
    await until(() => seen.length === 2);
    feed.stop();
    const withCursor = daemon.requests.filter((r) => r.url.includes("after=") || r.headers["last-event-id"]);
    expect(withCursor.length).toBeGreaterThanOrEqual(3);
    for (const r of withCursor) expect(r.url).toContain("streamId=stream-1");
    expect(daemon.requests.every((r) => !r.url.startsWith("/v2/events") || r.url.includes("streamId="))).toBe(true);
  });

  it("re-bootstraps instead of resuming a cursor without its streamId", async () => {
    daemon.emit();
    const reasons: FeedResyncReason[] = [];
    const feed = new EventFeed(client, { event: () => {}, resync: (r) => reasons.push(r) }, { after: "c1", minBackoffMs: 10 });
    feed.start();
    await until(() => reasons.length === 1);
    expect(reasons).toEqual(["stream_changed"]);
    expect(daemon.requests).toHaveLength(0);
  });

  it("re-bootstraps on the 400 'streamId is required' answer and on 409 stream_changed", async () => {
    daemon.emit();
    const reasons: FeedResyncReason[] = [];
    daemon.refuseCursors = true;
    const a = new EventFeed(client, { event: () => {}, resync: (r) => reasons.push(r) }, { streamId: "stream-1", after: "c1", minBackoffMs: 10 });
    a.start();
    await until(() => reasons.length === 1);
    expect(reasons).toEqual(["stream_changed"]);
    daemon.refuseCursors = false;
    const b = new EventFeed(client, { event: () => {}, resync: (r) => reasons.push(r) }, { streamId: "stream-old", after: "c1", minBackoffMs: 10 });
    b.start();
    await until(() => reasons.length === 2);
    expect(reasons).toEqual(["stream_changed", "stream_changed"]);
  });

  it("re-bootstraps with access_changed when cutex ends the stream for a changed user / grant", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v2/events/stream")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: cutex/access/changed\ndata: {"tokenId":"t1","changedAt":"2026-10-14T00:00:00Z"}\n\n'));
            controller.close();
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ streamId: "s1", events: [], nextCursor: null, hasMore: false }));
    });
    const source = new CutexClient(client.endpoint, { fetch });
    const reasons: [FeedResyncReason, unknown][] = [];
    const feed = new EventFeed(source, { event: () => {}, resync: (r, d) => reasons.push([r, d]) }, { minBackoffMs: 10 });
    feed.start();
    await until(() => reasons.length === 1);
    expect(reasons).toEqual([["access_changed", { tokenId: "t1", changedAt: "2026-10-14T00:00:00Z" }]]);
    await flush();
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("/v2/events/stream"))).toHaveLength(1);
  });

  it("sends the bearer token", async () => {
    await client.events();
    expect(daemon.requests[0]!.headers.authorization).toBe("Bearer test-token");
  });
});
