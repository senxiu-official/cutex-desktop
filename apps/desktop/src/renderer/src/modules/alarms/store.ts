// 闹钟 cache per (host, agent), memory only: `GET /v2/alarms?sessionId=&state=all` of the agents a
// status surface shows. `cutex/alarms/changed` on a host's feed reloads the agents it names (owner /
// target), so the capsule and the status row follow without polling; a slow safety poll covers a
// missed event (startAlarmSync / useAgentAlarms).
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ALARMS_FEATURE, alarmChangeOf, type AlarmView } from "../../../../shared/alarms";
import { bridge } from "../../bridge";
import { useClock } from "../../lib/time";
import { featuresOf, useApp } from "../../store";
import { useConvViewHost } from "../../lib/conversationScope";
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

const daemonOf = (hostId: string) => {
  const s = useApp.getState();
  return hostId === (s.hosts?.active ?? LOCAL_HOST_ID) ? s.daemon : s.byHost[hostId]?.daemon;
};
const resyncRevisions = new Map<string, number>();
const viewers = new Map<string, number>();
const inflight = new Map<string, { connection: ReturnType<typeof daemonOf>; revision: number; promise: Promise<void> }>();

export function loadAlarms(hostId: string, sessionId: string): Promise<void> {
  const key = keyOf(hostId, sessionId);
  const connection = daemonOf(hostId);
  const revision = resyncRevisions.get(hostId) ?? 0;
  if (connection?.kind !== "connected") return Promise.resolve();
  const running = inflight.get(key);
  if (running?.connection === connection && running.revision === revision) return running.promise;
  const current = () => daemonOf(hostId) === connection && (resyncRevisions.get(hostId) ?? 0) === revision;
  const promise = Promise.resolve().then(async () => {
    try {
      const list = await services.daemonFor(hostId).alarms({ sessionId, state: "all", limit: LIMIT });
      if (!current()) return;
      const entry: Entry = { alarms: list?.alarms ?? [], error: null, loaded: true };
      useAlarmCache.setState((s) => ({ byKey: { ...s.byKey, [key]: entry } }));
    } catch (e) {
      if (!current()) return;
      useAlarmCache.setState((s) => ({ byKey: { ...s.byKey, [key]: { alarms: s.byKey[key]?.alarms ?? [], error: errorText(e), loaded: true } } }));
    } finally {
      if (inflight.get(key) === request) inflight.delete(key);
    }
  });
  const request = { connection, revision, promise };
  inflight.set(key, request);
  return promise;
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
  // A fast SSE reconnect can keep daemon.kind connected. Changes during that gap
  // need a new snapshot even when no alarms/changed event can be replayed.
  const offResync = bridge.on("hostResync", ({ hostId }) => {
    resyncRevisions.set(hostId, (resyncRevisions.get(hostId) ?? 0) + 1);
    scheduleReload([...viewers.keys()].filter(key => key.startsWith(`${hostId}|`)));
  });
  ctx.signal.addEventListener("abort", () => {
    off?.();
    offResync?.();
    useAlarmCache.setState({ byKey: {} });
  });
}

/** The host of an open agent (an agent opened from another host in the scope keeps its own). */
export function useAgentHost(sessionId: string): string {
  return useConvViewHost(sessionId);
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
  const connected = useApp((s) => (hostId === (s.hosts?.active ?? LOCAL_HOST_ID) ? s.daemon : s.byHost[hostId]?.daemon)?.kind === "connected");
  const epoch = useApp((s) => s.hosts?.hosts?.find(h => h.id === hostId)?.conn?.epoch);
  const key = keyOf(hostId, sessionId);
  const entry = useAlarmCache((s) => (enabled ? s.byKey[key] : undefined));
  const now = useClock();
  useEffect(() => {
    if (!enabled) return;
    viewers.set(key, (viewers.get(key) ?? 0) + 1);
    return () => {
      const remaining = (viewers.get(key) ?? 1) - 1;
      if (remaining) viewers.set(key, remaining);
      else viewers.delete(key);
    };
  }, [enabled, key]);
  useEffect(() => {
    if (!enabled || !connected) return;
    void loadAlarms(hostId, sessionId);
    const id = setInterval(() => {
      if (!document.hidden) void loadAlarms(hostId, sessionId);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, connected, epoch, hostId, sessionId]);
  const data = useMemo(() => (entry ? agentAlarms(entry.alarms, now) : NO_ALARMS), [entry, now]);
  return { ...data, hostId, error: entry?.error ?? null, loaded: entry?.loaded ?? false };
}
