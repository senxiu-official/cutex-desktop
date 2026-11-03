import { createHash } from "node:crypto";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ feeds: [] as any[], capabilities: vi.fn(), blob: vi.fn(), events: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async importOriginal => ({
  ...await importOriginal<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class { capabilities() { return f.capabilities(); } eventBlob(...args: unknown[]) { return f.blob(...args); } events(...args: unknown[]) { return f.events(...args); } },
  EventFeed: class {
    start = vi.fn(); stop = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: any) { f.feeds.push(this); }
  },
}));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";

beforeEach(() => { f.feeds.length = 0; f.capabilities.mockReset(); f.blob.mockReset(); f.events.mockReset(); });
afterEach(() => vi.useRealTimers());
const fixture = () => {
  const events: { event: string; payload: unknown }[] = [];
  const daemon = new DaemonService((event, payload) => events.push({ event, payload }));
  (daemon as any).client = new CutexClient({ baseUrl: "http://fake.invalid", token: null });
  return { daemon, events };
};

it("recovers only the held identities' missed admission receipts before the new feed, never native deltas", async () => {
  const receipt = (sequence: number, method: string, id = "held-1") => ({ sequence, streamId: "durable", cursor: `c${sequence}`, correlation: {}, cutex: { method, params: { clientUserMessageId: id } } });
  const timeout = receipt(12, "cutex/userInput/failed");
  f.events.mockResolvedValueOnce({ events: [receipt(10, "cutex/userInput/held"), { sequence: 11, native: { message: { method: "item/agentMessage/delta" } } }], hasMore: true, nextCursor: "c11" });
  f.events.mockResolvedValueOnce({ events: [timeout, receipt(13, "cutex/userInput/failed", "other-input"), receipt(15, "cutex/userInput/submitted")], hasMore: true, nextCursor: "c15" });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: "c14", ownerAdmissionReplay: { after: "c9", throughSequence: 14, ids: ["held-1"] } });
  expect(events.filter(event => event.event === "sessionEvent").map(event => (event.payload as any).envelope.cutex.method)).toEqual(["cutex/userInput/held", "cutex/userInput/failed"]);
  expect(f.events.mock.calls.map(call => call[0])).toEqual([{ cutexSessionId: "s", streamId: "durable", after: "c9", limit: 1000 }, { cutexSessionId: "s", streamId: "durable", after: "c11", limit: 1000 }]);
  expect(f.feeds[0].options).toMatchObject({ streamId: "durable", after: "c14" });
  expect(f.feeds[0].start).toHaveBeenCalledOnce();
});

it("surfaces a read-only recovery failure instead of starting beyond an unknown held outcome", async () => {
  f.events.mockRejectedValue(new Error("replay unavailable"));
  const { daemon } = fixture();
  await expect(daemon.subscribe("s", { streamId: "durable", after: "c14", ownerAdmissionReplay: { after: "c9", throughSequence: 14, ids: ["held-1"] } })).rejects.toThrow("replay unavailable");
  expect(f.feeds).toHaveLength(0);
});

it.each([
  [{ hostId: "old", featureList: [] }, false],
  [{ hostId: "new", featureList: ["live-text-deltas"] }, true],
  [{ hostId: "new", featureList: [], features: { liveTextDeltas: true } }, true],
] as const)("negotiates the session stream only on a capable host: %j", async (caps, enabled) => {
  f.capabilities.mockResolvedValue(caps);
  const { daemon } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: "cursor" });
  expect(f.feeds[0].options).toMatchObject({ cutexSessionId: "s", streamId: "durable", after: "cursor", liveDeltas: enabled });
  await daemon.unsubscribe("s");
});

it("forwards live and reset as distinct IPC events and fences old subscriptions", async () => {
  f.capabilities.mockResolvedValue({ hostId: "new", featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  const first = f.feeds[0];
  const frame = { kind: "delta", params: { delta: "live" } };
  first.handlers.liveDelta(frame); first.handlers.liveReset();
  expect(events).toEqual([{ event: "sessionLiveDelta", payload: { sessionId: "s", frame } }, { event: "sessionLiveReset", payload: { sessionId: "s" } }]);
  await daemon.subscribe("s", { streamId: "new", after: null });
  events.length = 0;
  first.handlers.liveDelta(frame); first.handlers.liveReset(); first.handlers.resync("old");
  expect(events).toEqual([]);
  await daemon.unsubscribe("s");
});

it("cannot create an orphan feed when unsubscribe wins the capability probe", async () => {
  let resolve!: (value: unknown) => void;
  f.capabilities.mockReturnValue(new Promise(done => { resolve = done; }));
  const { daemon } = fixture();
  const pending = daemon.subscribe("s", { streamId: "durable", after: null });
  await daemon.unsubscribe("s");
  resolve({ featureList: ["live-text-deltas"] });
  await pending;
  expect(f.feeds).toEqual([]);
});

it("falls back quietly when an older capability endpoint is unavailable", async () => {
  f.capabilities.mockRejectedValue(new Error("not supported"));
  const { daemon } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  expect(f.feeds[0].options.liveDeltas).toBe(false);
  await daemon.unsubscribe("s");
});


it("cannot stall a legacy subscription when capability discovery ignores abort", async () => {
  vi.useFakeTimers();
  f.capabilities.mockReturnValue(new Promise(() => {}));
  const { daemon } = fixture();
  const pending = daemon.subscribe("s", { streamId: "durable", after: null });
  await vi.advanceTimersByTimeAsync(1_500);
  await pending;
  expect(f.feeds[0].options.liveDeltas).toBe(false);
  await daemon.unsubscribe("s");
});


function fullTextEvent(text: string): { event: EventEnvelope; value: { bytes: Uint8Array; mime: string; size: number } } {
  const bytes = new TextEncoder().encode(JSON.stringify({ id: "large", type: "agentMessage", text }));
  const sha = createHash("sha256").update(bytes).digest("hex");
  return {
    value: { bytes, mime: "application/json", size: bytes.byteLength },
    event: { contractVersion: 2, eventId: "complete", cursor: "cursor", streamId: "durable", sequence: 10, cutexSessionId: "s", hostId: "host", source: "app_server", correlation: { runtimeGeneration: 3 }, native: { kind: "notification", message: {
      method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { id: "large", type: "agentMessage", text: "short preview" } },
      _cutexTruncated: { reason: "event_size_limit", resyncRequired: true },
      _cutexFullText: { type: "cutexBlob", blobId: sha, sha256: sha, mime: "application/json", size: bytes.byteLength, url: `cutex-blob:s/${sha}` },
    } } } as unknown as EventEnvelope,
  };
}
const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };

