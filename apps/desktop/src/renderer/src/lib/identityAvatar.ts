// The avatar this desktop publishes for 「你」 (cutex `users-self-profile`): the local picture
// (lib/identityPrefs, already a 128×128 WebP from the cropper) as `{contentType, data}`, re-encoded
// smaller only when it is over cutex's 48 KiB limit, and its ETag — the first 8 bytes of the image's
// SHA-256, exactly how cutex names it — so the desktop can tell whether a host already has it.
import { AVATAR_MAX_BYTES, type AvatarUpload } from "../../../shared/users";

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/;
/** Square side of a published avatar (cutex accepts 16..=512). */
export const PUBLISHED_AVATAR_PX = 128;

/** Decoded byte length of a base64 string. */
export function base64Bytes(data: string): number {
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}

/** `{contentType, data}` of a picture data URL (null: not an image data URL cutex accepts). */
export function splitDataUrl(url: string): AvatarUpload | null {
  const m = DATA_URL.exec(url);
  return m ? { contentType: m[1] as AvatarUpload["contentType"], data: m[2]! } : null;
}

function bytesOf(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** cutex's ETag of an image: hex of the first 8 bytes of its SHA-256. */
export async function avatarEtag(upload: AvatarUpload): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(upload.data)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Re-encode at PUBLISHED_AVATAR_PX, lowering the quality until it fits (browser only). */
async function shrink(url: string): Promise<AvatarUpload | null> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PUBLISHED_AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PUBLISHED_AVATAR_PX, PUBLISHED_AVATAR_PX);
  for (const [type, quality] of [["image/webp", 0.85], ["image/webp", 0.6], ["image/jpeg", 0.8], ["image/jpeg", 0.5]] as const) {
    const upload = splitDataUrl(canvas.toDataURL(type, quality));
    if (upload && base64Bytes(upload.data) <= AVATAR_MAX_BYTES) return upload;
  }
  return null;
}

export interface PreparedAvatar {
  upload: AvatarUpload;
  etag: string;
}

const prepared = new Map<string, Promise<PreparedAvatar | null>>();

/**
 * The upload + ETag of a local picture (cached per picture, so the ETag is stable for the run): the
 * picture itself when it fits, else (or with `reencode`, after cutex refused it) a smaller
 * PUBLISHED_AVATAR_PX re-encoding. null: the picture cannot be published.
 */
export function prepareAvatar(picture: string, options: { reencode?: boolean } = {}): Promise<PreparedAvatar | null> {
  const key = `${options.reencode ? "r" : "d"}|${picture}`;
  let found = prepared.get(key);
  if (!found) {
    found = (async () => {
      const direct = options.reencode ? null : splitDataUrl(picture);
      const upload = direct && base64Bytes(direct.data) <= AVATAR_MAX_BYTES ? direct : await shrink(picture).catch(() => null);
      return upload ? { upload, etag: await avatarEtag(upload) } : null;
    })();
    // Only the current picture matters (both encodings of it).
    for (const k of [...prepared.keys()]) if (!k.endsWith(`|${picture}`)) prepared.delete(k);
    prepared.set(key, found);
  }
  return found;
}
