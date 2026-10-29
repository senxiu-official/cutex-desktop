// 复制图片 for a conversation image (thumbnail menu, the enlarged view's toolbar / menu / Ctrl+C): the bytes go to
// the system clipboard as an image through main (DaemonApi.imageAction "copy": decoded with nativeImage, written
// as image/png). Main decodes PNG / JPEG only, so anything else (WebP, GIF — its first frame —, BMP, unknown) is
// first drawn to PNG here from the src the view already shows (the blob / media / file bytes already read through
// their own paths: no new fetch), then sent as an inline PNG.
import type { ImageActionInput } from "../../../shared/ipc";

/** What main can copy as it is. */
const NATIVE = /^image\/(?:png|jpeg)$/;

export interface CopySource {
  /** The host read of the image (blob / media / inline data URL), when it has one. */
  input: ImageActionInput | null;
  /** Its type when known (blob metadata, the data URL). */
  mime: string | null;
  /** The src the view shows (data: / blob: URL). */
  src: string | null;
}

export interface CopyDeps {
  imageAction(input: ImageActionInput, action: "copy"): Promise<{ status: string }>;
  /** src → a PNG data URL (DOM; tests replace it). */
  toPng?(src: string): Promise<string>;
}

/** The type of a data: URL, else null. */
export function dataUrlMime(src: string | null): string | null {
  return src ? (/^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(src)?.[1]?.toLowerCase() ?? null) : null;
}

/** Copy the image; throws when it cannot (the caller says so). */
export async function copyImage(source: CopySource, deps: CopyDeps): Promise<void> {
  const mime = source.mime ?? dataUrlMime(source.src);
  const input = source.input ?? (source.src && NATIVE.test(dataUrlMime(source.src) ?? "") ? ({ kind: "inline", dataUrl: source.src } as const) : null);
  if (input && (!mime || NATIVE.test(mime))) {
    try {
      await deps.imageAction(input, "copy");
      return;
    } catch (e) {
      // A legacy media ref has no type: it may be a WebP main cannot decode — try the drawn copy.
      if (mime || !source.src) throw e;
    }
  }
  if (!source.src) throw new Error("image_unavailable");
  const png = await (deps.toPng ?? drawPng)(source.src);
  await deps.imageAction({ kind: "inline", dataUrl: png }, "copy");
}

/** Draw `src` (its first frame) to a canvas and read it back as PNG. */
async function drawPng(src: string): Promise<string> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) throw new Error("image_unavailable");
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}
