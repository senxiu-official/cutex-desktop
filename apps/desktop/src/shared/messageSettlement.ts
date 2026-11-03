import type { MessageSettlement as BaseMessageSettlement } from "@cutex-desktop/protocol";
import { deviceScopeOf, isOwnerFeatures, type HostUserAccess } from "./users";

export const MESSAGE_SETTLEMENT_FEATURE = "agent-bus-message-settlement-v1";
export const STALE_ACK_SETTLEMENT_FEATURE = "agent-bus-stale-ack-settlement-v1";
export const MESSAGE_SETTLEMENT_EVENT = "cutex/agentBus/messageSettlementUpdated";
export type MessageSettlement = BaseMessageSettlement & { evidence: BaseMessageSettlement["evidence"] & {
  staleAck?: { queuedAt: string; acceptedAt: string; minWaitSecs: 300; nativeAttemptId?: string | null; laterCompletedTurnId?: string | null };
} };

/** This is an owner mutation, including when a stale row still carries canClose. */
export function messageSettlementAllowed(features: ReadonlySet<string>, access: HostUserAccess): boolean {
  return features.has(MESSAGE_SETTLEMENT_FEATURE) && isOwnerFeatures(features)
    && access.isOwner && !access.pending && (deviceScopeOf(access) ?? "full") === "full";
}

/** Accept only explicit server evidence. No interpretation of receipts, age or message text. */
export function readMessageSettlement(raw: unknown): MessageSettlement | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as MessageSettlement;
  if (s.state !== "outcome_unknown" && s.state !== "closed") return undefined;
  if (typeof s.canClose !== "boolean" || typeof s.evidenceToken !== "string" || !s.evidenceToken || !s.evidence || typeof s.evidence !== "object") return undefined;
  const e = s.evidence;
  const stale = e.staleAck;
  if (stale !== undefined && (!stale || typeof stale !== "object" || typeof stale.queuedAt !== "string"
    || !Number.isFinite(Date.parse(stale.queuedAt)) || stale.minWaitSecs !== 300
    || typeof stale.acceptedAt !== "string" || !Number.isFinite(Date.parse(stale.acceptedAt))
    || (stale.nativeAttemptId !== undefined && stale.nativeAttemptId !== null && (typeof stale.nativeAttemptId !== "string" || !stale.nativeAttemptId))
    || (stale.laterCompletedTurnId !== undefined && stale.laterCompletedTurnId !== null && (typeof stale.laterCompletedTurnId !== "string" || !stale.laterCompletedTurnId)))) return undefined;
  if (e.runtime !== "claude" || !(["completed", "failed", "interrupted"].includes(e.terminalStatus) || (["inProgress", "unknown"].includes(e.terminalStatus) && !!stale?.laterCompletedTurnId))
    || typeof e.observedAt !== "string" || !Number.isFinite(Date.parse(e.observedAt))) return undefined;
  if (![e.runtime, e.threadId, e.actualTurnId, e.terminalStatus, e.observedAt].every((v) => typeof v === "string" && v.length > 0)
    || !Number.isSafeInteger(e.runtimeGeneration) || e.runtimeGeneration < 0) return undefined;
  if (s.closure !== null && (!s.closure || typeof s.closure !== "object"
    || ![s.closure.actor, s.closure.closedAt, s.closure.reason, s.closure.requestId].every((v) => typeof v === "string" && v.length > 0))) return undefined;
  if (s.state === "closed" ? (!s.closure || s.canClose || !Number.isFinite(Date.parse(s.closure.closedAt))) : s.closure !== null) return undefined;
  return {
    state: s.state, canClose: s.canClose, evidenceToken: s.evidenceToken,
    evidence: { runtime: e.runtime, runtimeGeneration: e.runtimeGeneration, threadId: e.threadId, actualTurnId: e.actualTurnId, terminalStatus: e.terminalStatus, observedAt: e.observedAt, ...(stale ? { staleAck: { queuedAt: stale.queuedAt, acceptedAt: stale.acceptedAt, minWaitSecs: stale.minWaitSecs, ...(stale.nativeAttemptId !== undefined ? { nativeAttemptId: stale.nativeAttemptId } : {}), ...(stale.laterCompletedTurnId !== undefined ? { laterCompletedTurnId: stale.laterCompletedTurnId } : {}) } } : {}) },
    closure: s.closure ? { actor: s.closure.actor, closedAt: s.closure.closedAt, reason: s.closure.reason, requestId: s.closure.requestId } : null,
  };
}

/** Closing is durable even if a late receipt or an older replay follows it. */
export function mergeMessageSettlement(previous: MessageSettlement | undefined, incoming: MessageSettlement | undefined): MessageSettlement | undefined {
  if (!incoming) return previous;
  if (previous?.state === "closed") return previous;
  if (previous && incoming.state !== "closed" && Date.parse(previous.evidence.observedAt) > Date.parse(incoming.evidence.observedAt)) return previous;
  return previous && JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}
