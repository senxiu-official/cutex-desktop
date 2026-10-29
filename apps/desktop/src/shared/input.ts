// Composer input items (cute-codex UserInput) shared by main (validation before forwarding) and
// the renderer (building them). Pure, unit-tested.
import { MAX_IMAGE_BYTES, type ExtraInput } from "./ipc";
import { mediaRecord, mediaUnavailable, parseCutexMediaRef, parseCutexBlobRef, parseMediaBlob, type MediaBlobDescriptor } from "./mediaBlobs";

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+=*$/;

/** Decoded byte size of a base64 data: URL. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Keep only well-formed, size-capped items; anything else the renderer sends is dropped. */
export function sanitizeExtraInput(extra: readonly unknown[]): ExtraInput[] {
  const out: ExtraInput[] = [];
  for (const raw of extra.slice(0, 20)) {
    const x = raw as Record<string, unknown> | null;
    if (!x || typeof x !== "object") continue;
    if (x.type === "image" && typeof x.url === "string" && ((DATA_IMAGE.test(x.url) && dataUrlBytes(x.url) <= MAX_IMAGE_BYTES) || parseCutexMediaRef(x.url) || parseCutexBlobRef(x.url))) out.push({ type: "image", url: x.url });
    else if (x.type === "localImage" && typeof x.path === "string" && x.path.length > 0 && x.path.length < 4096) out.push({ type: "localImage", path: x.path });
    else if ((x.type === "skill" || x.type === "mention") && typeof x.name === "string" && typeof x.path === "string") out.push({ type: x.type, name: x.name, path: x.path });
  }
  return out;
}

/** An image the composer holds until send: pasted / dropped (data URL) or picked (local path). */
export interface DraftImage {
  id: string;
  name: string;
  /** Thumbnail source (data URL). */
  preview: string | null;
  /** Returned by this desktop's picker; restored host attachments omit this. */
  pickedLocally?: boolean;
  source: { kind: "data"; url: string } | { kind: "path"; path: string };
}

export function imageInputItems(images: readonly DraftImage[]): ExtraInput[] {
  return images.map((img) => (img.source.kind === "data" ? { type: "image", url: img.source.url } : { type: "localImage", path: img.source.path }));
}

/** User-message image parts for display: data URLs render, host paths are read through cutex (components/ImageThumbs). */
export type MessageImage = { kind: "url"; url: string } | { kind: "path"; path: string; /** Display-only receipt encoded by cutex's fixed text marker. */ delivery?: "pathText" }
  | { kind: "blob"; blob: MediaBlobDescriptor } | { kind: "unavailable"; mime?: string; size?: number; reason?: string };

/** Decode a media value at an already-known image field; never mine arbitrary text for URLs. */
export function messageImage(value: unknown, mime?: unknown): MessageImage | null {
  const blob = parseMediaBlob(value);
  if (blob) return { kind: "blob", blob };
  const unavailable = mediaUnavailable(value);
  if (unavailable || (mediaRecord(value) && value.type === "cutexBlob")) return { kind: "unavailable",
    ...(typeof mime === "string" ? { mime } : {}), ...(unavailable?.mime ? { mime: unavailable.mime } : {}),
    ...(unavailable?.size !== undefined ? { size: unavailable.size } : {}), reason: unavailable?.reason ?? "invalid_blob_reference" };
  if (typeof value === "string" && value) return { kind: "url", url: value };
  return null;
}

export function messageImages(content: readonly { type: string; url?: unknown; path?: unknown }[]): MessageImage[] {
  const out: MessageImage[] = [];
  for (const part of content) {
    if (part.type === "image") { const image = messageImage(part.url); if (image) out.push(image); }
    else if (part.type === "imageNotLoaded" || part.type === "cutexBlob") { const image = messageImage(part); if (image) out.push(image); }
    else if (part.type === "localImage" && typeof part.path === "string") out.push({ kind: "path", path: part.path });
  }
  return out;
}

export type MessageSkill = { name: string; path: string };

/** Skill parts of a user message. */
export function messageSkills(content: readonly { type: string; name?: unknown; path?: unknown }[]): MessageSkill[] {
  return content.flatMap((part) => (part.type === "skill" && typeof part.name === "string" && typeof part.path === "string" ? [{ name: part.name, path: part.path }] : []));
}

/**
 * A sent message's images and skills as the input items it was sent with (编辑并重发 puts them back in
 * the composer): the data URL / host path cutex already holds, so a resend reads nothing local.
 */
export function messageInputItems(images: readonly MessageImage[] = [], skills: readonly MessageSkill[] = []): ExtraInput[] {
  return [
    ...images.flatMap((img): ExtraInput[] => img.kind === "unavailable" ? [] : img.kind === "path" ? [{ type: "localImage", path: img.path }]
      : [{ type: "image", url: img.kind === "blob" ? img.blob.url : img.url }]),
    ...skills.map((s): ExtraInput => ({ type: "skill", name: s.name, path: s.path })),
  ];
}

/** A composer image shown as a thumbnail: its preview, else its data URL, else its (host) path. */
export function draftMessageImage(img: DraftImage): MessageImage {
  if (img.preview) return { kind: "url", url: img.preview };
  return img.source.kind === "data" ? { kind: "url", url: img.source.url } : { kind: "path", path: img.source.path };
}

/**
 * Which composer items main uploads to the host (`POST /v2/sessions/{id}/attachments`, then sends
 * `localImage` with the returned path) before a submit: `path` = a local file the user picked (only
 * those: the renderer cannot make main read arbitrary files), `data` = a pasted / dropped data: URL,
 * null = sent as is. Inline images always upload so event normalization cannot change
 * image.url into a blob object inside typed management receipts. A remote host uploads picked files
 * (its disk is not ours); a non-owner connection
 * (users-p2-access) uploads every image, because cutex accepts a non-owner's image input only as an
 * attachment that same device uploaded to that session (403 attachment_not_owned / input_type_not_allowed).
 */
export function uploadKind(item: ExtraInput, ctx: { remote: boolean; restricted: boolean; picked: (path: string) => boolean }): "path" | "data" | null {
  if (item.type === "localImage") return (ctx.remote || ctx.restricted) && ctx.picked(item.path) ? "path" : null;
  if (item.type === "image") return "data";
  return null;
}

/** The bytes and type of a data: image URL main may upload (cutex attachments: png / jpeg / gif / webp; main converts BMP to PNG); null otherwise. */
export function dataUrlImage(url: string): { mime: string; base64: string } | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp|bmp));base64,([A-Za-z0-9+/]+=*)$/.exec(url);
  return m ? { mime: m[1]!, base64: m[2]! } : null;
}
