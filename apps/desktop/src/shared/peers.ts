// Cross-host peers (cutex `peers-v2`, P0.1; cutex docs/PEERS.md, schema export `peers`): paired
// cutex instances delegate to `name@label`. Wire shapes of `/v2/peers*`, the `/v2/settings` `peers`
// section and the host event `cutex/peers/changed`, plus the body builders main uses so only known
// fields reach cutex (cutex validates again and rejects unknown keys). Root credential only; writes
// are loopback-only on the daemon side (403 `loopback_only`). No credential ever passes here: the
// invite code is a one-time pairing code, peer tokens never leave cutex.
//
// P1 (docs/handoff/gpt-accounts.md) will bind each peer to a local user and move exports / accept /
// review onto that user's grant; `userId` is carried through untouched for that.

import type { CutexRefusal } from "./ipc";

export const PEERS_FEATURE = "peers-v2";
export const PEERS_CHANGED_EVENT = "cutex/peers/changed";
/** A peer's id = the remote durable instance id. */
export const PEER_ID = /^ci-[a-fA-F0-9]{32}$/;
/** cutex peer label (`^[a-z0-9-]{1,32}$`). */
export const PEER_LABEL = /^[a-z0-9-]{1,32}$/;
export const PEER_URLS_MAX = 8;

export type PeerState = "pending" | "online" | "unreachable" | "credentialRejected" | "identityChanged" | "versionMismatch" | "disabled" | "removedByPeer";
export const PEER_STATES: readonly PeerState[] = ["pending", "online", "unreachable", "credentialRejected", "identityChanged", "versionMismatch", "disabled", "removedByPeer"];

export type PeerExport = { all: true } | { agent: string } | { project: string };
export type PeerReview = "always" | "ifTargetWider" | "never";
export const PEER_REVIEWS: readonly PeerReview[] = ["always", "ifTargetWider", "never"];
export type PeerVisibility = "none" | "all";

export interface PeerCaps {
  /** Sandbox name (read-only / workspace-write / danger-full-access …); null = unknown. */
  sandbox: string | null;
  networkAccess: boolean;
  unrestrictedServices: boolean;
}

export interface PeerPolicy {
  inbound: {
    exports: PeerExport[];
    accept: boolean;
    review: PeerReview;
    assumedCaps: PeerCaps;
    maxOpenAsks: number;
    asksPerHour: number;
  };
  outbound: { visibility: PeerVisibility };
}

export const PEER_POLICY_DEFAULT: PeerPolicy = {
  inbound: { exports: [], accept: true, review: "always", assumedCaps: { sandbox: "read-only", networkAccess: false, unrestrictedServices: false }, maxOpenAsks: 20, asksPerHour: 60 },
  outbound: { visibility: "none" },
};
export const PEER_LIMITS = { maxOpenAsks: [1, 10_000], asksPerHour: [1, 100_000] } as const;

export interface PeerError {
  code: string;
  message?: string | null;
  details?: Record<string, unknown> | null;
}

/** One `GET /v2/peers` item (fields the desktop reads; unknown ones pass through). */
export interface PeerView {
  id: string;
  label: string;
  hostId: string;
  platform: string;
  urls: string[];
  enabled: boolean;
  protocol?: number;
  state: PeerState | (string & {});
  createdAt?: string;
  lastSeenAt?: string | null;
  lastError?: PeerError | null;
  nextProbeAt?: string | null;
  features?: { declared: string[]; negotiated: string[] };
  outboxPending?: number;
  /** Stable time of the oldest queued operation / event; the age is computed locally. */
  outboxOldestAt?: string | null;
  deadLetterCount?: number;
  inflight?: { outbound: number; inbound: number };
  policy: PeerPolicy;
  policyRevision?: number;
  /** P1: the local user this peer is bound to (P0.1: always "owner"). */
  userId?: string;
  [key: string]: unknown;
}

export interface PeerList {
  peers: PeerView[];
}

