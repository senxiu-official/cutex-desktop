// Your identity on this desktop (Settings → 你): a display name (default: the OS account
// name, from main) and an optional picture. Kept here (localStorage in userData) and, on hosts with
// cutex `users-self-profile`, published as your user's display name / avatar (lib/identitySync) —
// each field only after you edited it on this desktop (`nameAt` / `pictureAt`), so a second desktop of
// yours does not overwrite what the first one published unless you change that field there.
import { useSyncExternalStore } from "react";

export interface IdentityPrefs {
  /** 「你的名字」; "" = the OS account name. */
  name: string;
  /** A cropped square (ProfilePictureCrop) as a data URL; null = initials. */
  picture: string | null;
  /** When the name last changed on this desktop (ms); null = never (not published from here). */
  nameAt: number | null;
  /** When the picture last changed on this desktop (ms); null = never (not published from here). */
  pictureAt: number | null;
}

const KEY = "cutex-desktop.identity";
export const IDENTITY_NAME_MAX = 64;
const PICTURE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const PICTURE_MAX = 128 * 1024;
const EMPTY: IdentityPrefs = { name: "", picture: null, nameAt: null, pictureAt: null };

function read(): IdentityPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<IdentityPrefs> | null;
    if (!raw || typeof raw !== "object") return EMPTY;
    const name = typeof raw.name === "string" ? raw.name.slice(0, IDENTITY_NAME_MAX) : "";
    const picture = typeof raw.picture === "string" && raw.picture.length <= PICTURE_MAX && PICTURE.test(raw.picture) ? raw.picture : null;
    const stamp = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return { name, picture, nameAt: stamp(raw.nameAt), pictureAt: stamp(raw.pictureAt) };
  } catch {
    return EMPTY;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getIdentityPrefs(): IdentityPrefs {
  return current;
}

/** Change name / picture (an edit: stamps that field, which makes lib/identitySync publish it). */
export function setIdentityPrefs(patch: Partial<Pick<IdentityPrefs, "name" | "picture">>): void {
  const name = (patch.name ?? current.name).slice(0, IDENTITY_NAME_MAX);
  const picture = patch.picture !== undefined ? patch.picture : current.picture;
  if (name === current.name && picture === current.picture) return;
  const stamp = (before: number | null) => Math.max(Date.now(), (before ?? 0) + 1);
  current = {
    name,
    picture,
    nameAt: name !== current.name ? stamp(current.nameAt) : current.nameAt,
    pictureAt: picture !== current.picture ? stamp(current.pictureAt) : current.pictureAt,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // the pref just won't persist
  }
  for (const l of listeners) l();
}

export function useIdentityPrefs(): IdentityPrefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

/** Non-React: changes to the prefs (lib/identitySync). */
export function subscribeIdentityPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
