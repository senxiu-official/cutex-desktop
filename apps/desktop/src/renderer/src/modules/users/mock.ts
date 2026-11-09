// Browser-preview data for 用户 (cutex `users`; dev/mockTypes.ts): the owner and two users, devices
// bound to them, two pending devices, two peers, the pairing switch. Writes behave like cutex (409
// user_in_use while bound, 400 owner_immutable for a grant on the owner, revision + 1). Tokens are this
// mock's own (Settings → 远程访问's token list is another module's). The connection's own `user`
// (`?nonowner`, `?nonowner=send`, `?pending`) is core data: dev/mockBridge.ts capabilities.
// users-self-profile: Mia and the owner set their own name + picture (remote avatars, SVG here);
// `GET|PATCH /v2/users/me` acts on the connection's user (owner, or Mia under `?nonowner`).
// person-identity (P2): users' person keys, the keys tokens presented (`tokenPersons`: Mia's iPad = her
// key, a pending laptop with an unknown key calling itself "Kai (laptop)", a pending tablet with Mia's key,
// the WORKSTATION desktop that presented another key before), `PUT …/person-keys` (409 person_key_in_use),
// and this desktop's identity (main's HostApi `identityState` / export / import / copyIdentityKey /
// importIdentityKey / setIdentityName; the local root claim put the key on owner, workstation recorded
// it; a pasted `cutex-id-…` string with a good checksum "imports" the workstation key). `?noidentity`: an older host.
// r236: person-identity-ack (「知道了」 on the WORKSTATION desktop's changed-identity flag) and
// users-p2-access (`?nonowner=send`: read-only files, image attach, delegation commands; `?nop2`: without).
// client-token-rename: the desktops carry real `desktop-…` labels (「WORKSTATION」, 「kai-laptop 上的
// cutex_dev」); renames arrive through MockCore clientTokenNames (remote-access's mock serves the method).
// Owner devices (cutex 21123b6; docs/research/owner-devices-desktop-api-20261019.md): tokens carry
// `scope` / `issuedVia`; the owner's new iPhone 16 (paired 10 min ago) is an unacknowledged new owner
// device (`ownerNewDevices` / `ackOwnerNewDevice`; a revoke or a narrowed scope drops it, like cutex);
// `?ownerdevicedemo[=s]`: s seconds (default 8) after start a "Galaxy S25" pairs as an owner device and
// `cutex/access/ownerDeviceAdded` arrives on HOST-A's feed. workstation has no new devices. `?scope=chat|read`:
// ack refused (device_scope_denied). `?noownerlocal`: an older cutex (no fields, no features, no route).
import type { IdentityKeyErrorCode, PersonIdentityView } from "../../../../shared/personIdentity";
import type { PersonKeyRecord, SelfProfile, UserGrant, UserPeerRecord, UserRecord, UsersList, UserTokenRecord } from "../../../../shared/users";
import type { ModuleMock } from "../../dev/mockTypes";

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

class Refusal extends Error {
  constructor(readonly code: string, message: string, readonly tokens?: string[], readonly peers?: string[], readonly holder?: { publicKey: string; userId: string }) {
    super(`${code}: ${message}`);
  }
}

/** Person keys of the preview (base64url raw Ed25519 public keys) and their fingerprints. */
const KEY_SELF = "9Uz5KJEzXkUSRzmEfLleX0zbvOI1_5X1kwhrC0OUbJI"; // 116df1968daccae0: this desktop
const KEY_WORKSTATION = "LO-q-v9M27s3T2nFDPA7EOxvJ_HH4KhH5ybVTexFDqs"; // 6060078263515bfd: the owner's other computer
const KEY_MIA = "RhjSgCNk1meDWHjpGN-gnaaQ6val83kznZNOC3BChno"; // 9293fc98835464c1
const KEY_KAI = "C0bpwn3rQt-1NhbxuXE8MJF7MzXJDlc-4QlHc9GiOU0"; // 30c484eb9ff94a28
const FINGERPRINTS: Record<string, string> = { [KEY_SELF]: "116df1968daccae0", [KEY_WORKSTATION]: "6060078263515bfd", [KEY_MIA]: "9293fc98835464c1", [KEY_KAI]: "30c484eb9ff94a28" };
const NO_IDENTITY = typeof location !== "undefined" && new URLSearchParams(location.search).has("noidentity");
const NO_P2 = typeof location !== "undefined" && new URLSearchParams(location.search).has("nop2");
const NO_OWN = typeof location !== "undefined" && new URLSearchParams(location.search).has("noown");
const NO_OWNER_LOCAL = typeof location !== "undefined" && new URLSearchParams(location.search).has("noownerlocal");
const OWNER_DEVICE_DEMO = typeof location !== "undefined" ? new URLSearchParams(location.search).get("ownerdevicedemo") : null;
const owned = (scope: "full" | "chat" | "read", issuedVia: "hostCli" | "pairing") => (NO_OWNER_LOCAL ? {} : { scope, issuedVia });
const personKey = (publicKey: string, daysAgo: number, label?: string): PersonKeyRecord => ({ publicKey, fingerprint: FINGERPRINTS[publicKey] ?? "0000000000000000", addedAt: iso(daysAgo * 86400), ...(label ? { label } : {}) });

