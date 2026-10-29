// Publishes 「你」 (lib/identityPrefs: name + picture) to every connected host with cutex
// `users-self-profile`, as this connection's own user (`PATCH /v2/users/me`: the owner record on a
// host this desktop owns, the bound user elsewhere; docs/research/users-self-profile-20261014.md).
//
// - Only a field edited on this desktop is published (`nameAt` / `pictureAt`); per host the last
//   published stamps are remembered, so a host that connects later gets it once, and a second desktop
//   of the same person does not overwrite a field it never edited (nor fight a later change made
//   from another desktop: shown as 「名字或头像已在你另一台电脑上改过」).
// - Only what differs from the host's view (capabilities `user`) is sent; the avatar is compared by
//   ETag (cutex's: SHA-256 prefix of the bytes).
// - A desktop without its own name / picture (never edited here, none set) fills a host's empty field
//   with the one your other hosts have (lib/identityHosts: the most recently changed); never with the
//   OS account name, and never over a value a host already has.
// - Older cutex / pending devices: nothing is sent (local only, as before).
// Settings → 你 words the per-host states as one summary line under 「你」 plus exceptions per host
// (lib/identityPublish syncSummary / syncIssue).
import { create } from "zustand";
import { USERS_SELF_PROFILE_FEATURE, type SelfProfilePatch } from "../../../shared/users";
import { api, apiFor } from "../bridge";
import { useApp } from "../store";
import { hostAccessStore, noteSelfProfile } from "./hostAccess";
import { prepareAvatar, type PreparedAvatar } from "./identityAvatar";
import { getIdentityPrefs, subscribeIdentityPrefs, type IdentityPrefs } from "./identityPrefs";
import { planIdentityRound, publishedName, recordPublished, type IdentityPlan, type IdentitySyncStatus, type Published } from "./identityPublish";
import { adoptedIdentityNow, observeHostIdentities } from "./identityHosts";
import type { AdoptedIdentity } from "./identity";
import { noteUserAvatar } from "./userAvatars";
import { translate } from "../i18n";
import { memberName } from "./myAccess";
import { onClaimTransition, personPublicKeyNow } from "./personIdentity";

export type { IdentitySyncState, IdentitySyncStatus } from "./identityPublish";

const PUBLISHED_KEY = "cutex-desktop.identity.published";

function readPublished(): Published {
  try {
    const raw = JSON.parse(localStorage.getItem(PUBLISHED_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Published) : {};
  } catch {
    return {};
  }
}

function writePublished(next: Published): void {
  try {
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify(next));
  } catch {
    // published again next run (idempotent)
  }
}

const useStatus = create<Record<string, IdentitySyncStatus>>(() => ({}));

/** Sync state per connected host (Settings → 你). */
export function useIdentitySyncStatus(): Record<string, IdentitySyncStatus> {
  return useStatus();
}

interface HostNow {
  hostId: string;
  features: ReadonlySet<string>;
}

