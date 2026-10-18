// Host-stored Profile images (cutex `profile-avatar`): the picture and the intro portrait, fetched
// through main as data URLs and cached per host + profile + kind + ETag for the run (the profile list
// carries the ETags, so a changed image is a new key and an unchanged one is never fetched twice;
// lib/userAvatars works the same for users). Writes are optimistic: the new image shows at once and
// stays shown while the upload runs; a refused upload drops back to the host's image.
import { useEffect } from "react";
import { create } from "zustand";
import type { ProfileImageKind } from "@cutex-desktop/cutex-client";
import { onHostReset, onHostSwitch } from "./hostSwitch";
import { patchProfileLook, profileLookOf, profileLooksApi, useProfileLooksVersion } from "./profileLooks";

export type { ProfileImageKind };

const ETAG = /^[0-9a-f]{16}$/;

interface ImagesState {
  /** host|profile|kind|etag → data URL, or null once the host answered without an image. */
  images: Record<string, string | null>;
  /** host|profile|kind → the image being written (data URL; null = being removed). */
  pending: Record<string, string | null>;
}

const useImages = create<ImagesState>(() => ({ images: {}, pending: {} }));
const inFlight = new Set<string>();
/** Entries kept in all (oldest dropped first). */
const MAX_ENTRIES = 200;

const slotOf = (hostId: string, profileId: string, kind: ProfileImageKind) => `${hostId}|${profileId}|${kind}`;
const keyOf = (hostId: string, profileId: string, kind: ProfileImageKind, etag: string) => `${slotOf(hostId, profileId, kind)}|${etag}`;

function dropHost(hostId?: string): void {
  const keep = (key: string) => hostId !== undefined && !key.startsWith(`${hostId}|`);
  useImages.setState((s) => ({
    images: Object.fromEntries(Object.entries(s.images).filter(([key]) => keep(key))),
    pending: Object.fromEntries(Object.entries(s.pending).filter(([key]) => keep(key))),
  }));
}
onHostSwitch(() => dropHost());
onHostReset((hostId) => dropHost(hostId));

function remember(key: string, url: string | null): void {
  useImages.setState((s) => ({ images: Object.fromEntries([...Object.entries(s.images).filter(([k]) => k !== key), [key, url]].slice(-MAX_ENTRIES)) }));
}

/** The ETag of a profile's image as the host's list says (null = none; undefined = unknown). */
export function profileImageEtag(hostId: string, profileId: string, kind: ProfileImageKind): string | null | undefined {
  const look = profileLookOf(hostId, profileId);
  const etag = kind === "avatar" ? look?.avatarEtag : look?.introPortraitEtag;
  return etag === undefined ? undefined : etag && ETAG.test(etag) ? etag : null;
}

/** Fetch one image unless it is cached or on its way. */
export function loadProfileImage(hostId: string, profileId: string, kind: ProfileImageKind, etag: string): void {
  const key = keyOf(hostId, profileId, kind, etag);
  const api = profileLooksApi(hostId);
  if (!api || key in useImages.getState().images || inFlight.has(key)) return;
  inFlight.add(key);
  api
    .profileImage(profileId, kind)
    .then(
      (found) => remember(key, found?.dataUrl ?? null),
      () => {}, // unreachable / refused: nothing shown; retried on the next mount
    )
    .finally(() => inFlight.delete(key));
}

/** The image now (non-reactive): a pending write, else the cached host image (null: none / not loaded yet). */
export function profileImageNow(hostId: string, profileId: string, kind: ProfileImageKind): string | null {
  const { pending, images } = useImages.getState();
  const slot = slotOf(hostId, profileId, kind);
  if (slot in pending) return pending[slot] ?? null;
  const etag = profileImageEtag(hostId, profileId, kind);
  if (!etag) return null;
  const key = keyOf(hostId, profileId, kind, etag);
  if (!(key in images)) loadProfileImage(hostId, profileId, kind, etag);
  return images[key] ?? null;
}

/** Reactive image of a profile on a syncing host (null: none or still loading). Off when `hostId` is null. */
export function useProfileImage(hostId: string | null, profileId: string | null | undefined, kind: ProfileImageKind): string | null {
  useProfileLooksVersion();
  const etag = hostId && profileId ? profileImageEtag(hostId, profileId, kind) : null;
  const slot = hostId && profileId ? slotOf(hostId, profileId, kind) : null;
  const key = slot && etag ? `${slot}|${etag}` : null;
  const pending = useImages((s) => (slot && slot in s.pending ? s.pending[slot] : undefined));
  const url = useImages((s) => (key ? s.images[key] : undefined));
  const missing = key !== null && url === undefined;
  useEffect(() => {
    if (missing && hostId && profileId && etag) loadProfileImage(hostId, profileId, kind, etag);
  }, [missing, hostId, profileId, kind, etag]);
  if (pending !== undefined) return pending;
  return url ?? null;
}

/** Show `dataUrl` for a profile's image right away, before its upload is ready (null = removed; undefined = stop showing it). */
export function showPendingProfileImage(hostId: string, profileId: string, kind: ProfileImageKind, dataUrl: string | null | undefined): void {
  const slot = slotOf(hostId, profileId, kind);
  useImages.setState((s) => {
    const pending = { ...s.pending };
    if (dataUrl === undefined) delete pending[slot];
    else pending[slot] = dataUrl;
    return { pending };
  });
}

/**
 * Upload (data URL) or remove (null) a profile's image on its host. Optimistic: shown at once; on
 * success the new ETag is noted (no re-fetch of our own image), on a refusal the host's image shows
 * again. Resolves to whether the host stored it.
 */
export async function writeProfileImage(hostId: string, profileId: string, kind: ProfileImageKind, dataUrl: string | null): Promise<boolean> {
  const api = profileLooksApi(hostId);
  if (!api) return false;
  const slot = slotOf(hostId, profileId, kind);
  useImages.setState((s) => ({ pending: { ...s.pending, [slot]: dataUrl } }));
  try {
    const { etag } = await api.putProfileImage(profileId, kind, dataUrl);
    if (etag && dataUrl) remember(keyOf(hostId, profileId, kind, etag), dataUrl);
    patchProfileLook(hostId, profileId, kind === "avatar" ? { avatarEtag: etag } : { introPortraitEtag: etag });
    return true;
  } catch {
    return false;
  } finally {
    useImages.setState((s) => {
      if (s.pending[slot] !== dataUrl) return s; // a newer write took over
      const pending = { ...s.pending };
      delete pending[slot];
      return { pending };
    });
  }
}

/** Tests. */
export function resetProfileImagesForTest(): void {
  useImages.setState({ images: {}, pending: {} }, true);
  inFlight.clear();
}
