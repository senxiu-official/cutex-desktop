// The open agent's host's home directory (for `~/…` file links), from `GET /v2/fs/dirs` with no path
// (fs-dir-browse). Fetched lazily once per host; null while unknown or on older cutex.
import { useEffect, useState } from "react";
import { hostApi } from "../store";
import { useConvHost } from "./conversationScope";


const homes = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

/** The host's home (cached once known); null on older cutex or while the daemon is down. */
export function loadHostHome(hostId: string): Promise<string | null> {
  let p = pending.get(hostId);
  if (!p) {
    p = hostApi(hostId).browseDirs().then(
      (r) => {
        const home = r?.home ?? null;
        homes.set(hostId, home);
        return home;
      },
      () => {
        // Daemon down: retry on a later mount instead of caching the failure.
        pending.delete(hostId);
        return null;
      },
    );
    pending.set(hostId, p);
  }
  return p;
}

/** Home of the conversation's host (lib/conversationScope; the focus host without an agent); only fetched when `needed` (a link starts with `~`). */
export function useHostHome(needed: boolean): string | null {
  return useHostHomeOf(useConvHost(), needed);
}

/** Home of `hostId`; only fetched when `needed`. */
export function useHostHomeOf(hostId: string, needed: boolean): string | null {
  const [home, setHome] = useState<string | null>(() => homes.get(hostId) ?? null);
  useEffect(() => {
    if (!needed) return;
    if (homes.has(hostId)) {
      setHome(homes.get(hostId) ?? null);
      return;
    }
    let live = true;
    void loadHostHome(hostId).then((h) => live && setHome(h));
    return () => {
      live = false;
    };
  }, [hostId, needed]);
  return needed ? home : null;
}
