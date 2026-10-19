// The host whose settings the host pages of Settings edit (multi-host P1 step 2c; RFC §9.3, ★ Q11):
// the page header's host picker. Default = the focus host when Settings opens; a host picked in
// Settings stays until Settings closes (SettingsNav resets it) or the host is removed. A picked host
// that goes offline stays the target (UI-01, review 2026-10-15): the page shows it as unavailable and
// takes no edits (components/SettingsHostFrame) — it never moves to another host by itself.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { SettingsTab } from "../store"; // type only (erased)
import { canTargetHost, keepTargetHost, type AllHostsChoice } from "./hostPick";
import type { HostScope } from "./hostScope";
import { useHostScope } from "./useHostScope";

/**
 * Host pages that follow the picker (lib/targetHost: they read / write the picked host). Device pages
 * keep their own rules and show no picker.
 */
export const SETTINGS_HOST_PAGES: ReadonlySet<SettingsTab> = new Set<SettingsTab>(["profiles", "defaults", "instructions", "collab", "runtime", "mcp", "skills", "hooks", "plugins", "access", "remote", "peers", "users", "usage", "archive", "backend", "nci"]);
/**
 * Host pages that also render for a connection that is not the host's owner (the page decides what
 * such a connection sees): 访问管理 — a member sees 你在这台主机上 and their own devices; the management
 * parts are the owner's. (用户 is folded into it; kept for older params.)
 */
export const SETTINGS_MEMBER_PAGES: ReadonlySet<SettingsTab> = new Set<SettingsTab>(["access", "users"]);

const useChosen = create<{ hostId: string | null }>(() => ({ hostId: null }));

/** Pick the host Settings edits (null = back to the focus host). An explicit user choice. */
export function setSettingsHost(hostId: string | null): void {
  useChosen.setState({ hostId });
}

/** The picked host (null: none picked, the focus host is edited). Non-React, for tests / handlers. */
export function settingsHostChoice(): string | null {
  return useChosen.getState().hostId;
}

/** The host Settings edits and whether it can take edits now. */
export interface SettingsTarget {
  hostId: string;
  /** Online: reads are live and edits may be sent. False: show it as unavailable, accept no edits. */
  available: boolean;
}

/**
 * The Settings target for a picked host (`chosen`; null = none): the picked host while it is
 * configured — connected or not —, else the focus host. A host whose look is unknown (no host list
 * yet) counts as available, as before multi-host.
 */
export function resolveSettingsTarget(scope: Pick<HostScope, "host" | "focus">, chosen: string | null): SettingsTarget {
  const hostId = keepTargetHost(scope, chosen, scope.focus);
  const look = scope.host(hostId);
  return { hostId, available: !look || canTargetHost(look) };
}

const subscribeChosen = (listener: () => void) => useChosen.subscribe(listener);
const chosenNow = () => useChosen.getState().hostId;

/** The Settings target (re-renders on picks and connection changes). */
export function useSettingsTarget(): SettingsTarget {
  // The current pick also as the server snapshot (static renders in tests see it too).
  const chosen = useSyncExternalStore(subscribeChosen, chosenNow, chosenNow);
  const scope = useHostScope();
  const target = resolveSettingsTarget(scope, chosen);
  // Stable fields only: callers compare / key on them.
  return useMemo(() => target, [target.hostId, target.available]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The host the Settings host pages edit (see `resolveSettingsTarget`). */
export function useSettingsHost(): string {
  return useSettingsTarget().hostId;
}

// ---------- 「全部主机」 (SettingsPageItem.allHosts; first user: 用量) ----------

/**
 * The hosts a page shows at once while its header picker is on 「全部主机」; null = one host (the
 * target host, lib/targetHost). Edits still go to one host: the page picks it (never all at once).
 */
export const AllHostsContext = createContext<AllHostsChoice | null>(null);

/** The page's 「全部主机」 hosts (null: one host). */
export function useAllHostsTarget(): AllHostsChoice | null {
  return useContext(AllHostsContext);
}
