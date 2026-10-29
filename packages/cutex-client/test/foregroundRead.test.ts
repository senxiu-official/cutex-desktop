import { afterEach, describe, expect, it, vi } from "vitest";
import { SSE_EVENT } from "@cutex-desktop/protocol";
import { CutexClient } from "../src/client";
import { EventFeed } from "../src/feed";

const endpoint = { baseUrl: "http://foreground.test", token: null };
const background = { background: true, retryable: false };
const busy = () => Response.json({ error: { code: "heavy_read_capacity_exceeded", retryable: true, details: { retryAfterMs: 30_000 } } }, { status: 503, headers: { "Retry-After": "30" } });
afterEach(() => vi.useRealTimers());

// SSE opening uses no finite body slot, so a host subscription can report overload
// while both background finite response bodies remain stalled.
async function congest(client: CutexClient) {
  const bodies = await Promise.all(["/v2/sessions", "/v2/projects"].map(path => client.fetchRaw(client.url(path), {}, background)));
  const refused = await client.fetchRaw(client.url("/v2/events/stream"), { headers: { Accept: "text/event-stream" } }, background);
  expect(refused.status).toBe(503);
  await refused.text();
  return bodies;
}

describe("foreground reads with background admission enabled", () => {
  it("host, bootstrap, history and raw GET finish while two background bodies stall and a 30s cooldown is active", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v2/sessions" || path === "/v2/projects") return new Response(new ReadableStream<Uint8Array>({}));
      if (path === "/v2/events/stream") return busy();
      return Response.json({ foreground: path });
    });
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const bodies = await congest(client);
    const abort = new AbortController();
    const queued = client.fetchRaw(client.url("/v2/asks"), { signal: abort.signal }, background).catch(error => error);
    const results: unknown[] = [];
    const reads = Promise.all([client.host(), client.bootstrap("active"), client.history("active"), client.fetchRaw(client.url("/v2/probe"), {}).then(r => r.json())]).then(value => results.push(...value), error => results.push(error));
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(results).toEqual(["/v2/host", "/v2/sessions/active/bootstrap", "/v2/sessions/active/history", "/v2/probe"].map(foreground => ({ foreground })));
      await reads;
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === "/v2/asks")).toBe(false);
      // Free both finite slots: the queued background request must still respect cooldown.
      await Promise.allSettled(bodies.map(r => r.body!.cancel()));
      await vi.advanceTimersByTimeAsync(29_899);
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === "/v2/asks")).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await queued;
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === "/v2/asks")).toBe(true);
    } finally {
      abort.abort(); client.dispose();
      await Promise.allSettled(bodies.map(r => r.body!.cancel()));
      await queued;
      await reads;
    }
  });

  it("keeps the default foreground host retry after a transient 503", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => fetch.mock.calls.length === 1 ? Response.json({ error: { code: "temporarily_busy", retryable: true, details: { retryAfterMs: 100 } } }, { status: 503 }) : Response.json({ hostId: "recovered" }));
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const result = client.host().then(value => ({ value }), error => ({ error }));
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ value: { hostId: "recovered" } });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { client.dispose(); }
  });

  it.each(["catch-up", "SSE opening"])("lets EventFeed own transient 503 backoff for %s", async phase => {
    vi.useFakeTimers();
    let rejected = false;
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const stream = new URL(String(url)).pathname.endsWith("/stream");
      if (!rejected && (phase === "catch-up" || stream)) {
        rejected = true;
        return Response.json({ error: { code: "temporarily_busy", retryable: true, details: { retryAfterMs: 100 } } }, { status: 503 });
      }
      return Response.json({ streamId: "stream-1", events: [], nextCursor: null, hasMore: false });
    });
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(client, { event, resync, status }, { cutexSessionId: "active", minBackoffMs: 1_000 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(status.mock.calls.map(([state]) => state)).toEqual(["connecting", "retrying"]);
      const attempts = phase === "catch-up" ? 1 : 2;
      expect(fetch).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(attempts);
      feed.stop();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetch).toHaveBeenCalledTimes(attempts);
      expect(resync).not.toHaveBeenCalled();
    } finally { feed.stop(); client.dispose(); }
  });

  it("opens active-session SSE and delivers a new durable event while background slots and cooldown remain occupied", async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const durable = { contractVersion: 2, eventId: "e1", cursor: "c1", streamId: "stream-1", sequence: 1, receivedAt: "2026-10-27T00:00:00Z", cutexSessionId: "active", hostId: "host", source: "app_server", sensitivity: "owner", correlation: { runtimeGeneration: 1 }, native: { kind: "notification", message: { method: "item/agentMessage/delta", params: { delta: "new message" } } } };
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/v2/events") {
        expect(parsed.searchParams.get("cutexSessionId")).toBe("active");
        return Response.json({ streamId: "stream-1", events: [], nextCursor: null, hasMore: false });
      }
      if (parsed.pathname === "/v2/events/stream") {
        if (!parsed.searchParams.has("cutexSessionId")) return busy();
        expect(parsed.searchParams.get("cutexSessionId")).toBe("active");
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, cancel: cancelled }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(new ReadableStream<Uint8Array>({}));
    });
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const bodies = await congest(client);
    const abort = new AbortController();
    const queued = client.fetchRaw(client.url("/v2/asks"), { signal: abort.signal }, background).catch(error => error);
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(client, { event, resync, status }, { cutexSessionId: "active", requestTimeoutMs: 50 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(status.mock.calls).toEqual([["connecting"], ["live"]]);
      expect(event).not.toHaveBeenCalled();
      // Split one wire event across chunks to exercise the real SSE parser.
      const wire = `event: ${SSE_EVENT}\nid: c1\ndata: ${JSON.stringify(durable)}\n\n`;
      stream.enqueue(new TextEncoder().encode(wire.slice(0, 40)));
      await vi.advanceTimersByTimeAsync(0);
      expect(event).not.toHaveBeenCalled();
      stream.enqueue(new TextEncoder().encode(wire.slice(40)));
      await vi.advanceTimersByTimeAsync(100);
      expect(event).toHaveBeenCalledExactlyOnceWith(durable);
      expect(feed.position).toEqual({ streamId: "stream-1", after: "c1" });
      expect(status.mock.calls).toEqual([["connecting"], ["live"]]);
      expect(resync).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(5); // two stalled bodies, host refusal, catch-up, session SSE
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === "/v2/asks")).toBe(false);
    } finally {
      feed.stop(); abort.abort();
      await vi.advanceTimersByTimeAsync(0);
      client.dispose();
      await queued;
      await Promise.allSettled(bodies.map(r => r.body!.cancel()));
    }
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("delivers active-session durable catch-up events despite a full background queue and cooldown", async () => {
    vi.useFakeTimers();
    const durable = { contractVersion: 2, eventId: "e1", cursor: "c1", streamId: "stream-1", sequence: 1, receivedAt: "2026-10-27T00:00:00Z", cutexSessionId: "active", hostId: "host", source: "app_server", sensitivity: "owner", correlation: { runtimeGeneration: 1 }, native: { kind: "notification", message: { method: "turn/completed", params: {} } } };
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/v2/events") return Response.json({ streamId: "stream-1", events: [durable], nextCursor: "c1", hasMore: false });
      if (parsed.pathname === "/v2/events/stream") return busy();
      return new Response(new ReadableStream<Uint8Array>({}));
    });
    const client = new CutexClient(endpoint, { fetch, backgroundReads: true, retryRandom: () => 0 });
    const bodies = await congest(client);
    const abort = new AbortController();
    const queued = client.fetchRaw(client.url("/v2/asks"), { signal: abort.signal }, background).catch(error => error);
    const event = vi.fn(), resync = vi.fn(), status = vi.fn();
    const feed = new EventFeed(client, { event, resync, status }, { cutexSessionId: "active", requestTimeoutMs: 50 });
    try {
      feed.start();
      await vi.advanceTimersByTimeAsync(10);
      expect(event).toHaveBeenCalledExactlyOnceWith(durable);
      expect(fetch.mock.calls.some(([url]) => String(url).includes("cutexSessionId=active"))).toBe(true);
      expect(feed.position).toEqual({ streamId: "stream-1", after: "c1" });
      feed.stop();
      await vi.advanceTimersByTimeAsync(100);
      expect(resync).not.toHaveBeenCalled();
      expect(status.mock.calls.some(([, error]) => String(error).includes("timed out"))).toBe(false);
    } finally {
      feed.stop(); abort.abort(); client.dispose();
      await queued;
      await Promise.allSettled(bodies.map(r => r.body!.cancel()));
    }
  });
});

