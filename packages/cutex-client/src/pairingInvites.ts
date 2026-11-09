// Device pairing v2 (QR invites; cutex contract rev 9.1, `.claude/agent-artifacts/qr-pair/contract-rev9.md`): the
// owner makes a 5-minute invite, a phone scans it (`cutex-pair:v2:…`) and applies over the host's tailnet / LAN
// address or the relay's pairing entry, the owner checks its 6-digit code and allows it. Every path, field name
// and status of the owner endpoints lives in this one file; client.ts only calls these helpers.
import { DEVICE_SCOPES, USER_ID, type DeviceScope } from "./users";

/** Capability names a cutex with v2 invites may advertise (the name was still settling when this was written). */
export const PAIRING_INVITE_FEATURES = ["device-pairing-v2", "relay-pairing-v2"] as const;

const INVITES_PATH = "/v2/pairing/invites";
const INVITE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID = INVITE_ID;
const SHORT_CODE = /^\d{6}$/;
const PLATFORMS = ["android", "ios", "web", "other"] as const;

export const pairingInvitePaths = {
  list: INVITES_PATH,
  create: INVITES_PATH,
  one: (inviteId: string) => `${INVITES_PATH}/${encodeURIComponent(checkId(inviteId))}`,
  approve: (inviteId: string) => `${INVITES_PATH}/${encodeURIComponent(checkId(inviteId))}/approve`,
  deny: (inviteId: string) => `${INVITES_PATH}/${encodeURIComponent(checkId(inviteId))}/deny`,
};

function checkId(id: string): string {
  if (!INVITE_ID.test(id)) throw new Error("bad invite id");
  return id;
}

/**
 * Where an invite stands. `invited`: nobody applied yet (the QR is live). `pending`: a device applied and waits
 * for the owner (its short code is known). `approving`: allowed, the host is writing the token / certificate.
 * `approved`: done; the phone fetches its result. `rejected` / `cancelled` / `expired`: over.
 */
export type PairingInviteStatus = "invited" | "pending" | "approving" | "approved" | "rejected" | "cancelled" | "expired";
/** Which entry the device used: the host's own listener (tailnet / LAN) or the relay's pairing entry. */
export type PairingRoute = "direct" | "relay";
export type PairingPlatform = (typeof PLATFORMS)[number];

/** The device that applied to an invite (owner list only; never the CSR, token or secret). */
export interface PairingRequest {
  requestId: string;
  deviceName: string;
  platform: PairingPlatform;
  /** Six digits; the phone shows the same. */
  shortCode: string;
  /** Lower hex SHA-256 of the CSR DER / its public key (SPKI DER). */
  csrSha256: string | null;
  keySha256: string | null;
  route: PairingRoute | null;
}

/** One `GET /v2/pairing/invites` row. */
export interface PairingInvite {
  inviteId: string;
  status: PairingInviteStatus;
  expiresAt: string;
  userId: string;
  scope: DeviceScope;
  label: string | null;
  /** Existing-device mode: the device this invite adds relay access to (no new device). */
  deviceId: string | null;
  request: PairingRequest | null;
}

/** `POST /v2/pairing/invites` reply: the QR / paste string is the one secret the UI shows; never log it. */
export interface CreatedPairingInvite {
  invite: PairingInvite;
  /** `cutex-pair:v2:…` — the QR and the paste string are the same text. */
  qr: string;
  /** The phone can come in over the relay (the invite carries the relay pairing entry and host CA). */
  relay: boolean;
  /** The host's own addresses the phone may try first (tailnet / LAN). */
  directUrls: string[];
  bootstrapOrigin: string | null;
}

export interface PairingInviteCreate {
  userId?: string;
  scope?: DeviceScope;
  label?: string;
}

export function pairingInviteBody(options: PairingInviteCreate): Record<string, string> {
  const body: Record<string, string> = {};
  if (options.userId !== undefined) {
    if (!USER_ID.test(options.userId)) throw new Error("bad user id");
    body.userId = options.userId;
  }
  if (options.scope !== undefined) {
    if (!DEVICE_SCOPES.includes(options.scope)) throw new Error("bad scope");
    body.scope = options.scope;
  }
  const label = options.label?.trim();
  if (label) body.label = label.slice(0, 60);
  return body;
}

export function approveBody(requestId: string, shortCode: string): { requestId: string; shortCode: string; confirm: true } {
  if (!REQUEST_ID.test(requestId)) throw new Error("bad request id");
  if (!SHORT_CODE.test(shortCode)) throw new Error("bad short code");
  return { requestId, shortCode, confirm: true };
}

export function denyBody(requestId: string): { requestId: string } {
  if (!REQUEST_ID.test(requestId)) throw new Error("bad request id");
  return { requestId };
}

const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const hex = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null);

function readStatus(raw: unknown, expiresAt: string, now: number): PairingInviteStatus {
  const at = Date.parse(expiresAt);
  const over = Number.isFinite(at) && at <= now;
  switch (raw) {
    case "invited":
      return over ? "expired" : "invited";
    case "pending":
      return over ? "expired" : "pending";
    case "preparing":
    case "committing":
      return "approving";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return over ? "expired" : "invited";
  }
}

/** One owner-list row (lenient: unknown fields ignored; a row without an id is dropped). */
export function readPairingInvite(raw: unknown, now = Date.now()): PairingInvite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const inviteId = text(r.inviteId);
  if (!inviteId || !INVITE_ID.test(inviteId)) return null;
  const expiresAt = text(r.expiresAt) ?? "";
  const scope = DEVICE_SCOPES.includes(r.scope as DeviceScope) ? (r.scope as DeviceScope) : "full";
  const requestId = text(r.requestId);
  const shortCode = typeof r.shortCode === "string" && SHORT_CODE.test(r.shortCode) ? r.shortCode : null;
  const request: PairingRequest | null =
    requestId && shortCode
      ? {
          requestId,
          deviceName: (text(r.deviceName) ?? "").slice(0, 60),
          platform: PLATFORMS.includes(r.platform as PairingPlatform) ? (r.platform as PairingPlatform) : "other",
          shortCode,
          csrSha256: hex(r.csrSha256),
          keySha256: hex(r.keySha256),
          route: r.route === "direct" || r.route === "relay" ? r.route : null,
        }
      : null;
  return { inviteId, status: readStatus(r.status, expiresAt, now), expiresAt, userId: text(r.userId) ?? "owner", scope, label: text(r.label), deviceId: text(r.deviceId), request };
}

export function readPairingInvites(raw: unknown, now = Date.now()): PairingInvite[] {
  const list = raw && typeof raw === "object" ? (raw as { invites?: unknown }).invites : null;
  return Array.isArray(list) ? list.map((row) => readPairingInvite(row, now)).filter((row): row is PairingInvite => row !== null) : [];
}

export function readCreatedPairingInvite(raw: unknown, now = Date.now()): CreatedPairingInvite {
  const invite = readPairingInvite(raw, now);
  const r = (raw ?? {}) as Record<string, unknown>;
  const qr = text(r.qr);
  if (!invite || !qr || !qr.startsWith("cutex-pair:v2:")) throw new Error("malformed pairing invite reply");
  const payload = r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : {};
  const bootstrapOrigin = text(payload.bootstrapOrigin);
  const directUrls = Array.isArray(payload.directUrls) ? payload.directUrls.filter((u): u is string => typeof u === "string") : [];
  const relay = typeof r.relay === "boolean" ? r.relay : bootstrapOrigin !== null;
  return { invite, qr, relay, directUrls, bootstrapOrigin };
}
