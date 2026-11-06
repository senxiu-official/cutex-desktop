import { type MemoryHost } from "@cutex-desktop/cutex-client";
import type { DaemonState } from "../../../shared/ipc";
import { bridge, apiFor } from "../bridge";
import { useApp, refreshLayoutPins, localPinnedKeys } from "../store";
import { getLocalLayoutPrefs, refreshLayoutPrefs } from "./prefs";
import { hostData } from "./hostScope";
import { hostAccessNow, hostAccessStore } from "./hostAccess";
import { createUserLayout, layoutStore, setLayoutStore } from "./userLayout";
import { describeLayoutHost, type LayoutHost } from "./userLayoutModel";

export { useLayoutView } from "./userLayoutView";
import { useLayoutView } from "./userLayoutView";

/** One listener per window, independent of focus/scope. Network activity only on host transitions/events/edits. */
export function startUserLayout(): () => void {
  const store = createUserLayout({
    storage: localStorage,
    local: () => ({ ...getLocalLayoutPrefs(), pinned: localPinnedKeys() }),
    backend: id => ({ get: () => apiFor(id).userLayout(), put: (revision, data) => apiFor(id).putUserLayout("sidebar", revision, data) }),
    saveMemoryHost: async h => { await bridge.shell?.setMemoryHost?.(h); },
  });
  setLayoutStore(store);
  let stopped = false;
  let signature = "";
  const liveStates = new Map<string, { epoch: string; state: DaemonState }>();
  const notify = () => {
    const s = store.state.getState();
    useLayoutView.setState({ doc: s.doc, memoryHost: s.memoryHost, hosts: s.hosts, status: s.status, error: s.error, migration: s.migration, ownerPersonConfirmed: s.ownerPersonConfirmed, pending: s.pending });
    refreshLayoutPrefs(); refreshLayoutPins();
  };
  const offLayout = store.state.subscribe(notify);
  const visited = new Set<string>();
  async function discover(hosts: LayoutHost[]) {
    for (const h of hosts) {
      if (!h.online || !h.supported || !h.eligible || visited.has(h.id)) continue;
      visited.add(h.id);
      try {
        const r = await apiFor(h.id).userLayout();
        if (stopped || !r.ok) continue;
        if (!store.state.getState().memoryHost && r.value.pointer) {
          await store.choose({ instanceId: r.value.pointer.memoryHost, label: r.value.pointer.label }, true);
        }
        const memory = store.state.getState().memoryHost;
        if (memory && r.value.pointer?.memoryHost !== memory.instanceId) await apiFor(h.id).putLayoutPointer(memory);
      } catch { visited.delete(h.id); }
    }
  }
  const updateHosts = () => {
    const s = useApp.getState();
    const hosts = (s.hosts?.hosts ?? []).map(h => {
      const d = hostData(s, h.id); const a = hostAccessNow(h.id);
      const observed = liveStates.get(h.id);
      const connection = observed && observed.epoch === h.conn?.epoch ? observed.state : h.conn?.daemon;
      return describeLayoutHost(h.id, h.label, connection, d, !a.pending);
    });
    const next = JSON.stringify(hosts);
    if (signature === next) return;
    signature = next;
    for (const h of hosts) if (!h.online) visited.delete(h.id);
    store.setHosts(hosts);
    void store.refresh(); void discover(hosts);
  };
  const offApp = useApp.subscribe(updateHosts);
  const offAccess = hostAccessStore.subscribe(updateHosts);
  // HostManager publishes connection metadata on connect, while later daemon states arrive on
  // their own tagged channel. Keep that authoritative per-epoch stream, rather than a focus slice.
  const offDaemon = bridge.on("daemonState", ({ hostId, epoch, state }) => {
    if (useApp.getState().hosts?.hosts.find(h => h.id === hostId)?.conn?.epoch !== epoch) return;
    liveStates.set(hostId, { epoch, state });
    updateHosts();
  });
  const offEvent = bridge.on("hostEvent", ({ hostId, envelope }) => {
    if (envelope.cutex?.method !== "cutex/users/me/layoutChanged") return;
    const p = envelope.cutex.params as { docKey?: string; revision?: number; section?: string; pointer?: { memoryHost?: string; label?: string } } | undefined;
    if (p?.section === "pointer" && p.pointer?.memoryHost && p.pointer.label && !store.state.getState().memoryHost) {
      void store.choose({ instanceId: p.pointer.memoryHost, label: p.pointer.label }, true);
    }
    if (store.state.getState().hosts.find(h => h.id === hostId)?.instanceId === store.state.getState().memoryHost?.instanceId && p?.section === "sidebar" && p.docKey && typeof p.revision === "number") store.invalidate(p.docKey, p.revision);
  });
  const offResync = bridge.on("hostResync", () => void store.refresh());
  void bridge.shell?.state().then(s => {
    if (!stopped && s.prefs.memoryHost && !store.state.getState().memoryHost) void store.choose(s.prefs.memoryHost, true);
  });
  updateHosts(); notify();
  return () => { stopped = true; store.dispose(); offLayout(); offApp(); offAccess(); offDaemon(); offEvent(); offResync(); setLayoutStore(null); };
}

export async function chooseMemoryHost(host: MemoryHost) {
  await layoutStore()?.choose(host);
  // Pointer failures do not undo the chosen host or its document. A later reconnect retries them.
  await Promise.allSettled(useLayoutView.getState().hosts.filter(h => h.online && h.supported && h.eligible).map(h => apiFor(h.id).putLayoutPointer(host)));
}
