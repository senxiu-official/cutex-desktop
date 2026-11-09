// 拟人头像包, the owner's folder (shared/portraitPacks.ts): `<userData>/avatars/portraits/<pack>/`. The owner drops a
// pack there (the generator's output as is, or scripts/avatar-pack-import.mjs --user); Settings → 外观 → 拟人头像
// lists it. Only folders with a pack id name, only regular files (lstat: no symlinks) inside the pack folder, at
// most PORTRAIT_PACK_MAX packs; an entry whose picture is missing is dropped, so a regenerated pack with fewer
// pictures lists only what is there (the renderer falls back for agents that wore a removed one). Pictures are
// read on request, checked by signature (PNG / JPEG / WebP, ≤ PORTRAIT_IMAGE_MAX_BYTES) and handed over as data
// URLs, so the renderer's CSP (`img-src 'self' data:`) is unchanged; cached per path + size + mtime.
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isPackId,
  isPortraitStem,
  isThemeId,
  packFromFiles,
  parsePackManifest,
  PORTRAIT_IMAGE_MAX_BYTES,
  PORTRAIT_MANIFEST_MAX_BYTES,
  PORTRAIT_PACK_MAX,
  portraitImageType,
  type PortraitPackData,
  type PortraitPacksRequest,
  type PortraitPacksState,
  type UserPortraitPack,
} from "../shared/portraitPacks";

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

/** A regular file within the cap, read without following a symlink; null = refused. */
export async function readFileSafe(path: string, maxBytes: number): Promise<{ bytes: Buffer; key: string } | null> {
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
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > maxBytes) return null;
    const bytes = Buffer.alloc(opened.size);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return { bytes: bytes.subarray(0, length), key: `${opened.size}:${opened.mtimeMs}` };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/** A regular, non-symlink file of at most `maxBytes`. */
async function isPlainFile(path: string, maxBytes: number): Promise<boolean> {
  try {
    const info = await lstat(path);
    return !info.isSymbolicLink() && info.isFile() && info.size > 0 && info.size <= maxBytes;
  } catch {
    return false;
  }
}

/** Plain folders only (no symlinks / junctions). */
export async function isPlainDir(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return !info.isSymbolicLink() && info.isDirectory();
  } catch {
    return false;
  }
}

/** `avatars/<theme>/<file>` and `previews/<theme>/<file>` of a pack without a manifest. */
async function listPictures(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const top of ["avatars", "previews"]) {
    if (!(await isPlainDir(join(root, top)))) continue;
    for (const theme of (await readdir(join(root, top)).catch(() => [] as string[])).filter(isThemeId)) {
      if (!(await isPlainDir(join(root, top, theme)))) continue;
      for (const name of await readdir(join(root, top, theme)).catch(() => [] as string[])) if (/\.(png|jpe?g|webp)$/i.test(name)) out.push(`${top}/${theme}/${name}`);
    }
  }
  return out;
}

const MAX_CACHED = 400;

export class PortraitPackStore {
  private readonly cache = new Map<string, { key: string; url: string | null }>();
  /** Last listing: pack → theme/stem → paths (so `image` only reads what `list` showed). */
  private paths = new Map<string, Map<string, { full: string; preview: string | null }>>();

  constructor(readonly dir: string, private readonly limits = { maxPacks: PORTRAIT_PACK_MAX, maxImageBytes: PORTRAIT_IMAGE_MAX_BYTES }) {}

