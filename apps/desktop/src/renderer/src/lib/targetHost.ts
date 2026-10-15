// The target host of a form or settings page (multi-host P1 step 2c; RFC §9.2 / §9.3): the host the
// page reads from and writes to, which may differ from the focus host (`api`). Pages under a
// `TargetHostContext.Provider` (Settings → host pages, the new-agent form) use these hooks instead of
// `api` / `useApp((s) => s.features)` / `s.sidebar`; without a provider they fall back to the focus
// host, so the same components keep working anywhere else.
import { createContext, useContext, useMemo } from "react";
import { create } from "zustand";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import type { DaemonApi, QuotaGauge, SidebarSnapshot } from "../../../shared/ipc";
import { api, apiFor, bridge } from "../bridge";
import { agentHost, featuresOf, useApp } from "../store";
import { QUOTA_NATIVE_FEATURE, QUOTA_UPDATED_EVENT, quotaEventProfiles } from "./quota";
import { onHostReset } from "./hostSwitch";
import { useHostData } from "./useHostScope";
import { useHeldHostData } from "./heldHostData";

/** null = the focus host. */
export const TargetHostContext = createContext<string | null>(null);

const NO_FEATURES: ReadonlySet<string> = new Set();

/** The focus host id (`HostsState.active`). */
export const useFocusHostId = (): string => useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);

/** The page's target host id (provider value, else the focus host). */
export function useTargetHostId(): string {
  const target = useContext(TargetHostContext);
  const focus = useFocusHostId();
  return target ?? focus;
}

/** Daemon calls of `hostId`: the focus host keeps `api` (its proxy), others go through `apiFor`. */
export function daemonApiOf(hostId: string, focus: string): DaemonApi {
  return hostId === focus ? api : apiFor(hostId);
}

/** Daemon calls of the target host. */
export function useTargetApi(): DaemonApi {
  const hostId = useTargetHostId();
  const focus = useFocusHostId();
  return daemonApiOf(hostId, focus);
}

/** The target host is not the focus host (store-held per-agent / quota state does not apply to it). */
export function useTargetIsFocus(): boolean {
  return useTargetHostId() === useFocusHostId();
}

/** The target host is another machine (folder picking over the daemon, POSIX paths). */
export function useTargetIsRemote(): boolean {
  return useTargetHostId() !== LOCAL_HOST_ID;
}

/** cutex `featureList` of the target host (empty while unknown / not connected). */
export function useTargetFeatures(): ReadonlySet<string> {
  const hostId = useTargetHostId();
  const live = useHostData(hostId);
  const held = useHeldHostData(hostId, !!live?.featuresKnown);
  return held?.features ?? live?.features ?? NO_FEATURES;
}

/** The target host's sidebar snapshot (agents, projects); null until loaded / not connected. */
export function useTargetSidebar(): SidebarSnapshot | null {
  const hostId = useTargetHostId();
  const live = useHostData(hostId);
  const held = useHeldHostData(hostId, !!live?.sidebar);
  return held?.sidebar ?? live?.sidebar ?? null;
}

// ---------- profile quotas (store `quotas` / `loadQuota` are the open agent's host's) ----------

type Quotas = Record<string, QuotaGauge[]>;
/** Quota gauges of hosts other than the open agent's host, by host id then profile (Settings of another host). */
const useOtherQuotas = create<Record<string, Quotas>>(() => ({}));
onHostReset((hostId) => useOtherQuotas.setState((s) => (s[hostId] ? Object.fromEntries(Object.entries(s).filter(([id]) => id !== hostId)) : s)));
const NO_QUOTAS: Quotas = {};

async function loadOtherQuota(hostId: string, profile: string, refresh = false): Promise<void> {
  try {
    const gauges = await apiFor(hostId).profileQuota(profile, refresh);
    useOtherQuotas.setState((s) => ({ ...s, [hostId]: { ...s[hostId], [profile]: gauges } }));
  } catch {
    // keep last known gauges
  }
}

