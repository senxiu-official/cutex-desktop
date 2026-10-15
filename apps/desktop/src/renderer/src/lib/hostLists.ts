// Cross-host list pages and counts (multi-host P1 step 2b; RFC §9.2, §10, §8.5). Builds on the scope
// model (lib/hostScope, lib/useHostScope; docs/research/multi-host-p1-interfaces.md):
// - list pages (审批 / 服务 / 作业) show the scope's connected hosts, merged (`mergeHostLists`), rows
//   keyed `hostKey(hostId, id)`, actions sent to `apiFor(row.hostId)`;
// - counts and badges span every connected host, in the scope or not (`connectedHostIds`, `sumHosts`);
// - data the store does not follow per host (approval history, jobs) is loaded here, per page
//   (`usePerHost`), never in the core store.
import { useEffect, useMemo, useRef, useState } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { useOwnerNotify } from "./ownerNotifyStore";
import { attentionByHost } from "./shell";
import { connectedHostIds, hostsWithoutData, outOfScopeCount, staleHostIds } from "./hostCounts";
import type { DaemonApi } from "../../../shared/ipc";
import { api, apiFor } from "../bridge";
import { useApp } from "../store";
import { hostData, scopedHostData, type HostData, type HostLook } from "./hostScope";
import { onHostReset } from "./hostSwitch";
import { useHostScope, useScopedHostData } from "./useHostScope";

function useSource() {
  const hosts = useApp((s) => s.hosts);
  const daemon = useApp((s) => s.daemon);
  const features = useApp((s) => s.features);
  const featuresKnown = useApp((s) => s.featuresKnown);
  const sidebar = useApp((s) => s.sidebar);
  const approvals = useApp((s) => s.approvals);
  const services = useApp((s) => s.services);
  const byHost = useApp((s) => s.byHost);
  return useMemo(() => ({ hosts, daemon, features, featuresKnown, sidebar, approvals, services, byHost }), [hosts, daemon, features, featuresKnown, sidebar, approvals, services, byHost]);
}

/** Data of every connected host, in the scope or not (counts / badges, RFC §10). */
export function useConnectedHostData(): HostData[] {
  const source = useSource();
  return useMemo(() => scopedHostData(source, connectedHostIds(source.hosts)), [source]);
}

/** A list page's hosts: the scope's connected hosts' data, and the scope's hosts without any (notice). */
export interface ListHosts {
  /** The scope's hosts with loaded data (switcher order; the focus host from the top-level fields). */
  data: HostData[];
  /** Scope hosts without rows (not connected / loading): MissingHosts. */
  missing: HostLook[];
  /** Hosts whose rows are an older snapshot (daemon gone): greyed, no actions. */
  stale: ReadonlySet<string>;
  /** scope.showHostMarks */
  marks: boolean;
  /** scope.multi: notices about other hosts only then (a one-host scope looks like today). */
  multi: boolean;
  look: (hostId: string) => HostLook | null;
  focus: string;
}

/** A list page's hosts (RFC §9.2): the scope's connected hosts' data, and the scope's hosts without any. */
export function useListHosts(): ListHosts {
  const scope = useHostScope();
  const all = useScopedHostData();
  return useMemo(() => {
    const missing = hostsWithoutData(scope.hostsInScope, all);
    const gone = new Set(missing.map((h) => h.id));
    const data = all.filter((d) => !gone.has(d.hostId));
    return { data, missing, stale: staleHostIds(data), marks: scope.showHostMarks, multi: scope.multi, look: scope.host, focus: scope.focus };
  }, [scope, all]);
}

/** One host's data outside React (actions: the requester's sidebar row, …). */
export function hostDataNow(hostId: string): HostData | null {
  return hostData(useApp.getState(), hostId);
}

export interface PerHost<T> {
  value: T | null;
  error: string | null;
}

/**
 * Per-page data of several hosts (`load(hostId)`), reloaded when `key` changes, every `pollMs` while
 * the window is visible, and dropped when a host's connection is replaced (`onHostReset`). A host
 * leaving `hostIds` keeps nothing.
 */
export function usePerHost<T>(hostIds: readonly string[], load: (hostId: string) => Promise<T>, key: unknown, pollMs = 0): Record<string, PerHost<T>> {
  const [state, setState] = useState<Record<string, PerHost<T>>>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  const ids = hostIds.join("\n");
  useEffect(() => {
    const wanted = ids ? ids.split("\n") : [];
    let live = true;
    setState((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => wanted.includes(id))));
    const run = (hostId: string) =>
      loadRef.current(hostId).then(
        (value) => live && setState((cur) => ({ ...cur, [hostId]: { value, error: null } })),
        (e: unknown) => live && setState((cur) => ({ ...cur, [hostId]: { value: cur[hostId]?.value ?? null, error: e instanceof Error ? e.message : String(e) } })),
      );
    const all = () => wanted.forEach((id) => void run(id));
    all();
    const timer = pollMs > 0 ? setInterval(() => !document.hidden && all(), pollMs) : null;
    const offReset = onHostReset((hostId) => {
      if (!wanted.includes(hostId)) return;
      setState((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => id !== hostId)));
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
      offReset();
    };
  }, [ids, key, pollMs]);
  return state;
}

/**
 * Open an agent of `hostId` from a cross-host list (requester, owner, job agent): opened from its own
 * host while the scope stays (store `openAgent`; a host outside the scope shows 所有设备 first, ★ Q14).
 */
export function openHostAgent(hostId: string, sessionId: string): void {
  void useApp.getState().openAgent(sessionId, hostId);
}

/** 需要你 「其他主机 N 项」 (RFC §10, ★ Q15): what waits for the owner on connected hosts outside the scope. */
export function useOutOfScopeAttention(): number {
  const scope = useHostScope();
  const sessions = useApp((s) => s.sessions);
  const approvals = useApp((s) => s.approvals);
  const features = useApp((s) => s.features);
  const byHost = useApp((s) => s.byHost);
  const hosts = useApp((s) => s.hosts);
  const notes = useOwnerNotify((s) => s.byId);
  const others = useOwnerNotify((s) => s.others);
  return useMemo(() => outOfScopeCount(attentionByHost({ sessions, approvals, features, byHost, hosts }, notes, others), scope.isInScope), [scope, sessions, approvals, features, byHost, hosts, notes, others]);
}

/** Daemon calls for an entry of `hostId`: the focus host's `api`, another host's `apiFor` binding. */
export function hostApi(hostId: string): DaemonApi {
  return hostId === (useApp.getState().hosts?.active ?? LOCAL_HOST_ID) ? api : apiFor(hostId);
}
