import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { MAX_EVENT_MEDIA_BYTES } from "../src/shared/mediaBlobs";
import { fullTextReference, hasFullTextCompletion, hydrateFullText, type FullTextRead } from "../src/main/liveFullText";

type Json = Record<string, unknown>;
const marker = { reason: "event_size_limit", resyncRequired: true };
function fixture(item: Json = { id: "a", type: "agentMessage", text: "完整文本 🌏" }) {
  const bytes = new TextEncoder().encode(JSON.stringify(item));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const descriptor = { type: "cutexBlob", blobId: sha256, sha256, mime: "application/json", size: bytes.length, url: `cutex-blob:session.a/${sha256}` };
  const params: Json = { threadId: "thread-a", turnId: "turn-a", item: { id: "a", type: item.type, text: "preview" }, _cutexTruncated: marker, extra: 42 };
  const message: Json = { method: "item/completed", params, _cutexFullText: descriptor, _cutexTruncated: marker, unknownRoot: true };
  const envelope = {
    contractVersion: 2, cutexSessionId: "session.a", hostId: "HOST-A", sequence: 99, cursor: "cursor99", streamId: "stream-a",
    eventId: "event99", receivedAt: "2026-10-25T00:00:00Z", source: "app_server", sensitivity: "owner",
    correlation: { runtimeGeneration: 3, turnId: "turn-a", itemId: "a" }, native: { kind: "notification", message },
  } as unknown as EventEnvelope;
  const read = vi.fn<FullTextRead>().mockResolvedValue({ bytes, mime: "application/json", size: bytes.length });
  return { envelope, message, params, descriptor, bytes, item, read };
}

