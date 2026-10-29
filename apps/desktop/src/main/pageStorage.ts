// Channel A of agent pages (docs/design/004-artifact-page-bridge.md): each HTML artifact's own small
// key-value storage, shared by all its versions (an agent's new version keeps a half-filled form), in
// userData. One JSON file per (host, artifact); a page only ever reaches the file main bound to its frame.
// Limits are these constants and nothing else: a page cannot ask for more. A full store answers
// `quota_exceeded`; nothing is ever evicted — only the owner clears a page's data (⋯ menu, Settings).
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_ID } from "../shared/artifactStore";
import type { PageDataEntry, PageDataUsage } from "../shared/pageBridge";

/** One page (artifact) may store this much (keys + values, UTF-8), like a browser's localStorage. */
export const PAGE_STORAGE_PAGE_LIMIT = 5 * 1024 * 1024;
/** All pages together: soft limit — new growth is refused (and Settings says so); nothing is deleted. */
export const PAGE_STORAGE_TOTAL_LIMIT = 200 * 1024 * 1024;

export interface PageKey {
  hostId: string;
  artifactId: string;
}
export type PageWriteResult = { ok: true } | { ok: false; error: "quota_exceeded"; scope: "page" | "total"; limit: number };

interface PageFile {
  v: 1;
  hostId: string;
  artifactId: string;
  name: string | null;
  updatedAt: string;
  data: Record<string, string>;
}
type Meta = Omit<PageFile, "data" | "v"> & { bytes: number };

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");
const sizeOf = (data: Record<string, string>) => Object.entries(data).reduce((n, [k, v]) => n + utf8(k) + utf8(v), 0);
const fileName = ({ hostId, artifactId }: PageKey) => `${createHash("sha256").update(hostId).digest("hex").slice(0, 16)}-${artifactId}.json`;

/** A page's changes are written at most this often (storage audit 2026-10-23: a page saving on every keystroke
 * rewrote its whole file — up to 5 MB — per `storage.set`). */
export const PAGE_STORAGE_FLUSH_MS = 250;

