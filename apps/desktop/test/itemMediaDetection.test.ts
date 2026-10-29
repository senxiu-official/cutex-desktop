// itemMedia no longer scans every character of a long base64 image (image-heavy fix 2026-10-26): the same
// images come out of every shape it reads, compared with the previous full-scan implementation.
import { describe, expect, it } from "vitest";
import { messageImage, type MessageImage } from "../src/shared/input";
import { eventMediaNotice, MAX_EVENT_MEDIA_BYTES, mediaRecord, parseMediaBlob } from "../src/shared/mediaBlobs";
import { base64Like, itemMedia } from "../src/renderer/src/lib/itemMedia";

// The implementation before the fix, verbatim apart from names (full-string BASE64 regex, no memo).
const IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp|bmp|avif)$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
function previousItemMedia(item: Record<string, unknown>): { images: MessageImage[]; truncated: boolean } {
  const images: MessageImage[] = [], seen = new Set<string>();
  let truncated = false, remaining = 128;
  const add = (value: unknown, mime: unknown = "image/png", base64 = false) => {
    if (images.length >= 12) return;
    const blob = parseMediaBlob(value);
    let image: MessageImage | null;
    if (blob && !IMAGE_MIME.test(blob.mime)) image = { kind: "unavailable", mime: blob.mime, size: blob.size, reason: "unsupported_media" };
    else if (base64 && typeof value === "string" && !value.startsWith("data:") && !value.startsWith("cutex-media:") && !value.startsWith("cutex-blob:")) {
      image = value.length > MAX_EVENT_MEDIA_BYTES * 4 / 3 + 4 ? { kind: "unavailable", mime: typeof mime === "string" ? mime : undefined, size: Math.floor(value.length * 3 / 4), reason: "blob_size_limit" }
        : typeof mime === "string" && IMAGE_MIME.test(mime) && BASE64.test(value) ? { kind: "url", url: `data:${mime};base64,${value}` } : null;
    } else image = messageImage(value, mime);
    if (!image) return;
    const key = image.kind === "blob" ? image.blob.url : image.kind === "url" ? image.url : image.kind === "path" ? image.path : `unavailable:${JSON.stringify([image.mime, image.size, image.reason])}`;
    if (!seen.has(key)) { seen.add(key); images.push(image); }
  };
  const walk = (value: unknown, depth: number) => {
    if (depth > 8 || --remaining < 0 || images.length >= 12) return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 32)) walk(child, depth + 1); return; }
    if (!mediaRecord(value)) return;
    truncated ||= eventMediaNotice(value);
    if (value.type === "cutexBlob" || value.type === "imageNotLoaded") { add(value); return; }
    const mime = value.mimeType ?? value.mime ?? "image/png";
    if (value.type === "image") add(value.data ?? value.url, mime, true);
    if (value.type === "inputImage") add(value.imageUrl ?? value.url, mime);
    if (value.type === "imageGeneration") {
      add(value.result, mime, true);
      if (!images.length && typeof value.savedPath === "string" && value.savedPath) images.push({ kind: "path", path: value.savedPath });
      else if (!images.length && typeof value.resultOmittedBytes === "number") images.push({ kind: "unavailable", reason: "event_size_limit" });
    }
    for (const key of ["base64", "b64_json", "image_base64", "imageData"]) if (key in value) add(value[key], mime, true);
    for (const key of ["content", "contentItems", "result", "results", "output", "images", "data"]) {
      const child = value[key];
      if (child && typeof child === "object") walk(child, depth + 1);
    }
  };
  walk(item, 0);
  return { images, truncated };
}

