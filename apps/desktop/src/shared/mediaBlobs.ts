/** r258 design 051: durable, authenticated session media, never a public URL or host path. */
export const EVENT_MEDIA_BLOBS_FEATURE = "event-media-blobs";
export const MAX_EVENT_MEDIA_BYTES = 32 * 1024 * 1024;
export interface MediaBlobDescriptor {
  type: "cutexBlob"; blobId: string; mime: string; size: number; sha256: string; url: string;
  /** Optional header hints; neither an authorization input nor proof of successful decoding. */
  width?: number; height?: number;
}
export interface MediaUnavailable {
  type: "imageNotLoaded"; reason?: string; mime?: string; size?: number; fullItemRequired?: boolean;
}
export const mediaRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseCutexMediaRef(value: unknown): { sessionId: string; sha256: string } | null {
  if (typeof value !== "string") return null;
  const match = /^cutex-media:([A-Za-z0-9._:-]{1,200})\/([0-9a-f]{64})$/.exec(value);
  return match && match[1] !== "." && match[1] !== ".." ? { sessionId: match[1]!, sha256: match[2]! } : null;
}
export function parseCutexBlobRef(value: unknown): { sessionId: string; sha256: string } | null {
  if (typeof value !== "string") return null;
  const match = /^cutex-blob:([A-Za-z0-9._:-]{1,200})\/([0-9a-f]{64})$/.exec(value);
  return match && match[1] !== "." && match[1] !== ".." ? { sessionId: match[1]!, sha256: match[2]! } : null;
}
const validMime = (value: unknown): value is string => typeof value === "string" && value.length < 128 && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value);
export function parseMediaBlob(value: unknown): MediaBlobDescriptor | null {
  if (!mediaRecord(value) || value.type !== "cutexBlob") return null;
  const ref = parseCutexBlobRef(value.url);
  if (!ref || value.blobId !== ref.sha256 || value.sha256 !== ref.sha256 || !validMime(value.mime) ||
      !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > MAX_EVENT_MEDIA_BYTES) return null;
  const dimensions = mediaDimensions(value);
  return { type: "cutexBlob", blobId: ref.sha256, sha256: ref.sha256, url: value.url as string, mime: value.mime, size: value.size as number, ...dimensions };
}
/** Ignore malformed optional hints without rejecting an otherwise readable blob. */
export function mediaDimensions(value: { width?: unknown; height?: unknown }): { width: number; height: number } | undefined {
  const pixel = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 0xffffffff;
  return pixel(value.width) && pixel(value.height) ? { width: value.width, height: value.height } : undefined;
}
export function mediaUnavailable(value: unknown): MediaUnavailable | null {
  if (!mediaRecord(value) || value.type !== "imageNotLoaded") return null;
  return { type: "imageNotLoaded", ...(typeof value.reason === "string" && /^[a-z_]{1,64}$/.test(value.reason) ? { reason: value.reason } : {}),
    ...(validMime(value.mime) ? { mime: value.mime } : {}),
    ...(Number.isSafeInteger(value.size) && (value.size as number) >= 0 ? { size: value.size as number } : {}),
    ...(value.fullItemRequired === true ? { fullItemRequired: true } : {}) };
}
/** Notice only; do not pretend a bounded partial native event is complete content. */
export function eventMediaNotice(value: unknown): boolean {
  return mediaRecord(value) && mediaRecord(value._cutexTruncated) && value._cutexTruncated.reason === "event_size_limit";
}
