// Folder listings for the 文件 explorer: read through cutex `fs/dir` on demand (only the folders the tree
// wants: the current one, the open ones), re-read when the workspace watch says a folder changed
// (lib/workspaceRefresh DirVersions; a folder read while closed is re-read when it opens again if it changed
// meanwhile). A failed re-read keeps the listing it had (offline host: the last contents stay); each read
// carries a sequence number so a late, older answer never replaces a newer one. One read per folder at a
// time: changes during it read once more after it (its answer carries the older version). A transient
// failure (host busy, connection dropped: lib/transientError.ts) reads that folder again by itself after
// 1, 2, 5, 10, then every 30 s; `reload()` reads every failed folder now (重新加载).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DaemonApi, FsEntry, WorkspaceScope } from "../../../../../shared/ipc";
import { sameEntries, type DirVersions } from "../../../lib/workspaceRefresh";
import { workspaceError } from "../../../lib/workspaceView";
import { isTransientError, retryDelay } from "../../../lib/transientError";
import type { Listing } from "./model";

interface Slot extends Listing {
  /** DirVersions version the listing was read at (-1 = never). */
  version: number;
  /** A read failed for a folder that is not there (path_not_found / not_a_directory). */
  missing: boolean;
  /** The last read failed (listing kept, or `error`). */
  failed?: boolean;
}

const MISSING = /(?:^|[^a-z_])(path_not_found|not_a_directory)\b/;

export interface ListingsView {
  listings: ReadonlyMap<string, Listing>;
  /** Folders that are not there any more (the explorer moves up from such a current folder). */
  missing: ReadonlySet<string>;
  /** The last read failed while a listing is shown (host offline / unreachable). */
  stale: boolean;
  /** A failed folder read will be retried by itself (transient failure). */
  retrying: boolean;
  /** 重新加载: read every folder whose last read failed, now. */
  reload(): void;
  /** Read one folder now (a breadcrumb dropdown of a folder not shown yet). */
  read(path: string): Promise<FsEntry[]>;
}

export function useListings(api: DaemonApi, scope: WorkspaceScope | null, dirs: DirVersions, wanted: readonly string[]): ListingsView {
  const [slots, setSlots] = useState<ReadonlyMap<string, Slot>>(new Map());
  const [stale, setStale] = useState(false);
  const seq = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, number>());
  /** Transient failures in a row per folder, and the pending retry of each. */
  const failures = useRef(new Map<string, number>());
  const retries = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [retrying, setRetrying] = useState(false);
  const clearRetries = () => {
    for (const timer of retries.current.values()) clearTimeout(timer);
    retries.current.clear();
    failures.current.clear();
    setRetrying(false);
  };
  /** Read `paths` again on the next pass (their slot's version no longer matches). */
  const rereadSoon = (paths: Iterable<string>) => setSlots((prev) => {
    let next: Map<string, Slot> | null = null;
    for (const path of paths) {
      const slot = prev.get(path);
      if (!slot) continue;
      next ??= new Map(prev);
      next.set(path, { ...slot, version: -1 });
    }
    return next ?? prev;
  });
  // A rejection that lands after unmount must not schedule a retry (cross-review 2026-11-16).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearRetries();
    };
  }, []);
  // A new workspace / host: start over. Sequence numbers move on, so a late answer from the old workspace
  // never matches (a folder read again here, or not at all).
  useEffect(() => {
    setSlots(new Map());
    setStale(false);
    clearRetries();
    for (const [path, n] of seq.current) seq.current.set(path, n + 1);
    inflight.current = new Map();
  }, [api, scope]);
  const key = wanted.join("\n");
  const versions = useSyncExternalStore(dirs.subscribe, () => wanted.map((p) => dirs.version(p)).join(","));
  useEffect(() => {
    if (!scope) return;
    for (const path of wanted) {
      const version = dirs.version(path);
      const slot = slots.get(path);
      if (slot && slot.version === version) continue;
      if (inflight.current.has(path)) continue;
      // In backoff: changes meanwhile join the scheduled retry (which reads the newest version) instead of reading now.
      if (retries.current.has(path)) continue;
      inflight.current.set(path, version);
      const n = (seq.current.get(path) ?? 0) + 1;
      seq.current.set(path, n);
      api.fsDir(scope, path).then(
        (d) => {
          if (!alive.current || seq.current.get(path) !== n) return;
          inflight.current.delete(path);
          failures.current.delete(path);
          const pending = retries.current.get(path);
          if (pending) {
            clearTimeout(pending);
            retries.current.delete(path);
            if (!retries.current.size) setRetrying(false);
          }
          setStale(false);
          setSlots((prev) => {
            const old = prev.get(path);
            const entries = old?.entries && sameEntries(old.entries, d.entries) ? old.entries : d.entries;
            return new Map(prev).set(path, { entries, error: null, version, missing: false });
          });
        },
        (e: unknown) => {
          if (!alive.current || seq.current.get(path) !== n) return;
          inflight.current.delete(path);
          const message = e instanceof Error ? e.message : String(e);
          const missing = MISSING.test(message);
          if (!missing && isTransientError(e) && !retries.current.has(path)) {
            const attempt = failures.current.get(path) ?? 0;
            failures.current.set(path, attempt + 1);
            retries.current.set(path, setTimeout(() => {
              retries.current.delete(path);
              if (!retries.current.size) setRetrying(false);
              rereadSoon([path]);
            }, retryDelay(attempt)));
            setRetrying(true);
          }
          setSlots((prev) => {
            const old = prev.get(path);
            // Keep what was shown (an offline host); a folder that went away shows the error.
            if (old?.entries && !missing) {
              setStale(true);
              return new Map(prev).set(path, { ...old, version, failed: true });
            }
            return new Map(prev).set(path, { entries: null, error: workspaceError(e), version, missing, failed: true });
          });
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, scope, key, versions, slots]);
  return useMemo(() => {
    const missing = new Set<string>();
    for (const [p, s] of slots) if (s.missing) missing.add(p);
    return {
      listings: slots,
      missing,
      stale,
      retrying,
      reload: () => {
        clearRetries();
        rereadSoon([...slots].filter(([, s]) => s.failed).map(([p]) => p));
      },
      read: async (path: string) => {
        const have = slots.get(path)?.entries;
        if (have) return have;
        if (!scope) return [];
        return (await api.fsDir(scope, path)).entries;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, stale, retrying, api, scope]);
}
