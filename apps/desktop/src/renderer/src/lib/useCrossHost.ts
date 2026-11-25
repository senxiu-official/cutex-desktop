// Hooks over lib/crossHost: a record's receipt (gated on its own host's capability) and what its peer reads as on
// this desktop. Selectors return strings so a re-render happens only when the words would change.
import { useMemo } from "react";
import { useApp, featuresOf } from "../store";
import { asCrossHost, PEER_RECEIPTS_FEATURE, type CrossHost } from "../../../shared/crossHost";
import { peerHostView, type PeerHostView } from "./crossHost";

/** `record`'s receipt when `hostId` (the host that issued it) has peer-delivery-receipts-v1, else null. */
export function useCrossHost(record: { crossHost?: unknown } | null | undefined, hostId: string | null | undefined): CrossHost | null {
  const on = useApp((s) => featuresOf(s, hostId).has(PEER_RECEIPTS_FEATURE));
  const raw = record?.crossHost;
  return useMemo(() => (on ? asCrossHost(raw) : null), [on, raw]);
}

/** The peer `instanceId` as this desktop shows it: the connected host's current name, else `snapshot`. */
export function usePeerHost(instanceId: string | null | undefined, snapshot: string): PeerHostView | null {
  const key = useApp((s) => {
    if (!instanceId) return "";
    const v = peerHostView(s, instanceId, snapshot);
    return JSON.stringify([v.name, v.hostId, v.ambiguous]);
  });
  return useMemo(() => {
    if (!key || !instanceId) return null;
    const [name, hostId, ambiguous] = JSON.parse(key) as [string, string | null, boolean];
    return { name, hostId, ambiguous, instanceId };
  }, [key, instanceId]);
}