  async list(): Promise<PortraitPacksState> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => !n.startsWith(".")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    } catch {
      this.paths = new Map();
      return { packs: [], dir: this.dir, skipped: 0 };
    }
    const packs: UserPortraitPack[] = [];
    const paths = new Map<string, Map<string, { full: string; preview: string | null }>>();
    let skipped = 0;
    for (const name of names) {
      const root = join(this.dir, name);
      if (!isPackId(name) || !(await isPlainDir(root)) || packs.length >= this.limits.maxPacks) {
        if (await isPlainDir(root)) skipped++;
        continue;
      }
      const data = await this.readPack(root);
      if (!data) {
        skipped++;
        continue;
      }
      const index = new Map<string, { full: string; preview: string | null }>();
      const themes = [];
      for (const theme of data.themes) {
        const entries = [];
        for (const e of theme.entries) {
          if (!(await this.plainFile(root, e.avatarPath))) {
            skipped++;
            continue;
          }
          const preview = e.previewPath && (await this.plainFile(root, e.previewPath)) ? e.previewPath : null;
          entries.push({ ...e, previewPath: preview });
          index.set(`${theme.id}/${e.stem}`, { full: e.avatarPath, preview });
        }
        if (entries.length) themes.push({ ...theme, entries });
      }
      if (!themes.length) {
        skipped++;
        continue;
      }
      packs.push({ id: name, name: data.name, themes });
      paths.set(name, index);
    }
    this.paths = paths;
    return { packs, dir: this.dir, skipped };
  }

  async openFolder(openPath: (dir: string) => Promise<unknown>): Promise<PortraitPacksState> {
    await mkdir(this.dir, { recursive: true });
    await openPath(this.dir);
    return this.list();
  }

  /** A listed picture as a data URL; null when it is not listed, gone, oversized or not a picture. */
  async image(pack: string, theme: string, stem: string, kind: "full" | "preview"): Promise<string | null> {
    if (!isPackId(pack) || !isThemeId(theme) || !isPortraitStem(stem)) return null;
    if (!this.paths.size) await this.list();
    const known = this.paths.get(pack)?.get(`${theme}/${stem}`);
    const rel = known && (kind === "preview" ? (known.preview ?? known.full) : known.full);
    if (!rel) return null;
    const root = join(this.dir, pack);
    if (!(await this.plainFile(root, rel))) return null;
    const path = join(root, ...rel.split("/"));
    const read = await readFileSafe(path, this.limits.maxImageBytes);
    if (!read) return null;
    const cached = this.cache.get(path);
    if (cached && cached.key === read.key) return cached.url;
    const type = portraitImageType(read.bytes);
    const url = type ? `data:${type};base64,${read.bytes.toString("base64")}` : null;
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(path, { key: read.key, url });
    return url;
  }

  private async readPack(root: string): Promise<PortraitPackData | null> {
    const manifest = await readFileSafe(join(root, "manifest.json"), PORTRAIT_MANIFEST_MAX_BYTES);
    if (manifest) {
      try {
        return parsePackManifest(JSON.parse(manifest.bytes.toString("utf8")));
      } catch {
        return null;
      }
    }
    const files = await listPictures(root);
    return files.length ? packFromFiles(files) : null;
  }

  /** `rel` (checked by safePackPath: relative, no `..`) is a plain file under `root`, every folder on the way a plain folder (no symlink / junction out of the pack). */
  private async plainFile(root: string, rel: string): Promise<boolean> {
    const parts = rel.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = join(dir, part);
      if (!(await isPlainDir(dir))) return false;
    }
    return isPlainFile(join(dir, parts.at(-1)!), this.limits.maxImageBytes);
  }
}

/** The channel's ops; `openPath` is Electron's shell.openPath. */
export async function handlePortraitPacksRequest(store: PortraitPackStore, request: PortraitPacksRequest, openPath: (dir: string) => Promise<unknown>): Promise<PortraitPacksState | string | null> {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("unknown portrait-packs op");
  switch (request.op) {
    case "list":
      return store.list();
    case "openFolder":
      return store.openFolder(openPath);
    case "image":
      if (request.kind !== "full" && request.kind !== "preview") throw new Error("unknown portrait image kind");
      return store.image(request.pack, request.theme, request.stem, request.kind);
    default:
      throw new Error("unknown portrait-packs op");
  }
}
