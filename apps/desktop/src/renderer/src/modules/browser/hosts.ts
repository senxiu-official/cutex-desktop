// The binding's connection is the lifetime boundary, not the focus host. A hostsState notification
// can supersede (and filter out) main's old-epoch closed event, so metadata must also follow this store.
import { hostEpoch, type HostsState } from "../../../../shared/hosts";
import { useApp } from "../../store";
import { browserCache } from "./browserCache";

export function browserHostEpoch(hosts: Pick<HostsState, "hosts"> | null | undefined, hostId: string | null): string | null {
  return hostId ? hostEpoch(hosts, hostId) : null;
}

export function useBrowserHostEpoch(hostId: string | null): string | null {
  return useApp((state) => browserHostEpoch(state.hosts, hostId));
}

export function browserHostCurrent(hostId: string | null, epoch: string | null): boolean {
  return !!hostId && !!epoch && browserHostEpoch(useApp.getState().hosts, hostId) === epoch;
}

export function changedBrowserHosts(before: Pick<HostsState, "hosts"> | null, after: Pick<HostsState, "hosts"> | null): string[] {
  return [...new Set([...(before?.hosts ?? []).map((host) => host.id), ...(after?.hosts ?? []).map((host) => host.id)])]
    .filter((id) => browserHostEpoch(before, id) !== browserHostEpoch(after, id));
}

export function watchBrowserHosts(changed?: (hostId: string, epoch: string | null) => void): () => void {
  return useApp.subscribe((state, previous) => {
    if (state.hosts === previous.hosts) return;
    for (const hostId of changedBrowserHosts(previous.hosts, state.hosts)) { browserCache.removeHost(hostId); changed?.(hostId, browserHostEpoch(state.hosts, hostId)); }
  });
}

/** Preload commits its new bindings only after all hostsState listeners have returned. */
export function afterBrowserHostsDelivered(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
