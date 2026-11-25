// The hosts of the sidebar's scope that can use session search (harness C3, cutex r295 session-search-v1): connected
// with the capability; which of them have r297 session-search-v2. The shell (components/Sidebar) names no feature; it asks here.
import { useMemo } from "react";
import { hostEpoch } from "../../../shared/hosts";
import { SESSION_SEARCH_FEATURE, SESSION_SEARCH_V2_FEATURE } from "../../../shared/sessionSearch";
import { featuresOf, useApp } from "../store";
import { useNonOwnerHosts } from "./hostAccess";
import type { HostLook } from "./hostScope";
import type { ScopedSidebar } from "./scopedSidebarView";

/** The hosts of the scope this search can use (connected, with session-search-v1), and which of them are owner connections. */
export interface SessionSearchHosts {
  capable: readonly HostLook[];
  owner: ReadonlySet<string>;
  /** Capable hosts with session-search-v2: newest order, time / project / kind / sender filters, turn times. */
  v2: ReadonlySet<string>;
  /** Several hosts in scope: name the host on filters and results. */
  multi: boolean;
}

/** `hosts`: capable hosts and which are owner connections; `epochs`: changes with any capable host's connection. */
export function useSessionSearchHosts(scoped: Pick<ScopedSidebar, "hosts">, multi: boolean): { hosts: SessionSearchHosts; epochs: string } {
  const live = (s: Parameters<typeof featuresOf>[0], feature: string) => scoped.hosts.filter((h) => h.state === "live" && featuresOf(s, h.look.id).has(feature)).map((h) => h.look.id).join("\n");
  const capableKey = useApp((s) => live(s, SESSION_SEARCH_FEATURE));
  const v2Key = useApp((s) => live(s, SESSION_SEARCH_V2_FEATURE));
  // Known access per host (owners too; unknown = the owner, lib/hostAccess).
  const access = useNonOwnerHosts();
  const hosts = useMemo<SessionSearchHosts>(() => {
    const ids = capableKey ? capableKey.split("\n") : [];
    const v2 = v2Key ? v2Key.split("\n").filter((id) => ids.includes(id)) : [];
    return { capable: scoped.hosts.filter((h) => ids.includes(h.look.id)).map((h) => h.look), owner: new Set(ids.filter((id) => access[id]?.isOwner ?? true)), v2: new Set(v2), multi };
  }, [capableKey, v2Key, access, scoped.hosts, multi]);
  const epochs = useApp((s) => hosts.capable.map((h) => `${h.id}=${hostEpoch(s.hosts, h.id) ?? ""}`).join("\n"));
  return { hosts, epochs };
}
