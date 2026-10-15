// Inline image thumbnails for file links in messages: bytes come from cutex `fs/file` (workspace
// scope) or `GET /v2/fs/file` (fs-file-read, host path) through the bridge — never the local disk —
// or, for `cutex:` image links (v1.7), from the kind's `ref.target` provider (`thumbnail`).
// Results are cached in memory per host + scope + path (bounded), so re-rendered / re-mounted
// messages do not read the file again; failures are remembered briefly.
import { useEffect, useRef, useState } from "react";
import type { FsFile } from "../../../shared/ipc";
import { thumbnailSrc } from "./fileKinds";

/** What a reader hands back: a host file read, or a `ref.target` thumbnail (same shape, v1.7). */
export type ThumbnailBytes = Pick<FsFile, "encoding" | "content" | "mime" | "size" | "truncated">;

interface Entry {
  src: string | null;
  at: number;
}

/** Re-read a cached image after this long (an agent may rewrite a screenshot at the same path). */
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 30_000;
/** Total data-URL characters kept (~64 MB of strings). */
const MAX_CACHE_CHARS = 64 * 1024 * 1024;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
let cachedChars = 0;

function remember(key: string, entry: Entry) {
  const old = cache.get(key);
  if (old) {
    cachedChars -= old.src?.length ?? 0;
    cache.delete(key);
  }
  cache.set(key, entry);
  cachedChars += entry.src?.length ?? 0;
  // Map iteration order = insertion order: evict the oldest first.
  for (const [k, e] of cache) {
    if (cachedChars <= MAX_CACHE_CHARS || k === key) break;
    cache.delete(k);
    cachedChars -= e.src?.length ?? 0;
  }
}

function fresh(key: string): Entry | null {
  const e = cache.get(key);
  if (!e) return null;
  return Date.now() - e.at < (e.src ? OK_TTL_MS : FAIL_TTL_MS) ? e : null;
}

/** Load (or reuse) the thumbnail for `key`; null = not renderable (missing, too big, not an image). */
export function loadThumbnail(key: string, read: () => Promise<ThumbnailBytes>): Promise<string | null> {
  const hit = fresh(key);
  if (hit) return Promise.resolve(hit.src);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = read()
    .then((file) => {
      const src = thumbnailSrc(file);
      remember(key, { src, at: Date.now() });
      return src;
    })
    .catch(() => {
      remember(key, { src: null, at: Date.now() });
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export type ThumbnailState = { status: "idle" | "loading" } | { status: "ok"; src: string } | { status: "failed" };

/**
 * Thumbnail for `key` once `ref`'s element has scrolled near the viewport. `key` null = nothing to
 * load (stays idle). `read` may change identity freely; only `key` restarts the load.
 */
export function useThumbnail(key: string | null, read: (() => Promise<ThumbnailBytes>) | null) {
  const ref = useRef<HTMLElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ThumbnailState>(() => {
    const hit = key ? fresh(key) : null;
    return hit ? (hit.src ? { status: "ok", src: hit.src } : { status: "failed" }) : { status: "idle" };
  });

  useEffect(() => {
    if (!key || visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [key, visible]);

  useEffect(() => {
    const reader = readRef.current;
    if (!key || !reader || !visible) return;
    let live = true;
    const hit = fresh(key);
    if (hit) {
      setState(hit.src ? { status: "ok", src: hit.src } : { status: "failed" });
      return;
    }
    setState({ status: "loading" });
    void loadThumbnail(key, reader).then((src) => live && setState(src ? { status: "ok", src } : { status: "failed" }));
    return () => {
      live = false;
    };
  }, [key, visible]);

  return { ref, state };
}
