// React side of the view scope (multi-host P1; model + docs in lib/hostScope.ts and
// docs/research/multi-host-p1-interfaces.md): hooks over the store, and the scope / host actions the
// switcher and Settings → 主机 use. Everything goes through main HostManager (hosts.json): the
// renderer never keeps its own copy of the scope.
import { useMemo } from "react";
import type { HostAppearancePatch, HostGroupDraft, ViewScope } from "../../../shared/hosts";
import { api } from "../bridge";
import { useApp } from "../store";
import { hostData, resolveHostScope, scopedHostData, type HostData, type HostLook, type HostScope } from "./hostScope";
import { getUiPrefs, useUiPrefs } from "./prefs";

/** The current scope, its hosts and their looks (re-renders on host list / scope / connection changes). */
export function useHostScope(): HostScope {
  const hosts = useApp((s) => s.hosts);
  const daemon = useApp((s) => s.daemon);
  const byHost = useApp((s) => s.byHost);
  const marks = useUiPrefs().hostMarksSingle;
  return useMemo(() => resolveHostScope({ hosts, daemon, byHost }, marks), [hosts, daemon, byHost, marks]);
}

/** One host's look (dot color, label, platform, status); null for an unknown / removed host. */
export function useHostLook(hostId: string | null | undefined): HostLook | null {
  const scope = useHostScope();
  return hostId ? scope.host(hostId) : null;
}

/** Non-React code (event handlers, stores): the scope right now. */
export function currentHostScope(): HostScope {
  const s = useApp.getState();
  return resolveHostScope(s, getUiPrefs().hostMarksSingle);
}

/** Data of the scope's connected hosts (focus host from the top-level fields, others from `byHost`). */
export function useScopedHostData(): HostData[] {
  const source = useDataSource();
  return useMemo(() => scopedHostData(source), [source]);
}

/** One connected host's data (null: not connected / unknown). */
export function useHostData(hostId: string): HostData | null {
  const source = useDataSource();
  return useMemo(() => hostData(source, hostId), [source, hostId]);
}

/** Data of the given connected hosts, in switcher order (unconnected ones left out). */
export function useHostsData(ids: readonly string[]): HostData[] {
  const source = useDataSource();
  const key = ids.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `ids`
  return useMemo(() => scopedHostData(source, ids), [source, key]);
}

function useDataSource() {
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

const reportError = (error: unknown) => useApp.getState().notify(error instanceof Error ? error.message : String(error), "error");

/**
 * Change what the UI shows (switcher, notifications, "其他主机 N 项"). Connects the scope's hosts on
 * the way (main); persisted in hosts.json. Errors are shown as a notice; the promise never rejects.
 */
export async function setViewScope(scope: ViewScope): Promise<void> {
  try {
    await api.setScope(scope);
  } catch (error) {
    reportError(error);
  }
}

/** ⏻: connect / disconnect one host (does not change the scope). */
export async function setHostConnected(hostId: string, on: boolean): Promise<void> {
  try {
    await api.connectHost(hostId, on);
  } catch (error) {
    reportError(error);
  }
}

/** Connect at launch and keep connected outside the scope. */
export async function setHostAutoConnect(hostId: string, on: boolean): Promise<void> {
  try {
    await api.setHostAutoConnect(hostId, on);
  } catch (error) {
    reportError(error);
  }
}

/** Host color / look (hosts.json). */
export async function setHostAppearance(hostId: string, patch: HostAppearancePatch): Promise<void> {
  try {
    await api.setHostAppearance(hostId, patch);
  } catch (error) {
    reportError(error);
  }
}

/**
 * Replace the host groups (Settings → 主机 → 分组; whole list). Callers validate first with shared
 * `normalizeHostGroups` (lib/hostGroups); a refusal from main is shown as a notice. True when saved.
 */
export async function saveHostGroups(groups: HostGroupDraft[]): Promise<boolean> {
  try {
    await api.saveHostGroups(groups);
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}