const hash = "c".repeat(64);
const blob = (patch: Record<string, unknown> = {}) => ({ type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/jpeg", size: 700000, width: 1024, height: 1024, url: `cutex-blob:cutex.a/${hash}`, ...patch });
// Long, valid base64 (≈ a 1 MB image) and variants broken where the sampled check still looks.
const big = Buffer.from(Uint8Array.from({ length: 750_000 }, (_, i) => (i * 131 + 7) & 255)).toString("base64");
const small = Buffer.from("tiny png bytes").toString("base64");
const at = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i + 1);
const tooBig = "A".repeat(Math.ceil(MAX_EVENT_MEDIA_BYTES * 4 / 3) + 8);

const corpus: [string, Record<string, unknown>][] = [
  ["mcp raw base64 (long)", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/jpeg", data: big }] } }],
  ["mcp raw base64 (short)", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: small }] } }],
  ["mcp data URL", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: `data:image/png;base64,${big}` }] } }],
  ["mcp blob ref", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/jpeg", data: blob() }] } }],
  ["mcp non-image mime", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "text/plain", data: small }] } }],
  ["mcp bad head", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: at(big, 0, "!") }] } }],
  ["mcp bad tail", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: big + "#" }] } }],
  ["mcp short with a bad middle", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: at(small, 5, "-") }] } }],
  ["mcp padding", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: big.slice(0, -4) + "AA==" }] } }],
  ["mcp over the size limit", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: tooBig }] } }],
  ["generated raw base64", { type: "imageGeneration", result: big }],
  ["generated blob", { type: "imageGeneration", result: blob(), savedPath: "/host/a.png" }],
  ["generated omitted", { type: "imageGeneration", result: "", resultOmittedBytes: 900000 }],
  ["generated saved path", { type: "imageGeneration", result: "", savedPath: "/host/old.png" }],
  ["generated not loaded", { type: "imageGeneration", result: { type: "imageNotLoaded", reason: "blob_size_limit", mime: "image/png", size: 40000000 } }],
  ["inputImage data URL", { type: "dynamicToolCall", contentItems: [{ type: "inputImage", imageUrl: `data:image/png;base64,${small}` }] }],
  ["inputImage blob", { type: "dynamicToolCall", contentItems: [{ type: "inputImage", imageUrl: blob() }] }],
  ["inputImage cutex-media", { type: "dynamicToolCall", contentItems: [{ type: "inputImage", imageUrl: `cutex-media:cutex.a/${hash}` }] }],
  ["b64_json / imageData", { type: "tool", result: { images: [{ b64_json: big }, { imageData: small, mime: "image/webp" }] } }],
  ["blob of another type", { type: "imageGeneration", result: blob({ mime: "audio/wav" }) }],
  ["truncated marker", { type: "mcpToolCall", _cutexTruncated: { reason: "event_size_limit", resyncRequired: true }, result: { content: [] } }],
  ["tool text is not media", { type: "mcpToolCall", result: { content: [{ type: "text", text: big }] } }],
  ["duplicates", { type: "mcpToolCall", result: { content: [{ type: "image", mimeType: "image/png", data: big }, { type: "image", mimeType: "image/png", data: big }] } }],
];

describe("itemMedia detection", () => {
  it.each(corpus)("%s: same images as the full scan", (_name, item) => {
    expect(itemMedia(structuredClone(item))).toEqual(previousItemMedia(item));
  });

  it("base64Like matches the full regex on short values and on breaks at the head, tail and samples", () => {
    for (const v of [small, "", "=", "YWJj", "YWJj=", "YWJj===", "YW Jj", "YWJj\n", at(small, 3, "_")]) expect(base64Like(v)).toBe(BASE64.test(v));
    for (const v of [big, big + "=", big + "==", at(big, 0, "*"), big + "===", big + "\n", at(big, big.length - 100, "~")]) expect(base64Like(v)).toBe(BASE64.test(v));
  });

  it("a long value broken only between samples now passes (its thumbnail then fails to decode)", () => {
    const broken = at(big, 300_000 + 5000, "*");
    expect(BASE64.test(broken)).toBe(false);
    expect(base64Like(broken)).toBe(true);
  });

  it("reads each item once (memo by object)", () => {
    const item = { type: "imageGeneration", result: big };
    expect(itemMedia(item)).toBe(itemMedia(item));
  });
});
