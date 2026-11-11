// 中文字体包 (shared/fontCatalog.ts): the big CJK fonts live in `<userData>/fonts/`, not in the install. The owner imports
// them from a folder picked in main's own dialog (the font handoff folder, or any folder holding the files): only
// regular files whose name is a catalog pack file and whose SHA-256 matches it are copied (via a temporary file,
// then renamed). The app window gets them from main under `cutex-font://pack/<file>`: catalog names only, regular
// files only (no symlinks), the size the catalog lists.
//
// 下载并安装 (owner 2026-11-10, option B): main downloads the pinned release asset (shared/fontCatalog.ts
// FONT_PACK_ARCHIVE) through the updater's network session (the user's update proxy; never the renderer, never a
// page or frame session) into <userData>/fonts/.download/, continuing a partial file with a Range request. The
// archive is not trusted: its size and SHA-256 must be the pinned ones, then only entries named
// <root>/fonts/<catalog file> are copied out, each checked against its own catalog SHA-256 like the folder import.
// Anything else in the archive is ignored.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { download } from "./binaryUpdate";
import { ProxyAuthError, type Transport } from "./updateTransport";
import { FONT_PACK_ARCHIVE, FONT_SCHEME, PACK_FONTS, type FontCatalogEntry, type FontCatalogFace, type FontPackDownload, type FontPackDownloadError, type FontPackImportResult, type FontPackRequest, type FontPackState } from "../shared/fontCatalog";

export type FontPackArchive = { name: string; url: string; sha256: string; bytes: number; root: string };
export interface FontPackNetwork {
  transport: Transport;
  /** Tests only: a loopback origin besides GitHub's download hosts. */
  extraOrigins?: readonly string[];
  /** Tests only: another archive than FONT_PACK_ARCHIVE. */
  archive?: FontPackArchive;
}
const PROGRESS_INTERVAL_MS = 250;

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
/** How deep an import looks under the picked folder (the handoff keeps its files in fonts/). */
const IMPORT_DEPTH = 3;
const IMPORT_MAX_ENTRIES = 5000;

async function regularFile(path: string): Promise<{ size: number } | null> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink() ? { size: info.size } : null;
  } catch {
    return null;
  }
}

