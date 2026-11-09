// Folder listings for the 文件 explorer: read through cutex `fs/dir` on demand (only the folders the tree
// wants: the current one, the open ones), re-read when the workspace watch says a folder changed
// (lib/workspaceRefresh DirVersions; a folder read while closed is re-read when it opens again if it changed
// meanwhile). A failed re-read keeps the listing it had (offline host: the last contents stay); each read
// carries a sequence number so a late, older answer never replaces a newer one. One read per folder at a
// time: changes during it read once more after it (its answer carries the older version).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DaemonApi, FsEntry, WorkspaceScope } from "../../../../../shared/ipc";
import { sameEntries, type DirVersions } from "../../../lib/workspaceRefresh";
import { workspaceError } from "../../../lib/workspaceView";
import type { Listing } from "./model";

interface Slot extends Listing {
  /** DirVersions version the listing was read at (-1 = never). */
  version: number;
  /** A read failed for a folder that is not there (path_not_found / not_a_directory). */
  missing: boolean;
}

const MISSING = /(?:^|[^a-z_])(path_not_found|not_a_directory)\b/;

export interface ListingsView {
  listings: ReadonlyMap<string, Listing>;
  /** Folders that are not there any more (the explorer moves up from such a current folder). */
  missing: ReadonlySet<string>;
  /** The last read failed while a listing is shown (host offline / unreachable). */
  stale: boolean;
  /** Read one folder now (a breadcrumb dropdown of a folder not shown yet). */
  read(path: string): Promise<FsEntry[]>;
}

export function useListings(api: DaemonApi, scope: WorkspaceScope | null, dirs: DirVersions, wanted: readonly string[]): ListingsView {
  const [slots, setSlots] = useState<ReadonlyMap<string, Slot>>(new Map());
  const [stale, setStale] = useState(false);
  const seq = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, number>());
  // A new workspace / host: start over. Sequence numbers move on, so a late answer from the old workspace
  // never matches (a folder read again here, or not at all).
  useEffect(() => {
    setSlots(new Map());
    setStale(false);
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
      inflight.current.set(path, version);
      const n = (seq.current.get(path) ?? 0) + 1;
      seq.current.set(path, n);
      api.fsDir(scope, path).then(
        (d) => {
          if (seq.current.get(path) !== n) return;
          inflight.current.delete(path);
          setStale(false);
          setSlots((prev) => {
            const old = prev.get(path);
            const entries = old?.entries && sameEntries(old.entries, d.entries) ? old.entries : d.entries;
            return new Map(prev).set(path, { entries, error: null, version, missing: false });
          });
        },
        (e: unknown) => {
          if (seq.current.get(path) !== n) return;
          inflight.current.delete(path);
          const message = e instanceof Error ? e.message : String(e);
          const missing = MISSING.test(message);
          setSlots((prev) => {
            const old = prev.get(path);
            // Keep what was shown (an offline host); a folder that went away shows the error.
            if (old?.entries && !missing) {
              setStale(true);
              return new Map(prev).set(path, { ...old, version });
            }
            return new Map(prev).set(path, { entries: null, error: workspaceError(e), version, missing });
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
      read: async (path: string) => {
        const have = slots.get(path)?.entries;
        if (have) return have;
        if (!scope) return [];
        return (await api.fsDir(scope, path)).entries;
      },
    };
  }, [slots, stale, api, scope]);
}
