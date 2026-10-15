// Runtime package upgrade state per desktop host id (keying by host keeps a late reply from the previous
// host out of the new one's view; Settings may load another connected host's too). Loaded when
// the capability appears on connect, when Settings → 运行时 / 关于 opens, every 10 minutes (the red dot),
// and after a run finishes; `cutex/runtimePackages/runUpdated` host events (run header + the changed
// item) update the run live, and a run the view does not hold yet is fetched in full.
// The app store starts the sync (store.ts init). Multi-host (P1 step 2c): Settings → 运行时 of another
// connected host (lib/settingsHost) loads that host's list too (`hostId` parameters; default = the
// focus host) and follows its run events; the periodic refresh stays on the focus host.
import { create } from "zustand";
import type { CutexRefusal, HostsState, RuntimePackageRun, RuntimePackagesView } from "../../../shared/ipc";
import { api, apiFor, bridge } from "../bridge";
import { applyRunEvent, applyRunUpdate, asRunEvent, RUN_UPDATED_METHOD, RUNTIME_PACKAGES_FEATURE } from "./runtimePackages";

export interface HostRuntimePackages {
  view: RuntimePackagesView | null;
  /** Last load error (message); null after a good load. */
  error: string | null;
  loading: boolean;
  /** Last start / revert refusal (run_in_progress, …), shown inline until the next action or a run finishes. */
  actionError: CutexRefusal | null;
  /** A start / revert request is in flight. */
  starting: boolean;
}

export interface RuntimePackagesState {
  byHost: Record<string, HostRuntimePackages>;
}

const EMPTY_HOST: HostRuntimePackages = { view: null, error: null, loading: false, actionError: null, starting: false };

export const useRuntimePackages = create<RuntimePackagesState>(() => ({ byHost: {} }));

interface HostConn {
  features: ReadonlySet<string>;
  daemon: { kind: string };
}
interface AppHandle {
  getState(): HostConn & { hosts: HostsState | null; byHost: Readonly<Record<string, HostConn>> };
  subscribe(listener: (state: { features: ReadonlySet<string>; daemon: { kind: string } }, prev: { features: ReadonlySet<string>; daemon: { kind: string } }) => void): () => void;
}
let app: AppHandle | null = null;
const inFlight = new Set<string>();
/** A refresh was asked for while one was in flight (e.g. a run finished): run it once more after. */
const again = new Set<string>();
const REFRESH_MS = 10 * 60_000;
/** `host runId` whose full run is being fetched. */
const runFetches = new Set<string>();
const runKey = (hostId: string, runId: string) => `${hostId} ${runId}`;

/** The desktop host id the renderer is connected to ("" before the hosts list arrives). */
export function activeHostId(): string {
  return app?.getState().hosts?.active ?? "";
}

/** The host's connection: the focus host's top-level state, another connected host's slice. */
const connOf = (hostId: string): HostConn | null => {
  const s = app?.getState();
  if (!s) return null;
  return hostId === activeHostId() ? s : (s.byHost[hostId] ?? null);
};
const supported = (hostId = activeHostId()) => {
  const c = connOf(hostId);
  return !!c && c.daemon.kind === "connected" && c.features.has(RUNTIME_PACKAGES_FEATURE);
};
const daemonOf = (hostId: string) => (hostId === activeHostId() ? api : apiFor(hostId));

function patchHost(hostId: string, patch: Partial<HostRuntimePackages> | ((h: HostRuntimePackages) => Partial<HostRuntimePackages>)): void {
  useRuntimePackages.setState((s) => {
    const current = s.byHost[hostId] ?? EMPTY_HOST;
    const next = typeof patch === "function" ? patch(current) : patch;
    return { byHost: { ...s.byHost, [hostId]: { ...current, ...next } } };
  });
}

/** `GET /v2/runtime-packages` for a connected host (default: the focus host; no-op without the capability). */
export async function refreshRuntimePackages(hostId = activeHostId()): Promise<void> {
  if (!supported(hostId)) return;
  if (inFlight.has(hostId)) {
    again.add(hostId);
    return;
  }
  inFlight.add(hostId);
  patchHost(hostId, { loading: true });
  try {
    const view = await daemonOf(hostId).runtimePackages();
    patchHost(hostId, { view, error: null, loading: false });
  } catch (error) {
    patchHost(hostId, { error: error instanceof Error ? error.message : String(error), loading: false });
  } finally {
    inFlight.delete(hostId);
    if (again.delete(hostId)) void refreshRuntimePackages(hostId);
  }
}

