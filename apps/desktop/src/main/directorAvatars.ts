// 「Director 头像」 personal folder (shared/directorAvatars.ts): `<userData>/avatars/director/`. The owner
// drops portraits there; the picker lists them. Only the top level is read, only names with a supported
// extension, only regular files (lstat: no symlinks, no folders) of at most DIRECTOR_AVATAR_MAX_BYTES whose
// bytes start with a PNG / JPEG signature, at most DIRECTOR_AVATAR_MAX_FILES of them in name order. Each
// is shrunk (Electron nativeImage in main/index.ts; injected so this stays testable) to a small PNG and
// handed over as a data URL; a file that does not decode is skipped. Thumbnails are cached per name +
// size + mtime, so 「重新扫描」 only decodes new or changed files.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  avatarStem,
  DIRECTOR_AVATAR_MAX_BYTES,
  DIRECTOR_AVATAR_MAX_FILES,
  imageKind,
  type DirectorAvatarFile,
  type DirectorAvatarsRequest,
  type DirectorAvatarsState,
} from "../shared/directorAvatars";

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
const PERSONAL = /\.(png|jpe?g)$/i;

/** Bytes (PNG / JPEG) → a PNG thumbnail, or null when they do not decode. */
export type Shrink = (bytes: Buffer) => Buffer | null | Promise<Buffer | null>;

/** A regular file within the cap, read without following a symlink; null = refused. */
async function readImage(path: string, maxBytes: number): Promise<{ bytes: Buffer; key: string } | null> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return null;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.size > maxBytes) return null;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return null;
    const bytes = Buffer.from(buffer.subarray(0, length));
    return imageKind(bytes) ? { bytes, key: `${opened.size}:${opened.mtimeMs}` } : null;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

export class DirectorAvatarStore {
  private readonly cache = new Map<string, { key: string; url: string | null }>();

  constructor(
    readonly dir: string,
    private readonly shrink: Shrink,
    private readonly limits = { maxBytes: DIRECTOR_AVATAR_MAX_BYTES, maxFiles: DIRECTOR_AVATAR_MAX_FILES },
  ) {}

  async list(): Promise<DirectorAvatarsState> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => PERSONAL.test(n) && !n.startsWith(".")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    } catch {
      return { files: [], dir: this.dir, skipped: 0 };
    }
    const files: DirectorAvatarFile[] = [];
    const seen = new Set<string>();
    let skipped = Math.max(0, names.length - this.limits.maxFiles);
    for (const name of names.slice(0, this.limits.maxFiles)) {
      const stem = avatarStem(name);
      if (!stem || seen.has(stem)) {
        skipped++;
        continue;
      }
      const url = await this.thumbnail(name);
      if (!url) {
        skipped++;
        continue;
      }
      seen.add(stem);
      files.push({ stem, url });
    }
    for (const name of [...this.cache.keys()]) if (!names.includes(name)) this.cache.delete(name);
    return { files, dir: this.dir, skipped };
  }

  async openFolder(openPath: (dir: string) => Promise<unknown>): Promise<DirectorAvatarsState> {
    await mkdir(this.dir, { recursive: true });
    await openPath(this.dir);
    return this.list();
  }

  private async thumbnail(name: string): Promise<string | null> {
    const read = await readImage(join(this.dir, name), this.limits.maxBytes);
    if (!read) return null;
    const cached = this.cache.get(name);
    if (cached && cached.key === read.key) return cached.url;
    let png: Buffer | null = null;
    try {
      png = await this.shrink(read.bytes);
    } catch {
      png = null;
    }
    const url = png && png.length > 0 ? `data:image/png;base64,${png.toString("base64")}` : null;
    this.cache.set(name, { key: read.key, url });
    return url;
  }
}

/** The channel's ops; `openPath` is Electron's shell.openPath. */
export async function handleDirectorAvatarsRequest(store: DirectorAvatarStore, request: DirectorAvatarsRequest, openPath: (dir: string) => Promise<unknown>): Promise<DirectorAvatarsState> {
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1) throw new Error("unknown director-avatars op");
  switch (request.op) {
    case "list":
      return store.list();
    case "openFolder":
      return store.openFolder(openPath);
    default:
      throw new Error("unknown director-avatars op");
  }
}
