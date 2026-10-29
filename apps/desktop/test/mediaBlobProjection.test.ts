import { expect, it } from "vitest";
import { MAX_EVENT_MEDIA_BYTES, mediaUnavailable, parseCutexBlobRef, parseCutexMediaRef, parseMediaBlob } from "../src/shared/mediaBlobs";
import { messageImages, messageInputItems, sanitizeExtraInput } from "../src/shared/input";
import { itemMedia } from "../src/renderer/src/lib/itemMedia";
import { applyEvent, emptyTimeline, entryFromItem, orderedEntries } from "../src/renderer/src/lib/timeline";
import type { EventEnvelope } from "@cutex-desktop/protocol";

const hash = "a".repeat(64);
const blob = (patch: Record<string, unknown> = {}) => ({ type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: 40000, url: `cutex-blob:cutex.a/${hash}`, ...patch });
const event = (method: string, params: Record<string, unknown>, truncated = true) => ({ streamId: "stream", eventId: "event", receivedAt: "2026-10-24T00:00:00Z", native: {
  kind: "notification", message: { method, params, ...(truncated ? { _cutexTruncated: { reason: "event_size_limit", resyncRequired: true } } : {}) },
} }) as unknown as EventEnvelope;

it("accepts a bounded 051 descriptor and keeps blob and legacy media routes distinct", () => {
  expect(parseMediaBlob(blob())).toEqual(blob());
  expect(parseCutexBlobRef(blob().url)).toEqual({ sessionId: "cutex.a", sha256: hash });
  expect(parseCutexMediaRef(blob().url)).toBeNull();
  expect(parseMediaBlob(blob({ url: `cutex-media:cutex.a/${hash}` }))).toBeNull();
  expect(parseCutexMediaRef(`cutex-media:cutex.a/${hash}`)).not.toBeNull();
});
it.each([
  { sha256: "b".repeat(64) }, { blobId: "../private" }, { url: `https://host/${hash}` }, { url: `cutex-blob:../escape/${hash}` },
  { url: `cutex-blob:cutex.a/${hash.toUpperCase()}` }, { size: -1 }, { size: MAX_EVENT_MEDIA_BYTES + 1 }, { size: 1.2 }, { mime: "image/png;script=bad" },
])("rejects incoherent or unbounded blob metadata: %j", patch => { expect(parseMediaBlob(blob(patch))).toBeNull(); });
it("extracts user images without losing inline/path compatibility, and resends only available values", () => {
  const images = messageImages([{ type: "image", url: blob() }, { type: "image", url: "data:image/png;base64,YWJj" },
    { type: "localImage", path: "/host/a.png" }, { type: "image", url: { type: "imageNotLoaded", reason: "blob_size_limit" } }]);
  expect(images.map(image => image.kind)).toEqual(["blob", "url", "path", "unavailable"]);
  const extra = messageInputItems(images);
  expect(extra).toHaveLength(3); expect(sanitizeExtraInput(extra)).toEqual(extra);
  expect(sanitizeExtraInput([{ type: "image", url: `cutex-blob:../../bad/${hash}` }])).toEqual([]);
});
it("keeps unavailable markers bounded and does not display arbitrary reason strings", () => {
  expect(mediaUnavailable({ type: "imageNotLoaded", reason: "secret value", mime: "image/png", size: 50000 })).toEqual({ type: "imageNotLoaded", mime: "image/png", size: 50000 });
  expect(messageImages([{ type: "image", url: blob({ sha256: "bad" }) }])[0]?.kind).toBe("unavailable");
});
it("extracts generated results, MCP image data and dynamic inputImage URLs with bounded deduplication", () => {
  expect(itemMedia({ type: "imageGeneration", result: blob(), savedPath: "/host/generated.png" }).images).toEqual([{ kind: "blob", blob: blob() }]);
  expect(itemMedia({ type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: blob() }, { type: "inputImage", imageUrl: blob() }] } }).images).toHaveLength(1);
  expect(itemMedia({ type: "dynamicToolCall", contentItems: [{ type: "inputImage", imageUrl: blob() }] }).images[0]?.kind).toBe("blob");
  expect(itemMedia({ type: "imageGeneration", result: "YWJj" }).images).toEqual([{ kind: "url", url: "data:image/png;base64,YWJj" }]);
  expect(itemMedia({ type: "tool", result: { images: [{ b64_json: blob() }, { imageData: blob() }] } }).images).toHaveLength(1);
});
it("does not turn text or credentials into image requests and exposes unsupported media as a placeholder", () => {
  expect(itemMedia({ type: "imageGeneration", result: { type: "imageNotLoaded", reason: "blob_size_limit", mime: "image/png", size: 40000000 } }).images).toHaveLength(1);
  expect(itemMedia({ type: "mcpToolCall", result: { content: [{ type: "text", text: JSON.stringify(blob()) }] } }).images).toEqual([]);
  expect(itemMedia({ type: "mcpToolCall", arguments: { imageUrl: "https://secret.example/" } }).images).toEqual([]);
  expect(itemMedia({ type: "imageGeneration", result: blob({ mime: "audio/wav" }) }).images[0]).toMatchObject({ kind: "unavailable", mime: "audio/wav", size: 40000 });
  expect(itemMedia({ type: "imageGeneration", result: "", savedPath: "/host/old.png", resultOmittedBytes: 90000 }).images).toEqual([{ kind: "path", path: "/host/old.png" }]);
});
it("renders truncated native items as a notice instead of treating partial output as complete", () => {
  const entry = entryFromItem({ type: "agentMessage", id: "a", text: "partial", _cutexTruncated: { reason: "event_size_limit" } }, "t");
  expect(entry).toMatchObject({ kind: "notice", media: true, id: "a" });
});
it("keeps lifecycle completion while displaying a quiet notice for a truncated event", () => {
  const state = emptyTimeline();
  applyEvent(state, event("turn/started", { turn: { id: "t", status: "inProgress" } }, false));
  applyEvent(state, event("turn/completed", { turn: { id: "t", status: "completed" } }));
  expect(state.activeTurnId).toBeNull(); expect(state.turns[0]?.status).toBe("completed");
  expect(orderedEntries(state)).toEqual([expect.objectContaining({ kind: "notice", media: true })]);
});
it("does not append truncated deltas or put incomplete server requests in the pending map", () => {
  const state = emptyTimeline();
  expect(applyEvent(state, event("item/agentMessage/delta", { itemId: "a", delta: "partial" }))).toBe(true);
  const request = event("item/commandExecution/requestApproval", { command: "partial" }); request.native!.kind = "serverRequest";
  request.native!.message.id = 1;
  applyEvent(state, request); expect(state.pending.size).toBe(0);
  expect(orderedEntries(state).every(entry => entry.kind === "notice")).toBe(true);
});