/** Apply a full run (start / revert reply, or a fetched run) to the cached view. */
function applyFullRun(hostId: string, run: RuntimePackageRun): void {
  const view = useRuntimePackages.getState().byHost[hostId]?.view;
  if (!view) return;
  const next = applyRunUpdate(view, run);
  // A finished run also ends the reason for an earlier run_in_progress refusal.
  patchHost(hostId, next.finished ? { view: next.view, actionError: null } : { view: next.view });
  if (next.finished) void refreshRuntimePackages(hostId);
}

/** `GET /v2/runtime-packages/runs/{id}` for a run the view has not seen (or missed an item of). */
async function fetchRun(hostId: string, runId: string): Promise<void> {
  const key = runKey(hostId, runId);
  if (runFetches.has(key)) return;
  runFetches.add(key);
  try {
    const run = await daemonOf(hostId).runtimePackageRun(runId);
    if (!supported(hostId)) return;
    if (run) applyFullRun(hostId, run);
    else void refreshRuntimePackages(hostId);
  } catch {
    if (supported(hostId)) void refreshRuntimePackages(hostId);
  } finally {
    runFetches.delete(key);
  }
}

async function runAction(hostId: string, call: () => Promise<{ ok: true; run: RuntimePackageRun } | { ok: false; error: CutexRefusal }>): Promise<void> {
  if (!supported(hostId)) return;
  patchHost(hostId, { starting: true, actionError: null });
  try {
    const r = await call();
    if (r.ok) {
      patchHost(hostId, (h) => ({ starting: false, view: h.view ? applyRunUpdate(h.view, r.run).view : h.view }));
    } else {
      patchHost(hostId, { starting: false, actionError: r.error });
      // run_in_progress etc.: the list shows what is actually going on.
      void refreshRuntimePackages(hostId);
    }
  } catch (error) {
    patchHost(hostId, { starting: false, actionError: { code: "error", message: error instanceof Error ? error.message : String(error) } });
  }
}

/** 升级空闲的: `POST /v2/runtime-packages/runs {all: true}` (default: the focus host). */
export function startRuntimePackageUpgrade(hostId = activeHostId()): Promise<void> {
  return runAction(hostId, () => daemonOf(hostId).startRuntimePackageRun());
}

/** 撤销这次升级: `POST /v2/runtime-packages/runs/{runId}/revert {}` (default: the focus host). */
export function revertRuntimePackageRun(runId: string, hostId = activeHostId()): Promise<void> {
  return runAction(hostId, () => daemonOf(hostId).revertRuntimePackageRun(runId));
}

/** Start the capability / event / periodic refresh (store.ts init). */
export function startRuntimePackageSync(handle: AppHandle): void {
  if (app) return;
  app = handle;
  // Capability appears (connect, host switch, reconnect).
  handle.subscribe((state, prev) => {
    const now = state.daemon.kind === "connected" && state.features.has(RUNTIME_PACKAGES_FEATURE);
    const before = prev.daemon.kind === "connected" && prev.features.has(RUNTIME_PACKAGES_FEATURE);
    if (now && (!before || state.features !== prev.features)) void refreshRuntimePackages(activeHostId());
  });
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    // Runs of the shown host, and of another connected host whose list Settings loaded (its fetches go
    // to that host); other hosts' lists load when they are shown.
    if (envelope.cutex?.method !== RUN_UPDATED_METHOD || !supported(hostId)) return;
    const focus = hostId === activeHostId();
    if (!focus && !useRuntimePackages.getState().byHost[hostId]) return;
    const event = asRunEvent(envelope.cutex.params);
    if (!event) return;
    const view = useRuntimePackages.getState().byHost[hostId]?.view;
    if (!view) {
      void refreshRuntimePackages(hostId);
      return;
    }
    // The full run is on its way. A change it might miss is caught up by the item's next event
    // (items are replaced whole) or the list refetch when the run finishes.
    if (runFetches.has(runKey(hostId, event.runId))) {
      if (event.status !== "running") void refreshRuntimePackages(hostId);
      return;
    }
    const next = applyRunEvent(view, event);
    if (next.kind === "fetch") {
      void fetchRun(hostId, next.runId);
      return;
    }
    if (next.kind === "stale") return;
    // A finished run also ends the reason for an earlier run_in_progress refusal; the list refetch
    // brings the full run (revertedBy, final items) and the moved agents.
    patchHost(hostId, next.finished ? { view: next.view, actionError: null } : { view: next.view });
    if (next.finished) void refreshRuntimePackages(hostId);
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void refreshRuntimePackages(activeHostId());
  }, REFRESH_MS);
}
