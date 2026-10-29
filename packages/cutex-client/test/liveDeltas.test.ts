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

describe("readLiveDeltaFrame", () => {
  it("exports the capability and preserves both reasoning indices, coalesced revisions and unknown metadata", () => {
    expect(LIVE_DELTAS_FEATURE).toBe("live-text-deltas");
    for (const method of ["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta"] as const) {
      const value = frame({ method, revision: 8, params: { delta: "中😀", summaryIndex: 2, contentIndex: 4, future: { format: "native" } } });
      expect(readLiveDeltaFrame(value)).toBe(value);
      expect(readLiveDeltaFrame(JSON.stringify(value))).toEqual(value);
    }
    expect(readLiveDeltaFrame(frame({ turnId: null, params: { delta: "中😀" } }))?.turnId).toBeNull();
    expect(readLiveDeltaFrame(frame({ kind: "gap", params: { contentIndex: 3 } }))?.kind).toBe("gap");
    expect(readLiveDeltaFrame(frame({ kind: "gap", gapScope: "item", params: {} }))?.gapScope).toBe("item");
  });

  it("accepts a full-identity subscription gap and preserves the overflow-triggering item metadata", () => {
    const gap = frame({ kind: "gap", gapScope: "subscription", revision: 9,
      params: { summaryIndex: 2, contentIndex: 1, reason: "subscriber_overflow" } });
    expect(readLiveDeltaFrame(JSON.stringify(gap))).toEqual(gap);
    const { itemId: _itemId, ...missingIdentity } = gap;
    expect(readLiveDeltaFrame(missingIdentity)).toBeNull();
    expect(readLiveDeltaFrame({ version: 1, kind: "gap", gapScope: "subscription" })).toBeNull();
  });

  it.each(["item", "subscription"] as const)("preserves null params on a full-identity %s gap", (gapScope) => {
    const gap = frame({ kind: "gap", gapScope, params: null });
    expect(readLiveDeltaFrame(gap)).toBe(gap);
    expect(readLiveDeltaFrame(JSON.stringify(gap))).toEqual(gap);
    expect(readLiveDeltaFrame(JSON.stringify(gap))?.params).toBeNull();
    expect(readLiveDeltaFrame({ ...gap, threadId: undefined })).toBeNull();
    expect(readLiveDeltaFrame({ ...gap, params: undefined })).toBeNull();
    expect(readLiveDeltaFrame({ ...gap, params: [] })).toBeNull();
  });

  it("rejects null params on a delta and permits kind-based narrowing", () => {
    expect(readLiveDeltaFrame({ ...frame(), params: null })).toBeNull();
    const delta = readLiveDeltaFrame(frame());
    if (delta?.kind === "delta") expect(delta.params.delta).toBe("中😀");
  });

  it.each([
    null, [], "{", {}, frame({ version: 2 as 1 }), frame({ kind: "unknown" as "gap" }),
    frame({ method: "other" as LiveDeltaFrame["method"] }), frame({ revision: 0 }), frame({ revision: 1.5 }),
    frame({ runtimeGeneration: -1 }), frame({ startOffset: 8 }), frame({ endOffset: 3 }),
    frame({ endOffset: Number.MAX_SAFE_INTEGER + 1 }), frame({ params: { delta: "中😀", contentIndex: -1 } }),
    frame({ params: { delta: "中😀", summaryIndex: "1" } }), frame({ params: { delta: "中😀", threadId: "wrong" } }),
    frame({ anchor: { streamId: "stream", sequence: -1 } }), frame({ params: [] as unknown as Record<string, unknown> }),
    frame({ producerEpoch: "" }), { ...frame(), anchor: undefined }, { ...frame(), turnId: undefined },
    frame({ gapScope: "item" }), { ...frame({ kind: "gap" }), gapScope: "other" },
    JSON.stringify(frame({ params: { delta: "中😀", oversizedMetadata: "x".repeat(65_536) } })),
  ])("ignores malformed or unsupported input %#", (value) => expect(readLiveDeltaFrame(value)).toBeNull());
});

