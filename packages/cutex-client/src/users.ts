// P1 users and grants (cutex capability `users`; docs/handoff/gpt-accounts.md,
// docs/research/user-isolation-p1-20261014.md): wire types of `/v2/users*`, the `user` block of
// `GET /v2/capabilities`, the access-changed stream frame, and the body builders the client uses so
// only known fields reach cutex. Hand-written like summary.ts until cutex exports its schemas.

export const USERS_FEATURE = "users";
/**
 * Self-service profiles (cutex `users-self-profile`): `GET|PATCH /v2/users/me` (display name +
 * avatar of the caller's own user), `GET /v2/users/{id}/avatar`; `displayName` / `avatarEtag` on
 * user views, the capabilities `user` and `actingUser`.
 */
export const USERS_SELF_PROFILE_FEATURE = "users-self-profile";
/** cutex refuses larger avatars (413 avatar_too_large). */
export const AVATAR_MAX_BYTES = 48 * 1024;
export const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];
export const DISPLAY_NAME_MAX = 60;
/** A cutex avatar ETag (16 hex: the first 8 bytes of the image's SHA-256). */
export const AVATAR_ETAG = /^[0-9a-f]{16}$/;

// ---------- Profile looks (cutex `profile-avatar`) ----------

/** A Profile's two images: the round picture and the intro (opening) portrait. */
export const PROFILE_IMAGE_KINDS = ["avatar", "intro-portrait"] as const;
export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];
/** cutex limits: the picture like a user avatar (square, 16–512 px); the portrait any aspect, ≤ 1024 px. */
export const PROFILE_IMAGE_MAX_BYTES: Record<ProfileImageKind, number> = { avatar: AVATAR_MAX_BYTES, "intro-portrait": 2 * 1024 * 1024 };
/** Avatar theme ids cutex accepts (`detail.avatarThemeOptions` lists the host's own; this is the r245 list). */
export const PROFILE_AVATAR_THEMES = ["animals", "sea", "gems", "plants", "food", "sky", "birds", "insects", "fantasy", "prehistoric", "desserts", "seasons", "transport", "music", "cats"] as const;
/** Intro greeting cap (characters, after trim). */
export const PROFILE_INTRO_GREETING_MAX = 300;

/** `/v2/profiles/{id}/avatar | intro-portrait` (the id percent-encoded; ids are UUIDs, names work too). */
export function profileImagePath(profileId: string, kind: ProfileImageKind): string {
  if (typeof profileId !== "string" || !profileId || profileId.length > 200 || /[\u0000-\u001f/]/.test(profileId)) throw new Error("bad profile id");
  return `/v2/profiles/${encodeURIComponent(profileId)}/${kind}`;
}
/** The built-in owner user (no grant: implicitly everything). */
export const OWNER_USER_ID = "owner";
/**
 * SSE frame that ends a stream when the token's user or grant changed: reconnect (and re-read the
 * capabilities). Not a revoke — that stays `cutex/device/revoked`.
 */
export const ACCESS_CHANGED_EVENT = "cutex/access/changed";
/** `owner` or a cutex user id (`u-` + hex). */
export const USER_ID = /^(owner|u-[A-Za-z0-9]{1,64})$/;
/** Each grant list holds at most this many ids (cutex refuses more). */
export const GRANT_LIST_MAX = 500;
export const USER_NAME_MAX = 64;

/** What a non-owner user may see / do. `projects: "all"` = every project (not standalone agents). */
export interface UserGrant {
  projects: "all" | string[];
  /** Agents without a project, by cutex session id. */
  standaloneAgents: string[];
  /** May send messages to (and stop / answer) the visible agents. */
  send: boolean;
}

/**
 * `GET /v2/capabilities` → `user`: who this credential is. The root credential is the owner; an
 * older cutex has no `user` block (treat as owner, `userAccessOf`).
 */
