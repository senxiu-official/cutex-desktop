// React side of lib/settingsGate.ts: the gate target of a settings page, re-rendering when that host's
// capabilities or this desktop's role there change. Inside a Settings host frame whose host is offline
// it gates on what that host last reported (lib/heldHostData), like the page's own capability reads.
import { useMemo } from "react";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { useApp } from "../store";
import { useHeldHostData } from "./heldHostData";
import { useHostAccess } from "./hostAccess";
import type { SettingsGateTarget } from "./settingsGate";
import { useHostData } from "./useHostScope";

/** `hostId` = the page's target host (null: an app page, whose page-declared cards follow the focus host). */
export function useSettingsGateTarget(hostId: string | null): SettingsGateTarget {
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  const data = useHostData(hostId ?? focus);
  const held = useHeldHostData(hostId, !!data?.featuresKnown);
  const access = useHostAccess(hostId);
  const features = held?.features ?? data?.features ?? null;
  const known = held ? held.featuresKnown : (data?.featuresKnown ?? false);
  const { isOwner, pending } = access;
  return useMemo(
    () => ({ hostId, host: features ? { features, featuresKnown: known } : null, access: hostId ? { isOwner, pending } : null }),
    [hostId, features, known, isOwner, pending],
  );
}
