// Composer input items (cute-codex UserInput) shared by main (validation before forwarding) and
// the renderer (building them). Pure, unit-tested.
import { MAX_IMAGE_BYTES, type ExtraInput } from "./ipc";

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
    if (x.type === "image" && typeof x.url === "string" && DATA_IMAGE.test(x.url) && dataUrlBytes(x.url) <= MAX_IMAGE_BYTES) out.push({ type: "image", url: x.url });
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
  source: { kind: "data"; url: string } | { kind: "path"; path: string };
}

export function imageInputItems(images: readonly DraftImage[]): ExtraInput[] {
  return images.map((img) => (img.source.kind === "data" ? { type: "image", url: img.source.url } : { type: "localImage", path: img.source.path }));
}

/** User-message image parts for display: data URLs render, local paths show as a file chip. */
export type MessageImage = { kind: "url"; url: string } | { kind: "path"; path: string };

export function messageImages(content: readonly { type: string; url?: unknown; path?: unknown }[]): MessageImage[] {
  const out: MessageImage[] = [];
  for (const part of content) {
    if (part.type === "image" && typeof part.url === "string") out.push({ kind: "url", url: part.url });
    else if (part.type === "localImage" && typeof part.path === "string") out.push({ kind: "path", path: part.path });
  }
  return out;
}

/**
 * Which composer items main uploads to the host (`POST /v2/sessions/{id}/attachments`, then sends
 * `localImage` with the returned path) before a submit: `path` = a local file the user picked (only
 * those: the renderer cannot make main read arbitrary files), `data` = a pasted / dropped data: URL,
 * null = sent as is. A remote host uploads picked files (its disk is not ours); a non-owner connection
 * (users-p2-access) uploads every image, because cutex accepts a non-owner's image input only as an
 * attachment that same device uploaded to that session (403 attachment_not_owned / input_type_not_allowed).
 */
export function uploadKind(item: ExtraInput, ctx: { remote: boolean; restricted: boolean; picked: (path: string) => boolean }): "path" | "data" | null {
  if (item.type === "localImage") return (ctx.remote || ctx.restricted) && ctx.picked(item.path) ? "path" : null;
  if (item.type === "image") return ctx.restricted ? "data" : null;
  return null;
}

/** The bytes and type of a data: image URL main may upload (cutex attachments: png / jpeg / gif / webp); null otherwise. */
export function dataUrlImage(url: string): { mime: string; base64: string } | null {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(url);
  return m ? { mime: m[1]!, base64: m[2]! } : null;
}
