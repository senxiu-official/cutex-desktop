// Host choice of create forms and host settings pages (multi-host P1 step 2c; RFC §9.2, §9.3, ★ Q10,
// Q11) — pure, unit-tested in test/hostPick.test.ts. The picker component is components/HostPicker.tsx.
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import type { HostLook, HostScope } from "./hostScope";

/** Default host of create forms in a multi-host scope (Settings → 连接 → 新建时的主机). */
export type CreateHostDefault = "local" | "context";

/** A host a form can target / a settings page can edit: its daemon is connected and online. */
export const canTargetHost = (host: Pick<HostLook, "indicator">): boolean => host.indicator.status === "online";

/**
 * Default host of a new agent / project / … (★ RFC Q10): a one-host scope → that host; otherwise
 * (`mode` "context") the selected agent's host → the host of the last creation → this machine, or
 * (`mode` "local") this machine first, then the same two — each only when it is in the
 * scope and online (「本机」 without a local host: straight to the fallback). Falls back to the first online host in the scope, then any online host, then the
 * focus host (the form then shows it as unavailable).
 */
export function defaultCreateHost(scope: Pick<HostScope, "multi" | "hosts" | "hostsInScope" | "focus">, prefer: { selectedHost: string | null; lastUsed: string | null; mode?: CreateHostDefault }): string {
  const usable = (id: string | null | undefined): id is string => {
    const host = id ? scope.hostsInScope.find((h) => h.id === id) : undefined;
    return !!host && canTargetHost(host);
  };
  if (!scope.multi) {
    const only = scope.hostsInScope[0]?.id;
    if (usable(only)) return only;
  } else {
    // 「本机」 (owner 2026-10-14, the default): this machine first; 「跟随当前」: the RFC Q10 order.
    // No local host (macOS without a local cutex): 「本机」 falls back to the first online host below.
    const noLocal = prefer.mode === "local" && !scope.hosts.some((h) => h.id === LOCAL_HOST_ID);
    const order = noLocal ? [] : prefer.mode === "local" ? [LOCAL_HOST_ID, prefer.selectedHost, prefer.lastUsed] : [prefer.selectedHost, prefer.lastUsed, LOCAL_HOST_ID];
    for (const id of order) if (usable(id)) return id;
  }
  return scope.hostsInScope.find(canTargetHost)?.id ?? scope.hosts.find(canTargetHost)?.id ?? scope.focus;
}

/** How a form / settings page shows its host: a picker (more than one host could be chosen), a read-only label, or nothing. */
export type HostPickerMode = "picker" | "label" | "none";

/**
 * A picker when the scope spans hosts or more than one host is online (another host can be chosen
 * without changing the scope; a host that only keeps retrying does not count); otherwise a read-only
 * label when host marks are on (★ Q7), else nothing. `current`: the chosen host — another host than
 * the focus host always keeps its picker (the way back).
 */
export function hostPickerMode(scope: Pick<HostScope, "multi" | "hosts" | "showHostMarks" | "focus">, current?: string): HostPickerMode {
  if (scope.multi || scope.hosts.filter(canTargetHost).length > 1 || (current !== undefined && current !== scope.focus)) return "picker";
  return scope.showHostMarks ? "label" : "none";
}

/**
 * Keep a chosen host while it is configured, also while it is offline (a half-filled form never moves
 * to another host by itself — its create button waits instead); a removed host falls back.
 */
export function keepTargetHost(scope: Pick<HostScope, "host">, chosen: string | null, fallback: string): string {
  return chosen && scope.host(chosen) ? chosen : fallback;
}

/** Why a host is left out of a page's 「全部主机」 view. */
export type AllHostsExclusion = "offline" | "checking" | "unsupported";

/** The hosts a 「全部主机」 view reads (in switcher order) and the configured ones it leaves out. */
export interface AllHostsChoice {
  hostIds: string[];
  excluded: { hostId: string; label: string; reason: AllHostsExclusion }[];
}

/**
 * 「全部主机」 of a settings page that declares `allHosts` (SettingsPageItem): every online host whose
 * cutex reports `capability`. `features(id)`: that host's feature list, null while not known yet.
 * Offered (non-null) only when two or more hosts qualify.
 */
export function allHostsChoice(hosts: readonly Pick<HostLook, "id" | "label" | "indicator">[], features: (hostId: string) => ReadonlySet<string> | null, capability: string): AllHostsChoice | null {
  const choice: AllHostsChoice = { hostIds: [], excluded: [] };
  for (const h of hosts) {
    const known = canTargetHost(h) ? features(h.id) : null;
    const reason: AllHostsExclusion | null = !canTargetHost(h) ? "offline" : !known ? "checking" : known.has(capability) ? null : "unsupported";
    if (reason) choice.excluded.push({ hostId: h.id, label: h.label, reason });
    else choice.hostIds.push(h.id);
  }
  return choice.hostIds.length >= 2 ? choice : null;
}