export interface CapabilitiesUser {
  id: string | null;
  name: string | null;
  isOwner: boolean;
  /** A token not assigned to any user yet: it may read only the capabilities and the host. */
  pending: boolean;
  grant: UserGrant | null;
  /** users-self-profile: the name the user set on their own desktop (absent on older hosts). */
  displayName?: string | null;
  avatarEtag?: string | null;
  /** cutex `user-own-token`: this credential's own token (null: the root credential; absent: older host). */
  token?: SelfToken | null;
  /** cutex `device-scope`: this connection's scope (the root credential: `full`; absent: older host). */
  scope?: DeviceScope;
  /** cutex `owner-local-only`: this connection counts as the host itself (absent: older host = unknown). */
  ownerLocal?: boolean;
}

/**
 * cutex `device-scope`: what a client / device token may do on top of its user's rights — `full`
 * (default), `chat` (read + talk), `read` (read only). The root credential is always `full`.
 */
export type DeviceScope = "full" | "chat" | "read";
export const DEVICE_SCOPES: readonly DeviceScope[] = ["full", "chat", "read"];
/** cutex `owner-local-only`: where a token came from (`hostCli`: `client-token issue` on the host, e.g. over SSH; `pairing`: a pairing code). */
export type TokenIssuedVia = "hostCli" | "pairing" | "unknown";
export const TOKEN_ISSUED_VIA: readonly TokenIssuedVia[] = ["hostCli", "pairing", "unknown"];

/** `GET /v2/capabilities` → `user.token` (cutex `user-own-token`): owners, members and pending devices alike. */
export interface SelfToken {
  id: string;
  label: string;
  deviceName: string | null;
  ownerName: string | null;
  platform: string | null;
  /** cutex `device-scope` (absent: older host). */
  scope?: DeviceScope;
  /** cutex `owner-local-only` (absent: older host). */
  issuedVia?: TokenIssuedVia;
}

/** What a user set on their own desktop (users-self-profile; absent fields = an older host). */
export interface UserProfileFields {
  displayName?: string | null;
  avatarEtag?: string | null;
}

/**
 * One person identity known to a host (cutex `person-identity`; docs/research/person-identity-p2-20261014.md):
 * an Ed25519 public key (base64url, raw 32 bytes) a desktop presented, remembered for this user.
 */
export interface PersonKeyRecord {
  publicKey: string;
  /** First 16 hex (8 bytes) of SHA-256 over the raw key bytes (personFingerprint). */
  fingerprint: string;
  addedAt: string;
  label?: string | null;
}

export interface UserRecord extends UserProfileFields {
  id: string;
  name: string;
  color: string | null;
  builtin: boolean;
  isOwner: boolean;
  /** null for the owner. */
  grant: UserGrant | null;
  createdAt: string;
  updatedAt: string;
  /** person-identity: the person keys remembered for this user (absent on older hosts). */
  personKeys?: PersonKeyRecord[];
}

/** One issued client / device token with its binding (metadata only, never the secret). */
export interface UserTokenRecord {
  tokenId: string;
  label: string;
  kind: "client" | "device" | string;
  deviceName?: string | null;
  platform?: string | null;
  /** cutex `client-token-rename`: the owner-given display name. */
  ownerName?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  lastAddress?: string | null;
  /** null while pending. */
  userId: string | null;
  pending: boolean;
  /** person-identity: the identity this token presented (null: none; absent: older host). */
  person?: TokenPerson | null;
  /** cutex `device-scope` (absent: older host). */
  scope?: DeviceScope;
  /** cutex `owner-local-only` (absent: older host). */
  issuedVia?: TokenIssuedVia;
}

/** `GET /v2/users` `tokens[].person`: the last identity claim of a token. */
export interface TokenPerson {
  publicKey: string;
  fingerprint: string;
  /** The user that holds this key (null: nobody yet). */
  userId: string | null;
  /** The name the device sent with its claim (its own 「你」 name). */
  displayName?: string | null;
  claimedAt?: string | null;
  /** Set once the device presented a different key before this one. */
  previousPublicKey?: string | null;
}

export interface UserPeerRecord {
  peerId: string;
  label: string;
  hostId: string;
  status: string;
  userId: string;
  /** person-identity: the remote owner's public keys, sent at peer pairing. */
  personKeys?: string[];
}

export interface UsersSettings {
  /** A new pairing does not default to the owner unless an owner device approves (default true). */
  ownerRequiresApproval: boolean;
}

