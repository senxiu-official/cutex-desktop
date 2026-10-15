// Open a delegation's detail on the right side (owner 2026-10-13: clicking a delegation in a list
// shows its information instead of jumping to its card far back in the timeline). The core does not
// know the delegations module: it opens a `delegation` ref (docs/desktop-modules.md §19.9), whose
// one provider is that module (modules/delegations/detail.ts). Not available (module off, cutex
// without asks, another host out of view) → `fallback` (the old jump), when given.
import { DELEGATION_REF_KIND, delegationRef } from "./delegationRefs";
import { refsOpen } from "./refServices";

export { DELEGATION_REF_KIND };

/** `hostId`: the host whose record it is (the row's host, never the focus host for another host's row). */
export function openDelegationDetail(hostId: string, askId: string, opts: { title?: string; fallback?: () => void } = {}): void {
  void refsOpen(delegationRef(hostId, askId, opts.title), { how: "page" })
    .catch(() => ({ status: "unavailable" as const }))
    .then((r) => {
      if (r.status === "unavailable") opts.fallback?.();
    });
}