const state: UsersList = {
  revision: 7,
  users: [
    { id: "owner", name: "Sam", color: "cyan", builtin: true, isOwner: true, grant: null, createdAt: iso(9 * 86400), updatedAt: iso(9 * 86400), displayName: null, avatarEtag: null },
    { id: "u-5f1c2a9e0b7d", name: "Mia", color: "magenta", builtin: false, isOwner: false, grant: { projects: ["desktop"], standaloneAgents: [], send: false }, createdAt: iso(4 * 86400), updatedAt: iso(2 * 86400), displayName: "Mia Chen", avatarEtag: "5f1c2a9e0b7d0001" },
    { id: "u-a83d4e61c0f2", name: "Kai", color: "green", builtin: false, isOwner: false, grant: { projects: "all", standaloneAgents: [], send: true }, createdAt: iso(3 * 86400), updatedAt: iso(3 * 86400), displayName: "Kai Nakamura", avatarEtag: "a83d4e61c0f20001" },
  ],
  tokens: [
    { tokenId: "mct-1a2b3c4d5e6f7a8b", label: "Pixel 9", kind: "device", deviceName: "Pixel 9", platform: "android", createdAt: iso(3 * 86400), lastUsedAt: iso(720), lastAddress: "100.64.0.7", userId: "owner", pending: false, ...owned("full", "pairing") },
    { tokenId: "mct-9f8e7d6c5b4a3f2e", label: "desktop-WORKSTATION-Cutex-4f9a1c", kind: "client", deviceName: null, platform: null, createdAt: iso(20 * 86400), lastUsedAt: iso(86400), lastAddress: "100.64.0.97", userId: "owner", pending: false, ...owned("full", "hostCli") },
    { tokenId: "mct-6f7a8b9c0d1e2f30", label: "iPhone 16", kind: "device", deviceName: "iPhone 16", platform: "ios", createdAt: iso(600), lastUsedAt: iso(240), lastAddress: "100.64.0.21", userId: "owner", pending: false, ...owned("full", "pairing") },
    { tokenId: "mct-3c4d5e6f7a8b9c0d", label: "Mia's iPad", kind: "device", deviceName: "iPad", platform: "ios", createdAt: iso(2 * 86400), lastUsedAt: iso(3600), lastAddress: "100.64.0.12", userId: "u-5f1c2a9e0b7d", pending: false, ...owned("chat", "pairing") },
    // Mia's laptop: this desktop under `?nonowner` (C1 user.token, dev/mockBridge.ts mockConnectionUser).
    { tokenId: "mct-5d6e7f8091a2b3c4", label: "desktop-mia-laptop-Cutex-71c0de", kind: "client", deviceName: null, ownerName: "Mia 的笔记本", platform: null, createdAt: iso(2 * 86400), lastUsedAt: iso(120), lastAddress: "100.64.0.15", userId: "u-5f1c2a9e0b7d", pending: false, ...owned("full", "hostCli") },
    { tokenId: "mct-7e6d5c4b3a291807", label: "desktop-kai-laptop-cutex_dev-3b7e02", kind: "client", deviceName: null, platform: null, createdAt: iso(40 * 60), lastUsedAt: iso(30 * 60), lastAddress: "100.64.0.31", userId: null, pending: true, ...owned("full", "hostCli") },
    { tokenId: "mct-0a1b2c3d4e5f6071", label: "Galaxy Tab", kind: "device", deviceName: "Galaxy Tab S10", platform: "android", createdAt: iso(5 * 60), lastUsedAt: null, lastAddress: null, userId: null, pending: true, ...owned("read", "pairing") },
  ],
  peers: [
    { peerId: "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f", label: "workstation-lab", hostId: "WORKSTATION", status: "online", userId: "owner" },
    { peerId: "ci-6b0c1d2e3f405162738495a6b7c8d9e0", label: "gpu-box", hostId: "GPU-BOX", status: "unreachable", userId: "u-a83d4e61c0f2" },
    { peerId: "ci-ae3e47b1c2d3e4f5a6b7c8d9e0f1a2b3", label: "alpha-home", hostId: "ALPHA", status: "removedByPeer", userId: "owner" },
  ],
  settings: { ownerRequiresApproval: true },
};

/** `tokens[].person`, `tokenPersons`, `personsRevision` as cutex derives them from the presented keys. */
const presented: Record<string, { publicKey: string; displayName?: string; previousPublicKey?: string; claimedAt: string }> = {
  "mct-9f8e7d6c5b4a3f2e": { publicKey: KEY_WORKSTATION, previousPublicKey: KEY_KAI, claimedAt: iso(86400) },
  "mct-3c4d5e6f7a8b9c0d": { publicKey: KEY_MIA, displayName: "Mia Chen", claimedAt: iso(3600) },
  "mct-7e6d5c4b3a291807": { publicKey: KEY_KAI, displayName: "Kai (laptop)", claimedAt: iso(40 * 60) },
  "mct-0a1b2c3d4e5f6071": { publicKey: KEY_MIA, displayName: "Mia Chen", claimedAt: iso(5 * 60) },
};
let personsRevision = 4;
if (!NO_IDENTITY) {
  state.users[0]!.personKeys = [personKey(KEY_SELF, 9, "host-a"), personKey(KEY_WORKSTATION, 9, "workstation")];
  state.users[1]!.personKeys = [personKey(KEY_MIA, 2)];
  state.users[2]!.personKeys = [];
}

