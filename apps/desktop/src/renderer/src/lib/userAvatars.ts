// Avatars users set on their own desktops (cutex `users-self-profile`: `GET /v2/users/{id}/avatar`),
// fetched through main as data URLs and cached per host + user + ETag for the run. Views carry the
// ETag (`/v2/users` items, capabilities `user`, routeAccepted `actingUser`), so a changed picture is a
// new key and an unchanged one is never fetched twice. No ETag = no avatar (initials).
import { useEffect } from "react";
import { create } from "zustand";
import { AVATAR_ETAG } from "../../../shared/users";
import { apiFor } from "../bridge";
import { onHostReset } from "./hostSwitch";

/** data URL, or null once the host answered without an image. */
const useAvatars = create<Record<string, string | null>>(() => ({}));
const inFlight = new Set<string>();
/** Entries kept in all (oldest dropped first). */
const MAX_ENTRIES = 300;

const keyOf = (hostId: string, userId: string, etag: string) => `${hostId}|${userId}|${etag}`;

onHostReset((hostId) =>
  useAvatars.setState((s) => Object.fromEntries(Object.entries(s).filter(([key]) => !key.startsWith(`${hostId}|`))), true),
);

/** Fetch one avatar unless it is cached or on its way. */
export function loadUserAvatar(hostId: string, userId: string, etag: string): void {
  const key = keyOf(hostId, userId, etag);
  if (key in useAvatars.getState() || inFlight.has(key)) return;
  inFlight.add(key);
  apiFor(hostId)
    .userAvatar(userId)
    .then(
      (found) => useAvatars.setState((s) => Object.fromEntries([...Object.entries(s), [key, found?.dataUrl ?? null]].slice(-MAX_ENTRIES)), true),
      () => {}, // unreachable / refused: initials; retried on the next mount
    )
    .finally(() => inFlight.delete(key));
}

/** Seed the cache with an image this desktop just published (no round trip for our own picture). */
export function noteUserAvatar(hostId: string, userId: string, etag: string, dataUrl: string): void {
  useAvatars.setState({ [keyOf(hostId, userId, etag)]: dataUrl });
}

/** The avatar of `userId` on `hostId` with this ETag (null: none, unknown or still loading). */
export function useUserAvatar(hostId: string | null | undefined, userId: string | null | undefined, etag: string | null | undefined): string | null {
  const valid = !!hostId && !!userId && !!etag && AVATAR_ETAG.test(etag);
  const key = valid ? keyOf(hostId!, userId!, etag!) : null;
  const url = useAvatars((s) => (key ? s[key] : undefined));
  const missing = key !== null && url === undefined;
  useEffect(() => {
    if (missing) loadUserAvatar(hostId!, userId!, etag!);
  }, [missing, hostId, userId, etag]);
  return url ?? null;
}
