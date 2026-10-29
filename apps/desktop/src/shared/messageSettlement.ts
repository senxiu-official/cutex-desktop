import type { MessageSettlement } from "@cutex-desktop/protocol";
import { deviceScopeOf, isOwnerFeatures, type HostUserAccess } from "./users";

export const MESSAGE_SETTLEMENT_FEATURE = "agent-bus-message-settlement-v1";
export const MESSAGE_SETTLEMENT_EVENT = "cutex/agentBus/messageSettlementUpdated";

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
  if (e.runtime !== "claude" || !["completed", "failed", "interrupted"].includes(e.terminalStatus)
    || typeof e.observedAt !== "string" || !Number.isFinite(Date.parse(e.observedAt))) return undefined;
  if (![e.runtime, e.threadId, e.actualTurnId, e.terminalStatus, e.observedAt].every((v) => typeof v === "string" && v.length > 0)
    || !Number.isSafeInteger(e.runtimeGeneration) || e.runtimeGeneration < 0) return undefined;
  if (s.closure !== null && (!s.closure || typeof s.closure !== "object"
    || ![s.closure.actor, s.closure.closedAt, s.closure.reason, s.closure.requestId].every((v) => typeof v === "string" && v.length > 0))) return undefined;
  if (s.state === "closed" ? (!s.closure || s.canClose || !Number.isFinite(Date.parse(s.closure.closedAt))) : s.closure !== null) return undefined;
  return {
    state: s.state, canClose: s.canClose, evidenceToken: s.evidenceToken,
    evidence: { runtime: e.runtime, runtimeGeneration: e.runtimeGeneration, threadId: e.threadId, actualTurnId: e.actualTurnId, terminalStatus: e.terminalStatus, observedAt: e.observedAt },
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