it("hydrates large completions through a distinct IPC event, preserving the durable cursor", async () => {
  f.capabilities.mockResolvedValue({ hostId: "new", featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  const input = fullTextEvent("完整 🧪".repeat(50_000));
  f.blob.mockResolvedValue(input.value);
  f.feeds[0].handlers.event(input.event);
  await settle();
  expect(events.map(e => e.event)).toEqual(["sessionEvent", "sessionFullText"]);
  const restored = (events[1]!.payload as { envelope: EventEnvelope }).envelope;
  expect(restored).toMatchObject({ cursor: "cursor", streamId: "durable", sequence: 10 });
  expect(restored.native!.message.params).toMatchObject({ item: { text: "完整 🧪".repeat(50_000) } });
  await daemon.unsubscribe("s");
});

it("falls back to history if the reference cannot be repaired", async () => {
  f.capabilities.mockResolvedValue({ featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  f.blob.mockResolvedValue(null);
  f.feeds[0].handlers.event(fullTextEvent("full").event);
  await settle();
  expect(events.map(e => e.event)).toEqual(["sessionEvent", "sessionResync"]);
  await daemon.unsubscribe("s");
});

it("drops hydration results after unsubscribe replaced the view", async () => {
  f.capabilities.mockResolvedValue({ featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  const input = fullTextEvent("full");
  let resolve!: (value: unknown) => void;
  f.blob.mockReturnValue(new Promise(done => { resolve = done; }));
  f.feeds[0].handlers.event(input.event);
  await daemon.unsubscribe("s");
  resolve(input.value); await settle();
  expect(events.map(e => e.event)).toEqual(["sessionEvent"]);
});


it("does not reload history for an ordinary inline completed item", async () => {
  f.capabilities.mockResolvedValue({ featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  const event = fullTextEvent("full").event;
  const message = event.native!.message as unknown as Record<string, unknown>;
  delete message._cutexFullText; delete message._cutexTruncated;
  f.feeds[0].handlers.event(event);
  await settle();
  expect(f.blob).not.toHaveBeenCalled();
  expect(events.map(e => e.event)).toEqual(["sessionEvent"]);
  await daemon.unsubscribe("s");
});


it.each([true, false])("missing full text repairs only with per-runtime live evidence: %s", async enabled => {
  f.capabilities.mockResolvedValue({ featureList: ["live-text-deltas"] });
  const { daemon, events } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  const event = fullTextEvent("full").event;
  const message = event.native!.message as unknown as Record<string, any>;
  delete message._cutexFullText; delete message._cutexTruncated; delete message.params.item.text;
  if (enabled) f.feeds[0].handlers.liveDelta({ runtimeGeneration: 3 });
  f.feeds[0].handlers.event(event); await settle();
  expect(f.blob).not.toHaveBeenCalled();
  expect(events.map(e => e.event)).toEqual(enabled ? ["sessionLiveDelta", "sessionEvent", "sessionResync"] : ["sessionEvent"]);
  await daemon.unsubscribe("s");
});

it("bounds concurrent full-item reads while completions continue to arrive", async () => {
  f.capabilities.mockResolvedValue({ featureList: ["live-text-deltas"] });
  const { daemon } = fixture();
  await daemon.subscribe("s", { streamId: "durable", after: null });
  f.blob.mockReturnValue(new Promise(() => {}));
  for (let n = 0; n < 10; n++) {
    const event = fullTextEvent(`full ${n}`).event;
    f.feeds[0].handlers.event({ ...event, eventId: `event-${n}` });
  }
  await settle();
  expect(f.blob).toHaveBeenCalledTimes(2);
  await daemon.unsubscribe("s");
});
