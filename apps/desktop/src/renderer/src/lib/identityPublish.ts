// What 「你」 publishes to one host (pure part of lib/identitySync; unit-tested in
// test/identitySync.test.ts): nothing to an older cutex / a pending device; a field never edited on
// this desktop only fills an empty host field; otherwise only what differs from the host's view, once per edit.
// syncSummary / syncIssue word the outcome for Settings → 你 (one summary line, exceptions per host).
import { USERS_SELF_PROFILE_FEATURE, type UserAccess } from "../../../shared/users";
import type { PreparedAvatar } from "./identityAvatar";
import type { IdentityPrefs } from "./identityPrefs";

export type IdentitySyncState =
  /** cutex without users-self-profile: the identity stays on this desktop. */
  | "unsupported"
  /** this device is not assigned to a user on the host yet. */
  | "pending"
  /** never edited on this desktop: nothing to publish (the host shows what it has). */
  | "local"
  | "syncing"
  | "synced"
  /** published from here, since changed on the host by another desktop of yours. */
  | "changedElsewhere"
  | "failed";

export interface IdentitySyncStatus {
  state: IdentitySyncState;
  error?: string;
}

/**
 * Per host, per field: the edit stamp last published from here and what the host had right after
 * (to tell a later change from another desktop).
 */
export interface PublishedFields {
  nameAt?: number;
  name?: string | null;
  pictureAt?: number;
  etag?: string | null;
}
export type Published = Record<string, PublishedFields>;

/** The name this desktop publishes: the typed name, or null (clears it: the host shows its own label). */
export function publishedName(prefs: Pick<IdentityPrefs, "name">): string | null {
  return prefs.name.trim() || null;
}

/**
 * What to do on one host (pure; unit-tested). Each field is published only once it was edited on this
 * desktop, once per edit, and only when the host's value differs. `avatar`: the prepared local
 * picture (null: none, or not publishable).
 */
export function planIdentityPublish(input: {
  features: ReadonlySet<string>;
  access: Pick<UserAccess, "pending" | "displayName" | "avatarEtag"> | null;
  prefs: Pick<IdentityPrefs, "name" | "picture" | "nameAt" | "pictureAt">;
  published: PublishedFields | undefined;
  avatar: Pick<PreparedAvatar, "etag"> | null;
}): { state: IdentitySyncState; patch?: { displayName?: string | null; avatar?: "upload" | null } } {
  const { features, access, prefs, avatar } = input;
  const published = input.published ?? {};
  if (!features.has(USERS_SELF_PROFILE_FEATURE)) return { state: "unsupported" };
  if (!access || access.pending) return { state: "pending" };
  const hostName = access.displayName ?? null;
  const hostEtag = access.avatarEtag ?? null;
  // Set before this desktop stamped edits (or before the host supported it): fill a host field that is
  // still empty — that overwrites nothing (owner 2026-10-15: the avatar never reached the hosts).
  const fillName = prefs.nameAt === null && hostName === null ? publishedName(prefs) : null;
  const fillPicture = prefs.pictureAt === null && hostEtag === null && !!prefs.picture && !!avatar;
  if (prefs.nameAt === null && prefs.pictureAt === null && !fillName && !fillPicture) {
    // Never edited here: "synced" once the host already shows this desktop's identity (e.g. filled before).
    const same = hostName === publishedName(prefs) && (prefs.picture ? !!avatar && hostEtag === avatar.etag : true);
    return { state: same && (hostName !== null || hostEtag !== null) ? "synced" : "local" };
  }
  const patch: { displayName?: string | null; avatar?: "upload" | null } = {};
  if (fillName) patch.displayName = fillName;
  if (fillPicture) patch.avatar = "upload";
  let elsewhere = false;
  if (prefs.nameAt !== null) {
    const name = publishedName(prefs);
    if (published.nameAt === prefs.nameAt) elsewhere ||= hostName !== (published.name ?? null);
    else if (hostName !== name) patch.displayName = name;
  }
  if (prefs.pictureAt !== null) {
    if (published.pictureAt === prefs.pictureAt) elsewhere ||= hostEtag !== (published.etag ?? null);
    else if (!prefs.picture) {
      if (hostEtag) patch.avatar = null;
    } else if (avatar && hostEtag !== avatar.etag) patch.avatar = "upload";
  }
  if (Object.keys(patch).length) return { state: "syncing", patch };
  return { state: elsewhere ? "changedElsewhere" : "synced" };
}