/** `POST /v2/peers/invites` reply: hand `code` + one of `urls` to the other host. */
export interface PeerInvite {
  code: string;
  expiresAt: string;
  instanceId: string;
  hostId: string;
  urls: string[];
}

export interface PeerRemoteAgent {
  cutexSessionId: string;
  name: string | null;
  short: string;
  status: "idle" | "busy" | "offline" | (string & {});
  runtime: "codex" | "claude" | (string & {});
}

/** `GET /v2/peers/{id}/agents`: the refreshed directory, or the last cached one on failure. */
export interface PeerAgents {
  fetchedAt: string | null;
  agents: PeerRemoteAgent[];
}

export interface PeerAuditEntry {
  ts: string;
  direction: string;
  peerId?: string | null;
  label?: string | null;
  route: string;
  askId?: string | null;
  opId?: string | null;
  eventIds?: string[];
  status: number;
  code?: string | null;
  bytes: number;
  actingUser?: string | null;
}

/** `/v2/settings` → `peers`. */
export interface PeersSettings {
  enabled: boolean;
  outboxMaxAgeHours: number;
  maxHops: number;
  refreshAgentsSecs: number;
  connectTimeoutSecs: number;
  readTimeoutSecs: number;
}
export type PeersSettingsPatch = Partial<PeersSettings>;
export const PEERS_SETTINGS_RANGE: Record<Exclude<keyof PeersSettings, "enabled">, readonly [number, number]> = {
  outboxMaxAgeHours: [1, 720],
  maxHops: [1, 8],
  refreshAgentsSecs: [10, 3600],
  connectTimeoutSecs: [1, 60],
  readTimeoutSecs: [1, 300],
};
export const PEERS_SETTINGS_DEFAULT: PeersSettings = { enabled: false, outboxMaxAgeHours: 24, maxHops: 3, refreshAgentsSecs: 60, connectTimeoutSecs: 5, readTimeoutSecs: 30 };

/** `PATCH /v2/peers/{id}`: `policy` merges per field; `inbound.exports` and `assumedCaps` replace whole. */
export interface PeerPatch {
  label?: string;
  urls?: string[];
  enabled?: boolean;
  policy?: { inbound?: Partial<PeerPolicy["inbound"]>; outbound?: Partial<PeerPolicy["outbound"]> };
}

export type PeerResult<T> = { ok: true; value: T } | { ok: false; error: CutexRefusal };

// ---------- body builders (main): only known fields, well-typed values ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const shortStr = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

function exportsBody(v: unknown): PeerExport[] | null {
  if (!Array.isArray(v) || v.length > 1000) return null;
  const out: PeerExport[] = [];
  for (const e of v) {
    if (!isObj(e)) return null;
    if (e.all === true) out.push({ all: true });
    else if (shortStr(e.agent, 200)) out.push({ agent: e.agent as string });
    else if (shortStr(e.project, 200)) out.push({ project: e.project as string });
    else return null;
  }
  return out;
}

function capsBody(v: unknown): PeerCaps | null {
  if (!isObj(v)) return null;
  const sandbox = v.sandbox === null ? null : shortStr(v.sandbox, 64);
  if (sandbox === null && v.sandbox !== null) return null;
  if (typeof v.networkAccess !== "boolean" || typeof v.unrestrictedServices !== "boolean") return null;
  return { sandbox, networkAccess: v.networkAccess, unrestrictedServices: v.unrestrictedServices };
}

