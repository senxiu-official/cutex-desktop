// P1 users and grants (cutex `users`; docs/research/user-isolation-p1-20261014.md §9). Wire types come
// from @cutex-desktop/cutex-client (users.ts); this file adds the IPC result shape and the desktop's
// owner pseudo-capability.
//
// A non-owner connection (cutex default-deny: everything but its user's agents is owner-only) gets a
// reduced feature set: `hostFeatureSet` drops the capabilities whose routes are owner-only and adds
// `RESTRICTED_FEATURE` (not a cutex capability). Every existing capability gate — modules, entries,
// `features.has(…)` checks — then hides those parts on that host by itself; actions that have no
// capability of their own (rename, archive, new agent …) check `RESTRICTED_FEATURE`. An owner
// connection's set is exactly cutex's featureList, as before users existed.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { canSend, profileOf, userAccessOf, type CapabilitiesUser, type SelfToken, type UserAccess } from "@cutex-desktop/cutex-client";

export type {
  CapabilitiesUser,
  PeerBindingResult,
  TokenBindingResult,
  UserAccess,
  UserCreate,
  UserGrant,
  UserPatch,
  UserPeerRecord,
  UserRecord,
  UsersList,
  UsersSettings,
  UserTokenRecord,
  UserWriteResult,
  AvatarUpload,
  SelfProfile,
  SelfProfilePatch,
  UserProfileFields,
  PersonKeyRecord,
  PersonKeyInput,
  PersonKeysResult,
  TokenPersonAckResult,
  TokenPerson,
  SelfToken,
  OwnDevice,
  OwnDevices,
  OwnDeviceRevoked,
} from "@cutex-desktop/cutex-client";
export { ACCESS_CHANGED_EVENT, AVATAR_ETAG, AVATAR_MAX_BYTES, canSend, DISPLAY_NAME_MAX, OWNER_ACCESS, OWNER_USER_ID, shownUserName, USER_ID, USERS_FEATURE, USERS_SELF_PROFILE_FEATURE, userAccessOf, PERSON_IDENTITY_FEATURE, PERSON_IDENTITY_ACK_FEATURE } from "@cutex-desktop/cutex-client";

/** Marks a host's feature set as a non-owner (or pending) connection. Not a cutex capability. */
export const RESTRICTED_FEATURE = "desktop:restricted";

/**
 * cutex capabilities whose routes are owner-only (docs/research/user-isolation-p1-20261014.md §4):
 * files / terminals, host approvals, services, jobs, alarms, artifacts, notes, side chats, owner
 * notices, creating agents / chats, peers, runtimes, Claude accounts, Director rotation, NCI mail,
 * remote access, the agent bus, structural session actions (fork / delete / revert), delegation
 * pause, quota auto-continue, notification levels, attachments (non-text input), users, backend upgrades,
 * renaming client / device tokens, optional components (install / remove).
 */
export const OWNER_ONLY_CAPABILITIES: readonly string[] = [
  "terminal", "workspace-fs", "fs-dir-browse", "fs-file-read", "session-attachments",
  "owner-approvals", "services", "services-persistent-approval", "services-login-link", "job-service", "alarms-api",
  "artifacts", "notes", "side-chat", "owner-messages", "owner-notify-delete", "notification-levels",
  "human-create-session", "human-create-agent", "peers-v2", "runtime-package-upgrade", "runtimes-view",
  "runtime-restore-candidates", "claude-accounts", "owner-rotation", "project-optional-director",
  "inbound-mail", "listen-settings", "device-pairing", "management-client-tokens", "agent-bus-stuck-messages",
  "session-fork", "session-delete", "session-delete-empty-on-archive", "session-history-revert",
  "asks-pause-v2", "claude-quota-auto-continue", "users", "workflows", "workflow-resume", "backend-upgrade",
  "client-token-rename", "components", "claude-safety-grants",
];

/**
 * cutex `users-p2-access` (r236, docs/research/user-isolation-p2-access-20261015.md): a non-owner user
 * reads the workspace files / git status / diffs of its granted projects and visible agents (read
 * grant), and with `send` uploads images (`POST /v2/sessions/{id}/attachments` → `localImage`) and
 * runs delegation commands (`cutex/ask/stop|close|retry|respond|resume|reopen`) on asks whose two ends
 * it sees. Everything else stays the owner's (ask/create, asks / queue pause, permission mode,
 * terminals, approvals, settings).
 */
export const USERS_P2_ACCESS_FEATURE = "users-p2-access";

/** What a connection may do of the P2 additions (the owner: everything; a pending device: nothing). */
export interface P2Access {
  /** Workspace file tree, file previews, git status / diff — read-only for a non-owner. */
  files: boolean;
  /** Image attachments in the composer. */
  attachments: boolean;
  /** 停止 / 重试 / 采纳 / 放弃 on delegations (and answering an agent's question). */
  delegations: boolean;
  /** Write actions on the workspace (none today) and terminals: the owner only. */
  owner: boolean;
}

/**
 * The single P2 gate. `features`: the host's featureList (or the store's set for it: the capability is
 * not owner-only, so both carry it); `access`: this connection's user on that host. A host whose user
 * block is unknown reads as the owner (OWNER_ACCESS), like everywhere else.
 */
export function canUseP2(features: ReadonlySet<string> | readonly string[], access: UserAccess): P2Access {
  if (access.isOwner) return { files: true, attachments: true, delegations: true, owner: true };
  const has = Array.isArray(features) ? (features as readonly string[]).includes(USERS_P2_ACCESS_FEATURE) : (features as ReadonlySet<string>).has(USERS_P2_ACCESS_FEATURE);
  if (!has || access.pending) return { files: false, attachments: false, delegations: false, owner: false };
  const send = canSend(access);
  return { files: true, attachments: send, delegations: send, owner: false };
}

