import { afterEach, describe, expect, it, vi } from "vitest";
import { SSE_EVENT, type EventEnvelope } from "@cutex-desktop/protocol";
import { CutexClient } from "../src/client";
import { EventFeed, type EventFeedOptions } from "../src/feed";
import { LIVE_DELTAS_FEATURE, readLiveDeltaFrame, type LiveDeltaFrame } from "../src/index";
import { SseParser } from "../src/sse";

function frame(patch: Partial<LiveDeltaFrame> = {}): LiveDeltaFrame {
  return {
    version: 1, kind: "delta", cutexSessionId: "session", hostId: "host", runtimeGeneration: 3,
    threadId: "thread", turnId: "turn", itemId: "item", method: "item/agentMessage/delta",
    producerEpoch: "epoch", revision: 1, startOffset: 0, endOffset: 7,
    anchor: { streamId: "stream", sequence: 1 },
    params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "中😀" }, ...patch,
  } as LiveDeltaFrame;
}

function durable(sequence: number, reset = false): EventEnvelope {
  return {
    contractVersion: 2, eventId: `e${sequence}`, cursor: `c${sequence}`, streamId: "stream", sequence,
    receivedAt: "2026-10-25T00:00:00Z", cutexSessionId: "session", hostId: "host",
    source: "app_server", sensitivity: "owner", correlation: { runtimeGeneration: 3 },
    ...(reset ? { cutex: { method: "cutex/stream/reset", params: {} } } : {}),
    native: { kind: "notification", message: { method: "item/started", params: {} } },
  };
}

const encoder = new TextEncoder();
const liveWire = (value: unknown) => `event: live_delta\ndata: ${JSON.stringify(value)}\n\n`;
const durableWire = (sequence: number, reset = false) => `id: c${sequence}\nevent: ${SSE_EVENT}\ndata: ${JSON.stringify(durable(sequence, reset))}\n\n`;
const flush = () => vi.advanceTimersByTimeAsync(0);
const feeds: EventFeed[] = [];

async function setup(options: EventFeedOptions = { liveDeltas: true }, checkpointSequence?: number) {
  vi.useFakeTimers();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (!String(url).includes("/stream")) return Response.json({
      streamId: "stream", events: [], nextCursor: new URL(String(url)).searchParams.get("after") ?? "c0", hasMore: false,
      ...(checkpointSequence === undefined ? {} : { checkpoint: { streamId: "stream", sequence: checkpointSequence, cursor: `c${checkpointSequence}` } }),
    });
    return new Response(new ReadableStream<Uint8Array>({ start(c) { streams.push(c); } }));
  });
  const liveDelta = vi.fn(), liveReset = vi.fn(), event = vi.fn(), resync = vi.fn(), status = vi.fn();
  const feed = new EventFeed(new CutexClient({ baseUrl: "http://localhost:24370", token: "test", configPath: "test" }, { fetch }),
    { liveDelta, liveReset, event, resync, status }, { minBackoffMs: 10, ...options });
  feeds.push(feed);
  feed.start();
  await flush();
  const send = async (wire: string, bytewise = false) => {
    const bytes = encoder.encode(wire);
    if (bytewise) for (const byte of bytes) streams.at(-1)!.enqueue(Uint8Array.of(byte));
    else streams.at(-1)!.enqueue(bytes);
    await flush();
  };
  return { feed, fetch, streams, send, liveDelta, liveReset, event, resync, status };
}

afterEach(() => { for (const feed of feeds.splice(0)) feed.stop(); vi.useRealTimers(); });

// Actual wire shape from cutex management/v2/server.rs write_session_status:
// observation-only sequence, empty cursor, no SSE id, generation in params.
const sessionStatus = (backgroundWork: unknown = { running: true, shells: 1 }) => ({
  contractVersion: 2, eventId: "live-uuid", cursor: "", streamId: "stream", sequence: 0,
  receivedAt: "2026-11-04T00:00:00Z", cutexSessionId: "session", hostId: "host",
  source: "cutex", sensitivity: "owner", correlation: {},
  cutex: { method: "cutex/session/backgroundWork/changed", params: { cutexSessionId: "session", runtimeGeneration: 3, backgroundWork } },
});
const statusWire = (value: unknown) => `event: session_status\ndata: ${JSON.stringify(value)}\n\n`;

it("status-only SSE uses the event handler with generation and never opts into text", async () => {
  const h = await setup({ sessionStatus: true });
  const url = new URL(String(h.fetch.mock.calls[1]![0]));
  expect(url.searchParams.get("sessionStatus")).toBe("true");
  expect(url.searchParams.has("liveDeltas")).toBe(false);
  await h.send(statusWire(sessionStatus()), true);
  await h.send(statusWire(sessionStatus(null)), true);
  expect(h.event.mock.calls.map(([e]) => e.cutex.params.backgroundWork)).toEqual([{ running: true, shells: 1 }, null]);
  expect(h.event.mock.calls[0]![0].correlation.runtimeGeneration).toBe(3);
  expect(h.feed.position).toEqual({ streamId: "stream", after: "c0" });
  await h.send(liveWire(frame()));
  expect(h.liveDelta).not.toHaveBeenCalled();
  h.streams[0]!.close(); await flush(); await vi.advanceTimersByTimeAsync(10);
  const reconnect = h.fetch.mock.calls.findLast(([u]) => String(u).includes("/stream"))!;
  expect((reconnect[1] as RequestInit).headers).toMatchObject({ "Last-Event-ID": "c0" });
});

it("sticky and explicit SSE ids on status cannot move durable position or suppress real events", async () => {
  const h = await setup({ sessionStatus: true });
  await h.send(durableWire(1));
  await h.send(statusWire({ ...sessionStatus(), sequence: 999, cursor: "fake" }));
  await h.send(`id: fake\n${statusWire(sessionStatus(null))}`);
  expect(h.feed.position.after).toBe("c1");
  await h.send(durableWire(2));
  expect(h.feed.position.after).toBe("c2");
  expect(h.event.mock.calls.map(([e]) => e.eventId)).toEqual(["e1", "live-uuid", "live-uuid", "e2"]);
});

it.each([{}, { liveDeltas: true }])("status requires independent opt in (%j)", async options => {
  const h = await setup(options);
  await h.send(statusWire(sessionStatus()));
  expect(h.event).not.toHaveBeenCalled();
});

it("rejects malformed, foreign-session and foreign-stream status envelopes", async () => {
  const h = await setup({ sessionStatus: true, cutexSessionId: "session" });
  for (const value of [{}, sessionStatus({ running: "bad" }), { ...sessionStatus(), cutex: { method: "cutex/session/backgroundWork/changed", params: { cutexSessionId: "session", runtimeGeneration: 3 } } },
    { ...sessionStatus(), streamId: "other" }, { ...sessionStatus(), cutexSessionId: "other" },
    { ...sessionStatus(), correlation: { runtimeGeneration: 99 } }]) {
    await h.send(statusWire(value));
  }
  expect(h.event).not.toHaveBeenCalled();
});
