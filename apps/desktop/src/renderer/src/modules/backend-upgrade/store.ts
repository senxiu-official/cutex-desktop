// 后端更新 state per host, memory only: `GET /v2/upgrade` of the hosts the page / nav dot looks at,
// the last `cutex/upgrade/updated` params (they say whether the services are down right now), and the
// run history the page shows. The event (cutex publishes it on every state.json change, also after the
// restart with `reason: startup`) triggers a re-read; a slow poll covers a missed one while a run goes.
import { useEffect } from "react";
import { create } from "zustand";
import { BACKEND_UPGRADE_FEATURE, upgradeEventOf, type UpgradeEvent, type UpgradeRun, type UpgradeStatus } from "../../../../shared/backendUpgrade";
import { bridge } from "../../bridge";
import { onHostReset } from "../../lib/hostSwitch";
import { scopedHostData } from "../../lib/hostScope";
import { setSettingsAttention } from "../../lib/settingsAttention";
import { useHostData } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { services } from "../app";
import type { AppModuleContext } from "../slots";
import { runActive, upgradeAttention } from "./model";

export interface HostUpgrade {
  /** undefined: not read yet; null: the host has no upgrade route (older cutex). */
  status: UpgradeStatus | null | undefined;
  /** The last read failed (the previous status stays shown). */
  error: string | null;
  /** The last event of this host (`run.servicesDown` while the daemons restart). */
  event: UpgradeEvent | null;
  /** `GET /v2/upgrade/runs` (undefined: not read). */
  runs: UpgradeRun[] | undefined;
  runsError: string | null;
}

const EMPTY: HostUpgrade = { status: undefined, error: null, event: null, runs: undefined, runsError: null };

export const useUpgradeStore = create<{ byHost: Record<string, HostUpgrade> }>(() => ({ byHost: {} }));

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function patch(hostId: string, change: Partial<HostUpgrade>): void {
  useUpgradeStore.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { ...(s.byHost[hostId] ?? EMPTY), ...change } } }));
}

export function hostUpgrade(hostId: string): HostUpgrade {
  return useUpgradeStore.getState().byHost[hostId] ?? EMPTY;
}

/** A fresh status from an action's answer (check) or a read. */
export function putUpgradeStatus(hostId: string, status: UpgradeStatus): void {
  patch(hostId, { status, error: null });
}

const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Bumped when the module stops: fences every host's reads. */
let generation = 0;
/** Bumped by a host reset: a read started before it must not patch the old host's state back in. */
const epochs = new Map<string, number>();
/** Bumped by every upgrade event of the host: a status read started after the last one supersedes it. */
const eventSeqs = new Map<string, number>();
const epochOf = (hostId: string) => `${generation}:${epochs.get(hostId) ?? 0}`;
const eventSeqOf = (hostId: string) => eventSeqs.get(hostId) ?? 0;

/** Forget a host (reset / switch): drop its state and fence off reads still in flight. */
export function resetHostUpgrade(hostId: string): void {
  epochs.set(hostId, (epochs.get(hostId) ?? 0) + 1);
  inflight.delete(`status|${hostId}`);
  inflight.delete(`runs|${hostId}`);
  const t = timers.get(hostId);
  if (t) clearTimeout(t);
  timers.delete(hostId);
  useUpgradeStore.setState((s) => (s.byHost[hostId] ? { byHost: Object.fromEntries(Object.entries(s.byHost).filter(([id]) => id !== hostId)) } : s));
}

/** An upgrade event of a host (`cutex/upgrade/updated`). */
export function putUpgradeEvent(hostId: string, event: UpgradeEvent): void {
  eventSeqs.set(hostId, eventSeqOf(hostId) + 1);
  patch(hostId, { event });
}

