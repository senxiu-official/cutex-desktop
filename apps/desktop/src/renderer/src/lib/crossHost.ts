// Cross-host receipts and hosts for display (cutex peer-delivery-receipts-v1; shared/crossHost reads the wire). Pure:
// which receipt / reason words a record gets, whether the host of the record has receipts at all (gated per host and
// per record: an older host or an older record keeps today's display), and which connected host of this desktop is
// the peer — matched only by the Management instance id, never by a name, so two hosts with the same name (or two
// homes on one machine) stay apart and an old record never opens a connection of another identity.
import { asCrossHost, INSTANCE_ID, PEER_RECEIPTS_FEATURE, RECEIPT_REASONS, RECEIPT_STATES, type CrossHost, type ReceiptReason, type ReceiptState } from "../../../shared/crossHost";
import { hostDaemon, type ScopeSource } from "./hostScope";

export { PEER_RECEIPTS_FEATURE, type CrossHost };

/** The record's receipt when its host has receipts and the record carries one; null keeps the older display. */
export function crossHostOf(record: { crossHost?: unknown } | null | undefined, features: ReadonlySet<string> | null | undefined): CrossHost | null {
  if (!record || !features?.has(PEER_RECEIPTS_FEATURE)) return null;
  return asCrossHost(record.crossHost);
}

/** A receipt state as a `crossHost.receipt.*` key suffix; `unknown` for a state this desktop does not know. */
export function receiptKey(state: string): ReceiptState | "unknown" {
  return (RECEIPT_STATES as readonly string[]).includes(state) ? (state as ReceiptState) : "unknown";
}

/**
 * The short words for a reason (a full message key): the route reasons have their own; cancelled / interrupted /
 * outcomeUnknown reuse the delegation's short states. `unknown` (with the raw code as `{code}`) for a newer reason.
 */
export function reasonMessageKey(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "cancelled" || reason === "interrupted" || reason === "outcomeUnknown") return `delegation.status.${reason}`;
  if ((RECEIPT_REASONS as readonly string[]).includes(reason)) return `crossHost.reason.${reason as ReceiptReason}`;
  return "crossHost.reason.unknown";
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The receipt's short word, and its reason's (null without one): the same words in a list row and in the detail. */
export function receiptWords(t: Translate, ch: CrossHost): { state: string; reason: string | null } {
  const k = receiptKey(ch.receipt.state);
  // A reason that only repeats the state (outcomeUnknown / outcomeUnknown) adds nothing.
  const reasonKey = ch.receipt.reason === ch.receipt.state ? null : reasonMessageKey(ch.receipt.reason);
  return {
    state: t(`crossHost.receipt.${k}`, { code: ch.receipt.state }),
    reason: reasonKey ? t(reasonKey, { code: ch.receipt.reason ?? "" }) : null,
  };
}

export type ReceiptTone ="muted" | "accent" | "green" | "warn" | "danger";

/** How loud the receipt line is: a failure is danger; unconfirmed, or waiting with a reason, warns. */
export function receiptTone(ch: CrossHost): ReceiptTone {
  const k = receiptKey(ch.receipt.state);
  if (k === "failed") return "danger";
  if (k === "outcomeUnknown" || k === "unknown") return "warn";
  if (k === "queuedAtSource") return ch.receipt.reason ? "warn" : "muted";
  return k === "accepted" ? "green" : "accent";
}

/** A receipt worth showing in a list row (the row keeps its main status; these add the receipt's word). */
export function receiptNeedsNotice(ch: CrossHost): boolean {
  return receiptTone(ch) === "warn" || receiptTone(ch) === "danger";
}

/** The connected host of this desktop whose Management instance id is `instanceId` (null: none is connected). */
export function peerHostIn(source: ScopeSource, instanceId: string | null | undefined): { hostId: string; label: string } | null {
  if (!instanceId || !INSTANCE_ID.test(instanceId)) return null;
  for (const view of source.hosts?.hosts ?? []) {
    const d = hostDaemon(source, view.id);
    if (d?.kind === "connected" && d.instanceId === instanceId) return { hostId: view.id, label: view.label };
  }
  return null;
}

export interface PeerHostView {
  /** The name to show: the connected host's current name, else the record's snapshot. */
  name: string;
  /** The connected host it is (open the other side there); null = not connected on this desktop. */
  hostId: string | null;
  /** Another host of this desktop has the same name: show the full instance id in the hover. */
  ambiguous: boolean;
  instanceId: string;
}

/** What a record's peer reads as on this desktop (`snapshot`: the issuing daemon's label for it). */
export function peerHostView(source: ScopeSource, instanceId: string, snapshot: string): PeerHostView {
  const match = peerHostIn(source, instanceId);
  const name = match?.label || snapshot || instanceId;
  const ambiguous = (source.hosts?.hosts ?? []).some((h) => h.id !== match?.hostId && h.label.trim().toLowerCase() === name.trim().toLowerCase());
  return { name, hostId: match?.hostId ?? null, ambiguous, instanceId };
}
