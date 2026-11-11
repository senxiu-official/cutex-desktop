// An artifact image of any realistic size: read in cutex's content windows (ARTIFACT_WINDOW_BYTES, the route's
// largest), each window decoded once and kept as bytes, then one Blob for an object URL. The base64 text of a window
// is dropped as soon as it is decoded, so the page holds the decoded bytes once (and the Blob made from them).
import { ARTIFACT_WINDOW_BYTES, decodeBase64 } from "./docPreview";
import { imageMimeFor, sniffImageMime } from "./fileKinds";

/** Above this an image waits for 仍然打开 (it is held decoded in memory, and once more by the image decoder). */
export { IMAGE_PREVIEW_PROMPT_BYTES } from "../../../shared/imageCache";

export interface ImageWindow { encoding: "utf8" | "base64"; content: string; truncated: boolean; totalBytes: number; mediaType?: string }

export type WindowedImage =
  | { state: "ready"; blob: Blob; mime: string; size: number }
  | { state: "not-image"; size: number };

const PREVIEW_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml", "image/avif", "image/x-icon"]);

/**
 * Reads `size` bytes from `read(offset, maxBytes)` window by window (`onProgress(read, total)` after each), and makes
 * one Blob of them. `signal` stops between windows. A version that is gone (null) or a window that does not decode
 * throws; bytes that are no image (by type and by their first bytes) are `not-image`.
 */
export async function loadWindowedImage(
  read: (offset: number, maxBytes: number) => Promise<ImageWindow | null>,
  opts: { size: number; mime: string; name: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal; windowBytes?: number },
): Promise<WindowedImage> {
  const windowBytes = opts.windowBytes ?? ARTIFACT_WINDOW_BYTES;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let total = opts.size;
  let mime = imageMimeFor(opts.mime, opts.name);
  let text: string | null = null;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const w = await read(offset, windowBytes);
    if (!w) throw new Error("content unavailable");
    total = w.totalBytes;
    if (w.encoding === "utf8") {
      // SVG (text): one body, at most a few windows.
      text = (text ?? "") + w.content;
      offset += new TextEncoder().encode(w.content).length;
    } else {
      const bytes = decodeBase64(w.content) ?? (w.content === "" ? new Uint8Array() : null);
      if (!bytes) throw new Error("invalid image bytes");
      parts.push(bytes as Uint8Array<ArrayBuffer>);
      offset += bytes.length;
    }
    opts.onProgress?.(Math.min(offset, total), total);
    if (!w.truncated || offset >= total) break;
    if (offset === 0) throw new Error("empty content window");
  }
  if (text !== null) {
    if (!/<svg[\s>]/i.test(text)) return { state: "not-image", size: total };
    return { state: "ready", blob: new Blob([text], { type: "image/svg+xml" }), mime: "image/svg+xml", size: total };
  }
  // A generic / wrong type: the first bytes decide.
  if (!PREVIEW_MIMES.has(mime)) mime = sniffImageMime(headBase64(parts)) ?? mime;
  if (!PREVIEW_MIMES.has(mime)) return { state: "not-image", size: total };
  return { state: "ready", blob: new Blob(parts, { type: mime }), mime, size: total };
}

function headBase64(parts: readonly Uint8Array[]): string {
  const head: number[] = [];
  for (const p of parts) for (const b of p) { if (head.length >= 18) break; head.push(b); }
  return btoa(String.fromCharCode(...head));
}