describe("EventFeed live deltas", () => {
  it("does not reset on the first successful connection or a reopened connection, so fresh starts can receive live text", async () => {
    const h = await setup();
    expect(h.status.mock.calls).toEqual([["connecting"], ["live"]]);
    expect(h.liveReset).not.toHaveBeenCalled();
    await h.send(durableWire(1) + liveWire(frame()));
    h.streams[0]!.error(new Error("lost connection"));
    await flush();
    expect(h.liveReset).toHaveBeenCalledExactlyOnceWith();
    const resetOrder = h.liveReset.mock.invocationCallOrder[0]!;
    const retryOrder = h.status.mock.invocationCallOrder[2]!;
    expect(resetOrder).toBeLessThan(retryOrder);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.status.mock.calls.map(([status]) => status)).toEqual(["connecting", "live", "retrying", "connecting", "live"]);
    expect(resetOrder).toBeLessThan(h.status.mock.invocationCallOrder[3]!);
    const fresh = frame({ itemId: "fresh", params: { itemId: "fresh", delta: "中😀" }, anchor: { streamId: "stream", sequence: 2 } });
    await h.send(durableWire(2) + liveWire(fresh));
    expect(resetOrder).toBeLessThan(h.event.mock.invocationCallOrder[1]!);
    expect(h.event.mock.invocationCallOrder[1]).toBeLessThan(h.liveDelta.mock.invocationCallOrder[1]!);
    expect(h.liveDelta.mock.calls.map(([value]) => value.itemId)).toEqual(["item", "fresh"]);
    expect(h.liveReset).toHaveBeenCalledTimes(1);
    expect(h.resync).not.toHaveBeenCalled();
  });

  it("delivers both item and subscription gaps immediately, keeping scope and cursor intact", async () => {
    const h = await setup({ liveDeltas: true, cutexSessionId: "session" });
    const itemGap = frame({ kind: "gap", gapScope: "item", params: { contentIndex: 1 } });
    const subscriptionGap = frame({ kind: "gap", gapScope: "subscription", params: { reason: "subscriber_overflow" } });
    await h.send(liveWire(itemGap) + liveWire(subscriptionGap));
    expect(h.liveDelta.mock.calls).toEqual([[itemGap], [subscriptionGap]]);
    expect(h.feed.position.after).toBe("c0");
    await h.send(durableWire(1));
    expect(h.liveDelta.mock.calls).toEqual([[itemGap], [subscriptionGap]]);
    expect(h.feed.position.after).toBe("c1");
    // Consumer interprets scope; no redundant reset clears later fresh starts.
    expect(h.liveReset).not.toHaveBeenCalled();
    await h.send(liveWire({ ...subscriptionGap, cutexSessionId: "other" }));
    expect(h.liveDelta).toHaveBeenCalledTimes(2);
  });

  it.each(["item", "subscription"] as const)("delivers null-param %s gaps before the anchor without losing scope or advancing cursor", async (gapScope) => {
    const h = await setup({ liveDeltas: true, cutexSessionId: "session" });
    const gap = frame({ kind: "gap", gapScope, params: null });
    await h.send(liveWire(gap));
    expect(h.liveDelta).toHaveBeenCalledExactlyOnceWith(gap);
    expect(h.feed.position.after).toBe("c0");
    await h.send(durableWire(1));
    expect(h.liveDelta).toHaveBeenCalledExactlyOnceWith(gap);
    expect(h.liveDelta.mock.calls[0]![0].params).toBeNull();
    expect(h.feed.position.after).toBe("c1");
    expect(h.liveReset).not.toHaveBeenCalled();
    expect(h.resync).not.toHaveBeenCalled();
  });

  it.each(["item", "subscription"] as const)("applies null/future-anchor %s gaps immediately without advancing durable state", async gapScope => {
    const h = await setup({ liveDeltas: true, cutexSessionId: "session" });
    await h.send(durableWire(1));
    for (const anchor of [null, { streamId: "stream", sequence: 999 }]) {
      const gap = frame({ kind: "gap", gapScope, params: null, anchor });
      await h.send(liveWire(gap));
      expect(h.liveDelta).toHaveBeenLastCalledWith(gap);
      expect(h.feed.position).toEqual({ streamId: "stream", after: "c1" });
    }
    await h.send(liveWire(frame({ kind: "gap", gapScope, anchor: { streamId: "foreign", sequence: 999 } })));
    expect(h.liveDelta).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.liveReset).not.toHaveBeenCalled();
  });

  it("opts in only on SSE; byte-split UTF-8 live frames inherit the parser id but never advance the durable cursor", async () => {
    const h = await setup();
    const parser = new SseParser();
    const messages = parser.push(durableWire(1) + liveWire(frame()));
    expect(messages[1]?.id).toBe("c1"); // intentional WHATWG sticky id
    await h.send(durableWire(1) + liveWire(frame()), true);
    expect(h.liveDelta).toHaveBeenCalledExactlyOnceWith(frame());
    expect(h.event).toHaveBeenCalledTimes(1);
    expect(h.feed.position).toEqual({ streamId: "stream", after: "c1" });
    await h.send(`id: malicious-cursor\n${liveWire(frame({ revision: 3 }))}`);
    expect(h.feed.position.after).toBe("c1");
    expect(String(h.fetch.mock.calls[0]![0])).not.toContain("liveDeltas");
    expect(String(h.fetch.mock.calls[1]![0])).toContain("liveDeltas=true");
  });

  it("delivers an anchored frame only after the durable consumer applied its checkpoint", async () => {
    const h = await setup();
    await h.send(liveWire(frame()));
    expect(h.liveDelta).not.toHaveBeenCalled();
    await h.send(durableWire(1));
    expect(h.liveDelta).toHaveBeenCalledExactlyOnceWith(frame());
    expect(h.event.mock.invocationCallOrder[0]).toBeLessThan(h.liveDelta.mock.invocationCallOrder[0]!);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.liveReset).not.toHaveBeenCalled();
  });

  it("uses a completed catch-up checkpoint on an empty session-filtered page without changing the cursor", async () => {
    const h = await setup({ liveDeltas: true, cutexSessionId: "session" }, 100);
    await h.send(liveWire(frame({ anchor: { streamId: "stream", sequence: 100 } })));
    expect(h.liveDelta).toHaveBeenCalledTimes(1);
    expect(h.feed.position.after).toBe("c0");
  });

  it("filters sessions and ignores null/foreign anchors and malformed live data without stopping durable delivery", async () => {
    const h = await setup({ liveDeltas: true, cutexSessionId: "session" });
    await h.send(liveWire(frame({ cutexSessionId: "other" })) + liveWire(frame({ anchor: null })) +
      liveWire(frame({ anchor: { streamId: "old", sequence: 1 } })) + "event: live_delta\ndata: {bad\n\n" +
      liveWire(frame({ endOffset: 2 })) + durableWire(1));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.event).toHaveBeenCalledTimes(1);
    expect(h.resync).not.toHaveBeenCalled();
  });

  it.each([{}, { liveDeltas: false }])("keeps legacy subscriptions final-only (%j)", async (options) => {
    const h = await setup(options);
    await h.send(durableWire(1) + liveWire(frame()));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.event).toHaveBeenCalledTimes(1);
    expect(String(h.fetch.mock.calls[1]![0])).not.toContain("liveDeltas");
  });

  it("expires waiting anchors after five seconds even without new traffic", async () => {
    const h = await setup();
    await h.send(liveWire(frame()));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.liveReset).toHaveBeenCalledExactlyOnceWith();
    await h.send(durableWire(1));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.resync).not.toHaveBeenCalled();
  });

  it.each(["count", "bytes"])("bounds pending anchor %s and discards the entire overflowing batch", async (bound) => {
    const h = await setup();
    const value = bound === "bytes" ? frame({ params: { delta: "中😀", metadata: "x".repeat(60_000) } }) : frame();
    await h.send(liveWire(value).repeat(bound === "bytes" ? 5 : 257));
    expect(h.liveReset).toHaveBeenCalledExactlyOnceWith();
    await h.send(durableWire(1));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.feed.position.after).toBe("c1");
  });

  it("clears pending anchors and signals missing live text on reconnect, retaining only the durable resume cursor", async () => {
    const h = await setup();
    await h.send(durableWire(1) + liveWire(frame({ anchor: { streamId: "stream", sequence: 2 } })));
    h.streams[0]!.close();
    await flush();
    expect(h.liveReset).toHaveBeenCalledExactlyOnceWith();
    await vi.advanceTimersByTimeAsync(10);
    expect(String(h.fetch.mock.calls[2]![0])).toContain("after=c1");
    expect(h.fetch.mock.calls[3]![1]?.headers).toMatchObject({ "Last-Event-ID": "c1" });
    await h.send(durableWire(2));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.resync).not.toHaveBeenCalled();
    expect(h.feed.position.after).toBe("c2");
  });

  it("discards waiting anchors on durable reset, fences the remaining network chunk and clears the expiry timer", async () => {
    const h = await setup();
    await h.send(liveWire(frame()) + durableWire(1, true) + liveWire(frame()));
    expect(h.liveDelta).not.toHaveBeenCalled();
    expect(h.resync).toHaveBeenCalledExactlyOnceWith("stream_reset", {});
    expect(h.liveReset).toHaveBeenCalledExactlyOnceWith();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.liveReset).toHaveBeenCalledTimes(1);
  });
});
