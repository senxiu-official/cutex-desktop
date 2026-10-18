// Profile avatars: a small round picture per profile, or (none set) the name's initial on the
// profile colour. A host with cutex `profile-avatar` stores the picture itself (keyed by profile id,
// so a rename keeps it) and every device that connects shows it (lib/profileImages); an older host
// keeps the device-local copy in localStorage, per daemon host key and profile id, as before.
// One-time import: when a syncing host's profile list arrives, a local picture of a profile the host
// has none for is uploaded and the local copy removed (lib/profileLooks onProfileLooksNoted).
import { useSyncExternalStore } from "react";
import { useApp } from "../store";
import { prepareAvatar } from "./identityAvatar";
import { profileImageNow, showPendingProfileImage, useProfileImage, writeProfileImage } from "./profileImages";
import { hostOfProfile, onProfileLooksNoted, profileLooksSynced, useProfileLooksVersion } from "./profileLooks";

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

/** This device's copy (older hosts; the one-time import source). */
export function localProfileAvatarOf(host: string, profileId: string): string | null {
  return current[host]?.[profileId] ?? null;
}

function setLocal(host: string, profileId: string, picture: string | null): void {
  const forHost = { ...(current[host] ?? {}) };
  if (picture) forHost[profileId] = picture;
  else delete forHost[profileId];
  current = { ...current, [host]: forHost };
  if (!Object.keys(forHost).length) delete current[host];
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // quota full: the picture lasts until the window reloads
  }
  for (const l of listeners) l();
}

type DaemonLike = { kind: string; hostId?: string; baseUrl?: string } | null | undefined;
const daemonKey = (daemon: DaemonLike): string | null => (daemon ? (daemon.kind === "connected" ? (daemon.hostId ?? null) : (daemon.baseUrl ?? null)) : null);

/** Hosts-list id ↔ daemon host key (the key this file's local store uses) of the connected hosts. */
function hostPairs(): [string, string][] {
  const s = useApp.getState() as unknown as { daemon?: DaemonLike; hosts?: { active?: string } | null; byHost?: Record<string, { daemon?: DaemonLike }> };
  const pairs: [string, string][] = [];
  const focusKey = daemonKey(s.daemon);
  if (focusKey) pairs.push([s.hosts?.active ?? "local", focusKey]);
  for (const [hostId, slice] of Object.entries(s.byHost ?? {})) {
    const key = daemonKey(slice?.daemon);
    if (key) pairs.push([hostId, key]);
  }
  return pairs;
}

/** The hosts-list id of the host a profile picture belongs to: the host whose list holds the profile id, preferring the one behind `host` (a daemon key). */
function syncingHostOf(host: string, profileId: string): string | null {
  const prefer = hostPairs().find(([, key]) => key === host)?.[0] ?? null;
  const hostId = hostOfProfile(profileId, prefer);
  return hostId && profileLooksSynced(hostId) ? hostId : null;
}

/** The picture of `profileId` on `host` (daemon key; data URL), or null. */
export function profileAvatarOf(host: string, profileId: string): string | null {
  const synced = syncingHostOf(host, profileId);
  return synced ? profileImageNow(synced, profileId, "avatar") : localProfileAvatarOf(host, profileId);
}

/**
 * Set (data URL) or clear (null) a profile's picture. On a syncing host the upload runs in the
 * background (shown at once; a refusal drops back to the host's picture); else this device's copy.
 */
export function setProfileAvatar(host: string, profileId: string, picture: string | null): void {
  const synced = syncingHostOf(host, profileId);
  if (!synced) return setLocal(host, profileId, picture);
  void uploadPicture(synced, profileId, picture);
}

/** The picture as cutex takes it (≤ 48 KiB, re-encoded when bigger); null = remove. */
async function uploadPicture(hostId: string, profileId: string, picture: string | null): Promise<boolean> {
  if (!picture) return writeProfileImage(hostId, profileId, "avatar", null);
  showPendingProfileImage(hostId, profileId, "avatar", picture);
  const prepared = await prepareAvatar(picture).catch(() => null);
  if (!prepared) {
    showPendingProfileImage(hostId, profileId, "avatar", undefined);
    return false;
  }
  return writeProfileImage(hostId, profileId, "avatar", `data:${prepared.upload.contentType};base64,${prepared.upload.data}`);
}

/** Key of the active host (same as the usage page's cache key). */
export function useHostKey(): string {
  return useApp((s) => (s.daemon.kind === "connected" ? s.daemon.hostId : s.daemon.baseUrl));
}

/** The active host's picture for `profileId` (null = none; undefined id = none). */
export function useProfileAvatar(profileId: string | null | undefined): string | null {
  const host = useHostKey();
  useProfileLooksVersion();
  const synced = profileId ? syncingHostOf(host, profileId) : null;
  const remote = useProfileImage(synced, profileId, "avatar");
  const local = useSyncExternalStore(subscribe, () => (profileId ? localProfileAvatarOf(host, profileId) : null));
  return synced ? remote : local;
}

// ── one-time import of this device's pictures (per host and run) ─────────────────────────────────

const imported = new Set<string>();

/** Upload the local pictures of profiles a syncing host has none for; drop each local copy once stored. */
export async function importLocalProfileAvatars(hostId: string, looks: readonly { id: string; avatarEtag?: string | null }[], key: string | null): Promise<void> {
  if (!key || !profileLooksSynced(hostId)) return;
  for (const look of looks) {
    const picture = look.id ? localProfileAvatarOf(key, look.id) : null;
    if (!picture || look.avatarEtag) continue;
    if (await uploadPicture(hostId, look.id, picture)) setLocal(key, look.id, null);
  }
}

onProfileLooksNoted((hostId, looks) => {
  if (imported.has(hostId) || !profileLooksSynced(hostId)) return;
  const key = hostPairs().find(([id]) => id === hostId)?.[1] ?? null;
  if (!key || !current[key]) return;
  imported.add(hostId);
  void importLocalProfileAvatars(hostId, looks, key);
});
