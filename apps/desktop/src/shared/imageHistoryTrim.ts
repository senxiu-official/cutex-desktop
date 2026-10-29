// Codex profiles: keep only the newest generated images in the model request (cutex
// `profile-image-history-trim`, docs/design/027 option C). When an agent's history holds more than
// `maxInline` generated images, at the start of a turn all but the newest `keep` are replaced, in what
// is sent to the model, by a one-line note with the image's saved file path. `null` = off (default).

export const IMAGE_HISTORY_TRIM_FEATURE = "profile-image-history-trim";

export interface ImageHistoryTrim {
  maxInline: number;
  keep: number;
}

/** Turning it on starts from these (cutex's defaults). */
export const DEFAULT_IMAGE_HISTORY_TRIM: ImageHistoryTrim = { maxInline: 20, keep: 5 };
export const KEEP_MIN = 1;
export const KEEP_MAX = 50;
export const MAX_INLINE_MAX = 500;

/** cutex's ranges: keep 1..50, maxInline keep+1..500, both integers. */
export function validImageHistoryTrim(v: ImageHistoryTrim): boolean {
  return Number.isInteger(v.keep) && v.keep >= KEEP_MIN && v.keep <= KEEP_MAX && Number.isInteger(v.maxInline) && v.maxInline > v.keep && v.maxInline <= MAX_INLINE_MAX;
}

/** What the owner typed into the two inputs → the PATCH value, or null when it is not valid. */
export function parseImageHistoryTrim(fields: { maxInline: string; keep: string }): ImageHistoryTrim | null {
  const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const v = { maxInline: int(fields.maxInline), keep: int(fields.keep) };
  return validImageHistoryTrim(v) ? v : null;
}

/** A stored value from cutex; anything malformed reads as off. */
export function imageHistoryTrimOf(raw: unknown): ImageHistoryTrim | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.maxInline !== "number" || typeof r.keep !== "number") return null;
  const v = { maxInline: r.maxInline, keep: r.keep };
  return validImageHistoryTrim(v) ? v : null;
}

export const sameImageHistoryTrim = (a: ImageHistoryTrim | null, b: ImageHistoryTrim | null): boolean => (a === null || b === null ? a === b : a.maxInline === b.maxInline && a.keep === b.keep);
