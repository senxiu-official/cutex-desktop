// Pure helpers of the cross-host lists and counts (multi-host P1 step 2b; React side: lib/hostLists).
// Unit-tested in test/hostLists.test.ts.
import { LOCAL_HOST_ID, type HostsState } from "../../../shared/hosts";
import type { HostData, HostLook } from "./hostScope";

/** Every connected host (the focus host + those with a live connection), switcher order (RFC §10 counts). */
export function connectedHostIds(hosts: Pick<HostsState, "hosts" | "active"> | null): string[] {
  if (!hosts) return [LOCAL_HOST_ID];
  return hosts.hosts.filter((h) => h.id === hosts.active || !!h.conn?.epoch).map((h) => h.id);
}

/** Hosts of the scope a list has no rows from (not connected / capabilities not loaded yet): the RFC §8.5 notice. */
export function hostsWithoutData(inScope: readonly HostLook[], data: readonly Pick<HostData, "hostId" | "featuresKnown">[]): HostLook[] {
  const have = new Set(data.filter((d) => d.featuresKnown).map((d) => d.hostId));
  return inScope.filter((h) => !have.has(h.id));
}

/** Hosts whose rows are a snapshot from before their daemon went away (shown greyed, actions off; RFC §8.5). */
export function staleHostIds(data: readonly Pick<HostData, "hostId" | "featuresKnown" | "daemon">[]): Set<string> {
  return new Set(data.filter((d) => d.featuresKnown && d.daemon.kind !== "connected").map((d) => d.hostId));
}

/** A cross-host page is supported when any of its hosts has the capability (RFC §9.1, ★ Q12). */
export const anyHostHas = (data: readonly Pick<HostData, "features">[], feature: string) => data.some((d) => d.features.has(feature));

/** 需要你 「其他主机 N 项」 (★ Q15): attention of the connected hosts outside the scope. */
export function outOfScopeCount(byHost: Readonly<Record<string, number>>, isInScope: (hostId: string) => boolean): number {
  let n = 0;
  for (const [hostId, count] of Object.entries(byHost)) if (!isInScope(hostId)) n += count;
  return n;
}
