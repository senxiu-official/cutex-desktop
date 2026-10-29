import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { LiveDeltaFrame } from "@cutex-desktop/cutex-client";
import { applyLiveDelta, invalidateLiveDeltas, fullTextItemTerminalOf } from "../src/renderer/src/lib/liveDeltas";
import { applyEvent, emptyTimeline } from "../src/renderer/src/lib/timeline";
import { cloneTimeline } from "../src/renderer/src/lib/historyPages";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
function fixture(live = true, type = "agentMessage") {
  const state = emptyTimeline(); state.threadId = "thread";
  let sequence = 0;
  const durable = (method: string, params: unknown, generation = 3, streamId = "stream") => {
    const envelope = { contractVersion: 2, eventId: `e${++sequence}`, cursor: `c${sequence}`, sequence, streamId, hostId: "host", cutexSessionId: "session", receivedAt: "", sensitivity: "owner", source: "app_server", correlation: { runtimeGeneration: generation }, native: { kind: "notification", message: { method, params } } } as EventEnvelope;
    applyEvent(state, envelope, live); return envelope;
  };
  durable("turn/started", { threadId: "thread", turn: { id: "turn", status: "inProgress" } });
  durable("item/started", { threadId: "thread", turnId: "turn", item: { id: "item", type, text: "", summary: [], content: [] } });
  const frame = (delta: string, startOffset = 0, revision = 1, extra: Partial<LiveDeltaFrame> = {}): LiveDeltaFrame => ({
    version: 1, kind: "delta", cutexSessionId: "session", hostId: "host", runtimeGeneration: 3,
    threadId: "thread", turnId: "turn", itemId: "item", producerEpoch: "epoch", method: "item/agentMessage/delta", revision,
    startOffset, endOffset: startOffset + bytes(delta), anchor: { streamId: "stream", sequence }, params: { threadId: "thread", turnId: "turn", itemId: "item", delta }, ...extra,
  } as LiveDeltaFrame);
  const entry = () => state.entries.get("item")!;
  return { state, durable, frame, entry, append: (value: LiveDeltaFrame, generation = 3) => applyLiveDelta(state, value, generation) };
}

