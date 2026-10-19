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
import { canSend, DEVICE_SCOPES, profileOf, TOKEN_ISSUED_VIA, userAccessOf, type CapabilitiesUser, type DeviceScope, type SelfToken, type TokenIssuedVia, type UserAccess, type UserTokenRecord } from "@cutex-desktop/cutex-client";

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
  DeviceScope,
  TokenIssuedVia,
} from "@cutex-desktop/cutex-client";
export { DEVICE_SCOPES, TOKEN_ISSUED_VIA } from "@cutex-desktop/cutex-client";
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
  /** owner_local_only / owner_person_local_only / device_scope_denied: cutex `details` (accessRefusalOf reads them). */
  access?: AccessRefusalDetails;
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

/**
 * A connection's access plus C1's own token (`undefined`: the host does not report it; null: root
 * credential), and the owner-devices fields (cutex 21123b6): `scope` (device-scope) and `ownerLocal`
 * (owner-local-only). Absent = an older cutex = unknown — never read as "not local" / "narrowed".
 */
export type HostUserAccess = UserAccess & { token?: SelfToken | null; scope?: DeviceScope; ownerLocal?: boolean };

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
  const scope = readDeviceScope(t.scope);
  const issuedVia = readIssuedVia(t.issuedVia);
  return { id: t.id, label: typeof t.label === "string" ? t.label : "", deviceName: str(t.deviceName), ownerName: str(t.ownerName), platform: str(t.platform), ...(scope ? { scope } : {}), ...(issuedVia ? { issuedVia } : {}) };
}

/** A wire `scope`: undefined when absent; an unknown value reads as `read` (like cutex reads an unknown stored scope). */
export function readDeviceScope(value: unknown): DeviceScope | undefined {
  if (value === undefined || value === null) return undefined;
  return DEVICE_SCOPES.includes(value as DeviceScope) ? (value as DeviceScope) : "read";
}

/** A wire `issuedVia`: undefined when absent; an unknown value reads as `unknown` (never local). */
export function readIssuedVia(value: unknown): TokenIssuedVia | undefined {
  if (value === undefined || value === null) return undefined;
  return TOKEN_ISSUED_VIA.includes(value as TokenIssuedVia) ? (value as TokenIssuedVia) : "unknown";
}

/** `userAccessOf` plus C1's token, `scope` and `ownerLocal` (each only when the host reports it). */
export function hostUserAccessOf(capabilities: { user?: unknown } | null | undefined): HostUserAccess {
  const access: HostUserAccess = userAccessOf(capabilities);
  const token = selfTokenOf(capabilities);
  const user = capabilities?.user && typeof capabilities.user === "object" ? (capabilities.user as Record<string, unknown>) : null;
  const scope = readDeviceScope(user?.scope);
  const ownerLocal = typeof user?.ownerLocal === "boolean" ? user.ownerLocal : undefined;
  return { ...access, ...(token !== undefined ? { token } : {}), ...(scope ? { scope } : {}), ...(ownerLocal !== undefined ? { ownerLocal } : {}) };
}

// ---------- owner devices (cutex 21123b6; docs/research/owner-devices-ui-contract-20261019.md) ----------

/**
 * cutex `owner-local-only`: root-identity actions (see OwnerLocalAction) only on the host itself — a
 * loopback listener with the root credential or an owner token issued by `client-token issue` on the
 * host (SSH hosts) — never a paired device. `/v2/capabilities` `user.ownerLocal` says which this is.
 */
export const OWNER_LOCAL_ONLY_FEATURE = "owner-local-only";
/** cutex `owner-device-notice`: new owner devices (`GET /v2/users/owner/new-devices`, ack, host event). */
export const OWNER_DEVICE_NOTICE_FEATURE = "owner-device-notice";
/** cutex `device-scope`: per-token scope full / chat / read (pairing codes, `PATCH /v2/client-tokens/{id}`). */
export const DEVICE_SCOPE_FEATURE = "device-scope";
/** Host event: a token became an owner device (owner principals only). */
export const OWNER_DEVICE_ADDED_EVENT = "cutex/access/ownerDeviceAdded";

/** Root-identity actions cutex refuses with 403 `owner_local_only` `details.action` off the host. */
export type OwnerLocalAction = "disableOwnerApproval" | "pairingCode" | "peerPair" | "peerEnable" | "peersEnable" | "readRootCredential";
export const OWNER_LOCAL_ACTIONS: readonly OwnerLocalAction[] = ["disableOwnerApproval", "pairingCode", "peerPair", "peerEnable", "peersEnable", "readRootCredential"];

/** Whether the owner-local-only actions are open on a host: `unknown` = an older cutex (or not read yet). */
export type OwnerLocalAllowed = "yes" | "no" | "unknown";

const hasFeature = (features: ReadonlySet<string> | readonly string[], name: string): boolean =>
  Array.isArray(features) ? (features as readonly string[]).includes(name) : (features as ReadonlySet<string>).has(name);

