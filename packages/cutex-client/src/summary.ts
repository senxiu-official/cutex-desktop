// Mobile API (cutex `device-pairing`, `host-summary`): types of `POST /v2/pair`, `GET /v2/summary`
// and the `GET /v2/summary/events` stream (contract: docs/research/cutex-mobile-api.md §2, §4, §5).
// Hand-written like the rest of packages/protocol/src/cutex.ts until cutex exports its schemas.
import type { SseMessage } from "./sse";
import { SseParser } from "./sse";

export type DevicePlatform = "android" | "ios" | "web" | "other";

export interface PairRequest {
  /** `XXXX-XXXX` or the 8 characters without the dash (cutex normalises). */
  code: string;
  deviceName?: string;
  platform?: DevicePlatform;
}

export interface PairedDevice {
  tokenId: string;
  kind: "device" | "client" | string;
  label?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  createdAt?: string;
}

/** `POST /v2/pair` reply. `token` is shown only here. */
export interface PairResponse {
  device: PairedDevice;
  token: string;
  hostId: string;
  hostName: string;
  /** Persistent random id of this cutex instance (newer cutex); a better host key than hostId. */
  instanceId?: string | null;
}

/** `POST /v2/pairing-codes` reply (root or client token, loopback listener only). */
export interface PairingCode {
  /** `XXXX-XXXX`, single use, valid 10 minutes. The only secret the UI may show. */
  code: string;
  expiresAt: string;
  label?: string | null;
  hostId: string;
  /** Persisted random daemon id (newer cutex; optional). */
  instanceId?: string;
  /** One per active remote listener (+ MagicDNS name); empty when no remote listener is up. */
  urls: string[];
  /** `cutex-pair:v1?h=…&u=…&c=…` — the QR payload. */
  qr: string;
  /** cutex `owner-device-notice`: lifetime in seconds (owner codes 300, member codes 600; absent: older host). */
  ttlSeconds?: number;
  /** cutex `users`: the user the device will be bound to. */
  userId?: string | null;
  /** cutex `device-scope`: the paired device's scope (absent: older host = full). */
  scope?: import("./users").DeviceScope;
  /** cutex `owner-device-notice`: the code pairs a device with the owner's full rights. */
  ownerDevice?: boolean;
}

/** One `GET /v2/client-tokens` record (never the token itself). */
export interface ClientTokenRecord {
  tokenId: string;
  label: string;
  /** `client` = `client-token issue` (and old records), `device` = paired phone. */
  kind: "client" | "device" | string;
  deviceName?: string | null;
  platform?: string | null;
  /** cutex `client-token-rename`: the display name the owner gave this token (null / absent: none). */
  ownerName?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  lastAddress?: string | null;
  /** cutex `device-scope` (absent: older host). */
  scope?: import("./users").DeviceScope;
  /** cutex `owner-local-only` (absent: older host). */
  issuedVia?: import("./users").TokenIssuedVia;
}

/** cutex `client-token-rename`: `PATCH /v2/client-tokens/{id}` `{name}` (owner). */
export const CLIENT_TOKEN_RENAME_FEATURE = "client-token-rename";
/** Longest owner-given token name cutex takes (trimmed, no control characters). */
export const CLIENT_TOKEN_NAME_MAX = 60;

/** `PATCH /v2/client-tokens/{id}` reply. */
export interface ClientTokenRenamed {
  tokenId: string;
  ownerName: string | null;
}

export interface ClientTokenList {
  hostId?: string;
  tokens: ClientTokenRecord[];
}

export type SummaryAgentStatus = "working" | "idle" | "offline" | "needsInput";
/** owner-notify adds `ownerMessage` (a pending agent → owner message) and `ownerReply` (one that needs a reply); `id` = notificationId. */
export type SummaryNeedKind = "approval" | "question" | "input" | "ownerApproval" | "delegationReview" | "acceptance" | "ownerMessage" | "ownerReply";

/** `cutex/summary/messageToOwner` params (owner-notify; once per record whose channels contain `phone`). */
export interface SummaryMessageToOwner {
  /** agentId (cutexSessionId) */
  id: string;
  notificationId: string;
  preview: string;
  level: "info" | "attention" | "urgent";
  needsReply: boolean;
}

export interface SummaryNeed {
  kind: SummaryNeedKind | string;
  id: string;
  title: string;
  at: string;
}

export interface SummaryLastTurn {
  turnId: string;
  status: "completed" | "failed" | "interrupted" | string;
  endedAt: string;
}

export interface SummaryAgent {
  /** cutexSessionId */
  id: string;
  name: string;
  /** `chat` = owner-owned session (not a registered agent). Older builds may omit it. */
  kind?: "agent" | "chat" | string;
  projectId: string | null;
  provider: string;
  status: SummaryAgentStatus;
  needs: SummaryNeed[];
  preview: string | null;
  /** Last real conversation activity (cutex session-conversation-activity; older cutex: also runtime events / updatedAt). */
  lastActivityAt: string | null;
  lastTurn: SummaryLastTurn | null;
  unreadTurns: number;
}

export interface SummaryProject {
  id: string;
  name: string;
  color: string | null;
}

export interface SummaryCursor {
  streamId: string;
  /** Summary journal sequence (decimal string; "0" while the journal is empty). */
  after: string;
}

/** `GET /v2/summary`. */
export interface HostSummary {
  hostId: string;
  hostName: string;
  /** Persistent random id of this cutex instance (newer cutex). */
  instanceId?: string | null;
  capabilities: string[];
  cursor: SummaryCursor;
  generatedAt?: string;
  projects: SummaryProject[];
  agents: SummaryAgent[];
  needsYouCount: number;
}

/** `POST /v2/summary/read` (capability `summary-read`). */
export interface SummaryReadResult {
  agentId: string;
  readAt: string;
  /** The summary thread will clear `unreadTurns` (announced as `cutex/summary/agentChanged`). */
  summaryQueued: boolean;
  /** An unacknowledged notification reminder was acknowledged by this call. */
  notificationAcknowledged: boolean;
  /** owner-notify: open agent → owner messages of this agent acknowledged by this call (absent on older cutex). */
  ownerMessagesAcknowledged?: number;
}

/** Event names of `GET /v2/summary/events` (plus the shared error / revoke frames). */
export const SUMMARY_EVENTS = {
  agentChanged: "cutex/summary/agentChanged",
  agentRemoved: "cutex/summary/agentRemoved",
  turnEnded: "cutex/summary/turnEnded",
  messageToOwner: "cutex/summary/messageToOwner",
  approvalsChanged: "cutex/summary/approvalsChanged",
  asksChanged: "cutex/summary/asksChanged",
  resync: "cutex/summary/resync",
  deviceRevoked: "cutex/device/revoked",
  /** users: the token's user or grant changed; reconnect and re-read (not a revoke). */
  accessChanged: "cutex/access/changed",
  streamError: "cutex_management_stream_error",
} as const;

/** Read an SSE response body as messages; comment lines (`: keepalive`) go to `onComment`. */
export async function* readSse(response: Response, onComment?: (text: string) => void): AsyncGenerator<SseMessage> {
  if (!response.body) return;
  const parser = new SseParser(onComment);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const message of parser.push(decoder.decode(value, { stream: true }))) yield message;
    }
  } finally {
    // Early exit (consumer stopped iterating): close the connection.
    void reader.cancel().catch(() => undefined);
  }
}