/** owner-device-notice: tokens that became the owner's and are not acknowledged yet (cutex users-v1.json `newOwnerDevices`). */
const newOwnerDevices: { tokenId: string; at: string; via: "pairing" | "assigned" | "personKey" | "ssh" }[] = [{ tokenId: "mct-6f7a8b9c0d1e2f30", at: iso(600), via: "pairing" }];
/** `?ownerdevice` (HOST-A): this desktop's own paired owner token (dev/mockBridge.ts mockConnectionUser). */
const PAIRED_SELF_ID = "mct-2b3c4d5e6f708192";
if (typeof location !== "undefined" && !NO_OWNER_LOCAL && new URLSearchParams(location.search).has("ownerdevice") && (new URLSearchParams(location.search).get("ownerdevice") || "local") === "local") {
  state.tokens.push({ tokenId: PAIRED_SELF_ID, label: "desktop-sam-laptop-Cutex-5a2c11", kind: "device", deviceName: "sam-laptop", platform: "linux", createdAt: iso(5 * 86400), lastUsedAt: iso(5), lastAddress: "127.0.0.1", userId: "owner", pending: false, ...owned("full", "pairing") });
}
/** This connection's scope on HOST-A (`?scope=chat|read`). */
const connectionScope = (): "full" | "chat" | "read" => (NO_OWNER_LOCAL ? "full" : ((["chat", "read"] as const).find((v) => v === q().get("scope")) ?? "full"));

/** client-token-rename / device-scope / revoke: this list's tokens follow the token methods (no api method of their own). */
function registerTokens(core: Parameters<NonNullable<ModuleMock["api"]>>[0]): Record<string, never> {
  core.clientTokenNames.register({
    rename(tokenId, ownerName) {
      const token = state.tokens.find((t) => t.tokenId === tokenId);
      if (!token) return false;
      token.ownerName = ownerName;
      return true;
    },
    setScope(tokenId, scope) {
      const token = state.tokens.find((t) => t.tokenId === tokenId);
      if (!token) return false;
      token.scope = scope;
      // cutex: a narrowed owner device is no longer a "new device with full rights" notice.
      if (scope !== "full") dropNewDevice(tokenId);
      return true;
    },
    revoke(tokenId) {
      const i = state.tokens.findIndex((t) => t.tokenId === tokenId);
      dropNewDevice(tokenId);
      if (i < 0) return false;
      state.tokens.splice(i, 1);
      bump();
      return true;
    },
  });
  return {};
}

function dropNewDevice(tokenId: string): boolean {
  const i = newOwnerDevices.findIndex((d) => d.tokenId === tokenId);
  if (i >= 0) newOwnerDevices.splice(i, 1);
  return i >= 0;
}

/** `GET /v2/users/owner/new-devices` items (a `/v2/users` token item + at / via / current). */
function newDevicesView(): import("../../../../shared/users").OwnerNewDevice[] {
  const current = q().has("ownerdevice") ? PAIRED_SELF_ID : null;
  return newOwnerDevices.flatMap((d) => {
    const token = listing().tokens.find((t) => t.tokenId === d.tokenId && t.userId === "owner");
    return token ? [{ ...token, at: d.at, via: d.via, current: token.tokenId === current }] : [];
  });
}

function listing(): UsersList {
  const view = clone(state);
  if (NO_IDENTITY) return view;
  const holder = (key: string) => state.users.find((u) => u.personKeys?.some((k) => k.publicKey === key))?.id ?? null;
  for (const token of view.tokens) {
    const p = presented[token.tokenId];
    token.person = p ? { publicKey: p.publicKey, fingerprint: FINGERPRINTS[p.publicKey] ?? "0000000000000000", userId: holder(p.publicKey), displayName: p.displayName ?? null, claimedAt: p.claimedAt, previousPublicKey: p.previousPublicKey ?? null } : null;
  }
  view.tokenPersons = Object.fromEntries(Object.entries(presented).map(([id, p]) => [id, p.publicKey]));
  view.personsRevision = personsRevision;
  view.peers = view.peers.map((peer) => ({ ...peer, personKeys: peer.peerId.startsWith("ci-7a3f") ? [KEY_WORKSTATION] : [] }));
  return view;
}

/** This desktop's identity as main reports it (HostApi identityState). */
const identity: PersonIdentityView = {
  publicKey: KEY_SELF,
  fingerprint: FINGERPRINTS[KEY_SELF]!,
  claims: { local: { state: "claimed", outcome: "ownerKeyAdded", userId: "owner", pending: false, at: iso(9 * 86400) }, "ssh-7a3f01c2": { state: "claimed", outcome: "recorded", userId: "owner", pending: false, at: iso(3600) }, "ssh-ae3e47b1": { state: "unsupported" } },
};