/** Owner-only capabilities a non-owner keeps under P2: read-only workspace routes; with send, attachments. */
const P2_FILE_CAPABILITIES: readonly string[] = ["workspace-fs"];
const P2_SEND_CAPABILITIES: readonly string[] = ["session-attachments"];

/** A refused users write; `user_in_use` lists what is still bound to the user. */
export interface UsersRefusal {
  code: string;
  message: string;
  tokens?: string[];
  peers?: string[];
  /** person_key_in_use: the user holding the key, and the key. */
  userId?: string;
  publicKey?: string;
}

export type UsersResult<T> = { ok: true; value: T } | { ok: false; error: UsersRefusal };

/**
 * A host's feature set from its `/v2/capabilities` reply: the featureList on an owner connection;
 * on any other one without the owner-only capabilities (except what `users-p2-access` opens to it:
 * `workspace-fs`, with send also `session-attachments`) and with `RESTRICTED_FEATURE`.
 */
export function hostFeatureSet(caps: { featureList?: readonly string[]; user?: CapabilitiesUser | null } | null | undefined): Set<string> {
  const features = new Set(caps?.featureList ?? []);
  const access = userAccessOf(caps);
  if (access.isOwner) return features;
  // users-p2-access: the read-only workspace routes (and with send, attachments) stay for this user.
  const p2 = canUseP2(features, access);
  const keep = new Set([...(p2.files ? P2_FILE_CAPABILITIES : []), ...(p2.attachments ? P2_SEND_CAPABILITIES : [])]);
  for (const cap of OWNER_ONLY_CAPABILITIES) if (!keep.has(cap)) features.delete(cap);
  features.add(RESTRICTED_FEATURE);
  return features;
}

/** The connection behind this feature set is the host owner (an unknown / older host counts as owner). */
export function isOwnerFeatures(features: ReadonlySet<string>): boolean {
  return !features.has(RESTRICTED_FEATURE);
}

export const ROUTE_ACCEPTED_METHOD = "cutex/userInput/routeAccepted";

/**
 * The user (not the owner) who sent a message: cutex routeAccepted `actingUser` (management layer
 * only). users-self-profile adds the name and avatar that user set on their own desktop.
 */
export interface ActingUser {
  id: string;
  /** The owner's label for the user. */
  name: string;
  displayName?: string | null;
  avatarEtag?: string | null;
}

/** The acting user of a routeAccepted event (null: not one, or sent by the owner). */
export function actingUserOf(envelope: EventEnvelope): { sessionId: string; clientUserMessageId: string; user: ActingUser } | null {
  if (envelope.cutex?.method !== ROUTE_ACCEPTED_METHOD) return null;
  const params = envelope.cutex.params as { clientUserMessageId?: unknown; actingUser?: { id?: unknown; name?: unknown; displayName?: unknown; avatarEtag?: unknown } | null } | undefined;
  const user = params?.actingUser;
  if (!user || typeof user.id !== "string" || typeof params?.clientUserMessageId !== "string") return null;
  const name = typeof user.name === "string" && user.name.trim() ? user.name.trim().slice(0, 64) : user.id;
  return { sessionId: envelope.cutexSessionId, clientUserMessageId: params.clientUserMessageId, user: { id: user.id, name, ...profileOf(user) } };
}

/**
 * cutex C1 (docs/research/identity-settings-review-20261015.md §5): `GET /v2/capabilities` → `user.token`
 * = this credential's own client / device token — for owners, members and pending devices alike; null
 * for the root (local) credential. Lets Settings → 你 / 用户 say which device this desktop is on a host
 * where the owner-only token routes are closed to it.
 */
export const USER_OWN_TOKEN_FEATURE = "user-own-token";
/**
 * cutex C2: a user lists and removes its own devices — `GET /v2/users/me/devices` →
 * `{hostId, userId, devices}` (each a `/v2/users` `tokens[]` item + `current`), `DELETE
 * /v2/users/me/devices/{tokenId}` → `{tokenId, revoked, current}` (404 client_token_not_found for
 * someone else's token; removing `current` disconnects this connection). A pending device: 403
 * `user_pending` (older self routes: `access_pending`). The owner (or root) sees the owner user's devices.
 */
export const USER_OWN_DEVICES_FEATURE = "user-own-devices";

/** A connection's access plus C1's own token (`undefined`: the host does not report it; null: root credential). */
export type HostUserAccess = UserAccess & { token?: SelfToken | null };

/** C1 `user.token` of a capabilities reply: undefined when absent (older host), null for the root credential. */
export function selfTokenOf(capabilities: { user?: unknown } | null | undefined): SelfToken | null | undefined {
  const user = capabilities?.user;
  if (!user || typeof user !== "object" || !("token" in user)) return undefined;
  const token = (user as { token?: unknown }).token;
  if (token === null) return null;
  if (!token || typeof token !== "object") return undefined;
  const t = token as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { id: t.id, label: typeof t.label === "string" ? t.label : "", deviceName: str(t.deviceName), ownerName: str(t.ownerName), platform: str(t.platform) };
}

/** `userAccessOf` plus C1's token (only when the host reports it). */
export function hostUserAccessOf(capabilities: { user?: unknown } | null | undefined): HostUserAccess {
  const access = userAccessOf(capabilities);
  const token = selfTokenOf(capabilities);
  return token === undefined ? access : { ...access, token };
}