describe("r260 timeline live text", () => {
  it("uses UTF-8 offsets, accepts coalesced revision jumps, and replaces with authoritative completion", () => {
    const f = fixture();
    expect(f.append(f.frame("你好", 0, 2))).toBe(true);
    expect(f.append(f.frame("🧪", 6, 5))).toBe(true);
    expect(f.append(f.frame("!", 10, 9))).toBe(true);
    expect(f.entry()).toMatchObject({ text: "你好🧪!", streaming: true });
    f.durable("item/completed", { threadId: "thread", turnId: "turn", item: { id: "item", type: "agentMessage", text: "权威全文 🧪" } });
    expect(f.entry()).toMatchObject({ text: "权威全文 🧪", streaming: false });
    expect(f.append(f.frame("late", 11, 10))).toBe(false);
  });

  it("ignores consumed ranges but blocks overlaps and all subsequent fragments until repair", () => {
    const f = fixture();
    f.append(f.frame("hello"));
    expect(f.append(f.frame("hello"))).toBe(false);
    expect(f.entry()).toMatchObject({ text: "hello" });
    expect(f.append(f.frame("oops", 3, 2))).toBe(true);
    expect(f.entry()).toMatchObject({ text: "hello", liveIncomplete: true });
    expect(f.append(f.frame(" tail", 5, 3))).toBe(false);
  });

  it.each([
    { startOffset: 1, endOffset: 2 }, { endOffset: 4 }, { revision: 0 },
    { params: { delta: "\ud83e" }, endOffset: 3 },
  ])("rejects malformed offsets/UTF-8/revisions %j", extra => {
    const f = fixture();
    f.append(f.frame("x", 0, 1, extra));
    expect(f.entry()).toMatchObject({ text: "", liveIncomplete: true });
  });

  it("does not treat unknown metadata as a new offset identity", () => {
    const f = fixture();
    f.append(f.frame("a", 0, 1, { params: { delta: "a", metadata: { variant: "one" } } }));
    f.append(f.frame("b", 1, 2, { params: { delta: "b", metadata: { variant: "two" } } }));
    expect(f.entry()).toMatchObject({ text: "ab" });
  });

  it("requires a verified start and never borrows a missing turn from activeTurnId", () => {
    const f = fixture();
    expect(f.append(f.frame("x", 0, 1, { itemId: "unknown" }))).toBe(false);
    expect(f.append(f.frame("x", 0, 1, { turnId: null }))).toBe(false);
    expect(f.append(f.frame("x", 0, 1, { anchor: null }))).toBe(false);
    expect(f.entry()).toMatchObject({ text: "" });
    expect(f.state.entries.has("unknown")).toBe(false);
  });

  it.each([
    { cutexSessionId: "other" }, { hostId: "other" }, { threadId: "other" }, { turnId: "other" },
    { runtimeGeneration: 2 }, { runtimeGeneration: 4 }, { anchor: { streamId: "other", sequence: 2 } },
    { anchor: { streamId: "stream", sequence: 1 } },
  ])("fences unrelated or pre-start identities %j", extra => {
    const f = fixture();
    expect(f.append(f.frame("x", 0, 1, extra))).toBe(false);
    expect(f.entry()).toMatchObject({ text: "" });
  });

  it("a producer epoch change cannot restart or concatenate temporary text", () => {
    const f = fixture(); f.append(f.frame("a"));
    f.append(f.frame("b", 1, 2, { producerEpoch: "new" }));
    expect(f.entry()).toMatchObject({ text: "a", liveIncomplete: true });
    expect(f.append(f.frame("c", 1, 3))).toBe(false);
  });

  it("a gap marks the item incomplete and full completion repairs it", () => {
    const f = fixture(); f.append(f.frame("prefix"));
    f.append(f.frame("", 6, 2, { kind: "gap", gapScope: "item" }));
    expect(f.append(f.frame("last fragment", 6, 3))).toBe(false);
    expect(f.entry()).toMatchObject({ text: "prefix", liveIncomplete: true });
    f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "agentMessage", text: "prefix missing last fragment" } });
    expect(f.entry()).toMatchObject({ text: "prefix missing last fragment", streaming: false });
    expect("liveIncomplete" in f.entry()).toBe(false);
  });

  it("subscription gaps suppress existing items but not later durable starts", () => {
    const f = fixture(); f.append(f.frame("first"));
    const gap = f.frame("", 0, 2, { kind: "gap", gapScope: "subscription" });
    f.append(gap);
    f.durable("item/started", { threadId: "thread", turnId: "turn", item: { id: "new", type: "agentMessage", text: "" } });
    expect(f.entry()).toMatchObject({ liveIncomplete: true });
    expect(f.append(f.frame("safe", 0, 1, { itemId: "new", params: { delta: "safe" } }))).toBe(true);
    expect(f.state.entries.get("new")).toMatchObject({ text: "safe" });
  });

  it.each(["item", "subscription"] as const)("applies %s gaps with null or future anchors before any append readiness check", gapScope => {
    for (const anchor of [null, { streamId: "stream", sequence: 999 }]) {
      const f = fixture(); f.append(f.frame("prefix"));
      expect(f.append(f.frame("", 0, 2, { kind: "gap", gapScope, params: null, anchor }))).toBe(true);
      expect(f.entry()).toMatchObject({ text: "prefix", liveIncomplete: true });
      expect(f.append(f.frame("tail", 6, 3))).toBe(false);
      f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "agentMessage", text: "repaired" } });
      expect(f.entry()).toMatchObject({ text: "repaired", streaming: false });
    }
  });

  it("rejects foreign-stream gaps and subscription gaps invalidate all existing starts regardless of anchor sequence", () => {
    const f = fixture();
    expect(f.append(f.frame("", 0, 1, { kind: "gap", anchor: { streamId: "foreign", sequence: 999 } }))).toBe(false);
    f.durable("item/started", { threadId: "thread", turnId: "turn", item: { id: "other", type: "agentMessage", text: "" } });
    f.append(f.frame("", 0, 2, { kind: "gap", gapScope: "subscription", anchor: { streamId: "stream", sequence: 0 } }));
    expect(f.state.entries.get("other")).toMatchObject({ liveIncomplete: true });
    expect(f.append(f.frame("tail", 0, 3, { itemId: "other" }))).toBe(false);
  });

  it("terminal, generation replacement, stream reset and reconnect all fence late fragments", () => {
    for (const reason of ["terminal", "generation", "reset", "reconnect"]) {
      const f = fixture(); f.append(f.frame("a"));
      if (reason === "terminal") f.durable("turn/completed", { turn: { id: "turn", status: "interrupted" } });
      if (reason === "generation") f.durable("runtime/status", {}, 4);
      if (reason === "reset") applyEvent(f.state, { streamId: "stream", sequence: 3, hostId: "host", cutexSessionId: "session", correlation: { runtimeGeneration: 3 }, cutex: { method: "cutex/stream/reset", params: {} } } as EventEnvelope, true);
      if (reason === "reconnect") invalidateLiveDeltas(f.state);
      expect(f.append(f.frame("late", 1, 2))).toBe(false);
      expect(f.entry()).toMatchObject({ text: "a" });
    }
  });

  it("keeps independent reasoning summary/content indices and honors explicit empty completion arrays", () => {
    const f = fixture(true, "reasoning");
    f.append(f.frame("思考", 0, 1, { method: "item/reasoning/summaryTextDelta", params: { delta: "思考", summaryIndex: 1 } }));
    f.append(f.frame("🧠", 0, 1, { method: "item/reasoning/textDelta", params: { delta: "🧠", contentIndex: 2 } }));
    expect(f.entry()).toMatchObject({ summary: expect.arrayContaining(["思考"]), content: expect.arrayContaining(["🧠"]) });
    f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "reasoning", summary: [], content: [] } });
    expect(f.entry()).toMatchObject({ summary: [], content: [], streaming: false });
  });

  it("does not pretend that a completion with missing fields is an authoritative empty snapshot", () => {
    const f = fixture(); f.append(f.frame("verified prefix"));
    f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "agentMessage" } });
    expect(f.entry()).toMatchObject({ text: "verified prefix", liveIncomplete: true, streaming: false });
    const r = fixture(true, "reasoning");
    r.append(r.frame("prefix", 0, 1, { method: "item/reasoning/summaryTextDelta", params: { delta: "prefix", summaryIndex: 0 } }));
    r.durable("item/completed", { turnId: "turn", item: { id: "item", type: "reasoning", content: [] } });
    expect(r.entry()).toMatchObject({ summary: ["prefix"], content: [], liveIncomplete: true });
  });

  it("bounds active item tracking and item gaps invalidate every reasoning segment", () => {
    const f = fixture(true, "reasoning");
    f.append(f.frame("summary", 0, 1, { method: "item/reasoning/summaryTextDelta", params: { delta: "summary", summaryIndex: 0 } }));
    f.append(f.frame("content", 0, 1, { method: "item/reasoning/textDelta", params: { delta: "content", contentIndex: 0 } }));
    f.append(f.frame("", 0, 2, { kind: "gap", gapScope: "item", params: null }));
    expect(f.append(f.frame("bad", 7, 3, { method: "item/reasoning/summaryTextDelta", params: { delta: "bad", summaryIndex: 0 } }))).toBe(false);
    expect(f.append(f.frame("bad", 7, 3, { method: "item/reasoning/textDelta", params: { delta: "bad", contentIndex: 0 } }))).toBe(false);
    for (let n = 0; n < 100; n++) f.durable("item/started", { threadId: "thread", turnId: "turn", item: { id: `key-${n}`, type: "agentMessage", text: "" } });
    expect(f.state.liveDeltas!.items.size).toBeLessThanOrEqual(64);
  });

  it("fences a referenced/truncated completion before asynchronous full-item repair", () => {
    const f = fixture(); f.append(f.frame("verified prefix"));
    const marker = { reason: "event_size_limit", resyncRequired: true };
    const event = {
      contractVersion: 2, sequence: 3, eventId: "full", cursor: "c3", streamId: "stream", hostId: "host", cutexSessionId: "session",
      correlation: { runtimeGeneration: 3 }, native: { kind: "notification", message: {
        method: "item/completed", _cutexFullText: { type: "cutexBlob" }, _cutexTruncated: marker,
        params: { threadId: "thread", turnId: "turn", item: { id: "item", type: "agentMessage", text: "short preview" } },
      } },
    } as unknown as EventEnvelope;
    expect(applyEvent(f.state, event, true)).toBe(true);
    expect(f.entry()).toMatchObject({ text: "verified prefix", streaming: false, liveIncomplete: true });
    expect(f.append(f.frame("late", 15, 2))).toBe(false);
    const repaired = { ...event, native: { ...event.native!, message: { method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { id: "item", type: "agentMessage", text: "authoritative full text" } } } } } as EventEnvelope;
    applyEvent(f.state, repaired, true);
    expect(f.entry()).toMatchObject({ text: "authoritative full text", streaming: false });
    expect("liveIncomplete" in f.entry()).toBe(false);
    expect(f.state.liveDeltas!.sequence).toBe(3);
  });

  it("keeps the legacy durable path unchanged on old hosts", () => {
    const f = fixture(false, "reasoning");
    f.durable("item/reasoning/summaryTextDelta", { itemId: "item", turnId: "turn", summaryIndex: 0, delta: "legacy" });
    f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "reasoning", summary: [], content: [] } });
    expect(f.entry()).toMatchObject({ summary: ["legacy"] });
    expect(f.state.liveDeltas).toBeUndefined();
  });

  it("keeps a legacy runtime's durable reasoning on a live-capable host, including reconnect", () => {
    const f = fixture(true, "reasoning");
    f.durable("item/reasoning/summaryTextDelta", { itemId: "item", turnId: "turn", summaryIndex: 0, delta: "legacy on new host" });
    expect(invalidateLiveDeltas(f.state)).toBe(false);
    f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "reasoning", summary: [], content: [] } });
    expect(f.entry()).toMatchObject({ summary: ["legacy on new host"] });
    expect("liveIncomplete" in f.entry()).toBe(false);
  });

  it("uses the explicit runtime terminal flag only for its own generation", () => {
    expect(fullTextItemTerminalOf({ capabilities: { features: { fullTextItemTerminal: true } } })).toBe(true);
    expect(fullTextItemTerminalOf({ capabilities: { features: { fullTextItemTerminal: "true" } } })).toBe(false);
    for (const generation of [3, 4]) {
      const f = fixture(true, "reasoning");
      f.state.fullTextItemTerminal = true;
      f.state.fullTextItemTerminalGeneration = generation;
      f.durable("item/reasoning/summaryTextDelta", { itemId: "item", turnId: "turn", summaryIndex: 0, delta: "previous" });
      f.durable("item/completed", { turnId: "turn", item: { id: "item", type: "reasoning", summary: [], content: [] } });
      expect(f.entry()).toMatchObject({ summary: generation === 3 ? [] : ["previous"] });
    }
  });

  it("cloning a timeline isolates temporary channel state", () => {
    const f = fixture(); f.append(f.frame("a"));
    const copy = cloneTimeline(f.state);
    invalidateLiveDeltas(copy);
    expect(f.append(f.frame("b", 1, 2))).toBe(true);
    expect(f.entry()).toMatchObject({ text: "ab" });
  });
});