/** `GET /v2/users` (owner only). */
export interface UsersList {
  revision: number;
  users: UserRecord[];
  tokens: UserTokenRecord[];
  peers: UserPeerRecord[];
  settings: UsersSettings;
  /** person-identity: the public key each token presented (absent on older hosts). */
  tokenPersons?: Record<string, string>;
  personsRevision?: number;
}

export interface UserCreate {
  name: string;
  color?: string | null;
  grant?: UserGrant;
}

export interface UserPatch {
  name?: string;
  color?: string | null;
  grant?: UserGrant;
}

export interface UserWriteResult {
  user: UserRecord;
  revision: number;
}

export interface TokenBindingResult {
  tokenId: string;
  userId: string | null;
  pending: boolean;
}

export interface PeerBindingResult {
  peerId: string;
  userId: string;
}

/**
 * Person identity (cutex `person-identity`): `GET /v2/identity/challenge`, `POST /v2/identity/claim`,
 * `personKeys` / `tokenPersons` on `GET /v2/users`, `PUT /v2/users/{id}/person-keys` (owner only).
 * Weak authentication: it says who a paired device belongs to, it grants nothing.
 */
export const PERSON_IDENTITY_FEATURE = "person-identity";
/** An Ed25519 public key: base64url (no padding) of the raw 32 bytes. */
export const PERSON_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
/** An Ed25519 signature: base64url (no padding) of 64 bytes. */
export const PERSON_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
export const PERSON_KEY_LABEL_MAX = 64;

/** `GET /v2/identity/challenge`: one-use, short-lived. */
export interface IdentityChallenge {
  nonce: string;
  /** The cutex host id that goes into the signed message. */
  hostId: string;
  /** The calling credential as cutex sees it (a client token id, `"root"` for the root credential): signed as is. */
  tokenId: string;
  expiresAt: string;
}

/**
 * What a claim did: `autoBound` (a pending token bound to the key's user), `ownerKeyAdded` (root
 * credential or the host's first device: the key went on owner), `pending` (recorded, still waiting for
 * the owner), `recorded` (a bound token or an already known key: nothing changed but the record).
 */
export type IdentityClaimOutcome = "autoBound" | "ownerKeyAdded" | "pending" | "recorded";
export const IDENTITY_CLAIM_OUTCOMES: readonly IdentityClaimOutcome[] = ["autoBound", "ownerKeyAdded", "pending", "recorded"];

/** `POST /v2/identity/claim` → where the caller's token ended up. */
export interface IdentityClaimResult {
  outcome: IdentityClaimOutcome;
  /** null for the root credential. */
  tokenId: string | null;
  /** The token's user now (owner for the root credential); null while pending. */
  userId: string | null;
  pending: boolean;
  /** The user holding the presented key (null: nobody). */
  personUserId: string | null;
  publicKey: string;
  fingerprint: string;
}

/** `PUT /v2/users/{id}/person-keys` body item. */
export interface PersonKeyInput {
  publicKey: string;
  label?: string | null;
}

/** `PUT /v2/users/{id}/person-keys` → the user's keys now. */
export interface PersonKeysResult {
  userId: string;
  personKeys: PersonKeyRecord[];
}

/**
 * cutex `person-identity-ack` (r236): `DELETE /v2/users/token-persons/{tokenId}/previous` (owner only)
 * acknowledges that a device presented another key — clears that token's `person.previousPublicKey`
 * (「这台设备出示的身份变了」). The device's current key and its binding do not change.
 */
export const PERSON_IDENTITY_ACK_FEATURE = "person-identity-ack";

/** `DELETE /v2/users/token-persons/{tokenId}/previous` → `cleared`: a previous key was set (idempotent). */
export interface TokenPersonAckResult {
  tokenId: string;
  cleared: boolean;
  previousPublicKey: null;
  personsRevision: number;
}

