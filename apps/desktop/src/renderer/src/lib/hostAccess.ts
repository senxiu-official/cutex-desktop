// Who this desktop is on each connected host (cutex `users`, docs/research/user-isolation-p1-20261014.md
// §9): the `user` block of `/v2/capabilities`, kept per host id. The store notes it whenever it reads a
// host's capabilities (connect, reconnect, `cutex/access/changed`). Unknown (not read yet / not
// connected) reads as the owner here — owner-only parts are gated by the store's feature sets
// (shared/users.ts hostFeatureSet: a non-owner connection loses the owner-only capabilities), so this
// is only for notices and the composer's send check.
import { create } from "zustand";
import { hostUserAccessOf, OWNER_ACCESS, type HostUserAccess } from "../../../shared/users";
import { onHostReset } from "./hostSwitch";

const useAccess = create<Record<string, HostUserAccess>>(() => ({}));

onHostReset((hostId) => useAccess.setState((s) => (s[hostId] ? Object.fromEntries(Object.entries(s).filter(([id]) => id !== hostId)) : s), true));

/** Record a host's `/v2/capabilities` reply (null: the route is missing = an older cutex = the owner). */
export function noteHostAccess(hostId: string, capabilities: { user?: unknown } | null | undefined): void {
  const next = hostUserAccessOf(capabilities);
  const before = useAccess.getState()[hostId];
  if (before && JSON.stringify(before) === JSON.stringify(next)) return;
  useAccess.setState({ [hostId]: next });
}

/** Non-React: the host's access now (unknown → owner). */
export function hostAccessNow(hostId: string): HostUserAccess {
  return useAccess.getState()[hostId] ?? OWNER_ACCESS;
}

/** The host's access (unknown → owner); `known` = its capabilities have been read. */
export function useHostAccess(hostId: string | null | undefined): HostUserAccess & { known: boolean } {
  const access = useAccess((s) => (hostId ? s[hostId] : undefined));
  return access ? { ...access, known: true } : { ...OWNER_ACCESS, known: false };
}

/** Every host whose access is known and not the owner's (notices). */
export function useNonOwnerHosts(): Record<string, HostUserAccess> {
  return useAccess();
}

/**
 * users-self-profile: this desktop just set its own display name / avatar on `hostId` (PATCH
 * /v2/users/me answered): keep the known access in step until the next capabilities read.
 */
export function noteSelfProfile(hostId: string, profile: { displayName: string | null; avatarEtag: string | null }): void {
  const before = useAccess.getState()[hostId];
  if (!before || (before.displayName === profile.displayName && before.avatarEtag === profile.avatarEtag)) return;
  useAccess.setState({ [hostId]: { ...before, ...profile } });
}

/** Non-React: every host whose access is known, and changes to it. */
export const hostAccessStore = { get: () => useAccess.getState(), subscribe: (listener: () => void) => useAccess.subscribe(listener) };

const LAST_KEY = "cutex-desktop.lastAccess";

/** The last known 你在各主机上 row of a host (desktop only, localStorage), for 未连接 · 上次是 …. */
export function lastAccessOf<R>(hostId: string): R | null {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, R>;
    return all && typeof all === "object" ? (all[hostId] ?? null) : null;
  } catch {
    return null;
  }
}

/** Remember a host's row while it is connected (written only when it changed). */
export function rememberAccess<R>(hostId: string, row: R): void {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, R>;
    const next = all && typeof all === "object" ? all : {};
    if (JSON.stringify(next[hostId]) === JSON.stringify(row)) return;
    next[hostId] = row;
    localStorage.setItem(LAST_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the row just says 未连接 later
  }
}
