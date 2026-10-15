// 闹钟 cache per (host, agent), memory only: `GET /v2/alarms?sessionId=&state=all` of the agents a
// status surface shows. `cutex/alarms/changed` on a host's feed reloads the agents it names (owner /
// target), so the capsule and the status row follow without polling; a slow safety poll covers a
// missed event (startAlarmSync / useAgentAlarms).
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ALARMS_FEATURE, alarmChangeOf, type AlarmView } from "../../../../shared/alarms";
import { bridge } from "../../bridge";
import { useClock } from "../../lib/time";
import { featuresOf, useApp, viewHostOf } from "../../store";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { services } from "../app";
import type { AppModuleContext } from "../slots";
import { agentAlarms, keysTouched, NO_ALARMS, withAlarm, type AgentAlarms } from "./model";

interface Entry {
  alarms: AlarmView[];
  /** The last load failed (kept: the previous list stays shown). */
  error: string | null;
  loaded: boolean;
}

interface AlarmCache {
  /** `${hostId}|${sessionId}` */
  byKey: Record<string, Entry>;
}

export const useAlarmCache = create<AlarmCache>(() => ({ byKey: {} }));

const LIMIT = 100;
/** Safety poll while a surface shows the agent (events do the real work). */
const POLL_MS = 120_000;
const keyOf = (hostId: string, sessionId: string) => `${hostId}|${sessionId}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const inflight = new Map<string, Promise<void>>();

export function loadAlarms(hostId: string, sessionId: string): Promise<void> {
  const key = keyOf(hostId, sessionId);
  const running = inflight.get(key);
  if (running) return running;
  const run = (async () => {
    try {
      const list = await services.daemonFor(hostId).alarms({ sessionId, state: "all", limit: LIMIT });
      const entry: Entry = { alarms: list?.alarms ?? [], error: null, loaded: true };
      useAlarmCache.setState((s) => ({ byKey: { ...s.byKey, [key]: entry } }));
    } catch (e) {
      useAlarmCache.setState((s) => ({ byKey: { ...s.byKey, [key]: { alarms: s.byKey[key]?.alarms ?? [], error: errorText(e), loaded: true } } }));
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Patch one alarm into every cached list it belongs to (cancel answer, before the event arrives). */
export function patchAlarm(hostId: string, alarm: AlarmView): void {
  useAlarmCache.setState((s) => {
    const byKey = { ...s.byKey };
    for (const [key, entry] of Object.entries(s.byKey)) {
      if (!key.startsWith(`${hostId}|`) || !entry.alarms.some((a) => a.id === alarm.id)) continue;
      byKey[key] = { ...entry, alarms: withAlarm(entry.alarms, alarm) };
    }
    return { byKey };
  });
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
const reloadQueue = new Set<string>();

function scheduleReload(keys: readonly string[]) {
  for (const key of keys) reloadQueue.add(key);
  reloadTimer ??= setTimeout(() => {
    reloadTimer = null;
    const keys = [...reloadQueue];
    reloadQueue.clear();
    for (const key of keys) {
      const bar = key.indexOf("|");
      void loadAlarms(key.slice(0, bar), key.slice(bar + 1));
    }
  }, 150);
}

/** Module activation: follow `cutex/alarms/changed` on every connected host until the module stops. */
export function startAlarmSync(ctx: AppModuleContext): void {
  if (typeof bridge?.on !== "function") return;
  const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
    const change = alarmChangeOf(envelope);
    if (!change) return;
    scheduleReload(keysTouched(Object.keys(useAlarmCache.getState().byKey), hostId, [change.ownerCutexSessionId, change.targetCutexSessionId]));
  });
  ctx.signal.addEventListener("abort", () => {
    off?.();
    useAlarmCache.setState({ byKey: {} });
  });
}

/** The host of an open agent (an agent opened from another host in the scope keeps its own). */
export function useAgentHost(sessionId: string): string {
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  // viewHostOf reads the store's view map; the focus dependency re-evaluates it on a host switch.
  return useMemo(() => viewHostOf(sessionId), [sessionId, focus]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** That host runs a cutex with the alarms routes. */
export function useAlarmsSupported(hostId: string): boolean {
  return useApp((s) => featuresOf(s, hostId).has(ALARMS_FEATURE));
}

/**
 * An agent's alarms (capsule / status row), loaded while `active` (the category is placed
 * somewhere) and the agent's host supports them. Re-partitioned on the shared 30 s clock.
 */
export function useAgentAlarms(sessionId: string, active: boolean): AgentAlarms & { hostId: string; error: string | null; loaded: boolean } {
  const hostId = useAgentHost(sessionId);
  const enabled = useAlarmsSupported(hostId) && active;
  const key = keyOf(hostId, sessionId);
  const entry = useAlarmCache((s) => (enabled ? s.byKey[key] : undefined));
  const now = useClock();
  useEffect(() => {
    if (!enabled) return;
    void loadAlarms(hostId, sessionId);
    const id = setInterval(() => {
      if (!document.hidden) void loadAlarms(hostId, sessionId);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, hostId, sessionId]);
  const data = useMemo(() => (entry ? agentAlarms(entry.alarms, now) : NO_ALARMS), [entry, now]);
  return { ...data, hostId, error: entry?.error ?? null, loaded: entry?.loaded ?? false };
}
