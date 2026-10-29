// 「Director 头像」 (owner 2026-10-21): a portrait collection meant for Directors, from two folders:
// - bundled: renderer `assets/avatars/director/` (shipped with the app; lib/directorAvatars.ts globs it);
// - personal: `<userData>/avatars/director/` (DIRECTOR_AVATAR_DIR). Main (main/directorAvatars.ts) reads
//   only regular PNG / JPEG files at the top of that folder (no symlinks, no sub-folders, at most
//   DIRECTOR_AVATAR_MAX_BYTES each, DIRECTOR_AVATAR_MAX_FILES in all), shrinks each to a square-ish
//   DIRECTOR_AVATAR_PX thumbnail and hands the renderer `data:image/png` URLs over this channel, so the
//   renderer stays network-locked and its CSP (`img-src 'self' data:`) is unchanged.
// An agent wearing a portrait stores `{kind: "icon", value: "director:<source>/<stem>"}` in cutex (≤ 64
// chars). The picture itself never leaves the device: a client without that file shows the default.

export const DIRECTOR_AVATARS_CHANNEL = "cutex-desktop:director-avatars";

/** The personal folder under userData. */
export const DIRECTOR_AVATAR_DIR = "avatars/director";
/** One personal file's cap (a GPT-sized 1024² PNG is 1–3 MB). */
export const DIRECTOR_AVATAR_MAX_BYTES = 8 * 1024 * 1024;
/** Files read from the personal folder (by name order); the rest are ignored. */
export const DIRECTOR_AVATAR_MAX_FILES = 120;
/** Edge of the thumbnail main hands over (avatars are drawn at ≤ 48 px; 2× for the picker on HiDPI). */
export const DIRECTOR_AVATAR_PX = 192;
/** Longest stem kept: "director:user/" (14) + 40 stays within cutex's 64-character avatar value. */
export const DIRECTOR_AVATAR_STEM_MAX = 40;

export type DirectorAvatarSource = "bundled" | "user";

export interface DirectorAvatarFile {
  /** Normalised stem (lib/directorAvatars avatarStem): the id within its source. */
  stem: string;
  /** `data:image/png;base64,…` thumbnail. */
  url: string;
}

export interface DirectorAvatarsState {
  /** The personal folder's usable images, by stem. */
  files: DirectorAvatarFile[];
  /** Absolute path of the personal folder (shown in the picker so the owner knows where to drop files). */
  dir: string;
  /** Files of a supported extension that were skipped (too large, not an image, symlink, over the count …). */
  skipped: number;
}

export type DirectorAvatarsRequest = { op: "list" } | { op: "openFolder" };

export interface DirectorAvatarsBridge {
  /** Re-reads the personal folder. */
  list(): Promise<DirectorAvatarsState>;
  /** Creates the personal folder if needed and opens it in the system file manager. */
  openFolder(): Promise<DirectorAvatarsState>;
}

const EXT = /\.(png|jpe?g|webp|svg)$/i;

/**
 * A file name → its stem as an id: extension dropped, lower-cased, runs of anything but a–z / 0–9 / `_`
 * become `-`, trimmed, at most DIRECTOR_AVATAR_STEM_MAX. null: no usable characters / unsupported extension.
 */
export function avatarStem(fileName: string): string | null {
  if (!EXT.test(fileName)) return null;
  const stem = fileName
    .replace(EXT, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DIRECTOR_AVATAR_STEM_MAX)
    .replace(/-+$/, "");
  return stem || null;
}

/** PNG or JPEG by signature (the personal folder accepts only these: Electron decodes both everywhere). */
export function imageKind(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

const VALUE = /^director:(bundled|user)\/([a-z0-9_-]{1,40})$/;

/** The portrait id (`bundled/<stem>` / `user/<stem>`) a stored agent avatar points at, else null. */
export function directorAvatarIdOf(avatar: { kind: string; value: string } | null | undefined): string | null {
  if (avatar?.kind !== "icon") return null;
  const m = VALUE.exec(avatar.value);
  return m ? `${m[1]}/${m[2]}` : null;
}

export const isDirectorAvatar = (avatar: { kind: string; value: string } | null | undefined): boolean => directorAvatarIdOf(avatar) !== null;
