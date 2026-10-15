// React side of the create forms' host choice (multi-host P1 step 2c; model: lib/hostPick).
import { useState } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { useApp } from "../store";
import { defaultCreateHost, hostPickerMode, keepTargetHost, type HostPickerMode } from "./hostPick";
import type { HostLook } from "./hostScope";
import { getUiPrefs, setUiPref } from "./prefs";
import { useHostScope } from "./useHostScope";

export interface CreateHost {
  hostId: string;
  look: HostLook | null;
  mode: HostPickerMode;
  setHostId(hostId: string): void;
}

/**
 * The host a create form targets: `initial` (e.g. the host of the project the form was opened for),
 * else ★ RFC Q10's default — recomputed until the owner picks one; a picked host stays (also while
 * offline: the form then waits) until it is removed.
 */
export function useCreateHost(initial?: string | null): CreateHost {
  const scope = useHostScope();
  // The selected agent's host (an agent of another host in the scope opens in place: store `selectedHost`).
  const selectedHost = useApp((s) => (s.selectedId ? (s.selectedHost ?? s.hosts?.active ?? LOCAL_HOST_ID) : null));
  const [chosen, setChosen] = useState<string | null>(initial ?? null);
  const fallback = defaultCreateHost(scope, { selectedHost, lastUsed: getUiPrefs().lastCreateHost || null, mode: getUiPrefs().createHostDefault });
  const hostId = keepTargetHost(scope, chosen, fallback);
  return { hostId, look: scope.host(hostId), mode: hostPickerMode(scope, hostId), setHostId: setChosen };
}

/** A form created something on `hostId`: the next form defaults to it (★ Q10 "上次新建用的主机"). */
export function rememberCreateHost(hostId: string): void {
  if (getUiPrefs().lastCreateHost !== hostId) setUiPref("lastCreateHost", hostId);
}