/** Connected hosts whose capabilities are known. */
function connectedHosts(): HostNow[] {
  const s = useApp.getState();
  const focus = s.hosts?.active ?? "local";
  const out: HostNow[] = [];
  if (s.daemon.kind === "connected" && s.featuresKnown) out.push({ hostId: focus, features: s.features });
  for (const [hostId, slice] of Object.entries(s.byHost)) {
    if (hostId !== focus && slice.daemon.kind === "connected" && slice.featuresKnown) out.push({ hostId, features: slice.features });
  }
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The picture your other hosts have for you (adoptedIdentity), prepared for upload; null: none / unreadable. */
async function adoptedAvatar(source: AdoptedIdentity["picture"]): Promise<PreparedAvatar | null> {
  if (!source) return null;
  const found = await apiFor(source.hostId).userAvatar(source.userId).catch(() => null);
  return found?.dataUrl ? prepareAvatar(found.dataUrl) : null;
}

async function publishTo(host: HostNow, plan: IdentityPlan, prefs: IdentityPrefs, published: Published, avatar: PreparedAvatar | null, adopted: () => Promise<PreparedAvatar | null>): Promise<IdentitySyncStatus> {
  const access = hostAccessStore.get()[host.hostId] ?? null;
  if (!plan.patch) {
    if (plan.state === "synced") published[host.hostId] = recordPublished(prefs, published[host.hostId], { displayName: access?.displayName ?? null, avatarEtag: access?.avatarEtag ?? null });
    return { state: plan.state };
  }
  useStatus.setState({ [host.hostId]: { state: "syncing" } });
  // "upload" without a local picture: the one adopted from another host (filling an empty avatar).
  if (!prefs.picture && plan.patch.avatar === "upload") {
    avatar = await adopted();
    if (!avatar) delete plan.patch.avatar;
    if (!Object.keys(plan.patch).length) return { state: "local" };
  }
  const api = apiFor(host.hostId);
  const send = (a: PreparedAvatar | null) => {
    const body: SelfProfilePatch = {};
    if ("displayName" in plan.patch!) body.displayName = plan.patch!.displayName ?? null;
    if ("avatar" in plan.patch!) body.avatar = plan.patch!.avatar === null ? null : (a?.upload ?? null);
    return api.patchUsersMe(body);
  };
  let result = await send(avatar);
  // A picture cutex refused (an older, larger local picture): once more, re-encoded smaller.
  if (!result.ok && result.error.code === "invalid_avatar" && prefs.picture && plan.patch.avatar === "upload") {
    avatar = await prepareAvatar(prefs.picture, { reencode: true });
    if (avatar) result = await send(avatar);
  }
  if (!result.ok) return { state: "failed", error: result.error.message || result.error.code };
  const user = result.value.user;
  noteSelfProfile(host.hostId, { displayName: user.displayName, avatarEtag: user.avatarEtag });
  if (avatar && user.avatarEtag === avatar.etag) noteUserAvatar(host.hostId, user.id, avatar.etag, `data:${avatar.upload.contentType};base64,${avatar.upload.data}`);
  published[host.hostId] = recordPublished(prefs, published[host.hostId], user);
  return { state: "synced" };
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const prefs = getIdentityPrefs();
      const published = readPublished();
      const next: Record<string, IdentitySyncStatus> = {};
      const hosts = connectedHosts();
      const avatar = prefs.picture ? await prepareAvatar(prefs.picture).catch(() => null) : null;
      // Your identity as your hosts have it: fills empty hosts when this desktop has none of its own.
      const found = adoptedIdentityNow(useApp.getState().hosts?.active ?? "local");
      let adopted: Promise<PreparedAvatar | null> | null = null;
      const adoptedPicture = () => (adopted ??= adoptedAvatar(found.picture));
      const plans = planIdentityRound({
        hosts,
        access: hostAccessStore.get(),
        prefs,
        published,
        avatar,
        // The adopted picture is only fetched when a host needs it; its ETag is the source's.
        adopted: { name: found.name, avatar: found.picture ? { etag: found.picture.etag } : null },
      });
      for (const host of hosts) {
        try {
          next[host.hostId] = await publishTo(host, plans[host.hostId]!, prefs, published, avatar, adoptedPicture);
        } catch (e) {
          next[host.hostId] = { state: "failed", error: message(e) };
        }
      }
      writePublished(published);
      useStatus.setState(next, true);
      if (Object.values(next).some((s) => s.state === "failed") && !retry) {
        retry = setTimeout(() => {
          retry = null;
          schedule();
        }, 60_000);
      }
    } while (again);
  } finally {
    running = false;
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, 400);
}

let started = false;
/** Start following hosts, their access and the local identity (main.tsx, once). */
export function startIdentitySync(): void {
  if (started) return;
  started = true;
  let signature = "";
  const onApp = () => {
    const next = connectedHosts()
      .map((h) => `${h.hostId}:${h.features.has(USERS_SELF_PROFILE_FEATURE) ? 1 : 0}`)
      .join(",");
    if (next !== signature) {
      signature = next;
      schedule();
    }
  };
  useApp.subscribe(onApp);
  // What each host has for you, with when it changed (a desktop without its own 「你」 shows the latest).
  observeHostIdentities();
  hostAccessStore.subscribe(() => {
    observeHostIdentities();
    schedule();
  });
  subscribeIdentityPrefs(schedule);
  onApp();
  // P2 person identity: main sends this name with identity claims (shown on a host's pending card).
  let sentName: string | null | undefined;
  const pushName = () => {
    const name = publishedName(getIdentityPrefs());
    if (name === sentName || typeof api.setIdentityName !== "function") return;
    sentName = name;
    void api.setIdentityName(name).catch(() => (sentName = undefined));
  };
  subscribeIdentityPrefs(pushName);
  pushName();
  // A claim that just recognised you (Settings → 你 shows no claim states, only these toasts).
  onClaimTransition((hostId, outcome, userId) => {
    const s = useApp.getState();
    const host = s.hosts?.hosts.find((h) => h.id === hostId)?.label ?? hostId;
    const access = hostAccessStore.get()[hostId];
    const name = (access && access.userId === userId ? memberName(access) : null) ?? userId ?? "";
    s.notify(outcome === "autoBound" ? translate("me.access.toast.autoBound", { host, name }) : translate("me.access.toast.ownerKeyAdded", { host }));
  });
  personPublicKeyNow();
}
