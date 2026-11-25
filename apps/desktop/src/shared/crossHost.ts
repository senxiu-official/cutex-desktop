// Cross-host delivery receipts (cutex `peer-delivery-receipts-v1`, docs/PEERS.md "Management and tool delivery
// receipts", desktop spec docs/development/r296-crosshost-desktop.md): peer delegation views, result items, peer
// message views and agent-bus events may carry `crossHost {direction, peer {instanceId, label}, receipt {state,
// reason, confirmedAt}}`. The direction is from the daemon that issued the record; `peer.label` is that daemon's name
// snapshot of the peer; `confirmedAt` is its last confirmation of the receipt (null = no proof). Read defensively:
// a malformed object is no receipt (the record then shows what it showed before); unknown state / reason strings are
// kept so the detail can show them.

/** The capability (`features.peerDeliveryReceiptsV1`). */
export const PEER_RECEIPTS_FEATURE = "peer-delivery-receipts-v1";

export const RECEIPT_STATES = ["queuedAtSource", "deliveredToPeer", "accepted", "failed", "outcomeUnknown"] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];

export const RECEIPT_REASONS = [
  "sourceRoutingRefused", "destinationRoutingRefused", "peerRefusedUnspecified", "peerUnreachable", "peerCredentialRefused",
  "peerIdentityChanged", "peerVersionMismatch", "peerRemoved", "peerDisabled", "peerRejectedRequest", "destinationRejected",
  "destinationFailed", "cancelled", "interrupted", "outcomeUnknown",
] as const;
export type ReceiptReason = (typeof RECEIPT_REASONS)[number];

export interface CrossHost {
  direction: "inbound" | "outbound";
  peer: { instanceId: string; label: string };
  receipt: {
    state: ReceiptState | (string & {});
    reason: ReceiptReason | (string & {}) | null;
    confirmedAt: string | null;
  };
}

/** A cutex instance id (`ci-` + 32 hex). */
export const INSTANCE_ID = /^ci-[0-9a-fA-F]{32}$/;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

/** The `crossHost` of a wire record, null when absent or malformed. */
export function asCrossHost(raw: unknown): CrossHost | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as { direction?: unknown; peer?: unknown; receipt?: unknown };
  if (o.direction !== "inbound" && o.direction !== "outbound") return null;
  const peer = (o.peer && typeof o.peer === "object" ? o.peer : {}) as { instanceId?: unknown; label?: unknown };
  const receipt = (o.receipt && typeof o.receipt === "object" ? o.receipt : null) as { state?: unknown; reason?: unknown; confirmedAt?: unknown } | null;
  if (typeof peer.instanceId !== "string" || !INSTANCE_ID.test(peer.instanceId) || !receipt) return null;
  const state = text(receipt.state, 64);
  if (!state) return null;
  const at = typeof receipt.confirmedAt === "string" && Number.isFinite(Date.parse(receipt.confirmedAt)) ? receipt.confirmedAt : null;
  return {
    direction: o.direction,
    peer: { instanceId: peer.instanceId, label: text(peer.label, 128) ?? "" },
    receipt: { state, reason: text(receipt.reason, 64), confirmedAt: at },
  };
}

/** Same receipt (for keeping identities stable when a record is merged again). */
export function sameCrossHost(a: CrossHost | null | undefined, b: CrossHost | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.direction === b.direction && a.peer.instanceId === b.peer.instanceId && a.peer.label === b.peer.label
    && a.receipt.state === b.receipt.state && a.receipt.reason === b.receipt.reason && a.receipt.confirmedAt === b.receipt.confirmedAt;
}

const RANK: Record<string, number> = { queuedAtSource: 0, outcomeUnknown: 0, deliveredToPeer: 1, accepted: 2, failed: 2 };

/**
 * The receipt to keep when two observations of one record meet (events and snapshots arrive in any order): the
 * incoming one unless it is older (an earlier confirmation) or goes back (a late "queued" after "delivered"; a final
 * state is not revived by a late observation).
 */
export function newerCrossHost(prev: CrossHost | null | undefined, next: CrossHost | null | undefined): CrossHost | null {
  if (!next) return prev ?? null;
  if (!prev) return next;
  const a = prev.receipt.confirmedAt ? Date.parse(prev.receipt.confirmedAt) : NaN;
  const b = next.receipt.confirmedAt ? Date.parse(next.receipt.confirmedAt) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b) && b < a) return prev;
  if ((RANK[next.receipt.state] ?? 0) < (RANK[prev.receipt.state] ?? 0)) return prev;
  return sameCrossHost(prev, next) ? prev : next;
}
