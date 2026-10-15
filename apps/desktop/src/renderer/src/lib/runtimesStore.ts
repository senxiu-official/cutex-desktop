// Installed runtimes of the connected host (`GET /v2/runtimes`, cutex `runtimes-view`), keyed by
// desktop host id so a late reply from the previous host stays out of the new one. Loaded only when
// Settings → 运行时 opens and after a runtime package run finishes (pins changed); no polling.
import { create } from "zustand";
import { adaptRuntimes, RUNTIMES_FEATURE, type RuntimesView } from "../../../shared/runtimes";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { api, apiFor } from "../bridge";
import { useApp } from "../store";
import { hostData } from "./hostScope";
import { useTargetHostId } from "./targetHost";
import { useHostData } from "./useHostScope";

export interface HostRuntimes {
  view: RuntimesView | null;
  error: string | null;
  loading: boolean;
}

const EMPTY: HostRuntimes = { view: null, error: null, loading: false };

export const useRuntimesStore = create<{ byHost: Record<string, HostRuntimes> }>(() => ({ byHost: {} }));

const inFlight = new Set<string>();

function patch(hostId: string, next: Partial<HostRuntimes>): void {
  useRuntimesStore.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { ...(s.byHost[hostId] ?? EMPTY), ...next } } }));
}

/** `GET /v2/runtimes` for a connected host (default: the focus host; no-op without the capability or while one is in flight). */
export async function refreshRuntimes(hostId?: string): Promise<void> {
  const s = useApp.getState();
  const focus = s.hosts?.active ?? LOCAL_HOST_ID;
  const id = hostId ?? focus;
  const data = hostData(s, id);
  if (data?.daemon.kind !== "connected" || !data.features.has(RUNTIMES_FEATURE)) return;
  await load(id, id === focus ? api : apiFor(id));
}

async function load(hostId: string, daemon: { runtimes(): ReturnType<typeof api.runtimes> }): Promise<void> {
  if (inFlight.has(hostId)) return;
  inFlight.add(hostId);
  patch(hostId, { loading: true });
  try {
    const view = adaptRuntimes(await daemon.runtimes());
    patch(hostId, { view, error: null, loading: false });
  } catch (error) {
    patch(hostId, { error: error instanceof Error ? error.message : String(error), loading: false });
  } finally {
    inFlight.delete(hostId);
  }
}

/** The target host's installed runtimes (lib/targetHost); null without the capability (or not connected). */
export function useHostRuntimes(): HostRuntimes | null {
  const hostId = useTargetHostId();
  const data = useHostData(hostId);
  const enabled = data?.daemon.kind === "connected" && data.features.has(RUNTIMES_FEATURE);
  const host = useRuntimesStore((s) => s.byHost[hostId]);
  if (!enabled) return null;
  return host ?? EMPTY;
}