describe("authoritative completed text sidecars", () => {
  it.each(["agentMessage", "reasoning"])("restores >240KiB %s, preserving metadata and input", async type => {
    const large = "中文 🧪".repeat(30000);
    const item = type === "agentMessage" ? { id: "a", type, text: large, phase: "commentary", unknown: { keep: true } }
      : { id: "a", type, summary: [large, "第二部分"], content: [large, ""], unknown: { keep: true } };
    const f = fixture(item);
    expect(f.bytes.length).toBeGreaterThan(240 * 1024);
    const original = JSON.stringify(f.envelope);
    expect(hasFullTextCompletion(f.envelope)).toBe(true);
    const ref = fullTextReference(f.envelope)!;
    expect(ref).toEqual({ sessionId: "session.a", sha256: f.descriptor.sha256, expected: { mime: "application/json", size: f.bytes.length } });
    const out = await hydrateFullText(f.envelope, f.read);
    expect(f.read).toHaveBeenCalledExactlyOnceWith(ref.sessionId, ref.sha256, ref.expected);
    expect(out).toEqual({ ...f.envelope, native: { ...f.envelope.native!, message: { method: "item/completed", unknownRoot: true,
      params: { threadId: "thread-a", turnId: "turn-a", item, extra: 42 } } } });
    expect(out!.correlation).toBe(f.envelope.correlation);
    expect(JSON.stringify(f.envelope)).toBe(original);
  });

  it("accepts empty reasoning arrays", async () => {
    const f = fixture({ id: "a", type: "reasoning", summary: [], content: [] });
    expect((await hydrateFullText(f.envelope, f.read))?.native?.message.params).toMatchObject({ item: f.item });
  });

  it.each([
    { type: "nope" }, { mime: "text/plain" }, { mime: "application/json; charset=utf-8" },
    { size: MAX_EVENT_MEDIA_BYTES + 1 }, { size: -1 }, { size: 1.5 }, { size: 0 },
    { sha256: "a".repeat(64) }, { blobId: "b".repeat(64) },
    { url: `cutex-blob:other/${"a".repeat(64)}` }, { url: "https://example.com/blob" },
    { sha256: "not-a-hash" }, { url: `cutex-blob:session.a/${"A".repeat(64)}` },
  ])("rejects malformed descriptor %j without reading", async patch => {
    const f = fixture(); Object.assign(f.descriptor, patch);
    expect(fullTextReference(f.envelope)).toBeNull();
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
    expect(f.read).not.toHaveBeenCalled();
  });

  it("rejects an otherwise canonical descriptor from another session", async () => {
    const f = fixture(); f.envelope.cutexSessionId = "session.b";
    expect(fullTextReference(f.envelope)).toBeNull();
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull(); expect(f.read).not.toHaveBeenCalled();
  });

  it.each([
    { id: "wrong", type: "agentMessage", text: "full" }, { id: "a", type: "reasoning", summary: [], content: [] },
    { id: "a", type: "agentMessage" }, { id: "a", type: "agentMessage", text: null },
    { id: "a", type: "agentMessage", text: "full", _cutexTruncated: null },
    { id: "a", type: "agentMessage", text: "full", nested: [{ _cutexFullText: {} }] },
  ])("rejects mismatched, incomplete or recursively partial full items %j", async item => {
    const f = fixture(item); f.params.item = { id: "a", type: "agentMessage" };
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });
  it.each([
    { id: "a", type: "reasoning", summary: [] }, { id: "a", type: "reasoning", content: [] },
    { id: "a", type: "reasoning", summary: [1], content: [] }, { id: "a", type: "reasoning", summary: [], content: [null] },
    { id: "a", type: "reasoning", summary: "wrong", content: [] },
  ])("requires both reasoning arrays with only strings %j", async item => {
    const f = fixture(item); expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });

  it.each(["not json", "null", "[]", "{", "42", '"text"'])("rejects invalid full JSON %s", async raw => {
    const f = fixture(); const bytes = new TextEncoder().encode(raw);
    f.descriptor.size = bytes.length;
    f.read.mockResolvedValue({ bytes, size: bytes.length, mime: "application/json" });
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });
  it("rejects invalid UTF-8 rather than silently replacing bytes", async () => {
    const f = fixture();
    // Replacement decoding would produce valid JSON and pass item validation, so fatal UTF-8 matters.
    const bytes = new Uint8Array([...new TextEncoder().encode('{"id":"a","type":"agentMessage","text":"'), 0xff,
      ...new TextEncoder().encode('"}')]);
    f.descriptor.size = bytes.length;
    f.read.mockResolvedValue({ bytes, size: bytes.length, mime: "application/json" });
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });
  it.each(["mime", "size", "bytes", "null", "throw"])("fails closed on returned %s mismatch/unavailability", async mode => {
    const f = fixture();
    if (mode === "throw") f.read.mockRejectedValue(new Error("unavailable"));
    else if (mode === "null") f.read.mockResolvedValue(null);
    else f.read.mockResolvedValue({ bytes: mode === "bytes" ? new Uint8Array(1) : f.bytes,
      mime: mode === "mime" ? "text/plain" : "application/json", size: mode === "size" ? f.bytes.length + 1 : f.bytes.length });
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });

  it("does not follow params references; oversized/no-ref truncation requests repair", async () => {
    const f = fixture(); f.params._cutexFullText = f.descriptor; delete f.message._cutexFullText;
    expect(fullTextReference(f.envelope)).toBeNull();
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull(); expect(f.read).not.toHaveBeenCalled();
    delete f.params._cutexFullText;
    f.message._cutexTruncated = { ...marker, fullTextUnavailable: "blob_size_limit", repair: "thread/read" };
    expect(hasFullTextCompletion(f.envelope)).toBe(true);
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });
  it("passes ordinary full events through; non-completion is never hydrated", async () => {
    const f = fixture(); delete f.message._cutexFullText; delete f.message._cutexTruncated; delete f.params._cutexTruncated;
    expect(hasFullTextCompletion(f.envelope)).toBe(true);
    expect(await hydrateFullText(f.envelope, f.read)).toBe(f.envelope);
    f.message.method = "item/started"; f.message._cutexFullText = f.descriptor;
    expect(hasFullTextCompletion(f.envelope)).toBe(false); expect(fullTextReference(f.envelope)).toBeNull();
    expect(await hydrateFullText(f.envelope, f.read)).toBe(f.envelope); expect(f.read).not.toHaveBeenCalled();
  });
  it("detects truncation even when the inline item is absent", async () => {
    const f = fixture(); delete f.params.item;
    expect(hasFullTextCompletion(f.envelope)).toBe(true);
    expect(await hydrateFullText(f.envelope, f.read)).toBeNull();
  });
});
