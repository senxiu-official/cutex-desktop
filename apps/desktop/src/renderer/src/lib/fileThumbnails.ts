// Lazy thumbnail bytes are shared in a bounded cache. New history blobs use object URLs;
// the old file/provider data URL shape remains supported. Mounted readers retain an evicted
// object URL until their last lease ends, so cache churn cannot break a visible lightbox.
import { useEffect, useRef, useState } from "react";
import type { FsFile } from "../../../shared/ipc";
import { thumbnailSrc } from "./fileKinds";
import { ownerWindowOf } from "./ownerWindow";

export type ThumbnailBytes = Pick<FsFile, "encoding" | "content" | "mime" | "size" | "truncated">
  | { encoding: "bytes"; bytes: Uint8Array | ArrayBuffer; mime: string; size: number; truncated: boolean };
/** `maxBytes`: the largest fs/file body shown (default THUMBNAIL_MAX_BYTES; a sent image may be as big as its send cap). */
export interface ThumbnailOptions { hostId?: string; isCurrent?(): boolean; maxBytes?: number; revalidate?: boolean }
/**
 * A read that answered: the image is not there or not valid. Only this failure is cached (FAIL_TTL_MS);
 * any other (transport, the read queue full) is not, so the next mount reads again instead of keeping
 * a transient failure as 图片读取失败.
 */
export class ThumbnailUnavailable extends Error {}
interface Entry { src: string | null; at: number; weight: number; object: boolean; refs: number; retired: boolean; hostId?: string }
interface Lease { entry?: Entry }
const OK_TTL_MS = 5 * 60_000, FAIL_TTL_MS = 30_000;
export const THUMBNAIL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const THUMBNAIL_CACHE_MAX_ENTRIES = 256;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();
const leases = new Map<string, Set<Lease>>();
const hostEpochs = new Map<string, number>();
let cacheBytes = 0, generation = 0;
let activeReads = 0;
const waitingReaders: (() => void)[] = [];
function limitedRead(read: () => Promise<ThumbnailBytes>): Promise<ThumbnailBytes> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeReads++;
      void Promise.resolve().then(read).then(resolve, reject).finally(() => { activeReads--; waitingReaders.shift()?.(); });
    };
    if (activeReads < 4) run(); else if (waitingReaders.length < 64) waitingReaders.push(run); else reject(Error("thumbnail_queue_full"));
  });
}