export function loadUpgradeStatus(hostId: string): Promise<void> {
  const key = `status|${hostId}`;
  const running = inflight.get(key);
  if (running) return running;
  const epoch = epochOf(hostId);
  const seenEvents = eventSeqOf(hostId);
  const run = (async () => {
    try {
      const status = await services.daemonFor(hostId).upgradeStatus();
      if (epochOf(hostId) !== epoch) return;
      // A status read after the last event is newer than it: the event no longer speaks for the run
      // (nav dot, "services restarting" after an unrelated later disconnect).
      patch(hostId, eventSeqOf(hostId) === seenEvents ? { status, error: null, event: null } : { status, error: null });
    } catch (e) {
      if (epochOf(hostId) === epoch) patch(hostId, { error: errorText(e) });
    } finally {
      if (epochOf(hostId) === epoch) inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

export function loadUpgradeRuns(hostId: string): Promise<void> {
  const key = `runs|${hostId}`;
  const running = inflight.get(key);
  if (running) return running;
  const epoch = epochOf(hostId);
  const run = (async () => {
    try {
      const r = await services.daemonFor(hostId).upgradeRuns(20);
      if (epochOf(hostId) !== epoch) return;
      if (r.ok) patch(hostId, { runs: r.value, runsError: null });
      else patch(hostId, { runsError: `${r.error.code}: ${r.error.message}` });
    } catch (e) {
      if (epochOf(hostId) === epoch) patch(hostId, { runsError: errorText(e) });
    } finally {
      if (epochOf(hostId) === epoch) inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Re-read a host soon (events come every 2 s while a run moves: coalesce them). */
function scheduleReload(hostId: string): void {
  if (timers.has(hostId)) return;
  timers.set(
    hostId,
    setTimeout(() => {
      timers.delete(hostId);
      void loadUpgradeStatus(hostId);
      // The history only when someone looks at it (the page loaded it once).
      if (hostUpgrade(hostId).runs !== undefined) void loadUpgradeRuns(hostId);
    }, 300),
  );
}

/** Module activation: follow `cutex/upgrade/updated` on every connected host until the module stops. */
export function startUpgradeSync(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    const event = upgradeEventOf(envelope);
    if (!event) return;
    putUpgradeEvent(hostId, event);
    scheduleReload(hostId);
  });
  const offReset = onHostReset(resetHostUpgrade);
  // Read each connected host's state once per connection, so the sidebar 设置 dot can say "a backend
  // update is available" without anyone opening Settings (cutex checks on its own schedule and
  // publishes the event when its state changes; that keeps it current afterwards).
  const readOnce = new Set<string>();
  let seen: unknown[] = [];
  const syncHosts = () => {
    const st = useApp.getState();
    const refs = [st.hosts, st.daemon, st.features, st.byHost];
    if (refs.every((r, i) => r === seen[i])) return; // most store changes are not about hosts
    seen = refs;
    const live = new Set<string>();
    for (const d of scopedHostData(st)) {
      if (d.daemon.kind !== "connected" || !d.features.has(BACKEND_UPGRADE_FEATURE)) continue;
      live.add(d.hostId);
      if (!readOnce.has(d.hostId)) {
        readOnce.add(d.hostId);
        void loadUpgradeStatus(d.hostId);
      }
    }
    for (const id of readOnce) if (!live.has(id)) readOnce.delete(id);
  };
  syncHosts();
  const offHosts = useApp.subscribe(syncHosts);
  const syncDot = () => {
    const any = Object.values(useUpgradeStore.getState().byHost).some((u) => upgradeAttention(u.status, u.event) !== "none");
    setSettingsAttention("backend-upgrade", any ? "backend-upgrade.navAttention" : null);
  };
  syncDot();
  const offDot = useUpgradeStore.subscribe(syncDot);
  ctx.signal.addEventListener("abort", () => {
    off?.();
    offReset();
    offHosts();
    offDot();
    setSettingsAttention("backend-upgrade", null);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    generation++;
    inflight.clear();
    useUpgradeStore.setState({ byHost: {} });
  });
}

/** Safety poll while a run is going (events do the real work). */
const RUN_POLL_MS = 5_000;

/**
 * The host's upgrade state, read while `active`, the host is connected and has the capability (again
 * after every reconnect: a finished upgrade restarts the daemons). Polls while a run is going.
 */
export function useHostUpgrade(hostId: string, active = true): HostUpgrade & { supported: boolean; connected: boolean } {
  const data = useHostData(hostId);
  const connected = data?.daemon.kind === "connected";
  const supported = !!data?.features.has(BACKEND_UPGRADE_FEATURE);
  const entry = useUpgradeStore((s) => s.byHost[hostId]) ?? EMPTY;
  const enabled = active && connected && supported;
  useEffect(() => {
    if (enabled) void loadUpgradeStatus(hostId);
  }, [enabled, hostId]);
  const going = runActive(entry.status?.run) || entry.status?.staging?.state === "running";
  useEffect(() => {
    if (!enabled || !going) return;
    const id = setInterval(() => {
      if (!document.hidden) void loadUpgradeStatus(hostId);
    }, RUN_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, going, hostId]);
  return { ...entry, supported, connected };
}