/** The preview "imports" the owner's other computer's key (workstation) and claims it again (main's confirm dialog is skipped). */
function importWorkstationKey(emit: (name: "identityState", view: PersonIdentityView) => void): { ok: true; changed: boolean } {
  if (identity.publicKey === KEY_WORKSTATION) return { ok: true, changed: false };
  Object.assign(identity, { publicKey: KEY_WORKSTATION, fingerprint: FINGERPRINTS[KEY_WORKSTATION] });
  identity.claims = { ...identity.claims, "ssh-7a3f01c2": { state: "claiming" } };
  emit("identityState", structuredClone(identity));
  setTimeout(() => {
    identity.claims = { ...identity.claims, "ssh-7a3f01c2": { state: "claimed", outcome: "recorded", userId: "owner", pending: false, at: now() } };
    emit("identityState", structuredClone(identity));
  }, 900);
  return { ok: true, changed: true };
}

/** main/personKey.ts parsePersonKeyString's checks (prefix, length, checksum) with Web Crypto; null = reads. */
async function mockKeyStringError(text: string): Promise<IdentityKeyErrorCode | null> {
  const compact = text.replace(/\s+/g, "");
  if (!compact.startsWith("cutex-id-")) return "prefix";
  const body = compact.slice("cutex-id-".length);
  if (!/^[A-Za-z0-9_-]{48}$/.test(body)) return "length";
  const bytes = Uint8Array.from(atob(body.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  const seed = bytes.slice(0, 32);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...new TextEncoder().encode("cutex-id-v1"), ...seed])));
  return digest.slice(0, 4).every((b, i) => b === bytes[32 + i]) ? null : "checksum";
}

