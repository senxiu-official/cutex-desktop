// The sidebar's delegation-id lookup (lib/delegationIdSearch): which hosts of the scope are asked (connected, with
// delegations — not the session-search hosts) and when — shortly after the text settles; a change of text, scope or
// connection drops the search. The shell (components/Sidebar) names no feature; it asks here.
import { useEffect, useMemo } from "react";
import { hostEpoch } from "../../../shared/hosts";
import { ASKS_FEATURE } from "./delegations";
import { delegationIdQuery, dropDelegationIdSearch, searchDelegationId, setIdLookupHosts, SHORT_ID_LOOKUP_FEATURE, type DelegationIdQuery } from "./delegationIdSearch";
import type { ScopedSidebar } from "./scopedSidebarView";
import { featuresOf, useApp } from "../store";

/** Typing pauses this long before the hosts are asked. */
export const DELEGATION_ID_DELAY_MS = 300;

/** `id=epoch` lines → { id: epoch }. */
const epochsOf = (hostsKey: string): Record<string, string> =>
  Object.fromEntries(hostsKey ? hostsKey.split("\n").map((entry) => [entry.slice(0, entry.lastIndexOf("=")), entry.slice(entry.lastIndexOf("=") + 1)]) : []);

/** The parsed id of `query` (null: not a delegation id); looks it up on the scope's hosts that have delegations. */
export function useIdLookup(query: string, scoped: Pick<ScopedSidebar, "hosts">): DelegationIdQuery | null {
  const parsed = useMemo(() => delegationIdQuery(query), [query]);
  const hostsKey = useApp((s) => scoped.hosts.filter((h) => h.state === "live" && featuresOf(s, h.look.id).has(ASKS_FEATURE)).map((h) => `${h.look.id}=${hostEpoch(s.hosts, h.look.id) ?? ""}`).join("\n"));
  // r296: the hosts that look short ids up themselves (part of the key: a host gaining it searches again).
  const shortIdKey = useApp((s) => scoped.hosts.filter((h) => h.state === "live" && featuresOf(s, h.look.id).has(SHORT_ID_LOOKUP_FEATURE)).map((h) => h.look.id).join("\n"));
  const key = parsed && hostsKey ? JSON.stringify([parsed.ref, hostsKey, shortIdKey]) : null;
  // Only these hosts are asked, also by a request already queued on a host's lane behind a session search.
  useEffect(() => setIdLookupHosts(Object.keys(epochsOf(hostsKey))), [hostsKey]);
  useEffect(() => {
    dropDelegationIdSearch(key);
    if (!key || !parsed) return;
    const epochs = epochsOf(hostsKey);
    const shortId = new Set(shortIdKey ? shortIdKey.split("\n") : []);
    const timer = setTimeout(() => searchDelegationId(parsed, Object.keys(epochs), key, epochs, shortId), DELEGATION_ID_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the sidebar (unmount) ends the search too.
  useEffect(() => () => dropDelegationIdSearch(null), []);
  return parsed;
}
