import { expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { withoutLiveImages } from "../src/main/eventMedia";
import { MAX_EVENT_MEDIA_BYTES } from "../src/shared/mediaBlobs";

const sha = "a".repeat(64);
const blob = () => ({ type: "cutexBlob", blobId: sha, sha256: sha, mime: "image/png", size: 50000, url: `cutex-blob:cutex.s1/${sha}` });
const envelope = (params: unknown) => ({ eventId: "e1", cursor: "c1", cutexSessionId: "cutex.s1", correlation: { turnId: "t1" },
  native: { kind: "notification", message: { method: "item/completed", params } } }) as unknown as EventEnvelope;
const params = (event: EventEnvelope) => event.native!.message.params as Record<string, any>;

it("preserves canonical descriptors in generation, tool blocks and turn snapshots without inline bytes", () => {
  const event = envelope({ item: { type: "imageGeneration", result: blob(), savedPath: "/host/out.png" },
    turn: { id: "t1", items: [{ type: "mcpToolCall", result: { content: [{ type: "image", data: blob() }] } }] } });
  const result = withoutLiveImages(event), value = params(result);
  expect(value.item.result).toEqual(blob());
  expect(value.item.savedPath).toBe("/host/out.png");
  expect(value.turn.items[0].result.content[0].data).toEqual(blob());
  expect(result).toMatchObject({ eventId: "e1", cursor: "c1", correlation: { turnId: "t1" } });
  expect(params(event).item.result).toEqual(blob());
});

it("drops arbitrary descriptor extras before IPC rather than retaining a hidden large string", () => {
  const descriptor = { ...blob(), extra: "A".repeat(2 * 1024 * 1024) };
  const result = withoutLiveImages(envelope({ item: { type: "imageGeneration", result: descriptor } }));
  expect(params(result).item.result).toEqual(blob());
  expect(JSON.stringify(result).length).toBeLessThan(1000);
  expect(descriptor.extra.length).toBe(2 * 1024 * 1024);
});

it.each([
  { size: MAX_EVENT_MEDIA_BYTES + 1 }, { size: -1 }, { size: 0.5 }, { blobId: "b".repeat(64) },
  { sha256: "A".repeat(64) }, { url: `cutex-blob:cutex.other/${sha}` },
  { url: `cutex-media:cutex.s1/${sha}` }, { url: `https://example.invalid/${sha}` }, { mime: "image/png\r\nX: bad" },
])("turns malformed/foreign references into unavailable media (%j)", patch => {
  const event = envelope({ item: { type: "imageGeneration", result: { ...blob(), ...patch } } });
  expect(params(withoutLiveImages(event)).item.result).toEqual({ type: "imageNotLoaded", reason: "invalid_blob_reference" });
});

it("bounds unavailable metadata without dropping its unavailable state", () => {
  const event = envelope({ item: { type: "image", data: { type: "imageNotLoaded", reason: "invalid_blob_reference", extra: "A".repeat(100000) } } });
  expect(params(withoutLiveImages(event)).item.data).toEqual({ type: "imageNotLoaded", reason: "invalid_blob_reference" });
});
