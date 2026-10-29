// What your hosts have for you (cutex `users-self-profile`: capabilities `user` displayName /
// avatarEtag), followed across every connected host so a desktop without a local 「你」 shows — and
// fills empty hosts with (lib/identitySync) — the name / picture you set on another desktop, the most
// recently changed one when hosts disagree (lib/identity adoptedIdentity). cutex sends no profile
// timestamp, so "recent" is when this desktop saw a field change (localStorage, per host).
import { useMemo } from "react";
import { create } from "zustand";
import { hostAccessStore, useNonOwnerHosts } from "./hostAccess";
import { adoptedIdentity, observeHostIdentity, type AdoptedIdentity, type SeenHostIdentity } from "./identity";

const KEY = "cutex-desktop.identity.hosts";

function read(): Record<string, SeenHostIdentity> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, SeenHostIdentity>) : {};
  } catch {
    return {};
  }
}

const useSeen = create<Record<string, SeenHostIdentity>>(() => read());

/** Note the hosts' current values (hostAccess changes; lib/identitySync). */
export function observeHostIdentities(now = Date.now()): void {
  const before = useSeen.getState();
  let next: Record<string, SeenHostIdentity> | null = null;
  for (const [hostId, access] of Object.entries(hostAccessStore.get())) {
    if (!access || access.pending || (access.displayName === undefined && access.avatarEtag === undefined)) continue;
    const seen = observeHostIdentity(before[hostId], access, now);
    const old = before[hostId];
    if (old && old.name === seen.name && old.etag === seen.etag && old.nameAt === seen.nameAt && old.etagAt === seen.etagAt) continue;
    (next ??= { ...before })[hostId] = seen;
  }
  if (!next) return;
  useSeen.setState(next, true);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ages are just unknown next run
  }
}

/** Non-React: your identity across the connected hosts now. */
export function adoptedIdentityNow(focusHostId: string | null): AdoptedIdentity {
  return adoptedIdentity(hostAccessStore.get(), useSeen.getState(), focusHostId);
}

/** Your identity across the connected hosts (the name / picture shown without a local one). */
export function useAdoptedIdentity(focusHostId: string | null): AdoptedIdentity {
  const access = useNonOwnerHosts();
  const seen = useSeen();
  return useMemo(() => adoptedIdentity(access, seen, focusHostId), [access, seen, focusHostId]);
}