/** The signed claim message: `"cutex-identity-v1\n" + hostId + "\n" + nonce + "\n" + tokenId` (UTF-8). */
export function identityClaimMessage(hostId: string, nonce: string, tokenId: string): string {
  for (const [what, v] of [["hostId", hostId], ["nonce", nonce], ["tokenId", tokenId]] as const) {
    if (typeof v !== "string" || !v || v.includes("\n")) throw new Error(`bad identity ${what}`);
  }
  return `cutex-identity-v1\n${hostId}\n${nonce}\n${tokenId}`;
}

/** A `PUT /v2/users/{id}/person-keys` body with known fields only (de-duplicated; throws on bad values). */
export function personKeysBody(keys: readonly PersonKeyInput[]): { personKeys: PersonKeyInput[] } {
  if (!Array.isArray(keys)) throw new Error("bad person keys");
  const seen = new Set<string>();
  const out: PersonKeyInput[] = [];
  for (const key of keys) {
    if (!key || typeof key.publicKey !== "string" || !PERSON_PUBLIC_KEY.test(key.publicKey)) throw new Error("bad person key");
    if (seen.has(key.publicKey)) continue;
    seen.add(key.publicKey);
    const label = typeof key.label === "string" ? key.label.trim().slice(0, PERSON_KEY_LABEL_MAX) : "";
    out.push(label ? { publicKey: key.publicKey, label } : { publicKey: key.publicKey });
  }
  if (out.length > GRANT_LIST_MAX) throw new Error("too many person keys");
  return { personKeys: out };
}

/** What the desktop needs to know of a connection's user (an older cutex: owner). */
export interface UserAccess {
  isOwner: boolean;
  pending: boolean;
  userId: string | null;
  name: string | null;
  grant: UserGrant | null;
  /** users-self-profile: this connection's own display name / avatar on the host (null: none / older host). */
  displayName?: string | null;
  avatarEtag?: string | null;
}

export const OWNER_ACCESS: UserAccess = Object.freeze({ isOwner: true, pending: false, userId: OWNER_USER_ID, name: null, grant: null });

/** `GET|PATCH /v2/users/me` → the caller's own user (users-self-profile). */
export interface SelfProfile {
  user: { id: string; name: string; isOwner: boolean; displayName: string | null; avatarEtag: string | null };
}

/** An avatar upload: a square PNG / JPEG / WebP (desktop: 128×128), base64, ≤ AVATAR_MAX_BYTES. */
export interface AvatarUpload {
  contentType: AvatarContentType;
  /** base64 (no data: prefix). */
  data: string;
}

/** `PATCH /v2/users/me`: omitted = keep, null = clear. */
export interface SelfProfilePatch {
  displayName?: string | null;
  avatar?: AvatarUpload | null;
}

/** A fetched avatar (`GET /v2/users/{id}/avatar`). */
export interface UserAvatar {
  contentType: AvatarContentType;
  /** base64 */
  data: string;
  etag: string | null;
}

/** The name to show for a user: what they set themselves, else the owner's label (alias). */
export function shownUserName(user: { name?: string | null; displayName?: string | null; id?: string | null }): string {
  return user.displayName?.trim() || user.name?.trim() || user.id || "";
}

/** A `PATCH /v2/users/me` body with known fields only (throws on bad values). */
export function selfProfileBody(patch: SelfProfilePatch): Record<string, unknown> {
  if (!patch || typeof patch !== "object") throw new Error("bad profile patch");
  const body: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    if (patch.displayName === null) body.displayName = null;
    else {
      const name = typeof patch.displayName === "string" ? patch.displayName.trim() : "";
      if (!name || [...name].length > DISPLAY_NAME_MAX || /\p{Cc}/u.test(name)) throw new Error("bad display name");
      body.displayName = name;
    }
  }
  if (patch.avatar !== undefined) {
    if (patch.avatar === null) body.avatar = null;
    else {
      const { contentType, data } = patch.avatar;
      if (!AVATAR_CONTENT_TYPES.includes(contentType)) throw new Error("bad avatar type");
      if (typeof data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(data) || Math.floor((data.length * 3) / 4) > AVATAR_MAX_BYTES + 2) throw new Error("bad avatar data");
      body.avatar = { contentType, data };
    }
  }
  if (Object.keys(body).length === 0) throw new Error("empty profile patch");
  return body;
}

