// React hooks for the runtime package upgrade section and the 关于 red dot (kept out of
// components/*.tsx for Fast Refresh).
import { useApp } from "../store";
import { useTargetHostId, useTargetHostLabel } from "./targetHost";
import { useHostData } from "./useHostScope";
import { aboutAttention, RUNTIME_PACKAGES_FEATURE } from "./runtimePackages";
import { useRuntimePackages, type HostRuntimePackages } from "./runtimePackageStore";
import { useUpdateStatus } from "./update";

/** The target host's runtime package state (lib/targetHost; else the focus host); null without the capability (or not connected). */
export function useHostRuntimePackages(): HostRuntimePackages | null {
  const hostId = useTargetHostId();
  const data = useHostData(hostId);
  const enabled = data?.daemon.kind === "connected" && data.features.has(RUNTIME_PACKAGES_FEATURE);
  const host = useRuntimePackages((s) => s.byHost[hostId]);
  if (!enabled) return null;
  return host ?? { view: null, error: null, loading: false, actionError: null, starting: false };
}

/** Outdated agents on the connected host (0 without the capability or before the first load). */
export function useOutdatedAgentCount(): number {
  return useHostRuntimePackages()?.view?.agents.length ?? 0;
}

/** Red dot on 关于 (settings nav) and on the sidebar 设置 entry. */
export function useAboutAttention(): boolean {
  const outdated = useOutdatedAgentCount();
  const update = useUpdateStatus();
  return aboutAttention(outdated, update);
}

/** Display name of the target host (lib/targetHost; else the focus host). */
export function useActiveHostLabel(): string {
  return useTargetHostLabel();
}