async function fileSha256(path: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export class FontPackStore {
  private readonly files: Map<string, FontCatalogFace>;
  /** `catalog`: the pack families (tests pass their own). `onChange`: state pushes while a download runs. */
  constructor(private readonly root: string, private readonly catalog: readonly FontCatalogEntry[] = PACK_FONTS, private readonly onChange?: (state: FontPackState) => void) {
    this.files = new Map(catalog.flatMap((entry) => entry.faces.map((face) => [face.file, face] as const)));
  }

  private progress: FontPackDownload | undefined;
  private running: { promise: Promise<FontPackState>; abort: AbortController } | null = null;

  /** 下载并安装. A second call while one runs joins it. */
  downloadAndInstall(network: FontPackNetwork): Promise<FontPackState> {
    if (this.running) return this.running.promise;
    const abort = new AbortController();
    const promise = this.runDownload(network, abort.signal).finally(() => {
      this.running = null;
    });
    this.running = { promise, abort };
    return promise;
  }

  cancelDownload(): void {
    this.running?.abort.abort();
  }

  private async push(next: FontPackDownload | undefined): Promise<void> {
    this.progress = next;
    if (this.onChange) this.onChange(await this.state());
  }

  private async runDownload(network: FontPackNetwork, signal: AbortSignal): Promise<FontPackState> {
    const archive = network.archive ?? FONT_PACK_ARCHIVE;
    const dir = join(this.root, ".download"), part = join(dir, `${archive.name}.part`);
    let phase: FontPackDownload["phase"] = "downloading";
    let received = 0;
    try {
      await mkdir(dir, { recursive: true });
      await this.push({ phase, received, total: archive.bytes });
      let last = 0;
      await download(network.transport, archive.url, part, {
        max: archive.bytes,
        size: archive.bytes,
        extraOrigins: network.extraOrigins,
        signal,
        resume: true,
        onProgress: (n) => {
          received = n;
          const now = Date.now();
          if (now - last >= PROGRESS_INTERVAL_MS) {
            last = now;
            void this.push({ phase, received, total: archive.bytes });
          }
        },
      });
      phase = "verifying";
      received = archive.bytes;
      await this.push({ phase, received, total: archive.bytes });
      if ((await fileSha256(part)) !== archive.sha256) {
        // Not the published archive (or damaged): never continue it.
        await rm(part, { force: true });
        throw new FontPackError("mismatch");
      }
      phase = "installing";
      await this.push({ phase, received, total: archive.bytes });
      await this.installFromTar(part, archive.root);
      await rm(part, { force: true });
      await this.push(undefined);
      return this.state();
    } catch (error) {
      const code = errorCode(error, signal);
      // A cancel or a network error keeps the partial file: the next try continues it (and checks it in full).
      if (code === "disk") await rm(part, { force: true }).catch(() => {});
      await this.push(code === "cancelled" ? undefined : { phase: "failed", received, total: archive.bytes, error: code });
      return this.state();
    }
  }

  /**
   * Copies `<root>/fonts/<catalog file>` entries out of an uncompressed ustar archive on disk, each checked against its
   * catalog SHA-256 (via a temporary file, then renamed). Every catalog file must be there and match.
   */
  async installFromTar(path: string, root: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const wanted = new Set(this.files.keys()), done = new Set<string>();
    const prefix = `${root}/fonts/`;
    const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    try {
      const size = (await handle.stat()).size;
      const header = Buffer.alloc(512);
      let off = 0;
      for (;;) {
        if (off + 512 > size) throw new FontPackError("mismatch");
        await readExactly(handle, header, off);
        if (header.every((b) => b === 0)) break;
        const entry = parseTarHeader(header);
        off += 512;
        if (off + entry.size > size) throw new FontPackError("mismatch");
        const name = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : "";
        if (entry.regular && wanted.has(name) && !done.has(name)) {
          await this.copyEntry(handle, off, entry.size, name);
          done.add(name);
        }
        off += Math.ceil(entry.size / 512) * 512;
      }
    } finally {
      await handle.close();
    }
    if (done.size !== wanted.size) throw new FontPackError("mismatch");
  }

  private async copyEntry(src: FileHandle, offset: number, size: number, name: string): Promise<void> {
    const face = this.files.get(name)!;
    if (size !== face.bytes) throw new FontPackError("mismatch");
    const dest = join(this.root, name), temp = `${dest}.import`;
    const out = await open(temp, "w");
    const hash = createHash("sha256");
    try {
      const buffer = Buffer.alloc(1 << 20);
      for (let copied = 0; copied < size; ) {
        const n = Math.min(buffer.length, size - copied);
        await readExactly(src, buffer.subarray(0, n), offset + copied);
        hash.update(buffer.subarray(0, n));
        await out.write(buffer, 0, n);
        copied += n;
      }
    } finally {
      await out.close();
    }
    if (hash.digest("hex") !== face.sha256) {
      await rm(temp, { force: true });
      throw new FontPackError("mismatch");
    }
    await rename(temp, dest);
  }

  async state(): Promise<FontPackState> {
    const families = await Promise.all(this.catalog.map(async (entry) => {
      let installed = 0;
      for (const face of entry.faces) if ((await regularFile(join(this.root, face.file)))?.size === face.bytes) installed++;
      return { id: entry.id, installed, total: entry.faces.length, bytes: entry.faces.reduce((n, f) => n + f.bytes, 0) };
    }));
    return { families, ...(this.progress ? { download: this.progress } : {}) };
  }

  /** Copies every matching pack file found under `folder` (to IMPORT_DEPTH levels; symlinks are not followed). */
  async importFrom(folder: string): Promise<Omit<FontPackImportResult, "canceled">> {
    const found = new Map<string, string>();
    let seen = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (++seen > IMPORT_MAX_ENTRIES) return;
        const path = join(dir, entry.name);
        if (entry.isFile() && this.files.has(entry.name) && !found.has(entry.name)) found.set(entry.name, path);
        else if (entry.isDirectory() && depth < IMPORT_DEPTH) await walk(path, depth + 1);
      }
    };
    await walk(folder, 0);
    const imported: string[] = [], refused: string[] = [];
    if (found.size) await mkdir(this.root, { recursive: true });
    for (const [name, path] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
      const face = this.files.get(name)!;
      const info = await regularFile(path);
      if (!info || info.size !== face.bytes || (await fileSha256(path)) !== face.sha256) {
        refused.push(name);
        continue;
      }
      const dest = join(this.root, name), temp = `${dest}.import`;
      try {
        await copyFile(path, temp);
        // The copy is what will be served: check it again, then put it in place.
        if ((await fileSha256(temp)) !== face.sha256) throw new Error("copy changed");
        await rename(temp, dest);
        imported.push(name);
      } catch {
        await rm(temp, { force: true });
        refused.push(name);
      }
    }
    return { imported, refused, state: await this.state() };
  }

  async remove(id: string): Promise<FontPackState> {
    const entry = this.catalog.find((e) => e.id === id);
    for (const face of entry?.faces ?? []) await rm(join(this.root, face.file), { force: true });
    return this.state();
  }

  /** The bytes for a `cutex-font:` request, or null (not a pack file, not imported, or not the listed size). */
  async read(url: string): Promise<Buffer | null> {
    const name = this.fileOfUrl(url);
    if (!name) return null;
    const path = join(this.root, name), expected = this.files.get(name)!.bytes;
    if ((await regularFile(path))?.size !== expected) return null;
    try {
      const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
      try {
        const data = await handle.readFile();
        return data.length === expected ? data : null;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  /** The pack file a `cutex-font://pack/<file>` URL names, or null. */
  fileOfUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== `${FONT_SCHEME}:` || parsed.hostname !== "pack" || parsed.search || parsed.username || parsed.password) return null;
    let name: string;
    try {
      name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    } catch {
      return null;
    }
    return this.files.has(name) ? name : null;
  }

  async respond(request: Request): Promise<Response> {
    const data = request.method === "GET" ? await this.read(request.url) : null;
    if (!data) return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { "Content-Type": request.url.endsWith(".ttf") ? "font/ttf" : "font/woff2", "Cache-Control": "max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export async function handleFontPackRequest(store: FontPackStore, request: FontPackRequest, pickFolder: () => Promise<string | null>, openFolder: (dir: string) => Promise<unknown>, root: string, network: () => FontPackNetwork): Promise<FontPackState | FontPackImportResult | void> {
  switch (request.op) {
    case "state":
      return store.state();
    case "import": {
      const folder = await pickFolder();
      if (folder === null) return { canceled: true, imported: [], refused: [], state: await store.state() };
      return { canceled: false, ...(await store.importFrom(folder)) };
    }
    case "remove":
      return store.remove(request.id);
    case "openFolder":
      await mkdir(root, { recursive: true });
      await openFolder(root);
      return;
    case "download":
      return store.downloadAndInstall(network());
    case "cancelDownload":
      store.cancelDownload();
      return;
  }
}

class FontPackError extends Error {
  constructor(readonly code: FontPackDownloadError) {
    super(code);
  }
}

function errorCode(error: unknown, signal: AbortSignal): FontPackDownloadError {
  if (signal.aborted) return "cancelled";
  if (error instanceof FontPackError) return error.code;
  const text = error instanceof Error ? error.message : String(error);
  if (error instanceof ProxyAuthError || /proxy requires authentication/.test(text)) return "proxyAuth";
  const code = (error as { code?: string } | null)?.code;
  if (code === "ENOSPC" || code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "EBUSY") return "disk";
  return "network";
}

async function readExactly(handle: FileHandle, into: Buffer, position: number): Promise<void> {
  for (let got = 0; got < into.length; ) {
    const { bytesRead } = await handle.read(into, got, into.length - got, position + got);
    if (!bytesRead) throw new FontPackError("mismatch");
    got += bytesRead;
  }
}

function tarText(b: Buffer, start: number, len: number): string {
  const s = b.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? len : end).toString("utf8");
}

/** One ustar header (checksum, magic, octal size); a path with "." / ".." parts or a backslash is refused. */
export function parseTarHeader(h: Buffer): { path: string; size: number; regular: boolean } {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!;
  const octal = (start: number, len: number) => {
    const t = tarText(h, start, len).trim();
    if (!/^[0-7]{1,12}$/.test(t)) throw new FontPackError("mismatch");
    return parseInt(t, 8);
  };
  if (octal(148, 8) !== sum) throw new FontPackError("mismatch");
  const magic = h.subarray(257, 263).toString("latin1");
  if (magic !== "ustar\0" && magic !== "ustar ") throw new FontPackError("mismatch");
  const prefix = magic === "ustar\0" ? tarText(h, 345, 155) : "";
  const name = tarText(h, 0, 100);
  const path = prefix ? `${prefix}/${name}` : name;
  if (path.includes("\\") || path.split("/").some((p) => p === "." || p === "..")) throw new FontPackError("mismatch");
  const type = h[156];
  return { path, size: octal(124, 12), regular: type === 0x30 || type === 0 };
}