/** This connection's device scope: `user.scope`, else `user.token.scope`, else `full` for the root credential; null = unknown (older host). */
export function deviceScopeOf(access: HostUserAccess): DeviceScope | null {
  return access.scope ?? access.token?.scope ?? (access.token === null ? "full" : null);
}

const SCOPE_RANK: Record<DeviceScope, number> = { read: 0, chat: 1, full: 2 };

/** A scope covers what `need` requires (read ⊂ chat ⊂ full). */
export function scopeAllows(scope: DeviceScope, need: DeviceScope): boolean {
  return SCOPE_RANK[scope] >= SCOPE_RANK[need];
}

/**
 * May this connection do the owner-local-only actions (更换主人, 配对码, 关闭主人审批, 配对 / 启用跨主机,
 * 读主凭据)? `yes` = `ownerLocal && scope == "full"`; `no` = cutex says it is not the host itself (a
 * paired device, a member, a remote listener) or the token is narrowed; `unknown` = the host does not
 * report it (older cutex without `owner-local-only`, missing fields, capabilities not read yet).
 * Missing fields are never read as `no`.
 */
export function ownerLocalActionsAllowed(access: HostUserAccess, features: ReadonlySet<string> | readonly string[]): OwnerLocalAllowed {
  if (!hasFeature(features, OWNER_LOCAL_ONLY_FEATURE) || typeof access.ownerLocal !== "boolean") return "unknown";
  if (!access.ownerLocal) return "no";
  const scope = deviceScopeOf(access);
  if (scope === null) return "unknown";
  return scope === "full" ? "yes" : "no";
}

/** How a token became an owner device. */
export type OwnerDeviceVia = "pairing" | "assigned" | "personKey" | "ssh";

/** One `GET /v2/users/owner/new-devices` item: a `/v2/users` token item + when / how it became the owner's, and `current` (this connection's token). */
export type OwnerNewDevice = UserTokenRecord & { at: string; via: OwnerDeviceVia | (string & {}); current: boolean };

/** `POST /v2/users/owner/new-devices/{tokenId}/ack` (`acknowledged: false` = nothing to acknowledge). */
export interface OwnerDeviceAck {
  tokenId: string;
  acknowledged: boolean;
}

/** `cutex/access/ownerDeviceAdded` params. */
export interface OwnerDeviceAdded {
  tokenId: string;
  label: string;
  deviceName: string | null;
  platform: string | null;
  scope: DeviceScope;
  at: string;
  via: OwnerDeviceVia | (string & {});
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The new-devices reply's list (malformed items dropped; `scope` / `issuedVia` normalised). */
export function readOwnerNewDevices(reply: unknown): OwnerNewDevice[] {
  const devices = (reply as { devices?: unknown } | null | undefined)?.devices;
  if (!Array.isArray(devices)) return [];
  const out: OwnerNewDevice[] = [];
  for (const raw of devices) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    if (typeof d.tokenId !== "string" || !d.tokenId) continue;
    const scope = readDeviceScope(d.scope);
    const issuedVia = readIssuedVia(d.issuedVia);
    out.push({
      ...(d as unknown as UserTokenRecord),
      tokenId: d.tokenId,
      label: typeof d.label === "string" ? d.label : "",
      kind: typeof d.kind === "string" ? d.kind : "client",
      createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
      userId: typeof d.userId === "string" ? d.userId : null,
      pending: d.pending === true,
      ...(scope ? { scope } : {}),
      ...(issuedVia ? { issuedVia } : {}),
      at: typeof d.at === "string" ? d.at : typeof d.createdAt === "string" ? d.createdAt : "",
      via: typeof d.via === "string" ? d.via : "pairing",
      current: d.current === true,
    });
  }
  return out;
}

/** The params of a `cutex/access/ownerDeviceAdded` host event (null: another event / malformed). */
export function ownerDeviceAddedOf(envelope: EventEnvelope): OwnerDeviceAdded | null {
  if (envelope.cutex?.method !== OWNER_DEVICE_ADDED_EVENT) return null;
  const p = envelope.cutex.params as Record<string, unknown> | undefined;
  if (!p || typeof p.tokenId !== "string" || !p.tokenId) return null;
  return {
    tokenId: p.tokenId,
    label: typeof p.label === "string" ? p.label : "",
    deviceName: strOrNull(p.deviceName),
    platform: strOrNull(p.platform),
    scope: readDeviceScope(p.scope) ?? "full",
    at: typeof p.at === "string" ? p.at : new Date().toISOString(),
    via: typeof p.via === "string" ? p.via : "pairing",
  };
}

/** `PATCH /v2/client-tokens/{id}` (`client-token-rename` / `device-scope`): omitted = keep; name null / blank = clear. */
export interface ClientTokenUpdate {
  name?: string | null;
  scope?: DeviceScope;
}