/** The published record once the host holds `host` for the fields edited here (after a write or when nothing differed). */
export function recordPublished(prefs: Pick<IdentityPrefs, "nameAt" | "pictureAt">, before: PublishedFields | undefined, host: { displayName: string | null; avatarEtag: string | null }): PublishedFields {
  const next: PublishedFields = { ...before };
  if (prefs.nameAt !== null && next.nameAt !== prefs.nameAt) Object.assign(next, { nameAt: prefs.nameAt, name: host.displayName });
  if (prefs.pictureAt !== null && next.pictureAt !== prefs.pictureAt) Object.assign(next, { pictureAt: prefs.pictureAt, etag: host.avatarEtag });
  return next;
}

export type SyncSummaryKey =
  | "me.access.sync.synced"
  | "me.access.sync.syncedFailed"
  | "me.access.sync.failed"
  | "me.access.sync.noName"
  | "me.access.sync.sameElsewhere"
  | "me.access.sync.localOnly"
  | "me.access.sync.syncing";

/**
 * The one quiet line under 「你」's preview (docs/research/identity-settings-review-20261015.md §4.1.3),
 * instead of a 「未设置」 per host: what others see, from every connected host's sync state. `local`
 * (never edited here) reads as 「和你其他电脑上设的一样」 where the host already has a name or picture,
 * and as 「还没设置名字」 when this desktop and the hosts are all empty. A pending device is the host
 * row's business, not the summary's. null: nothing to say (no connected host).
 */
export function syncSummary(input: {
  statuses: Readonly<Record<string, IdentitySyncStatus>>;
  prefs: Pick<IdentityPrefs, "name" | "picture">;
  access: Readonly<Record<string, Pick<UserAccess, "displayName" | "avatarEtag"> | undefined>>;
  hostName(hostId: string): string;
}): { key: SyncSummaryKey; vars?: { n?: number; host?: string }; error?: string } | null {
  const entries = Object.entries(input.statuses);
  const supported = entries.filter(([, s]) => s.state !== "unsupported" && s.state !== "pending");
  if (!supported.length) return entries.some(([, s]) => s.state === "unsupported") ? { key: "me.access.sync.localOnly" } : null;
  const hostHas = (id: string) => !!(input.access[id]?.displayName || input.access[id]?.avatarEtag);
  let synced = 0;
  let elsewhere = 0;
  let syncing = false;
  let failed: [string, IdentitySyncStatus] | null = null;
  for (const [id, s] of supported) {
    if (s.state === "synced" || s.state === "changedElsewhere") synced++;
    else if (s.state === "local") elsewhere += hostHas(id) ? 1 : 0;
    else if (s.state === "syncing") syncing = true;
    else if (s.state === "failed") failed ??= [id, s];
  }
  if (failed) {
    const host = input.hostName(failed[0]);
    const error = failed[1].error;
    return synced + elsewhere > 0 ? { key: "me.access.sync.syncedFailed", vars: { n: synced + elsewhere, host }, error } : { key: "me.access.sync.failed", vars: { host }, error };
  }
  const localEmpty = !publishedName(input.prefs) && !input.prefs.picture;
  if (localEmpty && !supported.some(([id]) => hostHas(id))) return { key: "me.access.sync.noName" };
  if (syncing) return { key: "me.access.sync.syncing" };
  if (!synced && elsewhere) return { key: "me.access.sync.sameElsewhere" };
  if (synced + elsewhere) return { key: "me.access.sync.synced", vars: { n: synced + elsewhere } };
  return null;
}

export type SyncIssueKey = "me.access.issue.syncFailed" | "me.access.issue.changedElsewhere" | "me.access.issue.unsupported" | "me.access.issue.syncing";

/** A host row's sync exception (nothing when all is well: synced, never edited here, pending). */
export function syncIssue(status: IdentitySyncStatus | undefined): { key: SyncIssueKey; tone: "danger" | "subtle"; error?: string } | null {
  switch (status?.state) {
    case "failed":
      return { key: "me.access.issue.syncFailed", tone: "danger", error: status.error };
    case "changedElsewhere":
      return { key: "me.access.issue.changedElsewhere", tone: "subtle" };
    case "unsupported":
      return { key: "me.access.issue.unsupported", tone: "subtle" };
    case "syncing":
      return { key: "me.access.issue.syncing", tone: "subtle" };
    default:
      return null;
  }
}
