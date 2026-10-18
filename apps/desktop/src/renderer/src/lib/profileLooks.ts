// What an agent avatar needs of its Profile (colour, model family → 头像主题), per host, kept from the
// profile lists the app loads anyway (lib/profileSnapshot rememberProfileList). Reactive (avatars
// re-render when a list arrives); no bridge import: the loader and the write path are registered by
// profileSnapshot, so tests and the mock without one simply see no profiles.
//
// cutex `profile-avatar` (2026-10-18): a host that stores Profile looks (picture, intro portrait,
// 头像主题, greeting) lists `avatarEtag` on every Profile. That presence is how the desktop tells a
// syncing host from an older one (profileLooksSynced); lib/profileAvatar, lib/introAppearance and the
// theme prefs read and write through the host then, and fall back to this device's copies otherwise.
import { useSyncExternalStore } from "react";
import type { DaemonApi, ProfileItem } from "../../../shared/ipc";
import { onHostReset, onHostSwitch } from "./hostSwitch";

export type ProfileLook = Pick<ProfileItem, "id" | "name" | "model" | "cliKind" | "appearance" | "avatarEtag" | "introPortraitEtag">;

/** The daemon calls the host-stored looks need (registered by lib/profileSnapshot). */
export type ProfileLooksApi = Pick<DaemonApi, "profileImage" | "putProfileImage" | "patchProfile">;

/** host id → profiles by id and by name (sessions name their profile; renames keep the id). */
let byHost = new Map<string, Map<string, ProfileLook>>();
/** Hosts whose list carried `avatarEtag` (cutex `profile-avatar`). */
let synced = new Set<string>();
const asked = new Set<string>();
let loader: ((hostId: string) => void) | null = null;
let apiOf: ((hostId: string) => ProfileLooksApi) | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notedListeners = new Set<(hostId: string, looks: readonly ProfileLook[]) => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

const lookOf = (p: ProfileLook): ProfileLook => ({
  id: p.id,
  name: p.name,
  model: p.model,
  cliKind: p.cliKind,
  appearance: p.appearance,
  avatarEtag: p.avatarEtag,
  introPortraitEtag: p.introPortraitEtag,
});

export function noteProfileLooks(hostId: string, profiles: readonly ProfileLook[] | null | undefined): void {
  const map = new Map<string, ProfileLook>();
  const looks: ProfileLook[] = [];
  for (const p of profiles ?? []) {
    const look = lookOf(p);
    looks.push(look);
    map.set(p.name, look);
    if (p.id) map.set(p.id, look);
  }
  byHost = new Map(byHost).set(hostId, map);
  synced = new Set(synced);
  if (looks.some((p) => p.avatarEtag !== undefined)) synced.add(hostId);
  else synced.delete(hostId);
  emit();
  for (const l of [...notedListeners]) {
    try {
      l(hostId, looks);
    } catch {
      // one migration failing must not stop the others
    }
  }
}

/** Called after every noted profile list (one-time imports of this device's copies listen here). */
export function onProfileLooksNoted(listener: (hostId: string, looks: readonly ProfileLook[]) => void): () => void {
  notedListeners.add(listener);
  return () => notedListeners.delete(listener);
}

/** Loads a host's profile list on first use (lib/profileSnapshot registers it). */
export function setProfileLooksLoader(load: ((hostId: string) => void) | null): void {
  loader = load;
}

/** The daemon calls of a host (lib/profileSnapshot registers them). */
export function setProfileLooksApi(api: ((hostId: string) => ProfileLooksApi) | null): void {
  apiOf = api;
}

/** A host's daemon calls for the looks (null: none registered, e.g. tests). */
export function profileLooksApi(hostId: string): ProfileLooksApi | null {
  return apiOf?.(hostId) ?? null;
}

/** A host's profile by name or id; asks for the host's list once when none is known yet. */
export function profileLookOf(hostId: string, profile: string | null | undefined): ProfileLook | null {
  const map = byHost.get(hostId);
  if (!map && loader && !asked.has(hostId)) {
    asked.add(hostId);
    queueMicrotask(() => loader?.(hostId));
  }
  return profile ? (map?.get(profile) ?? null) : null;
}

/**
 * Whether `hostId` stores Profile looks itself (cutex `profile-avatar`, seen on its profile list):
 * pictures, intro portraits, 头像主题 and greetings then live on the host and show on every device.
 * false until the host's list is known. The Settings section drops its 「本机」 badge on true.
 */
export function profileLooksSynced(hostId: string): boolean {
  return synced.has(hostId);
}

/** Reactive {@link profileLooksSynced} (asks for the host's list once when none is known yet). */
export function useProfileLooksSynced(hostId: string | null | undefined): boolean {
  useProfileLooksVersion();
  if (!hostId) return false;
  profileLookOf(hostId, null);
  return synced.has(hostId);
}

/** The host whose list holds profile `profileId` (ids are UUIDs): `prefer` when it does, else the first. */
export function hostOfProfile(profileId: string, prefer?: string | null): string | null {
  if (prefer && byHost.get(prefer)?.get(profileId)?.id === profileId) return prefer;
  for (const [hostId, map] of byHost) if (map.get(profileId)?.id === profileId) return hostId;
  return null;
}

/** Applies a write's result to the known look at once (the next list confirms it). */
export function patchProfileLook(hostId: string, profileId: string, patch: Partial<Pick<ProfileLook, "avatarEtag" | "introPortraitEtag">> & { appearance?: Partial<ProfileLook["appearance"]> }): void {
  const map = byHost.get(hostId);
  const look = map?.get(profileId);
  if (!map || !look) return;
  const next: ProfileLook = { ...look, ...patch, appearance: { ...look.appearance, ...patch.appearance } };
  const copy = new Map(map);
  for (const [key, value] of map) if (value === look) copy.set(key, next);
  byHost = new Map(byHost).set(hostId, copy);
  emit();
}

export function useProfileLooksVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
}

/** Non-React subscription (stores built on the looks). */
export function subscribeProfileLooks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function drop(hostId?: string): void {
  if (hostId === undefined) {
    byHost = new Map();
    synced = new Set();
    asked.clear();
  } else {
    byHost = new Map(byHost);
    byHost.delete(hostId);
    synced = new Set(synced);
    synced.delete(hostId);
    asked.delete(hostId);
  }
  emit();
}
onHostSwitch(() => drop());
onHostReset((hostId) => drop(hostId));

/** Tests. */
export function resetProfileLooksForTest(): void {
  byHost = new Map();
  synced = new Set();
  asked.clear();
  loader = null;
  apiOf = null;
  notedListeners.clear();
}
