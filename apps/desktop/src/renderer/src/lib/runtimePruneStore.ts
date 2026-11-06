import { create } from "zustand";
import { RUNTIME_PRUNE_FEATURE, type RuntimePrunePlan, type RuntimePruneResult } from "../../../shared/runtimes";
import { apiFor } from "../bridge";
import { useApp } from "../store";
import { hostData } from "./hostScope";
import { captureHostAction, onHostReset } from "./hostSwitch";
import { refreshRuntimes } from "./runtimesStore";
import { loadComponents } from "./componentStore";

export interface HostRuntimePrune {
  plan: RuntimePrunePlan | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  outcome: { plan: RuntimePrunePlan; result: RuntimePruneResult } | null;
}
export const EMPTY_PRUNE: HostRuntimePrune = { plan: null, loading: false, pending: false, error: null, outcome: null };
export const useRuntimePruneStore = create<{ byHost: Record<string, HostRuntimePrune> }>(() => ({ byHost: {} }));
const reads = new Map<string, Promise<void>>();
function patch(host: string, next: Partial<HostRuntimePrune>) {
  useRuntimePruneStore.setState(s => ({ byHost: { ...s.byHost, [host]: { ...(s.byHost[host] ?? EMPTY_PRUNE), ...next } } }));
}
export function runtimePruneEnabled(host: string): boolean {
  const data = hostData(useApp.getState(), host);
  return data?.daemon.kind === "connected" && data.features.has(RUNTIME_PRUNE_FEATURE);
}
onHostReset(host => {
  reads.delete(host);
  useRuntimePruneStore.setState(s => ({ byHost: Object.fromEntries(Object.entries(s.byHost).filter(([id]) => id !== host)) }));
});
export function refreshRuntimePrune(host: string): Promise<void> {
  if (!runtimePruneEnabled(host)) return Promise.resolve();
  const existing = reads.get(host);
  if (existing) return existing;
  const current = captureHostAction(host);
  patch(host, { loading: true, plan: null });
  const request = Promise.resolve().then(async () => {
    try {
      const plan = await apiFor(host).runtimePrunePlan();
      if (current()) patch(host, { plan, error: null });
    } catch (error) {
      if (current()) patch(host, { error: String(error) });
    } finally {
      if (current()) { patch(host, { loading: false }); reads.delete(host); }
    }
  });
  reads.set(host, request);
  return request;
}
/** Confirmation must still refer to this exact read and connection. The daemon rechecks authority. */
export async function pruneRuntimeVersions(host: string, plan: RuntimePrunePlan, ids: string[], current: () => boolean): Promise<void> {
  const state = useRuntimePruneStore.getState().byHost[host];
  if (!current() || !runtimePruneEnabled(host) || state?.pending || state?.loading || state?.plan !== plan) return;
  if (!ids.length || ids.length > 100 || ids.some(id => !plan.versions.some(v => v.id === id && v.canPrune))) return;
  patch(host, { pending: true, error: null, outcome: null });
  let actionError: string | null = null;
  try {
    const result = await apiFor(host).pruneRuntimes(ids);
    if (current()) patch(host, { outcome: { plan, result } });
  } catch (error) {
    actionError = String(error);
    if (current()) patch(host, { error: actionError });
  } finally {
    if (current()) {
      // Includes uncertain POST outcomes; never automatically retry a deletion.
      await Promise.allSettled([refreshRuntimePrune(host), refreshRuntimes(host), loadComponents(host)]);
      if (current()) patch(host, { pending: false, ...(actionError ? { error: actionError } : {}) });
    }
  }
}