/** A remote user's picture (what they set on their own desktop): a gradient with their initial. */
function svgAvatar(letter: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="64" cy="50" r="22" fill="#fff" fill-opacity=".85"/><rect x="26" y="80" width="76" height="60" rx="30" fill="#fff" fill-opacity=".85"/><text x="64" y="58" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="${to}">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Avatar images by user id (with the ETag they were published under). */
const avatars = new Map<string, { etag: string; dataUrl: string }>([
  ["u-5f1c2a9e0b7d", { etag: "5f1c2a9e0b7d0001", dataUrl: svgAvatar("M", "#f783ac", "#ae3ec9") }],
  ["u-a83d4e61c0f2", { etag: "a83d4e61c0f20001", dataUrl: svgAvatar("K", "#69db7c", "#2b8a3e") }],
]);

/** The connection's own user (dev/mockBridge.ts mockConnectionUser): Mia under `?nonowner`, else the owner; null = pending. */
const q = () => (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());
function meId(): string | null {
  if (q().has("pending")) return null;
  return q().has("nonowner") ? "u-5f1c2a9e0b7d" : "owner";
}

function selfView(id: string): SelfProfile {
  const user = userOf(id);
  return { user: { id: user.id, name: user.name, isOwner: user.isOwner, displayName: user.displayName ?? null, avatarEtag: user.avatarEtag ?? null } };
}

const clone = <T>(x: T): T => structuredClone(x);
const now = () => new Date().toISOString();
const bump = () => ++state.revision;

function userOf(id: string): UserRecord {
  const user = state.users.find((u) => u.id === id);
  if (!user) throw new Refusal("user_not_found", `no user ${id}`);
  return user;
}

function cleanGrant(grant: UserGrant): UserGrant {
  return { projects: grant.projects === "all" ? "all" : [...new Set(grant.projects)], standaloneAgents: [...new Set(grant.standaloneAgents)], send: grant.send === true };
}

/** UsersResult for a refusal / success (the real main process does this in DaemonService.usersCall). */
async function result<T>(run: () => T) {
  try {
    return { ok: true as const, value: run() };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    const access = (e as Refusal & { access?: import("../../../../shared/users").AccessRefusalDetails }).access;
    return { ok: false as const, error: { code: e.code, message: e.message.slice(e.code.length + 2), ...(e.tokens ? { tokens: e.tokens } : {}), ...(e.peers ? { peers: e.peers } : {}), ...(e.holder ?? {}), ...(access ? { access } : {}) } };
  }
}

let workstationKnowsSelf = false;
/** workstation's own listing: HOST-A's, plus this desktop's client token there (hosts.json tokenId of workstation). */
const WORKSTATION_SELF: UserTokenRecord = { tokenId: "mct-4b5c6d7e8f901a2b", label: "desktop-HOST-A-Cutex-9c1d2e", kind: "client", deviceName: null, platform: null, createdAt: iso(30 * 86400), lastUsedAt: iso(30), lastAddress: "100.64.0.2", userId: "owner", pending: false, ...owned("full", "hostCli") };

// Pairing v2 (QR invites, AddDevice.tsx; contract rev 9.1). `?nopairv2`: a cutex without invites (the v1 code in
// the same panel). `?norelay`: invites carry no relay entry (tailnet / LAN only). `?pairdemo[=s]`: s seconds
// (default 6) after an invite is made a "Pixel 9 Pro" applies to it. `?pairpending`: a request made from the
// host's CLI already waits (full control). `?pairdialog=cancel`: the owner cancels main's native dialog (the mock
// records what it would have shown in `window.__pairingDialogs`). Allowing adds the device to the list.
const NO_PAIR_V2 = typeof location !== "undefined" && new URLSearchParams(location.search).has("nopairv2");
const NO_RELAY = typeof location !== "undefined" && new URLSearchParams(location.search).has("norelay");
type MockInvite = import("../../../../shared/ipc").PairingInviteView;
// 公网扫码配对 switch (RelayPairing.tsx; contract rev 9.4). Off by default like a fresh relay setup;
// `?relaypairing=on` listening, `=stuck` on but the port is taken; `?norelay` not configured; `?norelayswitch` an
// older cutex without the switch. Turning it on while `=stuck` fails like cutex (503, the choice stays on).
const NO_RELAY_SWITCH = typeof location !== "undefined" && new URLSearchParams(location.search).has("norelayswitch");
const RELAY_PAIRING_START = (typeof location !== "undefined" && new URLSearchParams(location.search).get("relaypairing")) || "off";
type MockRelayPairing = import("../../../../shared/ipc").RelayPairingStatusView;
const relayPairing: MockRelayPairing = NO_RELAY
  ? { configured: false, enabled: false, listening: false, reason: "not_configured", bootstrapBind: null, bootstrapServerName: null }
  : { configured: true, enabled: RELAY_PAIRING_START !== "off", listening: RELAY_PAIRING_START === "on", reason: RELAY_PAIRING_START === "on" ? null : RELAY_PAIRING_START === "stuck" ? "bind_unavailable" : "disabled", bootstrapBind: "0.0.0.0:8443", bootstrapServerName: "eva-pair.example.love" };
function relayPairingApi(): Partial<import("../../../../shared/ipc").DesktopApi> {
  if (NO_RELAY_SWITCH) return {};
  return {
    relayPairing: () => result(() => (pairRefusal(), clone(relayPairing))),
    setRelayPairing: (enabled) =>
      result(() => {
        pairRefusal();
        if (enabled && !relayPairing.configured) throw new Refusal("bootstrap_not_configured", "no bootstrap bind / name");
        relayPairing.enabled = enabled;
        if (!enabled) Object.assign(relayPairing, { listening: false, reason: "disabled" });
        else if (RELAY_PAIRING_START === "stuck") {
          Object.assign(relayPairing, { listening: false, reason: "bind_unavailable" });
          throw new Refusal("bootstrap_bind_unavailable", "address in use");
        } else Object.assign(relayPairing, { listening: true, reason: null });
        return clone(relayPairing);
      }),
  };
}
const invites: MockInvite[] = [];
const sixDigits = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
const hex64 = (seed: string) => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) * (i + 7)) % 16]).join("");
const b64url = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function applyTo(invite: MockInvite, deviceName: string, platform: "android" | "ios", route: "direct" | "relay") {
  if (invite.status !== "invited") return;
  invite.status = "pending";
  invite.request = { requestId: `rpr-${invite.inviteId.slice(4)}`, deviceName, platform, shortCode: sixDigits(), csrSha256: hex64(`${deviceName}csr`), keySha256: hex64(`${deviceName}key`), route };
}
function liveInvites(): MockInvite[] {
  const nowMs = Date.now();
  for (const i of invites) if ((i.status === "invited" || i.status === "pending") && Date.parse(i.expiresAt) <= nowMs) i.status = "expired";
  return invites.filter((i) => i.status === "invited" || i.status === "pending" || i.status === "approving" || i.status === "approved");
}
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("pairpending")) {
  const invite: MockInvite = { inviteId: "rpi-c11a0000000000000000000000000001", status: "invited", expiresAt: new Date(Date.now() + 240_000).toISOString(), userId: "owner", scope: "full", label: null, deviceId: null, request: null };
  invites.push(invite);
  applyTo(invite, "Pixel 9 Pro", "android", "relay");
}
const pairRefusal = () => {
  if (connectionScope() !== "full") throw Object.assign(new Refusal("device_scope_denied", "this device's scope does not allow this"), { access: { scope: connectionScope(), required: "full" } });
  if (q().has("ownerdevice") && (q().get("ownerdevice") || "local") === "local") throw Object.assign(new Refusal("owner_local_only", "only on the host itself or over SSH"), { access: { action: "pairingCode" } });
};
function pairingApi(): Partial<import("../../../../shared/ipc").DesktopApi> {
  if (NO_PAIR_V2) return {};
  return {
    pairingInvites: () => result(() => (pairRefusal(), clone(liveInvites()))),
    createPairingInvite: (options) =>
      result(() => {
        pairRefusal();
        if (liveInvites().length >= 20) throw new Refusal("bootstrap_rate_limited", "too many live invites");
        const inviteId = `rpi-${Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32)}`;
        const invite: MockInvite = { inviteId, status: "invited", expiresAt: new Date(Date.now() + 300_000).toISOString(), userId: options.userId ?? "owner", scope: options.scope ?? "full", label: options.label ?? null, deviceId: null, request: null };
        invites.push(invite);
        const directUrls = ["http://100.101.102.103:24270", "http://host-a.tail1234.ts.net:24270"];
        const bootstrapOrigin = NO_RELAY ? null : "https://eva-pair.example.love";
        const relayFields = bootstrapOrigin ? { bootstrapOrigin, workOrigin: "https://eva.example.love", caDer: "MIIBszCCAVmgAwIBAgIUQmock".padEnd(640, "A"), serverCaSha256: hex64("ca") } : {};
        const payload = { v: 2, hostId: "ci-0f1e2d3c4b5a69788796a5b4c3d2e1f0", hostName: "HOST-A", directUrls, ...relayFields, inviteId, secret: "mock-secret-not-real-0000000000000000000000", expiresAt: invite.expiresAt, userId: invite.userId, scope: invite.scope };
        const demo = q().get("pairdemo");
        if (demo !== null) setTimeout(() => applyTo(invite, "Pixel 9 Pro", "android", NO_RELAY ? "direct" : "relay"), (Number(demo) || 6) * 1000);
        return { invite: clone(invite), qr: `cutex-pair:v2:${b64url(JSON.stringify(payload))}`, relay: !NO_RELAY, directUrls, bootstrapOrigin };
      }),
    cancelPairingInvite: (inviteId) =>
      result(() => {
        const invite = invites.find((i) => i.inviteId === inviteId);
        if (!invite) throw new Refusal("request_not_found", inviteId);
        if (invite.status === "approving" || invite.status === "approved") throw new Refusal("request_conflict", "already approved");
        invite.status = "cancelled";
        return null;
      }),
    denyPairingRequest: (inviteId, requestId) =>
      result(() => {
        const invite = invites.find((i) => i.inviteId === inviteId);
        if (!invite?.request || invite.request.requestId !== requestId || invite.status !== "pending") throw new Refusal("request_conflict", "not this request");
        invite.status = "rejected";
        return null;
      }),
    async approvePairingRequest(inviteId, requestId, texts) {
      const invite = liveInvites().find((i) => i.inviteId === inviteId);
      const request = invite?.request;
      if (!invite || !request || request.requestId !== requestId || (invite.status !== "pending" && invite.status !== "approving")) return { ok: false as const, changed: true as const };
      if (invite.scope === "full" && invite.status === "pending") {
        // main/pairingInvites.ts shows this in a native dialog; the preview records it.
        const code = `${request.shortCode.slice(0, 3)} ${request.shortCode.slice(3)}`;
        const fill = (s: string) => s.replace("{host}", "HOST-A").replace("{device}", request.deviceName).replace("{code}", code).replace("{user}", "Sam").replace("{platform}", texts.platforms[request.platform] ?? "");
        const w = window as unknown as { __pairingDialogs?: unknown[] };
        (w.__pairingDialogs ??= []).push({ title: fill(texts.title), message: fill(texts.message), detail: fill(texts.detail), buttons: [texts.allow, texts.cancel] });
        if (q().get("pairdialog") === "cancel") return { ok: false as const, canceled: true as const };
      }
      invite.status = "approved";
      const at = now();
      state.tokens.push({ tokenId: `mct-${invite.inviteId.slice(4, 20)}`, label: request.deviceName, kind: "device", deviceName: request.deviceName, platform: request.platform, createdAt: at, lastUsedAt: at, lastAddress: request.route === "relay" ? "127.0.0.1" : "100.64.0.51", userId: invite.userId, pending: false, ...owned(invite.scope, "pairing") });
      bump();
      return { ok: true as const, invite: clone(invite) };
    },
  };
}

