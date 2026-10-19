// Desktop client presence and remote close (cutex capability `client-remote-close`; desktop contract
// docs/research/remote-close-desktop-20261019.md): wire types of `/v2/clients*`, the host events
// `cutex/client/closeRequested` / `cutex/client/stateChanged`, the body builders (only known fields
// reach cutex) and tolerant readers. Hand-written like users.ts until cutex exports its schemas.

export const CLIENT_REMOTE_CLOSE_FEATURE = "client-remote-close";
export const CLIENT_CLOSE_REQUESTED_EVENT = "cutex/client/closeRequested";
export const CLIENT_STATE_CHANGED_EVENT = "cutex/client/stateChanged";
/** What this app registers as (`appName`). */
export const DESKTOP_APP_NAME = "cutex-desktop";
/** A client instance / install id: a UUID or another short opaque token. */
export const CLIENT_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** cutex's default heartbeat when the reply omits / garbles it. */
export const DEFAULT_HEARTBEAT_SECONDS = 60;
/** The contract's countdown; the event may carry another. */
export const DEFAULT_CLOSE_GRACE_SECONDS = 15;

export type ClientState = "online" | "closeRequested" | "closing" | "cancelled";
export const CLIENT_STATES: readonly ClientState[] = ["online", "closeRequested", "closing", "cancelled"];
export type ClientClosingOutcome = "closing" | "cancelled";

/** `POST /v2/clients/presence` body (a repeat is the heartbeat). */
export interface ClientPresence {
  installId: string;
  instanceId: string;
  appName: string;
  appVersion: string;
  deviceName: string;
  platform: string;
  allowRemoteClose: boolean;
}

/** `POST /v2/clients/presence` reply. */
export interface ClientPresenceReply {
  instanceId: string;
  heartbeatSeconds: number;
}

/** One `GET /v2/clients` row. */
export interface OnlineClient {
  instanceId: string;
  installId: string;
  appName: string;
  appVersion: string;
  deviceName: string;
  platform: string;
  userId: string | null;
  tokenId: string | null;
  /** Registered over the host's own (root / loopback) credential. */
  local: boolean;
  connectedSince: string | null;
  lastSeen: string | null;
  allowRemoteClose: boolean;
  state: ClientState;
  /** cutex: this row is the caller's own registration. */
  current: boolean;
}

/** `cutex/client/closeRequested` params. */
export interface ClientCloseRequested {
  instanceId: string;
  requestedBy: { deviceName: string | null; userId: string | null; local: boolean };
  graceSeconds: number;
  at: string;
}

/** `cutex/client/stateChanged` params. */
export interface ClientStateChanged {
  instanceId: string;
  state: ClientState;
}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Bounded text for the presence body (cutex rejects overlong fields). */
export function clientPresenceBody(p: ClientPresence): ClientPresence {
  if (!CLIENT_INSTANCE_ID.test(p.installId)) throw new Error("bad install id");
  if (!CLIENT_INSTANCE_ID.test(p.instanceId)) throw new Error("bad instance id");
  return {
    installId: p.installId,
    instanceId: p.instanceId,
    appName: (str(p.appName, 64) ?? DESKTOP_APP_NAME),
    appVersion: str(p.appVersion, 64) ?? "0.0.0",
    deviceName: str(p.deviceName, 120) ?? "unknown",
    platform: str(p.platform, 32) ?? "unknown",
    allowRemoteClose: p.allowRemoteClose !== false,
  };
}

/** A presence reply: heartbeat clamped to 15 s … 10 min (absent / garbled: 60 s). */
export function readClientPresenceReply(raw: unknown, instanceId: string): ClientPresenceReply {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hb = typeof r.heartbeatSeconds === "number" && Number.isFinite(r.heartbeatSeconds) ? Math.min(600, Math.max(15, Math.round(r.heartbeatSeconds))) : DEFAULT_HEARTBEAT_SECONDS;
  return { instanceId: str(r.instanceId, 128) ?? instanceId, heartbeatSeconds: hb };
}

export function readClientState(value: unknown): ClientState {
  return CLIENT_STATES.includes(value as ClientState) ? (value as ClientState) : "online";
}

/** `GET /v2/clients`: rows without an instance id are dropped. */
export function readOnlineClients(raw: unknown): OnlineClient[] {
  const list = (raw as { clients?: unknown } | null)?.clients;
  if (!Array.isArray(list)) return [];
  const out: OnlineClient[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const instanceId = str(c.instanceId, 128);
    if (!instanceId) continue;
    out.push({
      instanceId,
      installId: str(c.installId, 128) ?? "",
      appName: str(c.appName, 64) ?? "",
      appVersion: str(c.appVersion, 64) ?? "",
      deviceName: str(c.deviceName, 120) ?? "",
      platform: str(c.platform, 32) ?? "",
      userId: str(c.userId, 128),
      tokenId: str(c.tokenId, 128),
      local: c.local === true,
      connectedSince: str(c.connectedSince, 64),
      lastSeen: str(c.lastSeen, 64),
      allowRemoteClose: c.allowRemoteClose !== false,
      state: readClientState(c.state),
      current: c.current === true,
    });
  }
  return out;
}

/** Grace seconds of a close request: 15 when absent; 3 … 120. */
export function closeGraceSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(120, Math.max(3, Math.round(value))) : DEFAULT_CLOSE_GRACE_SECONDS;
}

/** `cutex/client/closeRequested` params (any instance); null when malformed. */
export function readClientCloseRequested(params: unknown): ClientCloseRequested | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const instanceId = str(p.instanceId, 128);
  if (!instanceId) return null;
  const by = (p.requestedBy && typeof p.requestedBy === "object" ? p.requestedBy : {}) as Record<string, unknown>;
  return {
    instanceId,
    requestedBy: { deviceName: str(by.deviceName, 120), userId: str(by.userId, 128), local: by.local === true },
    graceSeconds: closeGraceSeconds(p.graceSeconds),
    at: str(p.at, 64) ?? new Date().toISOString(),
  };
}

/** `cutex/client/stateChanged` params; null when malformed. */
export function readClientStateChanged(params: unknown): ClientStateChanged | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const instanceId = str(p.instanceId, 128);
  if (!instanceId || !CLIENT_STATES.includes(p.state as ClientState)) return null;
  return { instanceId, state: p.state as ClientState };
}
