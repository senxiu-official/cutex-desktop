// Lazy thumbnail bytes are shared in a bounded cache. New history blobs use object URLs;
// the old file/provider data URL shape remains supported. Mounted readers retain an evicted
// object URL until their last lease ends, so cache churn cannot break a visible lightbox.
// An image already in memory shows at once when its view mounts again (no loading placeholder, no read). A host file
// that may change (`revalidate` + `version`) is then checked in the background by a byte-free size / mtime read at
// most once per CHECK_MS, and its bytes are read again only when that version changed.
import { useEffect, useRef, useState } from "react";
import type { FsFile } from "../../../shared/ipc";
import { thumbnailSrc } from "./fileKinds";
import { ownerWindowOf } from "./ownerWindow";

export type ThumbnailBytes = Pick<FsFile, "encoding" | "content" | "mime" | "size" | "truncated">
  | { encoding: "bytes"; bytes: Uint8Array | ArrayBuffer; mime: string; size: number; truncated: boolean };
/**
 * `maxBytes`: the largest fs/file body shown (default THUMBNAIL_MAX_BYTES; a sent image may be as big as its send cap).
 * `revalidate`: the bytes behind the key may change (a host file). Without `version` such a key is read again on every
 * mount; with it a copy in memory is shown, and `version()` — the file's version without its bytes (`fileVersion` of
 * an `fs/file` read of one byte) — decides whether to read again.
 */
export interface ThumbnailOptions { hostId?: string; isCurrent?(): boolean; maxBytes?: number; revalidate?: boolean; version?: () => Promise<string | null> }
/**
 * A read that answered: the image is not there or not valid. Only this failure is cached (FAIL_TTL_MS);
 * any other (transport, the read queue full) is not, so the next mount reads again instead of keeping
 * a transient failure as 图片读取失败.
 */
export class ThumbnailUnavailable extends Error {}
interface Entry { src: string | null; at: number; weight: number; object: boolean; refs: number; retired: boolean; hostId?: string; version?: string | null; checked?: number }
interface Lease { entry?: Entry }
const OK_TTL_MS = 5 * 60_000, FAIL_TTL_MS = 30_000;
/** A versioned host file in memory: kept this long (its version check guards it), checked at most once per CHECK_MS. */
const VERSIONED_TTL_MS = 30 * 60_000, CHECK_MS = 60_000;
export const THUMBNAIL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const THUMBNAIL_CACHE_MAX_ENTRIES = 256;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();
const checking = new Map<string, Promise<Entry | null>>();
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

// Version checks have their own small queue: a remount after CHECK_MS checks every image in memory at once, and those
// checks must neither flood the host nor fill the byte-read queue (a full one fails a first read).
let activeChecks = 0;
const waitingChecks: (() => void)[] = [];
function limitedCheck(check: () => Promise<string | null>): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeChecks++;
      void Promise.resolve().then(check).then(resolve, reject).finally(() => { activeChecks--; waitingChecks.shift()?.(); });
    };
    if (activeChecks < 4) run(); else waitingChecks.push(run);
  });
}