const intIn = (v: unknown, [lo, hi]: readonly [number, number]): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** The PATCH body with only known, well-typed fields (throws on a malformed value instead of dropping it). */
export function peerPatchBody(patch: unknown): PeerPatch {
  if (!isObj(patch)) throw new Error("bad peer patch");
  const body: PeerPatch = {};
  if ("label" in patch) {
    if (typeof patch.label !== "string" || !PEER_LABEL.test(patch.label)) throw new Error("bad peer label");
    body.label = patch.label;
  }
  if ("urls" in patch) {
    const urls = patch.urls;
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > PEER_URLS_MAX || urls.some((u) => !shortStr(u, 300))) throw new Error("bad peer urls");
    body.urls = urls as string[];
  }
  if ("enabled" in patch) {
    if (typeof patch.enabled !== "boolean") throw new Error("bad peer enabled");
    body.enabled = patch.enabled;
  }
  if ("policy" in patch) {
    const p = patch.policy;
    if (!isObj(p)) throw new Error("bad peer policy");
    const policy: NonNullable<PeerPatch["policy"]> = {};
    if ("inbound" in p) {
      const i = p.inbound;
      if (!isObj(i)) throw new Error("bad peer policy");
      const inbound: Partial<PeerPolicy["inbound"]> = {};
      if ("exports" in i) {
        const e = exportsBody(i.exports);
        if (!e) throw new Error("bad peer exports");
        inbound.exports = e;
      }
      if ("accept" in i) {
        if (typeof i.accept !== "boolean") throw new Error("bad peer accept");
        inbound.accept = i.accept;
      }
      if ("review" in i) {
        if (!PEER_REVIEWS.includes(i.review as PeerReview)) throw new Error("bad peer review");
        inbound.review = i.review as PeerReview;
      }
      if ("assumedCaps" in i) {
        const c = capsBody(i.assumedCaps);
        if (!c) throw new Error("bad peer caps");
        inbound.assumedCaps = c;
      }
      if ("maxOpenAsks" in i) {
        if (!intIn(i.maxOpenAsks, PEER_LIMITS.maxOpenAsks)) throw new Error("bad maxOpenAsks");
        inbound.maxOpenAsks = i.maxOpenAsks;
      }
      if ("asksPerHour" in i) {
        if (!intIn(i.asksPerHour, PEER_LIMITS.asksPerHour)) throw new Error("bad asksPerHour");
        inbound.asksPerHour = i.asksPerHour;
      }
      policy.inbound = inbound;
    }
    if ("outbound" in p) {
      const o = p.outbound;
      if (!isObj(o) || (o.visibility !== "none" && o.visibility !== "all")) throw new Error("bad peer visibility");
      policy.outbound = { visibility: o.visibility };
    }
    body.policy = policy;
  }
  return body;
}

/** `PATCH /v2/settings {peers}` body: known keys within range only. */
export function peersSettingsBody(patch: unknown): PeersSettingsPatch {
  if (!isObj(patch)) throw new Error("bad peers settings");
  const body: PeersSettingsPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "enabled") {
      if (typeof value !== "boolean") throw new Error("bad peers.enabled");
      body.enabled = value;
    } else if (key in PEERS_SETTINGS_RANGE) {
      const k = key as keyof typeof PEERS_SETTINGS_RANGE;
      if (!intIn(value, PEERS_SETTINGS_RANGE[k])) throw new Error(`bad peers.${key}`);
      body[k] = value;
    } else throw new Error(`unknown peers setting: ${key}`);
  }
  return body;
}

/** `POST /v2/peers/invites` body. */
export function peerInviteBody(request: unknown): { label?: string } {
  if (request === undefined || request === null) return {};
  if (!isObj(request)) throw new Error("bad invite");
  if (request.label === undefined || request.label === null || request.label === "") return {};
  if (typeof request.label !== "string" || !PEER_LABEL.test(request.label)) throw new Error("bad peer label");
  return { label: request.label };
}

/** `POST /v2/peers` body (the URL / code are checked by cutex; here only shape and size). */
export function peerAddBody(request: unknown): { url: string; code: string; label?: string } {
  if (!isObj(request)) throw new Error("bad peer request");
  const url = shortStr(typeof request.url === "string" ? request.url.trim() : null, 300);
  const code = shortStr(typeof request.code === "string" ? request.code.trim() : null, 64);
  if (!url || !code) throw new Error("url and code are required");
  const label = typeof request.label === "string" && request.label.trim() ? request.label.trim() : null;
  if (label !== null && !PEER_LABEL.test(label)) throw new Error("bad peer label");
  return { url, code, ...(label ? { label } : {}) };
}