/**
 * The connection's user from a `/v2/capabilities` reply. No reply / no `user` block (an older cutex,
 * or the route is missing) = the owner, as before users existed. A malformed block is read as the
 * most restrictive: a pending, non-owner connection.
 */
export function userAccessOf(capabilities: { user?: unknown } | null | undefined): UserAccess {
  const user = capabilities?.user;
  if (user === undefined || user === null) return OWNER_ACCESS;
  if (typeof user !== "object") return { isOwner: false, pending: true, userId: null, name: null, grant: null };
  const u = user as Partial<CapabilitiesUser>;
  const profile = profileOf(u);
  if (u.isOwner === true) return { isOwner: true, pending: false, userId: typeof u.id === "string" ? u.id : OWNER_USER_ID, name: typeof u.name === "string" ? u.name : null, grant: null, ...profile };
  const grant = readGrant(u.grant);
  const pending = u.pending === true || typeof u.id !== "string";
  return { isOwner: false, pending, userId: typeof u.id === "string" ? u.id : null, name: typeof u.name === "string" ? u.name : null, grant: pending ? null : grant, ...(pending ? {} : profile) };
}

/** May this connection send to its visible agents (owner: always). */
export function canSend(access: UserAccess): boolean {
  return access.isOwner || (!access.pending && access.grant?.send === true);
}

/** `displayName` / `avatarEtag` of a user view (only the fields a host sent; bad values read as null). */
export function profileOf(value: { displayName?: unknown; avatarEtag?: unknown }): UserProfileFields {
  const out: UserProfileFields = {};
  if ("displayName" in value) out.displayName = typeof value.displayName === "string" && value.displayName.trim() ? value.displayName.trim().slice(0, DISPLAY_NAME_MAX) : null;
  if ("avatarEtag" in value) out.avatarEtag = typeof value.avatarEtag === "string" && AVATAR_ETAG.test(value.avatarEtag) ? value.avatarEtag : null;
  return out;
}

function readGrant(value: unknown): UserGrant | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Partial<UserGrant>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { projects: g.projects === "all" ? "all" : ids(g.projects), standaloneAgents: ids(g.standaloneAgents), send: g.send === true };
}

/** A grant body with known fields only: de-duplicated, capped id lists, a boolean `send`. */
export function grantBody(grant: UserGrant): UserGrant {
  if (!grant || typeof grant !== "object") throw new Error("bad grant");
  const list = (v: unknown, what: string): string[] => {
    if (!Array.isArray(v)) throw new Error(`bad grant ${what}`);
    if (!v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)) throw new Error(`bad grant ${what}`);
    const out = [...new Set(v as string[])];
    if (out.length > GRANT_LIST_MAX) throw new Error(`too many grant ${what}`);
    return out;
  };
  return {
    projects: grant.projects === "all" ? "all" : list(grant.projects, "projects"),
    standaloneAgents: list(grant.standaloneAgents, "standaloneAgents"),
    send: grant.send === true,
  };
}

/** A trimmed user name (1..64 chars). */
export function userNameBody(name: unknown): string {
  const text = typeof name === "string" ? name.trim() : "";
  if (!text || text.length > USER_NAME_MAX) throw new Error("bad user name");
  return text;
}

/** A color: null, or a short CSS-ish token (`#rrggbb`, a palette name). */
export function userColorBody(color: unknown): string | null {
  if (color === null) return null;
  if (typeof color !== "string" || !/^[#A-Za-z0-9-]{1,32}$/.test(color)) throw new Error("bad user color");
  return color;
}

/** cutex `user-own-devices`: one of the caller's own devices (a `/v2/users` `tokens[]` item + `current`). */
export type OwnDevice = UserTokenRecord & { current: boolean };

/** `GET /v2/users/me/devices` (the owner / root: the owner user's devices). */
export interface OwnDevices {
  hostId: string | null;
  userId: string | null;
  devices: OwnDevice[];
}

/** `DELETE /v2/users/me/devices/{tokenId}`: `current` = this connection's own token (its requests now get 401). */
export interface OwnDeviceRevoked {
  tokenId: string;
  revoked: boolean;
  current: boolean;
}
