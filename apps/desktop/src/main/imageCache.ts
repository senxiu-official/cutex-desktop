import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_PREVIEW_PROMPT_BYTES, type ImageCacheSettings, type ImageCacheState } from "../shared/imageCache";

export const IMAGE_CACHE_MAX_IMAGE_BYTES = IMAGE_PREVIEW_PROMPT_BYTES;
const DEFAULTS: ImageCacheSettings = { days: 7, maxBytes: 5 * 1024 ** 3 };
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
interface Entry { size: number; digest: string; mime: string; viewed: number; chunks?: string[] }
const CHUNK = 4 * 1024 * 1024;
/** A view moves the entry up in memory at once; its file is rewritten at most this often (the limit is whole days). */
const VIEW_WRITE_MS = 60 * 60_000;
export interface CacheWindow { offset: number; maxBytes: number }
export interface CachedImage { bytes: Uint8Array; mime: string; size?: number; digest?: string }
/** Main-only, disposable bytes. No source paths or credentials are written to disk. */
export class ImageCache {
  private entries = new Map<string, Entry>();
  private settings = { ...DEFAULTS };
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private epoch = 0;
  private pending = new Map<string, Promise<CachedImage | null>>();
  /** When each entry's file last recorded `viewed` (entries read at start: their file value). */
  private written = new Map<string, number>();
  constructor(private root: string, private now = Date.now) { this.ready = this.initialize(); }
  private async initialize() {
    await mkdir(this.root, { recursive: true });
    try { this.settings = validateSettings(JSON.parse(await readFile(join(this.root, "settings.json"), "utf8"))); } catch { /* defaults */ }
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const e: Entry = JSON.parse(await readFile(join(this.root, name), "utf8"));
        if (!Number.isSafeInteger(e.size) || e.size <= 0 || e.size > IMAGE_CACHE_MAX_IMAGE_BYTES || !/^[a-f0-9]{64}$/.test(e.digest) || typeof e.mime !== "string" || !Number.isFinite(e.viewed)) throw Error("invalid entry");
        if ((await stat(join(this.root, `${name.slice(0, 64)}.bin`))).size !== e.size) throw Error("partial cache entry");
        this.entries.set(name.slice(0, 64), e); this.written.set(name.slice(0, 64), e.viewed);
      } catch { await this.remove(name.slice(0, 64)); }
    }
    // Interrupted writes and orphan bodies are disposable; only fixed cache names are removed.
    for (const name of await readdir(this.root)) {
      if (/^[a-f0-9]{64}\.(?:bin|json)$/.test(name) && !this.entries.has(name.slice(0, 64)) || /^(?:[a-f0-9]{64}|settings)\.[a-f0-9-]+\.tmp$/.test(name)) await unlink(join(this.root, name)).catch(() => {});
    }
    await this.prune();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(fn);
    this.queue = next.catch(() => {}); return next;
  }
  private async atomic(name: string, bytes: string | Uint8Array) {
    const tmp = join(this.root, `${name.replace(/\.(bin|json)$/, "")}.${randomUUID()}.tmp`);
    try { await writeFile(tmp, bytes, { flag: "wx" }); await rename(tmp, join(this.root, name)); }
    finally { await unlink(tmp).catch(() => {}); }
  }
  private async remove(key: string) {
    this.entries.delete(key); this.written.delete(key);
    await Promise.all(["bin", "json"].map(ext => unlink(join(this.root, `${key}.${ext}`)).catch(() => {})));
  }
  private async prune() {
    let size = [...this.entries.values()].reduce((n, e) => n + e.size, 0);
    for (const [key, e] of [...this.entries].sort((a, b) => a[1].viewed - b[1].viewed)) {
      if (this.now() - e.viewed >= this.settings.days * 86400000 || size > this.settings.maxBytes) { await this.remove(key); size -= e.size; }
    }
  }
  cleanup() { return this.serial(() => this.prune()); }
  state(): Promise<ImageCacheState> { return this.serial(async () => ({ ...this.settings, bytes: [...this.entries.values()].reduce((n, e) => n + e.size, 0), entries: this.entries.size })); }
  configure(value: ImageCacheSettings) { return this.serial(async () => { const settings = validateSettings(value); await this.atomic("settings.json", JSON.stringify(settings)); this.settings = settings; await this.prune(); }); }
  clear() {
    this.epoch++; this.pending.clear();
    return this.serial(async () => { for (const key of [...this.entries.keys()]) await this.remove(key); });
  }
  async read(keyParts: readonly unknown[], load: () => Promise<CachedImage | null>, sha256?: string, window?: CacheWindow): Promise<CachedImage | null> {
    const key = hash(JSON.stringify(keyParts)), epoch = this.epoch;
    const operationKey = window ? `${key}:${window.offset}:${window.maxBytes}` : key;
    const slice = (image: CachedImage): CachedImage => window ? { ...image, size: image.bytes.length, bytes: image.bytes.subarray(window.offset, window.offset + window.maxBytes) } : image;
    const active = this.pending.get(operationKey); if (active) return active;
    const task = (async () => {
      const hit = await this.serial(async () => {
        const e = this.entries.get(key); if (!e) return null;
        if (this.now() - e.viewed >= this.settings.days * 86400000) { await this.remove(key); return null; }
        try {
          let bytes: Uint8Array;
          if (sha256 && e.digest !== sha256) throw Error("image sha256 mismatch");
          if (window && e.chunks?.length === Math.ceil(e.size / CHUNK)) {
            // Verify just the bounded chunks needed by this content window. A large preview
            // never rereads the whole disk image for every four-megabyte renderer window.
            const handle = await open(join(this.root, `${key}.bin`), "r");
            try {
              if ((await handle.stat()).size !== e.size) throw Error("partial image cache");
              const start = Math.min(e.size, Math.floor(window.offset / CHUNK) * CHUNK);
              const end = Math.min(e.size, Math.ceil((window.offset + window.maxBytes) / CHUNK) * CHUNK);
              const region = Buffer.alloc(Math.max(0, end - start));
              let done = 0;
              while (done < region.length) { const read = await handle.read(region, done, region.length - done, start + done); if (!read.bytesRead) throw Error("partial image cache"); done += read.bytesRead; }
              for (let pos = 0; pos < region.length; pos += CHUNK) if (hash(region.subarray(pos, pos + CHUNK)) !== e.chunks[(start + pos) / CHUNK]) throw Error("corrupt image cache chunk");
              bytes = new Uint8Array(region.subarray(window.offset - start, window.offset - start + window.maxBytes));
            } finally { await handle.close(); }
          } else {
            const whole = await readFile(join(this.root, `${key}.bin`));
            if (whole.length !== e.size || hash(whole) !== e.digest) throw Error("corrupt image cache");
            bytes = window ? whole.subarray(window.offset, window.offset + window.maxBytes) : whole;
          }
          const updated = { ...e, viewed: this.now() };
          if (updated.viewed - (this.written.get(key) ?? 0) >= VIEW_WRITE_MS) { await this.atomic(`${key}.json`, JSON.stringify(updated)); this.written.set(key, updated.viewed); }
          this.entries.set(key, updated);
          return { bytes: new Uint8Array(bytes), mime: e.mime, size: e.size, digest: e.digest };
        } catch { await this.remove(key); return null; }
      }).catch(() => null);
      if (hit) return hit;
      const image = await load();
      if (!image || image.bytes.length === 0 || image.bytes.length > IMAGE_CACHE_MAX_IMAGE_BYTES || !image.mime.startsWith("image/")) return image;
      const digest = hash(image.bytes);
      if (sha256 && digest !== sha256) throw Error("image sha256 mismatch");
      await this.serial(async () => {
        if (epoch !== this.epoch || image.bytes.length > this.settings.maxBytes) return;
        const chunks: string[] = [];
        for (let at = 0; at < image.bytes.length; at += CHUNK) chunks.push(hash(image.bytes.subarray(at, at + CHUNK)));
        const e = { size: image.bytes.length, digest, mime: image.mime, viewed: this.now(), chunks };
        await this.atomic(`${key}.bin`, image.bytes); await this.atomic(`${key}.json`, JSON.stringify(e)); this.entries.set(key, e); this.written.set(key, e.viewed); await this.prune();
      }).catch(() => {});
      return slice({ ...image, digest });
    })().finally(() => { if (this.pending.get(operationKey) === task) this.pending.delete(operationKey); });
    this.pending.set(operationKey, task); return task;
  }
}
export function validateSettings(value: ImageCacheSettings): ImageCacheSettings {
  if (!value || !Number.isInteger(value.days) || value.days < 1 || value.days > 3650 || !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1024 ** 2 || value.maxBytes > 1024 ** 4) throw Error("invalid image cache limits");
  return { days: value.days, maxBytes: value.maxBytes };
}
let activeCache: ImageCache | undefined;
export const currentImageCache = () => activeCache;
export function installImageCache(cache: ImageCache) { activeCache = cache; }