function retire(entry: Entry) {
  entry.retired = true;
  if (!entry.refs && entry.object && entry.src) { URL.revokeObjectURL(entry.src); entry.src = null; }
}
function drop(key: string) { const e = cache.get(key); if (e) { cache.delete(key); cacheBytes -= e.weight; retire(e); } }
function fresh(key: string): Entry | null {
  const e = cache.get(key); if (!e) return null;
  if (Date.now() - e.at >= (e.src ? OK_TTL_MS : FAIL_TTL_MS)) { drop(key); return null; }
  cache.delete(key); cache.set(key, e); return e;
}
function remember(key: string, entry: Entry) {
  drop(key); cache.set(key, entry); cacheBytes += entry.weight;
  for (const lease of leases.get(key) ?? []) if (!lease.entry) { lease.entry = entry; entry.refs++; }
  for (const k of [...cache.keys()]) {
    if (cacheBytes <= THUMBNAIL_CACHE_MAX_BYTES && cache.size <= THUMBNAIL_CACHE_MAX_ENTRIES) break;
    drop(k);
  }
}
export function invalidateThumbnailHost(hostId: string): void {
  hostEpochs.set(hostId, (hostEpochs.get(hostId) ?? 0) + 1);
  for (const [key, entry] of cache) if (entry.hostId === hostId) drop(key);
}
export function resetThumbnailCache(): void { generation++; for (const key of [...cache.keys()]) drop(key); inflight.clear(); }
function loadEntry(key: string, read: () => Promise<ThumbnailBytes>, options: ThumbnailOptions): Promise<Entry | null> {
  if (options.isCurrent && !options.isCurrent()) return Promise.resolve(null);
  const hit = fresh(key); if (hit && !options.revalidate) return Promise.resolve(hit);
  const pending = inflight.get(key); if (pending) return pending;
  const epoch = options.hostId ? hostEpochs.get(options.hostId) ?? 0 : 0, round = generation;
  const current = () => round === generation && (!options.hostId || epoch === (hostEpochs.get(options.hostId) ?? 0)) && (options.isCurrent?.() ?? true);
  const p = limitedRead(() => { if (!current()) throw Error("thumbnail_stale"); return read(); }).then((file) => {
    if (!current()) return null;
    let src: string | null = null, object = false;
    if (file.encoding === "bytes") {
      const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
      if (!file.truncated && bytes.byteLength === file.size && file.size > 0 && file.size <= MAX_BLOB_BYTES && /^image\/(png|jpeg|gif|webp|bmp|avif|x-icon|svg\+xml)$/.test(file.mime)) {
        // A fresh array owns the backing buffer; no IPC/base64 body survives in React state.
        src = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: file.mime })); object = true;
      }
    } else src = thumbnailSrc(file, "", options.maxBytes);
    const entry: Entry = { src, at: Date.now(), weight: object ? file.size : src?.length ?? 0, object, refs: 0, retired: false, hostId: options.hostId };
    remember(key, entry); return entry;
  }).catch((error: unknown) => {
    if (!current()) return null;
    const entry: Entry = { src: null, at: Date.now(), weight: 0, object: false, refs: 0, retired: false, hostId: options.hostId };
    if (error instanceof ThumbnailUnavailable) remember(key, entry);
    return entry;
  }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p); return p;
}
export async function loadThumbnail(key: string, read: () => Promise<ThumbnailBytes>, options: ThumbnailOptions = {}): Promise<string | null> {
  return (await loadEntry(key, read, options))?.src ?? null;
}
export type ThumbnailState = { status: "idle" | "loading" } | { status: "ok"; src: string } | { status: "failed" };
export function useThumbnail(key: string | null, read: (() => Promise<ThumbnailBytes>) | null, options: ThumbnailOptions = {}) {
  const ref = useRef<HTMLElement | null>(null), readRef = useRef(read), optionsRef = useRef(options);
  readRef.current = read; optionsRef.current = options;
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<{ key: string | null; state: ThumbnailState }>({ key: null, state: { status: "idle" } });
  useEffect(() => {
    if (!key || visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new (ownerWindowOf(el).IntersectionObserver)((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "300px 0px" });
    io.observe(el); return () => io.disconnect();
  }, [key, visible]);
  useEffect(() => {
    const reader = readRef.current; if (!key || !reader || !visible) return;
    let live = true; const lease: Lease = {};
    const set = leases.get(key) ?? new Set<Lease>(); set.add(lease); leases.set(key, set);
    const hit = optionsRef.current.revalidate ? null : fresh(key); if (hit) { lease.entry = hit; hit.refs++; }
    setShown({ key, state: { status: "loading" } });
    void loadEntry(key, reader, optionsRef.current).then((entry) => {
      if (!live) return;
      if (optionsRef.current.isCurrent && !optionsRef.current.isCurrent()) { setShown({ key, state: { status: "failed" } }); return; }
      if (entry && !lease.entry) { lease.entry = entry; entry.refs++; }
      setShown({ key, state: entry?.src ? { status: "ok", src: entry.src } : { status: "failed" } });
    });
    return () => {
      live = false; set.delete(lease); if (!set.size) leases.delete(key);
      if (lease.entry) { lease.entry.refs--; if (lease.entry.retired) retire(lease.entry); }
    };
  }, [key, visible]);
  return { ref, state: shown.key === key ? shown.state : { status: "idle" } as ThumbnailState };
}