/** A host file's version from an `fs/file` reply (its size and mtime); null when the reply has none. */
export function fileVersion(file: Partial<Pick<FsFile, "size" | "modifiedAt">> | null | undefined): string | null {
  return file && typeof file.modifiedAt === "string" && file.modifiedAt && Number.isFinite(file.size) ? `${file.size}|${file.modifiedAt}` : null;
}
const ttl = (e: Entry) => (!e.src ? FAIL_TTL_MS : e.version ? VERSIONED_TTL_MS : OK_TTL_MS);
/** A hit these options may show without reading: any image, unless the key may change and has no version to check. */
const usable = (e: Entry, options: ThumbnailOptions) => !!e.src && (!options.revalidate || (!!options.version && !!e.version));
const checkDue = (e: Entry, options: ThumbnailOptions) => !!options.revalidate && !!options.version && !!e.version && Date.now() - (e.checked ?? e.at) >= CHECK_MS;
function retire(entry: Entry) {
  entry.retired = true;
  if (!entry.refs && entry.object && entry.src) { URL.revokeObjectURL(entry.src); entry.src = null; }
}
function drop(key: string) { const e = cache.get(key); if (e) { cache.delete(key); cacheBytes -= e.weight; retire(e); } }
function fresh(key: string): Entry | null {
  const e = cache.get(key); if (!e) return null;
  if (Date.now() - e.at >= ttl(e)) { drop(key); return null; }
  cache.delete(key); cache.set(key, e); return e;
}
/** `fresh` without touching the cache (safe during render): a hit these options may show now. */
function peek(key: string, options: ThumbnailOptions): Entry | null {
  const e = cache.get(key);
  return e && !e.retired && Date.now() - e.at < ttl(e) && usable(e, options) ? e : null;
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
export function resetThumbnailCache(): void { generation++; for (const key of [...cache.keys()]) drop(key); inflight.clear(); checking.clear(); }
/**
 * The background check of a versioned hit: its version again (no bytes). Unchanged → the hit stays (checked now);
 * changed → the bytes are read again and the new entry is the answer. A failed check keeps the hit (a transient
 * transport error never replaces a shown image) and is tried again after CHECK_MS. null = nothing new.
 */
function recheck(key: string, entry: Entry, read: () => Promise<ThumbnailBytes>, options: ThumbnailOptions): Promise<Entry | null> {
  const active = checking.get(key); if (active) return active;
  entry.checked = Date.now();
  const round = generation;
  const versionOf = options.version!;
  const p: Promise<Entry | null> = limitedCheck(() => round === generation && cache.get(key) === entry ? versionOf() : Promise.resolve(entry.version ?? null)).then((version) => {
    if (round !== generation || cache.get(key) !== entry || version === entry.version) return null;
    drop(key);
    return loadEntry(key, read, options);
  }, () => null).finally(() => { if (checking.get(key) === p) checking.delete(key); });
  checking.set(key, p); return p;
}
function loadEntry(key: string, read: () => Promise<ThumbnailBytes>, options: ThumbnailOptions): Promise<Entry | null> {
  if (options.isCurrent && !options.isCurrent()) return Promise.resolve(null);
  const hit = fresh(key);
  if (hit && (usable(hit, options) || (!hit.src && !options.revalidate))) {
    if (checkDue(hit, options)) void recheck(key, hit, read, options);
    return Promise.resolve(hit);
  }
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
    const now = Date.now(), version = src && options.version ? fileVersion(file as Partial<FsFile>) : null;
    const entry: Entry = { src, at: now, weight: object ? file.size : src?.length ?? 0, object, refs: 0, retired: false, hostId: options.hostId, version, checked: now };
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
  // Already in memory (a view mounted again): shown from the first render, without waiting to be scrolled near.
  const held = key && read && shown.key !== key ? peek(key, options) : null;
  useEffect(() => {
    if (!key || visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new (ownerWindowOf(el).IntersectionObserver)((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "300px 0px" });
    io.observe(el); return () => io.disconnect();
  }, [key, visible]);
  useEffect(() => {
    const reader = readRef.current, opts = optionsRef.current; if (!key || !reader) return;
    const hit = fresh(key), trusted = hit && usable(hit, opts) ? hit : null;
    if (!trusted && !visible) return;
    let live = true; const lease: Lease = {};
    const set = leases.get(key) ?? new Set<Lease>(); set.add(lease); leases.set(key, set);
    const hold = (entry: Entry) => {
      if (lease.entry === entry) return;
      const before = lease.entry; lease.entry = entry; entry.refs++;
      if (before) { before.refs--; if (before.retired) retire(before); }
    };
    const show = (entry: Entry | null) => {
      if (!live) return;
      if (opts.isCurrent && !opts.isCurrent()) { setShown({ key, state: { status: "failed" } }); return; }
      if (entry) hold(entry);
      setShown({ key, state: entry?.src ? { status: "ok", src: entry.src } : { status: "failed" } });
    };
    if (trusted) {
      show(trusted);
      // A check this effect started, or one still running from an earlier pass (the visibility re-run).
      const check = checkDue(trusted, opts) ? recheck(key, trusted, reader, opts) : checking.get(key);
      void check?.then((next) => { if (next) show(next); });
    } else {
      setShown({ key, state: { status: "loading" } });
      void loadEntry(key, reader, opts).then(show);
    }
    return () => {
      live = false; set.delete(lease); if (!set.size) leases.delete(key);
      if (lease.entry) { lease.entry.refs--; if (lease.entry.retired) retire(lease.entry); }
    };
  }, [key, visible]);
  const state: ThumbnailState = shown.key === key ? shown.state : held?.src ? { status: "ok", src: held.src } : { status: "idle" };
  return { ref, state };
}
