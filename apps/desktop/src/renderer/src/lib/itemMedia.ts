import { messageImage, type MessageImage } from "../../../shared/input";
import { eventMediaNotice, MAX_EVENT_MEDIA_BYTES, mediaRecord, parseMediaBlob } from "../../../shared/mediaBlobs";

const IMAGE_MIME = /^image\/(?:png|jpe?g|gif|webp|bmp|avif)$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_CHUNK = /^[A-Za-z0-9+/]*$/;
const FULL_CHECK_MAX = 64 * 1024, SAMPLES = 32, SAMPLE = 256;
const memo = new WeakMap<object, { images: MessageImage[]; truncated: boolean }>();

/**
 * Whether a known media field holds plain base64: all of a short value; the tail (with its padding), the head
 * and evenly spaced samples of a long one. A full scan of a ~1 MB image took ~3.5 ms, for every inline image
 * of a conversation on open (image-heavy measurement 2026-10-26). A long value corrupted only between the
 * samples is no longer dropped here: its thumbnail fails to decode and shows as failed.
 */
export function base64Like(value: string): boolean {
  if (value.length <= FULL_CHECK_MAX) return BASE64.test(value);
  if (!BASE64.test(value.slice(-SAMPLE))) return false;
  const step = Math.floor((value.length - SAMPLE) / SAMPLES);
  for (let i = 0; i < SAMPLES; i++) if (!BASE64_CHUNK.test(value.slice(i * step, i * step + SAMPLE))) return false;
  return true;
}

/** Only known media fields and structured result containers; never interpret tool text as image data. */
export function itemMedia(item: Record<string, unknown>): { images: MessageImage[]; truncated: boolean } {
  const cached = memo.get(item); if (cached) return cached;
  const images: MessageImage[] = [], seen = new Set<string>();
  let truncated = false, remaining = 128;
  const add = (value: unknown, mime: unknown = "image/png", base64 = false) => {
    if (images.length >= 12) return;
    const blob = parseMediaBlob(value);
    let image: MessageImage | null;
    if (blob && !IMAGE_MIME.test(blob.mime)) image = { kind: "unavailable", mime: blob.mime, size: blob.size, reason: "unsupported_media" };
    else if (base64 && typeof value === "string" && !value.startsWith("data:") && !value.startsWith("cutex-media:") && !value.startsWith("cutex-blob:")) {
      image = value.length > MAX_EVENT_MEDIA_BYTES * 4 / 3 + 4 ? { kind: "unavailable", mime: typeof mime === "string" ? mime : undefined, size: Math.floor(value.length * 3 / 4), reason: "blob_size_limit" }
        : typeof mime === "string" && IMAGE_MIME.test(mime) && base64Like(value) ? { kind: "url", url: `data:${mime};base64,${value}` } : null;
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
  const result = { images, truncated }; memo.set(item, result); return result;
}
