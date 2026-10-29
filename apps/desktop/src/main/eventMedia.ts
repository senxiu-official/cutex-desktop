// r258 event blobs (design 051): preserve bounded authenticated descriptors through live IPC.
// Old hosts may still embed multi-megabyte generated-image results; drop those legacy payloads
// before duplicating them across host/session feeds. Paths, prompts, lifecycle IDs and status stay.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { MAX_EVENT_MEDIA_BYTES, mediaUnavailable, parseCutexBlobRef, parseCutexMediaRef, parseMediaBlob } from "../shared/mediaBlobs";
import type { HistoryMediaExpected, HistoryMediaPayload, ImageActionInput } from "../shared/ipc";

/** A generated image's `result` longer than this (as history-media-refs' INLINE_MAX) is dropped. */
export const LIVE_IMAGE_INLINE_MAX = 64 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** `item` without its big generated image (`resultOmittedBytes` = how long it was); the same object otherwise. */
function lightItem(item: unknown): unknown {
  if (!isObject(item) || item.type !== "imageGeneration") return item;
  const result = item.result;
  if (typeof result !== "string" || result.length <= LIVE_IMAGE_INLINE_MAX) return item;
  return { ...item, result: "", resultOmittedBytes: result.length };
}

/**
 * Canonical bounded descriptors survive in any native image field. Legacy large generated-image
 * strings are omitted; ordinary events retain object identity when no media metadata changes.
 */
export function withoutLiveImages(envelope: EventEnvelope): EventEnvelope {
  const message = envelope.native?.message;
  const params = message?.params;
  if (!message || !isObject(params)) return envelope;
  let nodes = 0;
  function clean(value: unknown, depth = 0): unknown {
    // Traverse bounded native JSON without copying unchanged legacy values.
    if (++nodes > 20_000 || depth > 64) return value;
    if (Array.isArray(value)) {
      const next = value.map(child => clean(child, depth + 1));
      return next.some((child, i) => child !== value[i]) ? next : value;
    }
    if (!isObject(value)) return value;
    if (value.type === "cutexBlob") {
      const blob = parseMediaBlob(value);
      const ref = blob && parseCutexBlobRef(blob.url);
      if (!blob || (envelope.cutexSessionId && ref?.sessionId !== envelope.cutexSessionId))
        return { type: "imageNotLoaded", reason: "invalid_blob_reference" };
      return blob;
    }
    if (value.type === "imageNotLoaded") return mediaUnavailable(value);
    const item = lightItem(value) as Json;
    let next: Json | undefined = item !== value ? item : undefined;
    for (const [key, child] of Object.entries(item)) {
      const result = clean(child, depth + 1);
      if (result !== child) { next ??= { ...item }; next[key] = result; }
    }
    return next ?? value;
  }
  const lighter = clean(params) as Json;
  if (lighter === params) return envelope;
  return { ...envelope, native: { ...envelope.native!, message: { ...message, params: lighter } } };
}

/** Fixed session route inputs, never a renderer-supplied URL, path or request options. */
export function mediaReadRequest(sessionId: unknown, sha256: unknown, expected?: unknown): {
  sessionId: string; sha256: string; expected?: HistoryMediaExpected;
} {
  const ref = typeof sessionId === "string" && typeof sha256 === "string"
    ? parseCutexMediaRef(`cutex-media:${sessionId}/${sha256}`) : null;
  if (!ref) throw new Error("invalid_media_reference");
  if (expected === undefined) return ref;
  if (!isObject(expected) || Object.keys(expected).some(key => key !== "mime" && key !== "size")) throw new Error("invalid_media_reference");
  const blob = parseMediaBlob({ type: "cutexBlob", blobId: ref.sha256, sha256: ref.sha256,
    url: `cutex-blob:${ref.sessionId}/${ref.sha256}`, mime: expected.mime, size: expected.size });
  if (!blob) throw new Error("invalid_media_reference");
  return { ...ref, expected: { mime: blob.mime, size: blob.size } };
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
function imageMimeMatches(bytes: Uint8Array, mime: string): boolean {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  if (mime === "image/png") return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(head.subarray(0, 6).toString("ascii"));
  if (mime === "image/webp") return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
  return mime === "image/bmp" && head[0] === 66 && head[1] === 77;
}

function inlineImage(dataUrl: unknown): { bytes: Uint8Array; mime: string } {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_EVENT_MEDIA_BYTES * 4 / 3 + 128) throw new Error("image_unavailable");
  const match = /^data:(image\/(?:png|jpeg|gif|webp|bmp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2]!.length % 4 !== 0) throw new Error("image_unavailable");
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > MAX_EVENT_MEDIA_BYTES || bytes.toString("base64") !== match[2] || !imageMimeMatches(bytes, match[1]!)) throw new Error("image_unavailable");
  return { bytes, mime: match[1]! };
}

/** Bounded image bytes for explicit copy/save; the only output filename is a fixed extension. */
export async function imageActionBytes(input: ImageActionInput,
  read: (sessionId: string, sha256: string, expected?: HistoryMediaExpected, blob?: boolean) => Promise<HistoryMediaPayload | null>,
): Promise<{ bytes: Uint8Array; mime: string; extension: string }> {
  if (!isObject(input)) throw new Error("invalid_image_action");
  if (input.kind === "inline") {
    if (Object.keys(input).some(key => key !== "kind" && key !== "dataUrl")) throw new Error("invalid_image_action");
    const image = inlineImage(input.dataUrl);
    return { ...image, extension: IMAGE_EXTENSIONS[image.mime]! };
  }
  if ((input.kind !== "media" && input.kind !== "blob") || Object.keys(input).some(key => !["kind", "sessionId", "sha256", "mime", "size"].includes(key))) throw new Error("invalid_image_action");
  if (input.mime !== undefined && !IMAGE_EXTENSIONS[input.mime]) throw new Error("unsupported_image_type");
  if (input.size !== undefined && (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_EVENT_MEDIA_BYTES)) throw new Error("image_unavailable");
  const ref = mediaReadRequest(input.sessionId, input.sha256,
    input.mime !== undefined && input.size !== undefined ? { mime: input.mime, size: input.size } : undefined);
  const value = await read(ref.sessionId, ref.sha256, ref.expected, input.kind === "blob");
  if (!value) throw new Error("image_unavailable");
  const image = "bytes" in value ? value : inlineImage(value.dataUrl);
  if (!(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > MAX_EVENT_MEDIA_BYTES || !IMAGE_EXTENSIONS[image.mime] || !imageMimeMatches(image.bytes, image.mime)
    || (input.mime !== undefined && image.mime !== input.mime) || (input.size !== undefined && image.bytes.length !== input.size)) throw new Error("image_unavailable");
  return { bytes: image.bytes, mime: image.mime, extension: IMAGE_EXTENSIONS[image.mime]! };
}
