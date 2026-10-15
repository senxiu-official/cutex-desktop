// Profile avatars: a small round picture per profile, or (none set) the name's initial on the
// profile colour. cutex has no avatar field yet, so pictures live in this device's localStorage,
// per host and keyed by profile id (a rename keeps the picture). When cutex stores them, this file
// becomes the read / write path to it and the local copies are imported once.
import { useSyncExternalStore } from "react";
import { useApp } from "../store";

const KEY = "cutex-desktop.profileAvatars";
/** Edge of the stored square, px (shown at up to 64 px; 2x for HiDPI). */
export const AVATAR_PX = 128;

type Store = Record<string, Record<string, string>>;

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Store) : {};
  } catch {
    return {};
  }
}

let current: Store = load();
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The picture of `profileId` on `host` (data URL), or null. */
export function profileAvatarOf(host: string, profileId: string): string | null {
  return current[host]?.[profileId] ?? null;
}

/** Set (data URL) or clear (null) a profile's picture. */
export function setProfileAvatar(host: string, profileId: string, picture: string | null): void {
  const forHost = { ...(current[host] ?? {}) };
  if (picture) forHost[profileId] = picture;
  else delete forHost[profileId];
  current = { ...current, [host]: forHost };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // quota full: the picture lasts until the window reloads
  }
  for (const l of listeners) l();
}

/** Key of the active host (same as the usage page's cache key). */
export function useHostKey(): string {
  return useApp((s) => (s.daemon.kind === "connected" ? s.daemon.hostId : s.daemon.baseUrl));
}

/** The active host's picture for `profileId` (null = none; undefined id = none). */
export function useProfileAvatar(profileId: string | null | undefined): string | null {
  const host = useHostKey();
  return useSyncExternalStore(subscribe, () => (profileId ? profileAvatarOf(host, profileId) : null));
}
