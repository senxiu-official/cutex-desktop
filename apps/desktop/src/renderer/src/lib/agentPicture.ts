// Custom icon pictures are device-local, like profile pictures. cutex keeps only the opaque
// icon identifier (within its 64-character limit); clients without the picture show an initial.
import type { SessionAvatar } from "@cutex-desktop/protocol";

const PREFIX = "desktop-picture:";
const KEY = "cutex-desktop.agentPictures.";
const PICTURE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LENGTH = 128 * 1024;
/** The cropper writes AVATAR_PX (128) squares; anything far larger is not ours. */
export const MAX_PICTURE_PX = 512;
/** Source files the cropper will open (it decodes the whole file before cropping). */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SOURCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);

/** Why an uploaded file cannot be used as an avatar, or null if the cropper may open it. */
export function avatarSourceProblem(file: { type: string; size: number }): "type" | "tooLarge" | null {
  if (!SOURCE_TYPES.has(file.type)) return "type";
  return file.size > MAX_SOURCE_BYTES ? "tooLarge" : null;
}

/** Width / height from the image header (PNG IHDR, WebP VP8 / VP8L / VP8X, JPEG SOFn), without
 *  decoding; null when the header is unreadable. */
export function pictureSize(dataUrl: string): { width: number; height: number } | null {
  const comma = dataUrl.indexOf(",");
  let bin: string;
  try { bin = atob(dataUrl.slice(comma + 1, comma + 1 + 64 * 1024)); } catch { return null; }
  const b = (i: number) => bin.charCodeAt(i);
  const u16be = (i: number) => (b(i) << 8) | b(i + 1);
  const u16le = (i: number) => b(i) | (b(i + 1) << 8);
  const u24le = (i: number) => b(i) | (b(i + 1) << 8) | (b(i + 2) << 16);
  const u32be = (i: number) => ((b(i) << 24) >>> 0) + ((b(i + 1) << 16) | (b(i + 2) << 8) | b(i + 3));
  if (bin.startsWith("\x89PNG\r\n\x1a\n") && bin.slice(12, 16) === "IHDR" && bin.length >= 24) return { width: u32be(16), height: u32be(20) };
  if (bin.startsWith("RIFF") && bin.slice(8, 12) === "WEBP" && bin.length >= 30) {
    const chunk = bin.slice(12, 16);
    if (chunk === "VP8 " && u24le(23) === 0x2a019d) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L" && b(20) === 0x2f) {
      const bits = (b(21) | (b(22) << 8) | (b(23) << 16) | (b(24) << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    return null;
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bin.length) {
      if (b(i) !== 0xff) return null;
      const marker = b(i + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/** Well-formed, small, and with plausible header dimensions. */
function validPicture(picture: string): boolean {
  if (picture.length > MAX_LENGTH || !PICTURE.test(picture)) return false;
  const size = pictureSize(picture);
  return !!size && size.width > 0 && size.height > 0 && size.width <= MAX_PICTURE_PX && size.height <= MAX_PICTURE_PX;
}

function pictureId(avatar: SessionAvatar | null | undefined): string | null {
  return avatar?.kind === "icon" && /^desktop-picture:[0-9a-f-]{36}$/.test(avatar.value) ? avatar.value : null;
}

/** A device-local picture avatar (whether or not this device holds the picture). */
export const isPictureAvatar = (avatar: SessionAvatar | null | undefined): boolean => !!pictureId(avatar);

export function newPictureAvatar(): SessionAvatar {
  return { kind: "icon", value: `${PREFIX}${crypto.randomUUID()}` };
}

export function agentPictureOf(avatar: SessionAvatar | null | undefined): string | null {
  const id = pictureId(avatar);
  if (!id) return null;
  try {
    const picture = localStorage.getItem(KEY + id);
    return picture && validPicture(picture) ? picture : null;
  } catch {
    return null;
  }
}

/** Persist before updating metadata. A quota failure must remain retryable, never silent. */
export function saveAgentPicture(avatar: SessionAvatar, picture: string): void {
  const id = pictureId(avatar);
  if (!id || !validPicture(picture)) throw new Error("Invalid avatar picture");
  localStorage.setItem(KEY + id, picture);
}
