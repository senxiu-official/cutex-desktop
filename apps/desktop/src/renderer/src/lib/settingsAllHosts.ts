// 「全部主机」 of a host settings page (SettingsPageItem.allHosts; the page reads lib/settingsHost
// `useAllHostsTarget`): whether it is offered and picked. Only components/Settings.tsx uses this.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { appModules } from "../modules/app";
import { useApp } from "../store";
import { allHostsChoice, type AllHostsChoice } from "./hostPick";
import { useHostScope } from "./useHostScope";

/** Module pref key of the remembered choice (per device; default on while offered). */
export const ALL_HOSTS_PREF = "hosts.all";
const noop = () => () => {};

/**
 * `offered` = the hosts 「全部主机」 would read (two or more online hosts report `capability`), `on` =
 * picked (the page module's pref `hosts.all`, default on). Without a module / capability: never offered.
 */
export function useSettingsAllHosts(moduleId: string | undefined, capability: string | undefined): { offered: AllHostsChoice | null; on: boolean; set(on: boolean): void } {
  const scope = useHostScope();
  const active = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  const features = useApp((s) => s.features);
  const known = useApp((s) => s.featuresKnown);
  const byHost = useApp((s) => s.byHost);
  const offered = useMemo(() => {
    if (!moduleId || !capability) return null;
    const of = (id: string) => (id === active ? (known ? features : null) : byHost[id]?.featuresKnown ? byHost[id].features : null);
    return allHostsChoice(scope.hosts, of, capability);
  }, [moduleId, capability, scope, active, features, known, byHost]);
  const prefs = moduleId ? appModules().prefs(moduleId) : null;
  const on = useSyncExternalStore(prefs?.subscribe ?? noop, () => (prefs ? prefs.get<boolean>(ALL_HOSTS_PREF, true) : false));
  const set = useCallback((next: boolean) => prefs?.set(ALL_HOSTS_PREF, next), [prefs]);
  return { offered, on: on && offered !== null, set };
}