// Quota pushed by another host's cutex (profile-quota-native): re-read its loaded gauges here (the store
// handles the open agent's host). Guarded: unit tests import this with a bridge stub.
if (typeof bridge.on === "function") bridge.on("hostEvent", ({ hostId, envelope }) => {
  if (envelope.cutex?.method !== QUOTA_UPDATED_EVENT) return;
  const loaded = useOtherQuotas.getState()[hostId];
  const s = useApp.getState();
  if (!loaded || hostId === agentHost(s) || !featuresOf(s, hostId).has(QUOTA_NATIVE_FEATURE)) return;
  const named = quotaEventProfiles(envelope.cutex?.params);
  for (const p of Object.keys(loaded)) if (!named.length || named.includes(p)) void loadOtherQuota(hostId, p);
});

/** The target host's quota gauges by profile name (the open agent's host: the store's). */
export function useTargetQuotas(): Quotas {
  return useHostQuotas(useTargetHostId());
}

/** `loadQuota(profile, refresh?)` against the target host (the open agent's host: the store's action). */
export function useTargetLoadQuota(): (profile: string, refresh?: boolean) => Promise<void> {
  return useHostLoadQuota(useTargetHostId());
}

/**
 * The host of a composer: a provider's (the quick-chat draft page: the host it creates on), else the
 * open agent's host.
 */
export function useComposerHost(): string {
  const target = useContext(TargetHostContext);
  const agent = useApp(agentHost);
  return target ?? agent;
}

/** A host's quota gauges by profile name (the open agent's host: the store's). */
export function useHostQuotas(hostId: string): Quotas {
  const storeHost = useApp(agentHost);
  const store = useApp((s) => s.quotas);
  const other = useOtherQuotas((s) => s[hostId]) ?? NO_QUOTAS;
  return hostId === storeHost ? store : other;
}

/** Quota gauges of several hosts by host id, then profile (用量 「全部主机」). */
export function useHostsQuotas(hostIds: readonly string[]): Readonly<Record<string, Quotas>> {
  const storeHost = useApp(agentHost);
  const store = useApp((s) => s.quotas);
  const other = useOtherQuotas();
  const key = hostIds.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `hostIds`
  return useMemo(() => Object.fromEntries(hostIds.map((id) => [id, id === storeHost ? store : (other[id] ?? NO_QUOTAS)])), [key, storeHost, store, other]);
}

/** `loadQuota(profile, refresh?)` on any host, outside React (the open agent's host: the store's action). */
export function loadHostQuota(hostId: string, profile: string, refresh = false): Promise<void> {
  const s = useApp.getState();
  return hostId === agentHost(s) ? s.loadQuota(profile, refresh) : loadOtherQuota(hostId, profile, refresh);
}

/** `loadQuota(profile, refresh?)` against a host (the open agent's host: the store's action). */
export function useHostLoadQuota(hostId: string): (profile: string, refresh?: boolean) => Promise<void> {
  const storeHost = useApp(agentHost);
  const store = useApp((s) => s.loadQuota);
  return useMemo(() => {
    if (hostId === storeHost) return store;
    return (profile: string, refresh = false) => loadOtherQuota(hostId, profile, refresh);
  }, [hostId, storeHost, store]);
}

/** Open an agent of the target host in place (store `openAgent`: widens the scope to 所有设备 when needed). */
export function useTargetSelect(): (sessionId: string) => Promise<void> {
  const hostId = useTargetHostId();
  const openAgent = useApp((s) => s.openAgent);
  return useMemo(() => async (sessionId: string) => void (await openAgent(sessionId, hostId)), [hostId, openAgent]);
}

/** Page params for a page of `hostId` (`host`, multi-host P1; none for the focus host). */
export function hostPageParam(hostId: string): { host?: string } {
  return hostId === (useApp.getState().hosts?.active ?? LOCAL_HOST_ID) ? {} : { host: hostId };
}

/** The target host's label (source tags, hints); "—" when unknown. */
export function useTargetHostLabel(): string {
  const hostId = useTargetHostId();
  return useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? "—";
}
