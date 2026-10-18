// React hooks for optional components (kept out of components/*.tsx for Fast Refresh): the card state
// of a component on a host (lib/componentCard.ts) and whether it can be used now.
import { useEffect, useMemo } from "react";
import { COMPONENTS_FEATURE, isOperationRunning } from "../../../shared/components";
import { CLAUDE_RUNTIME_COMPONENT, componentCardState, componentUsable, type ComponentCardState } from "./componentCard";
import { EMPTY_COMPONENTS, loadComponents, retainEvents, useComponentStore, type HostComponents } from "./componentStore";
import { refreshRuntimes, useRuntimesStore } from "./runtimesStore";
import { useHostData, useHostLook } from "./useHostScope";

const NO_FEATURES: ReadonlySet<string> = new Set();

/** The card state of `name` on `hostId` (reads `GET /v2/components` while `active`). */
export function useComponentState(hostId: string, name: string, opts: { active?: boolean; moduleCapabilities?: readonly string[] } = {}): { state: ComponentCardState; entry: HostComponents } {
  const active = opts.active ?? true;
  const data = useHostData(hostId);
  const look = useHostLook(hostId);
  const entry = useHostComponents(hostId, active);
  const caps = opts.moduleCapabilities;
  const capsKey = caps?.join("\n") ?? "";
  // An unmanaged host may have its Claude runtime set up by hand (deployment kits): ask /v2/runtimes.
  const list = entry.list;
  const unmanagedMissing =
    active &&
    name === CLAUDE_RUNTIME_COMPONENT &&
    !!list &&
    (!list.managed || list.installFrom === "none") &&
    list.components.some((c) => c.name === name && c.state === "missing");
  const runtimes = useRuntimesStore((s) => s.byHost[hostId]);
  useEffect(() => {
    if (unmanagedMissing && !runtimes?.view && !runtimes?.loading && !runtimes?.error) void refreshRuntimes(hostId);
  }, [unmanagedMissing, hostId, runtimes]);
  const handConfigured = unmanagedMissing && !!runtimes?.view?.claude.some((r) => r.selected && !r.missing);
  const state = useMemo(
    () =>
      componentCardState({
        name,
        connected: data?.daemon.kind === "connected",
        featuresKnown: !!data?.featuresKnown,
        features: data?.features ?? NO_FEATURES,
        platform: look?.platform ?? null,
        moduleCapabilities: caps ?? [],
        list: entry.list,
        listError: entry.error,
        pending: entry.pending?.name === name,
        handConfigured,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capsKey stands for caps
    [name, data, look?.platform, capsKey, entry.list, entry.error, entry.pending, handConfigured],
  );
  return { state, entry };
}

/** `name` can be used on `hostId` now (lib/componentCard componentUsable); false while unread. */
export function useComponentUsable(hostId: string, name: string, active = true): boolean {
  const data = useHostData(hostId);
  const entry = useHostComponents(hostId, active);
  return componentUsable(data?.features ?? NO_FEATURES, entry.list, name);
}

/** Safety poll while an install runs or a restart waits (events do the real work). */
const BUSY_POLL_MS = 5_000;

/**
 * A host's components, read while `active`, the host is connected and has the capability (again after
 * every reconnect: an install or upgrade may restart the daemons).
 */
export function useHostComponents(hostId: string, active = true): HostComponents & { connected: boolean; supported: boolean } {
  const data = useHostData(hostId);
  const connected = data?.daemon.kind === "connected";
  const supported = !!data?.features.has(COMPONENTS_FEATURE);
  const entry = useComponentStore((s) => s.byHost[hostId]) ?? EMPTY_COMPONENTS;
  const enabled = active && connected && supported;
  useEffect(() => {
    if (!enabled) return;
    const release = retainEvents();
    void loadComponents(hostId);
    return release;
  }, [enabled, hostId]);
  const busy = !!entry.pending || isOperationRunning(entry.list?.operation) || !!entry.list?.components.some((c) => c.state === "installing" || c.state === "restartPending");
  useEffect(() => {
    if (!enabled || !busy) return;
    const id = setInterval(() => {
      if (!document.hidden) void loadComponents(hostId);
    }, BUSY_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, busy, hostId]);
  return { ...entry, connected, supported };
}