export const mock: ModuleMock = {
  remote: (hostId) =>
    hostId === "ssh-7a3f01c2"
      ? {
          async users() {
            const view = listing();
            view.tokens.push(clone(WORKSTATION_SELF));
            // workstation does not know this desktop's key yet (Settings → 你: 这台主机还不认得你的身份 [记住]).
            if (!workstationKnowsSelf) for (const user of view.users) user.personKeys = user.personKeys?.filter((k) => k.publicKey !== identity.publicKey);
            return view;
          },
          async putUserPersonKeys(userId, personKeys) {
            if (personKeys.some((k) => k.publicKey === identity.publicKey)) workstationKnowsSelf = true;
            const user = state.users.find((u) => u.id === userId);
            return { ok: true as const, value: { userId, personKeys: clone(user?.personKeys ?? []) } };
          },
          // owner-device-notice: nothing new on workstation.
          async ownerNewDevices() {
            return { ok: true as const, value: NO_OWNER_LOCAL ? null : [] };
          },
          ackOwnerNewDevice(tokenId) {
            return result(() => ({ tokenId, acknowledged: false }));
          },
        }
      : {},
  // users-p2-access (r236): `?nop2` = an older host (a non-owner gets no files / images / delegation commands).
  // cutex C1 / C2 (user-own-token, user-own-devices): `?noown` = a host without them.
  features: { new: [...(NO_IDENTITY ? ["users", "users-self-profile"] : ["users", "users-self-profile", "person-identity", "person-identity-ack"]), ...(NO_P2 ? [] : ["users-p2-access"]), ...(NO_OWN ? [] : ["user-own-token", "user-own-devices"]), ...(NO_OWNER_LOCAL ? [] : ["owner-local-only", "owner-device-notice", "device-scope"]), ...(NO_PAIR_V2 ? [] : ["relay-pairing-v2"]), ...(NO_RELAY_SWITCH ? [] : ["relay-pairing-switch-v1"])] },
  start(core) {
    // `?ownerdevicedemo[=s]`: a new owner device pairs on HOST-A after s seconds (default 8).
    if (core.legacy || NO_OWNER_LOCAL || OWNER_DEVICE_DEMO === null) return;
    setTimeout(() => {
      const tokenId = "mct-8091a2b3c4d5e6f7";
      if (state.tokens.some((t) => t.tokenId === tokenId)) return;
      const at = now();
      state.tokens.push({ tokenId, label: "Galaxy S25", kind: "device", deviceName: "Galaxy S25", platform: "android", createdAt: at, lastUsedAt: at, lastAddress: "100.64.0.44", userId: "owner", pending: false, scope: "full", issuedVia: "pairing" });
      newOwnerDevices.push({ tokenId, at, via: "pairing" });
      bump();
      core.emitHost("cutex/access/ownerDeviceAdded", { tokenId, label: "Galaxy S25", deviceName: "Galaxy S25", platform: "android", scope: "full", at, via: "pairing" });
    }, (Number(OWNER_DEVICE_DEMO) || 8) * 1000);
  },
  api: (core) => ({
    ...registerTokens(core),
    ...pairingApi(),
    ...relayPairingApi(),
    async identityState() {
      return structuredClone(identity);
    },
    async exportIdentity() {
      return { ok: true as const, path: `C:\\Users\\sam\\Documents\\cutex-identity-${identity.fingerprint}.json` };
    },
    async importIdentity() {
      const r = importWorkstationKey((name, view) => core.emit(name, view));
      return r.changed ? { ...r, path: "C:\\Users\\sam\\Downloads\\cutex-identity-6060078263515bfd.json" } : r;
    },
    async copyIdentityKey() {
      // main writes the string to the clipboard; the preview has none to write.
      return { ok: true as const, clearAfterMs: 60_000 };
    },
    async importIdentityKey(text) {
      const errorCode = await mockKeyStringError(text);
      if (errorCode) return { ok: false as const, errorCode, error: errorCode };
      return importWorkstationKey((name, view) => core.emit(name, view));
    },
    async setIdentityName() {},
    ackTokenPersonChange(tokenId) {
      // person-identity-ack: clears the token's previous key (idempotent; 404 for an unknown token).
      return result(() => {
        if (!state.tokens.some((t) => t.tokenId === tokenId)) throw new Refusal("client_token_not_found", tokenId);
        const p = presented[tokenId];
        const cleared = !!p?.previousPublicKey;
        if (p) delete p.previousPublicKey;
        if (cleared) personsRevision++;
        return { tokenId, cleared, previousPublicKey: null, personsRevision };
      });
    },
    putUserPersonKeys(userId, personKeys) {
      return result(() => {
        const user = userOf(userId);
        // A key belongs to at most one user (cutex: 409 person_key_in_use {publicKey, userId}).
        for (const other of state.users) {
          const taken = other.id !== userId && other.personKeys?.find((k) => personKeys.some((p) => p.publicKey === k.publicKey));
          if (taken) throw new Refusal("person_key_in_use", "this key already belongs to another user", undefined, undefined, { publicKey: taken.publicKey, userId: other.id });
        }
        const before = new Map((user.personKeys ?? []).map((k) => [k.publicKey, k]));
        user.personKeys = personKeys.map((k) => ({ ...(before.get(k.publicKey) ?? personKey(k.publicKey, 0)), ...(k.label ? { label: k.label } : {}) }));
        personsRevision++;
        return { userId, personKeys: clone(user.personKeys) };
      });
    },
    async users() {
      return listing();
    },
    // owner-device-notice (owner principals; a read / chat owner device may read, only full may ack).
    ownerNewDevices() {
      return result(() => {
        if (NO_OWNER_LOCAL) return null;
        if (meId() !== "owner") throw new Refusal(meId() ? "owner_required" : "user_pending", "owner only");
        return newDevicesView();
      });
    },
    ackOwnerNewDevice(tokenId) {
      return result(() => {
        if (NO_OWNER_LOCAL) throw new Refusal("route_not_found", "management v2 route not found");
        if (meId() !== "owner") throw new Refusal(meId() ? "owner_required" : "user_pending", "owner only");
        if (connectionScope() !== "full") throw Object.assign(new Refusal("device_scope_denied", "this device's scope does not allow this"), { access: { scope: connectionScope(), required: "full" } });
        return { tokenId, acknowledged: dropNewDevice(tokenId) };
      });
    },
    createUser(request) {
      return result(() => {
        const user: UserRecord = { id: `u-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`, name: request.name.trim(), color: request.color ?? null, builtin: false, isOwner: false, grant: cleanGrant(request.grant ?? { projects: [], standaloneAgents: [], send: false }), createdAt: now(), updatedAt: now() };
        state.users.push(user);
        return { user: clone(user), revision: bump() };
      });
    },
    async patchUser(userId, patch) {
      // A short write, so 项目页 → 可见用户's locked switch shows.
      await new Promise((r) => setTimeout(r, 350));
      return result(() => {
        const user = userOf(userId);
        if (patch.grant && user.isOwner) throw new Refusal("owner_immutable", "the owner has no grant");
        if (patch.name !== undefined) user.name = patch.name.trim();
        if (patch.color !== undefined) user.color = patch.color;
        if (patch.grant) user.grant = cleanGrant(patch.grant);
        user.updatedAt = now();
        return { user: clone(user), revision: bump() };
      });
    },
    deleteUser(userId) {
      return result(() => {
        const user = userOf(userId);
        if (user.isOwner) throw new Refusal("owner_immutable", "the owner cannot be deleted");
        const tokens = state.tokens.filter((t) => t.userId === userId).map((t) => t.tokenId);
        const peers = state.peers.filter((p) => p.userId === userId).map((p) => p.peerId);
        if (tokens.length || peers.length) throw new Refusal("user_in_use", "rebind or revoke first", tokens, peers);
        state.users = state.users.filter((u) => u.id !== userId);
        bump();
        return { userId, deleted: true };
      });
    },
    bindUserToken(tokenId, userId) {
      return result(() => {
        const token = state.tokens.find((t) => t.tokenId === tokenId);
        if (!token) throw new Refusal("client_token_not_found", tokenId);
        if (userId !== null) userOf(userId);
        Object.assign(token, { userId, pending: userId === null } satisfies Partial<UserTokenRecord>);
        bump();
        return { tokenId, userId, pending: userId === null };
      });
    },
    bindUserPeer(peerId, userId) {
      return result(() => {
        const peer = state.peers.find((p) => p.peerId === peerId);
        if (!peer) throw new Refusal("peer_not_found", peerId);
        userOf(userId);
        (peer as UserPeerRecord).userId = userId;
        bump();
        return { peerId, userId };
      });
    },
    // C2: the connection's own devices (the owner: the owner user's; a pending device: 403 user_pending).
    usersMeDevices() {
      return result(() => {
        const id = meId();
        if (!id) throw new Refusal("user_pending", "this device is waiting for the host owner");
        const current = q().has("nonowner") ? "mct-5d6e7f8091a2b3c4" : null;
        const devices = state.tokens.filter((t) => t.userId === id && !t.pending).map((t) => ({ ...clone(t), current: t.tokenId === current }));
        return { hostId: "HOST-A", userId: id, devices };
      });
    },
    usersMeRemoveDevice(tokenId) {
      return result(() => {
        const id = meId();
        if (!id) throw new Refusal("user_pending", "this device is waiting for the host owner");
        const i = state.tokens.findIndex((t) => t.tokenId === tokenId && t.userId === id);
        if (i < 0) throw new Refusal("client_token_not_found", tokenId);
        state.tokens.splice(i, 1);
        bump();
        return { tokenId, revoked: true, current: q().has("nonowner") && tokenId === "mct-5d6e7f8091a2b3c4" };
      });
    },
    async usersMe() {
      const id = meId();
      return id ? selfView(id) : null;
    },
    patchUsersMe(patch) {
      return result(() => {
        const id = meId();
        if (!id) throw new Refusal("access_pending", "this device is waiting for the host owner");
        const user = userOf(id);
        if (patch.displayName !== undefined) user.displayName = patch.displayName?.trim() || null;
        if (patch.avatar === null) {
          avatars.delete(id);
          user.avatarEtag = null;
        } else if (patch.avatar) {
          const etag = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
          avatars.set(id, { etag, dataUrl: `data:${patch.avatar.contentType};base64,${patch.avatar.data}` });
          user.avatarEtag = etag;
        }
        user.updatedAt = now();
        bump();
        return selfView(id);
      });
    },
    async userAvatar(userId) {
      // A non-owner sees the owner, itself and the users sharing an agent (all of them, in this mock).
      const found = avatars.get(userId);
      await new Promise((r) => setTimeout(r, 120));
      return found ? { dataUrl: found.dataUrl, etag: found.etag } : null;
    },
    patchUsersSettings(patch) {
      return result(() => {
        // owner-local-only: turning approval off is a root-identity action (`?ownerdevice`: this desktop is a paired device).
        if (patch.ownerRequiresApproval === false && q().has("ownerdevice") && (q().get("ownerdevice") || "local") === "local" && !NO_OWNER_LOCAL) {
          throw Object.assign(new Refusal("owner_local_only", "only on the host itself or over SSH"), { access: { action: "disableOwnerApproval", issuedVia: "pairing" } });
        }
        state.settings = { ownerRequiresApproval: patch.ownerRequiresApproval };
        bump();
        return { settings: clone(state.settings) };
      });
    },
  }),
};
