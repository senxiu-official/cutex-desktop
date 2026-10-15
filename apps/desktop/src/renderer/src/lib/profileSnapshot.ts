// Everything the profile editor needs, fetched together and cached per profile, so opening a profile
// paints once (no "details → account row pops in → model list arrives" reflow) and revisiting one
// renders from the cache in the first frame while it refreshes quietly in the background.
// Per host (multi-host P1 step 2c): every function takes an optional `hostId` (default: the focus
// host); Settings → Profiles of another host (lib/settingsHost) keeps its own entries.
import type { ProfileAccountView, ProfileDetail, ProfileItem, ProfileModelsView, QuotaConfigView } from "../../../shared/ipc";
import { api, apiFor } from "../bridge";
import { focusHostId } from "./hostKeys";
import { onHostReset, onHostSwitch } from "./hostSwitch";
import { noteCatalogNames, setProfileModelNames, setProfileNamesLoader } from "./modelDisplay";
import { profileKind } from "./profileKind";

export interface ProfileSnapshot {
  detail: ProfileDetail;
  models: ProfileModelsView | null;
  /** ChatGPT-login profiles only; null = unsupported / failed (the account rows hide). */
  account: ProfileAccountView | null;
  /** API-key profiles only (quota reader config). */
  quota: QuotaConfigView | null;
}

type ProfileList = { defaultProfile: string | null; profiles: ProfileItem[] };

/** Cache key of a host's profile. */
const keyOf = (hostId: string, name: string) => `${hostId}
${name}`;
const daemonOf = (hostId: string) => (hostId === focusHostId() ? api : apiFor(hostId));

const cache = new Map<string, ProfileSnapshot>();
const inflight = new Map<string, Promise<ProfileSnapshot>>();
const lastLists = new Map<string, ProfileList | null>();
const listInflight = new Map<string, Promise<ProfileList | null>>();
const dropHost = (hostId: string) => {
  for (const key of [...cache.keys()]) if (key.startsWith(`${hostId}
`)) cache.delete(key);
  for (const key of [...inflight.keys()]) if (key.startsWith(`${hostId}
`)) inflight.delete(key);
  lastLists.delete(hostId);
  listInflight.delete(hostId);
};
// Profiles belong to a host: another daemon has other profiles (or the same names, other settings).
// The focus host starts over on a switch (as before); a replaced / removed connection drops its host.
onHostSwitch(() => {
  cache.clear();
  inflight.clear();
  lastLists.clear();
  listInflight.clear();
});
onHostReset(dropHost);

export function cachedProfile(name: string, hostId = focusHostId()): ProfileSnapshot | null {
  return cache.get(keyOf(hostId, name)) ?? null;
}

export function cachedProfileList(hostId = focusHostId()): ProfileList | null {
  return lastLists.get(hostId) ?? null;
}

export function rememberProfileList(list: ProfileList | null, hostId = focusHostId()): void {
  lastLists.set(hostId, list);
  // Per-entry model display names (lib/modelDisplay) come with every profile list (the focus host's).
  if (list && hostId === focusHostId()) setProfileModelNames(list.profiles);
  const names = new Set(list?.profiles.map((p) => keyOf(hostId, p.name)) ?? []);
  for (const key of [...cache.keys()]) if (key.startsWith(`${hostId}
`) && !names.has(key)) cache.delete(key);
}

/** The profile list (deduped while a request is running); also refreshes the cached copy. */
export function loadProfileList(hostId = focusHostId()): Promise<ProfileList | null> {
  let running = listInflight.get(hostId);
  if (!running) {
    running = daemonOf(hostId)
      .listProfiles()
      .then((r) => (rememberProfileList(r, hostId), r))
      .finally(() => listInflight.delete(hostId));
    listInflight.set(hostId, running);
  }
  return running;
}

// The first model name shown loads the list (and with it the profiles' entry names).
setProfileNamesLoader(() => void loadProfileList().catch(() => {}));

/** Fetch detail + models (+ account / quota config by kind) in parallel; deduped per profile. */
export function loadProfileSnapshot(item: ProfileItem, hostId = focusHostId()): Promise<ProfileSnapshot> {
  const name = item.name;
  const key = keyOf(hostId, name);
  const running = inflight.get(key);
  if (running) return running;
  const kind = profileKind(item);
  const api = daemonOf(hostId);
  const p = Promise.all([
    api.getProfile(name),
    api.profileModels(name).catch(() => null),
    kind === "chatgpt" ? api.profileAccount(name).catch(() => null) : Promise.resolve(null),
    kind === "apiKey" ? api.quotaConfig(name).catch(() => null) : Promise.resolve(null),
  ])
    .then(([detail, models, account, quota]) => {
      const snap = { detail, models, account, quota };
      cache.set(key, snap);
      if (models && hostId === focusHostId()) noteCatalogNames(models.models);
      return snap;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Keep the cache in step with edits made in the editor (save, login, model list changes). */
export function updateCachedProfile(name: string, patch: Partial<ProfileSnapshot>, hostId = focusHostId()): void {
  const key = keyOf(hostId, name);
  const prev = cache.get(key);
  if (prev) cache.set(key, { ...prev, ...patch });
}

export function prefetchProfiles(items: readonly ProfileItem[], hostId = focusHostId()): void {
  for (const item of items) if (!cache.has(keyOf(hostId, item.name))) void loadProfileSnapshot(item, hostId).catch(() => {});
}