/** `PATCH /v2/client-tokens/{id}` reply (`scope` null: an older host that does not report it). */
export interface ClientTokenUpdated {
  tokenId: string;
  ownerName: string | null;
  scope: DeviceScope | null;
}

/** The PATCH body with known fields only (throws on an empty patch or a bad value). */
export function clientTokenUpdateBody(patch: ClientTokenUpdate): { name?: string | null; scope?: DeviceScope } {
  if (!patch || typeof patch !== "object") throw new Error("bad token update");
  const body: { name?: string | null; scope?: DeviceScope } = {};
  if (patch.name !== undefined) {
    if (patch.name !== null && typeof patch.name !== "string") throw new Error("bad name");
    const text = patch.name?.trim().slice(0, 200) ?? "";
    body.name = text ? text : null;
  }
  if (patch.scope !== undefined) {
    if (!DEVICE_SCOPES.includes(patch.scope)) throw new Error("bad scope");
    body.scope = patch.scope;
  }
  if (Object.keys(body).length === 0) throw new Error("empty token update");
  return body;
}

// ---------- access refusals (owner_local_only, device_scope_denied, …) ----------

/** The refusals of the owner-devices rules, as reasons the UI turns into text. */
export type AccessRefusalReason = "ownerLocalOnly" | "ownerPersonLocalOnly" | "deviceScopeDenied" | "invalidScope" | "loopbackOnly";

const ACCESS_REFUSAL_CODES: Readonly<Record<string, AccessRefusalReason>> = {
  owner_local_only: "ownerLocalOnly",
  owner_person_local_only: "ownerPersonLocalOnly",
  device_scope_denied: "deviceScopeDenied",
  invalid_scope: "invalidScope",
  loopback_only: "loopbackOnly",
};

/** cutex `details` of such a refusal (only the fields the UI uses). */
export interface AccessRefusalDetails {
  /** owner_local_only: which root-identity action (OwnerLocalAction; an unknown newer one passes through). */
  action?: OwnerLocalAction | (string & {});
  /** owner_local_only / owner_person_local_only: the caller token's origin (null: the root credential). */
  issuedVia?: TokenIssuedVia | null;
  /** device_scope_denied: this token's scope, and what the route needs. */
  scope?: DeviceScope;
  required?: DeviceScope;
}

export interface AccessRefusal extends AccessRefusalDetails {
  reason: AccessRefusalReason;
  code: string;
}

/** Main: the fields of a 4xx `details` worth carrying over IPC for these codes (undefined: another code / none). */
export function accessRefusalDetailsOf(code: string, details: unknown): AccessRefusalDetails | undefined {
  if (!(code in ACCESS_REFUSAL_CODES) || !details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  const out: AccessRefusalDetails = {};
  if (typeof d.action === "string" && /^[A-Za-z]{1,64}$/.test(d.action)) out.action = d.action;
  if ("issuedVia" in d) out.issuedVia = d.issuedVia === null ? null : (readIssuedVia(d.issuedVia) ?? null);
  const scope = readDeviceScope(d.scope);
  if (scope) out.scope = scope;
  const required = readDeviceScope(d.required);
  if (required) out.required = required;
  return Object.keys(out).length ? out : undefined;
}

const ACCESS_CODE_IN_TEXT = /\b(owner_local_only|owner_person_local_only|device_scope_denied|invalid_scope|loopback_only)\b/;

/**
 * One of the owner-devices refusals, from whatever the call gave back: a refusal value (`UsersRefusal`,
 * `CutexRefusal`, `{ok: false, error}`) — with its `access` details — or a thrown error / message
 * (calls that throw, e.g. createPairingCode; only the code survives IPC there, so `fallback.action`
 * names the action the caller attempted). null: not one of them.
 */
export function accessRefusalOf(error: unknown, fallback: { action?: OwnerLocalAction } = {}): AccessRefusal | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "object" && !(error instanceof Error)) {
    const e = error as { ok?: unknown; error?: unknown; code?: unknown; access?: unknown; details?: unknown };
    if (e.ok === false && e.error) return accessRefusalOf(e.error, fallback);
    if (typeof e.code === "string") {
      const reason = ACCESS_REFUSAL_CODES[e.code];
      if (!reason) return null;
      const details = (e.access && typeof e.access === "object" ? (e.access as AccessRefusalDetails) : accessRefusalDetailsOf(e.code, e.details)) ?? {};
      return withFallback({ reason, code: e.code, ...details }, fallback);
    }
    return null;
  }
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = ACCESS_CODE_IN_TEXT.exec(text)?.[1];
  return code ? withFallback({ reason: ACCESS_REFUSAL_CODES[code]!, code }, fallback) : null;
}

function withFallback(refusal: AccessRefusal, fallback: { action?: OwnerLocalAction }): AccessRefusal {
  return refusal.reason === "ownerLocalOnly" && !refusal.action && fallback.action ? { ...refusal, action: fallback.action } : refusal;
}
