import { create } from "zustand";
import { RUNTIME_PRUNE_FEATURE, RUNTIME_PRUNE_PLAN_TIMEOUT, type RuntimePrunePlan, type RuntimePruneResult } from "../../../shared/runtimes";
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
  /** The last plan read did not answer in time (EVA 2026-11-15: it never did); the panel offers 重试. */
  timedOut: boolean;
  outcome: { plan: RuntimePrunePlan; result: RuntimePruneResult } | null;
}
export const EMPTY_PRUNE: HostRuntimePrune = { plan: null, loading: false, pending: false, error: null, timedOut: false, outcome: null };
export const useRuntimePruneStore = create<{ byHost: Record<string, HostRuntimePrune> }>(() => ({ byHost: {} }));
/** How long the panel waits for a plan; main gives up on its side at the same time. */
export const RUNTIME_PRUNE_PLAN_WAIT_MS = 20_000;
/** The read in flight per host; `drop` ends it now (its late answer is ignored) and frees main's request. */
const reads = new Map<string, { promise: Promise<void>; drop: () => void }>();
/** Mounted cleanup panels per host: the read is dropped when the last one goes. */
const watchers = new Map<string, number>();
function patch(host: string, next: Partial<HostRuntimePrune>) {
  useRuntimePruneStore.setState(s => ({ byHost: { ...s.byHost, [host]: { ...(s.byHost[host] ?? EMPTY_PRUNE), ...next } } }));
}
export function runtimePruneEnabled(host: string): boolean {
  const data = hostData(useApp.getState(), host);
  return data?.daemon.kind === "connected" && data.features.has(RUNTIME_PRUNE_FEATURE);
}
onHostReset(host => {
  reads.get(host)?.drop();
  reads.delete(host);
  useRuntimePruneStore.setState(s => ({ byHost: Object.fromEntries(Object.entries(s.byHost).filter(([id]) => id !== host)) }));
});
export function refreshRuntimePrune(host: string): Promise<void> {
  if (!runtimePruneEnabled(host)) return Promise.resolve();
  const existing = reads.get(host);
  if (existing) return existing.promise;
  const current = captureHostAction(host);
  patch(host, { loading: true, plan: null, timedOut: false });
  let settle: (outcome: "timeout" | "dropped") => void = () => {};
  const stopped = new Promise<"timeout" | "dropped">(resolve => { settle = resolve; });
  // Main stops waiting too, so the request does not hold the host's read slot. Sent at once: a cancel sent after a
  // new read started (a remount) would end that one in main as well.
  const stop = (outcome: "timeout" | "dropped") => {
    try { void Promise.resolve(apiFor(host).cancelRuntimePrunePlan?.()).catch(() => {}); } catch { /* best effort */ }
    settle(outcome);
  };
  const timer = setTimeout(() => stop("timeout"), RUNTIME_PRUNE_PLAN_WAIT_MS);
  const live = () => current() && reads.get(host) === read;
  const read = {
    drop: () => { clearTimeout(timer); stop("dropped"); },
    promise: Promise.resolve().then(async () => {
      // Dropped before it started (the last panel closed, e.g. StrictMode's first mount): the cancel has gone to main
      // already, so a GET sent now would run unwatched for up to 20 s.
      if (!live()) { clearTimeout(timer); return; }
      try {
        const answer = await Promise.race([apiFor(host).runtimePrunePlan().then(plan => ({ plan })), stopped]);
        if (typeof answer === "string") {
          if (answer === "timeout" && live()) patch(host, { timedOut: true, error: null });
        } else if (live()) patch(host, { plan: answer.plan, error: null });
      } catch (error) {
        if (live()) patch(host, String(error).includes(RUNTIME_PRUNE_PLAN_TIMEOUT) ? { timedOut: true, error: null } : { error: String(error) });
      } finally {
        clearTimeout(timer);
        if (live()) { patch(host, { loading: false }); reads.delete(host); }
      }
    }),
  };
  reads.set(host, read);
  return read.promise;
}
/** A cleanup panel is showing this host's plan; the returned release drops the read when no panel is left. */
export function watchRuntimePrune(host: string): () => void {
  watchers.set(host, (watchers.get(host) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (watchers.get(host) ?? 1) - 1;
    if (left > 0) { watchers.set(host, left); return; }
    watchers.delete(host);
    const read = reads.get(host);
    if (!read) return;
    reads.delete(host);
    read.drop();
    patch(host, { loading: false });
  };
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
