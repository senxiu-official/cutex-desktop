import { useEffect, useSyncExternalStore } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import type { ProfileLinkState, ProfileLinkHostSync } from "../../../shared/profileLink";
import { deviceScopeOf } from "../../../shared/users";
import { apiFor, bridge } from "../bridge";
import { useApp } from "../store";
import { hostAccessNow, hostAccessStore } from "./hostAccess";
import { hostData } from "./hostScope";
import { onHostReset } from "./hostSwitch";
import { noteProfileLooks } from "./profileLooks";
import { useHostScope } from "./useHostScope";

export const PROFILE_ACCOUNT_LINK_FEATURE = "profile-account-link";
export interface LinkedProfileRef { hostId: string; hostName: string; profile: ProfileItem; connected: boolean }
const lists = new Map<string, readonly ProfileItem[]>();
const pending = new Map<string, Promise<void>>();
const loadedEpochs = new Map<string, string>();
const generations = new Map<string, number>();
const accessIdentities = new Map<string, string>();
const secretIds = new Map<string, string>();
const syncStates = new Map<string, ProfileLinkHostSync>();
const listeners = new Set<() => void>();
let snapshot: readonly LinkedProfileRef[] = [];

export function accountLinkIdentity(profile: Pick<ProfileItem, "link">): string | null {
  const link = profile.link;
  return link && /^[a-zA-Z0-9_-]{22}$/.test(link.accountKey) && /^[0-9a-f]{8}$/.test(link.secretId) ? `${link.secretId}:${link.accountKey}` : null;
}
export function sameProfileAccount(a: Pick<ProfileItem, "link">, b: Pick<ProfileItem, "link">): boolean {
  const identity = accountLinkIdentity(a);
  return identity !== null && identity === accountLinkIdentity(b);
}
export function accountLinkHostAllowed(hostId: string): boolean {
  const data = hostData(useApp.getState(), hostId);
  const access = hostAccessNow(hostId);
  return data?.daemon.kind === "connected" && data.featuresKnown && data.features.has(PROFILE_ACCOUNT_LINK_FEATURE) && access.isOwner && !access.pending && deviceScopeOf(access) === "full";
}
/** Manual cross-host groups require the same installed salt, even for unknown identities. */
export function accountLinkHostReady(hostId: string): boolean {
  return accountLinkHostAllowed(hostId) && syncStates.get(hostId)?.state === "synced" && !!syncStates.get(hostId)?.secretId;
}
/** An async operation and its inverse belong to one connection/access lifetime. */
export function captureAccountProfileRead(hostId: string): () => boolean {
  const generation = generations.get(hostId) ?? 0;
  const epoch = useApp.getState().hosts?.hosts.find((host) => host.id === hostId)?.conn?.epoch;
  return () => generation === (generations.get(hostId) ?? 0) && epoch === useApp.getState().hosts?.hosts.find((host) => host.id === hostId)?.conn?.epoch;
}
export function captureAccountLinkAction(hostId: string): () => boolean {
  const current = captureAccountProfileRead(hostId);
  return () => current() && accountLinkHostAllowed(hostId);
}
function publish(): void {
  const state = useApp.getState();
  snapshot = [...lists].flatMap(([hostId, profiles]) => profiles.map((profile) => ({ hostId, hostName: state.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId, profile, connected: accountLinkHostAllowed(hostId) })));
  for (const listener of listeners) listener();
}
export const accountProfilesSnapshot = (): readonly LinkedProfileRef[] => snapshot;
export const accountProfilesForHost = (hostId: string): readonly ProfileItem[] | undefined => lists.get(hostId);
export function subscribeAccountProfiles(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function noteAccountProfiles(hostId: string, profiles: readonly ProfileItem[]): void {
  const expected = secretIds.get(hostId);
  if (expected && profiles.some((profile) => profile.link && profile.link.secretId !== expected)) return;
  // A late ordinary list response must not repopulate owner-only link metadata
  // after access was narrowed (or before the connection's access is known).
  const visible = accountLinkHostAllowed(hostId) ? profiles : profiles.map(({ link: _link, accountLinkState: _state, ...profile }) => profile);
  lists.set(hostId, visible);
  publish();
}
onHostReset((hostId) => { generations.set(hostId, (generations.get(hostId) ?? 0) + 1); lists.delete(hostId); loadedEpochs.delete(hostId); pending.delete(hostId); syncStates.delete(hostId); secretIds.delete(hostId); publish(); });
hostAccessStore.subscribe(() => {
  let changed = false;
  for (const [hostId, access] of Object.entries(hostAccessStore.get())) {
    const identity = JSON.stringify([access.isOwner, access.pending, deviceScopeOf(access), access.token?.id]);
    if (accessIdentities.get(hostId) !== identity) { accessIdentities.set(hostId, identity); generations.set(hostId, (generations.get(hostId) ?? 0) + 1); loadedEpochs.delete(hostId); pending.delete(hostId); }
    if ((!access.isOwner || access.pending || deviceScopeOf(access) !== "full") && lists.delete(hostId)) { loadedEpochs.delete(hostId); changed = true; }
  }
  if (changed) publish();
});

/** Explicit per-host daemon reads only; unsupported/restricted hosts are never queried for links. */
export async function refreshAccountProfiles(hostId?: string): Promise<void> {
  const state = useApp.getState();
  const ids = hostId ? [hostId] : state.hosts?.hosts.map((h) => h.id) ?? [state.hosts?.active ?? "local"];
  await Promise.all(ids.filter(accountLinkHostAllowed).map((id) => {
    const running = pending.get(id);
    if (running) return running;
    const epoch = state.hosts?.hosts.find((h) => h.id === id)?.conn?.epoch ?? "focus";
    const generation = generations.get(id) ?? 0;
    const call = apiFor(id).listProfiles().then((list) => {
      const current = useApp.getState().hosts?.hosts.find((h) => h.id === id)?.conn?.epoch ?? "focus";
      if (epoch !== current || generation !== (generations.get(id) ?? 0) || !accountLinkHostAllowed(id)) return;
      loadedEpochs.set(id, epoch);
      noteAccountProfiles(id, list?.profiles ?? []);
      if (list) noteProfileLooks(id, list.profiles);
    }).finally(() => { if (pending.get(id) === call) pending.delete(id); });
    pending.set(id, call);
    return call;
  }));
}

export function useProfileAccountLinks(hostId: string, profile: ProfileItem | string) {
  useApp((state) => state.features);
  useSyncExternalStore(hostAccessStore.subscribe, hostAccessStore.get, hostAccessStore.get);
  const refs = useSyncExternalStore(subscribeAccountProfiles, accountProfilesSnapshot, accountProfilesSnapshot);
  const scope = useHostScope();
  const connectionKey = scope.hosts.filter((h) => h.connected).map((h) => `${h.id}:${h.view.conn?.epoch ?? ""}:${accountLinkHostAllowed(h.id)}`).join("|");
  useEffect(() => {
    const state = useApp.getState();
    const ids = state.hosts?.hosts.map((h) => h.id) ?? [hostId];
    for (const id of ids) {
      const epoch = state.hosts?.hosts.find((h) => h.id === id)?.conn?.epoch ?? "focus";
      if (accountLinkHostAllowed(id) && loadedEpochs.get(id) !== epoch) void refreshAccountProfiles(id).catch(() => {});
    }
  }, [connectionKey, hostId]);
  const self = refs.find((ref) => ref.hostId === hostId && (typeof profile === "string" ? ref.profile.id === profile || ref.profile.name === profile : ref.profile.id === profile.id)) ?? (typeof profile === "string" ? null : { hostId, hostName: scope.host(hostId)?.label ?? hostId, profile, connected: accountLinkHostAllowed(hostId) });
  const peers = self && accountLinkHostAllowed(hostId) ? refs.filter((ref) => ref.hostId !== hostId && sameProfileAccount(self.profile, ref.profile)).map((ref) => ({ ...ref, hostName: scope.host(ref.hostId)?.label ?? ref.hostName, connected: accountLinkHostAllowed(ref.hostId) })) : [];
  const family = self?.profile.providerFamily;
  const targets = family && accountLinkHostReady(hostId) ? refs.filter((ref) => ref.hostId !== hostId && accountLinkHostReady(ref.hostId) && syncStates.get(ref.hostId)?.secretId === syncStates.get(hostId)?.secretId && ref.profile.providerFamily === family).map((ref) => ({ ...ref, hostName: scope.host(ref.hostId)?.label ?? ref.hostName, connected: true })) : [];
  return { self, peers, targets, refresh: () => refreshAccountProfiles() };
}

// A successful main-only secret push changes the keys without publishing them
// in events. Re-read the normal owner profile view for that connection.
let following = false;
function noteSyncState(state: ProfileLinkState): void {
  for (const [id, value] of Object.entries(state.hosts)) {
    syncStates.set(id, value);
    if (value.state !== "synced" || !value.secretId) continue;
    if (secretIds.get(id) !== value.secretId) {
      secretIds.set(id, value.secretId);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      loadedEpochs.delete(id); pending.delete(id);
    }
    void refreshAccountProfiles(id).catch(() => {});
  }
  publish();
}
export function startProfileAccountLinks(): void {
  if (following || typeof bridge.on !== "function") return;
  following = true;
  let statusVersion = 0;
  bridge.on("profileLinkState", (state) => {
    statusVersion++;
    noteSyncState(state);
  });
  if (typeof bridge.api?.profileLinkState === "function") void bridge.api.profileLinkState().then((state) => { if (statusVersion === 0) noteSyncState(state); }, () => {});
}