/** `totalLimit` / `flushMs` are for tests only; the app always uses the constants. */
export function createPageStorage(options: { root: string; now?: () => Date; cacheSize?: number; totalLimit?: number; flushMs?: number }) {
  const { root } = options;
  const TOTAL = options.totalLimit ?? PAGE_STORAGE_TOTAL_LIMIT;
  const now = options.now ?? (() => new Date());
  const cacheSize = options.cacheSize ?? 8;
  let index: Map<string, Meta> | null = null;
  const cache = new Map<string, PageFile>(); // LRU of loaded pages
  // Changed pages not on disk yet (always also readable here: the LRU may drop them, this never does).
  const dirty = new Map<string, PageFile>();
  const flushMs = options.flushMs ?? PAGE_STORAGE_FLUSH_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let totalRefused = false;
  let queue: Promise<unknown> = Promise.resolve();
  // One operation at a time: sizes are checked and written without interleaving.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const check = (page: PageKey) => {
    if (typeof page?.hostId !== "string" || !page.hostId || page.hostId.length > 200 || typeof page.artifactId !== "string" || !ARTIFACT_ID.test(page.artifactId)) throw new Error("Invalid page");
  };
  const parse = (text: string): PageFile | null => {
    try {
      const f = JSON.parse(text) as PageFile;
      if (f?.v !== 1 || typeof f.hostId !== "string" || typeof f.artifactId !== "string" || !f.data || typeof f.data !== "object") return null;
      for (const value of Object.values(f.data)) if (typeof value !== "string") return null;
      return f;
    } catch {
      return null;
    }
  };
  const loadIndex = async (): Promise<Map<string, Meta>> => {
    if (index) return index;
    const found = new Map<string, Meta>();
    let names: string[] = [];
    try {
      names = await readdir(root);
    } catch {
      /* nothing stored yet */
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const f = parse(await readFile(join(root, name), "utf8").catch(() => ""));
      if (f && name === fileName(f)) found.set(name, { hostId: f.hostId, artifactId: f.artifactId, name: f.name, updatedAt: f.updatedAt, bytes: sizeOf(f.data) });
    }
    return (index = found);
  };
  const total = (idx: Map<string, Meta>) => [...idx.values()].reduce((n, m) => n + m.bytes, 0);
  const load = async (page: PageKey): Promise<PageFile | null> => {
    const name = fileName(page);
    const pending = dirty.get(name);
    if (pending) return pending;
    const hit = cache.get(name);
    if (hit) {
      cache.delete(name);
      cache.set(name, hit);
      return hit;
    }
    if (!(await loadIndex()).has(name)) return null;
    const f = parse(await readFile(join(root, name), "utf8").catch(() => ""));
    if (!f || f.hostId !== page.hostId || f.artifactId !== page.artifactId) return null;
    remember(name, f);
    return f;
  };
  const remember = (name: string, f: PageFile) => {
    cache.delete(name);
    cache.set(name, f);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
  };
  const write = async (name: string, f: PageFile) => {
    await mkdir(root, { recursive: true });
    const tmp = join(root, `${name}.tmp`);
    await writeFile(tmp, JSON.stringify(f), "utf8");
    await rename(tmp, join(root, name));
  };
  /** Every changed page to disk (atomic per page), inside the queue. */
  const flushNow = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const [name, f] of [...dirty]) {
      await write(name, f);
      if (dirty.get(name) === f) dirty.delete(name);
    }
  };
  /** In memory at once (reads see it), on disk within flushMs: one write however many sets came in between. */
  const save = async (f: PageFile) => {
    const name = fileName(f);
    dirty.set(name, f);
    if (!timer) timer = setTimeout(() => void serial(flushNow).catch(() => undefined), flushMs);
    remember(name, f);
    const idx = await loadIndex();
    idx.set(name, { hostId: f.hostId, artifactId: f.artifactId, name: f.name, updatedAt: f.updatedAt, bytes: sizeOf(f.data) });
    if (totalRefused && total(idx) < TOTAL) totalRefused = false;
  };
  const drop = async (page: PageKey) => {
    const name = fileName(page);
    dirty.delete(name);
    await rm(join(root, name), { force: true });
    cache.delete(name);
    const idx = await loadIndex();
    idx.delete(name);
    if (totalRefused && total(idx) < TOTAL) totalRefused = false;
  };

  return {
    get(page: PageKey, key: string): Promise<string | null> {
      check(page);
      return serial(async () => (await load(page))?.data[key] ?? null);
    },
    keys(page: PageKey): Promise<string[]> {
      check(page);
      return serial(async () => Object.keys((await load(page))?.data ?? {}));
    },
    set(page: PageKey, key: string, value: string, name: string | null = null): Promise<PageWriteResult> {
      check(page);
      return serial(async () => {
        const f = (await load(page)) ?? { v: 1 as const, hostId: page.hostId, artifactId: page.artifactId, name, updatedAt: "", data: {} };
        const before = sizeOf(f.data);
        const old = Object.hasOwn(f.data, key) ? utf8(key) + utf8(f.data[key]!) : 0;
        const after = before - old + utf8(key) + utf8(value);
        if (after > PAGE_STORAGE_PAGE_LIMIT) return { ok: false, error: "quota_exceeded", scope: "page", limit: PAGE_STORAGE_PAGE_LIMIT } as const;
        const idx = await loadIndex();
        if (after > before && total(idx) - before + after > TOTAL) {
          totalRefused = true;
          return { ok: false, error: "quota_exceeded", scope: "total", limit: TOTAL } as const;
        }
        await save({ ...f, name: name ?? f.name, updatedAt: now().toISOString(), data: { ...f.data, [key]: value } });
        return { ok: true } as const;
      });
    },
    remove(page: PageKey, key: string): Promise<void> {
      check(page);
      return serial(async () => {
        const f = await load(page);
        if (!f || !Object.hasOwn(f.data, key)) return;
        const { [key]: _gone, ...data } = f.data;
        await save({ ...f, updatedAt: now().toISOString(), data });
      });
    },
    /** The page clearing itself, or the owner (⋯ menu, Settings): the file is gone. */
    clear(page: PageKey): Promise<void> {
      check(page);
      return serial(() => drop(page));
    },
    /** The artifact's name as main last learned it (shown in Settings); only for pages with data. */
    rename(page: PageKey, name: string): Promise<void> {
      check(page);
      return serial(async () => {
        const f = await load(page);
        if (f && f.name !== name) await save({ ...f, name });
      });
    },
    /** Changes not written yet (quit waits for flush()). */
    pending(): boolean {
      return dirty.size > 0;
    },
    /** Writes every pending change now. */
    flush(): Promise<void> {
      return serial(flushNow);
    },
    usage(): Promise<PageDataUsage> {
      return serial(async () => {
        const idx = await loadIndex();
        const items: PageDataEntry[] = [...idx.values()].map(({ hostId, artifactId, name, bytes, updatedAt }) => ({ hostId, artifactId, name, bytes, updatedAt }))
          .sort((a, b) => b.bytes - a.bytes);
        return { items, totalBytes: total(idx), pageLimit: PAGE_STORAGE_PAGE_LIMIT, totalLimit: TOTAL, totalRefused };
      });
    },
  };
}
export type PageStorage = ReturnType<typeof createPageStorage>;
