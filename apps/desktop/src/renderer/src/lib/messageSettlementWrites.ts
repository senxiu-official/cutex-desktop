// Per-host in-flight intents outlive a row/popover unmount. An uncertain operation keeps its exact
// key, evidence and reason until a read proves closure or a definitive refusal resolves it.
import { create } from "zustand";
import type { MessageSettlement, MessageSettlementCloseRequest } from "@cutex-desktop/protocol";
import { apiFor } from "../bridge";
import { useAgentMessages } from "./agentMessageStore";
import { featuresOf, useApp } from "../store";
import { hostAccessNow } from "./hostAccess";
import { messageSettlementAllowed, mergeMessageSettlement, readMessageSettlement } from "../../../shared/messageSettlement";

export interface SettlementWrite {
  phase: "pending" | "uncertain" | "error" | "done";
  request?: MessageSettlementCloseRequest;
  settlement?: MessageSettlement;
  checked?: boolean;
  /** Distinguishes authoritative absence from a cache entry that has never been read. */
  authoritative?: boolean;
  error?: "conflict" | "unauthorized" | "missing" | "unavailable" | "unknown";
}

// Only contracted prewrite refusals resolve an intent. A proxy's http_4xx, a new/unknown code,
// throttling or a timeout is not proof that the close did not commit.
const DEFINITIVE_REFUSALS: Record<number, readonly string[]> = {
  400: ["invalid_request"],
  401: ["unauthorized", "unauthenticated"],
  403: ["forbidden", "owner_required", "owner_only", "owner_local_only", "device_scope_denied"],
  404: ["message_not_found", "not_found"],
  405: ["method_not_allowed"],
  409: ["message_protected", "message_not_closable", "settlement_not_closable", "settlement_evidence_missing", "settlement_evidence_changed", "settlement_evidence_expired", "settlement_runtime_changed", "request_id_conflict"],
};

export const settlementWriteKey = (hostId: string, messageId: string) => JSON.stringify([hostId, messageId]);
const INTENTS_KEY = "cutex-desktop.messageSettlementIntents.v1";
function restoredIntents(): Record<string, SettlementWrite> {
  try {
    const saved = JSON.parse(localStorage.getItem(INTENTS_KEY) ?? "{}") as Record<string, MessageSettlementCloseRequest>;
    const entries: Record<string, SettlementWrite> = {};
    for (const [key, request] of Object.entries(saved)) {
      const route = JSON.parse(key) as unknown;
      if (!Array.isArray(route) || route.length !== 2 || !route.every((v) => typeof v === "string") || route[1] !== request?.messageId) continue;
      if (![request.messageId, request.expectedEvidenceToken, request.requestId, request.reason].every((v) => typeof v === "string" && !!v.trim())) continue;
      entries[key] = { phase: "uncertain", request, checked: false, error: "unknown" };
    }
    return entries;
  } catch {
    return {};
  }
}
export const useSettlementWrites = create<{ entries: Record<string, SettlementWrite> }>(() => ({ entries: restoredIntents() }));
function put(key: string, entry: SettlementWrite) {
  useSettlementWrites.setState((s) => ({ entries: { ...s.entries, [key]: entry } }));
  try {
    // Retain only unresolved immutable client intents, not a second copy of server business state.
    const intents = Object.fromEntries(Object.entries(useSettlementWrites.getState().entries).filter(([, e]) => e.request).map(([id, e]) => [id, e.request]));
    localStorage.setItem(INTENTS_KEY, JSON.stringify(intents));
  } catch {
    // The in-memory intent still protects explicit retries if storage is unavailable.
  }
}

// Stream clears/delivery confirmations and full bootstrap projections also invalidate local write
// eligibility. Keep an unresolved intent intact; a projection update is never a resend or success.
useAgentMessages.subscribe((state, previous) => {
  for (const [key, entry] of Object.entries(useSettlementWrites.getState().entries)) {
    const [, messageId] = JSON.parse(key) as [string, string];
    const record = state.byId[messageId];
    const before = previous.byId[messageId];
    if (!record?.settlementKnown || (record.settlement === before?.settlement && record.settlementKnown === before?.settlementKnown)) continue;
    const closed = record.settlement?.state === "closed";
    put(key, { ...entry, settlement: record.settlement, authoritative: true, checked: !!record.settlement && !!entry.checked,
      ...(closed ? { phase: "done", request: undefined } : {}) });
  }
});

function publish(messageId: string, settlement: MessageSettlement) {
  useAgentMessages.getState().applySettlement(messageId, settlement);
}

async function refreshAdmission(hostId: string, sessionId?: string) {
  if (sessionId) await useApp.getState().refreshAdmission(sessionId, hostId);
}

/** A missing row is not proof of success. Only an explicit closed settlement proves closure. */
export async function recheckSettlement(hostId: string, messageId: string, sessionId?: string, explicit = true): Promise<void> {
  const key = settlementWriteKey(hostId, messageId);
  const before = useSettlementWrites.getState().entries[key];
  if (!before || before.phase === "pending") return;
  put(key, { ...before, phase: "pending" });
  const api = apiFor(hostId);
  const reads = await Promise.allSettled([
    api.stuckBusMessages(0),
    sessionId ? api.bootstrap(sessionId) : Promise.resolve(null),
    refreshAdmission(hostId, sessionId),
  ]);
  let settlement: MessageSettlement | undefined;
  let authoritative = false;
  const list = reads[0];
  if (list.status === "fulfilled" && list.value) {
    authoritative = true;
    settlement = readMessageSettlement(list.value.messages.find((m) => m.messageId === messageId)?.settlement);
  }
  const boot = reads[1];
  if (boot.status === "fulfilled" && boot.value) {
    authoritative = true;
    const state = boot.value.cutexState;
    // Bootstrap is the message's authoritative snapshot, including explicit absence of a sidecar.
    const listClosure = settlement?.state === "closed" ? settlement : undefined;
    settlement = undefined;
    for (const raw of [...(state.agentBusMessages ?? []), ...(state.agentBusSentMessages ?? [])]) {
      const m = raw as { messageId?: string; settlement?: unknown };
      if (m.messageId === messageId) settlement = mergeMessageSettlement(settlement, readMessageSettlement(m.settlement));
    }
    settlement = mergeMessageSettlement(listClosure, settlement);
  }
  const live = useAgentMessages.getState().byId[messageId]?.settlement;
  settlement = mergeMessageSettlement(settlement, live?.state === "closed" ? live : undefined);
  settlement = mergeMessageSettlement(before.settlement?.state === "closed" ? before.settlement : undefined, settlement);
  if (authoritative || settlement?.state === "closed") useAgentMessages.getState().applySettlementRead(messageId, settlement);
  put(key, {
    ...before,
    phase: settlement?.state === "closed" ? "done" : before.phase,
    request: settlement?.state === "closed" ? undefined : before.request,
    settlement: authoritative ? settlement : mergeMessageSettlement(before.settlement, settlement),
    authoritative: authoritative || before.authoritative,
    // Automatic recovery reads may prove closure, but never authorize a repeat mutation.
    checked: explicit && !!settlement,
  });
}

export async function closeMessageFollowUp(hostId: string, messageId: string, settlement: MessageSettlement, reason: string, sessionId?: string): Promise<void> {
  if (!messageSettlementAllowed(featuresOf(useApp.getState(), hostId), hostAccessNow(hostId))) return;
  const evidence = readMessageSettlement(settlement);
  if (!evidence || !evidence.canClose || evidence.state === "closed") return;
  const key = settlementWriteKey(hostId, messageId);
  const previous = useSettlementWrites.getState().entries[key];
  if (previous?.phase === "pending" || settlement.state === "closed" || !settlement.canClose || !reason.trim()) return;
  const live = useAgentMessages.getState().byId[messageId];
  if (live?.state === "delivered" || (live?.settlementKnown && !live.settlement?.canClose)) return;
  if (previous?.authoritative && !previous.settlement?.canClose) return;
  // An explicit retry is allowed only after reading an actual settlement, never just a missing row.
  if (previous?.request && !previous.checked) return;
  const request = previous?.request ?? { messageId, expectedEvidenceToken: settlement.evidenceToken, requestId: crypto.randomUUID(), reason: reason.trim() };
  put(key, { phase: "pending", request, settlement });
  try {
    const result = await apiFor(hostId).closeBusMessage(request);
    if (result.ok) {
      const closed = readMessageSettlement(result.result.settlement);
      if (result.result.messageId !== messageId || typeof result.result.changed !== "boolean" || closed?.state !== "closed") throw new Error("unconfirmed settlement response");
      publish(messageId, closed);
      put(key, { phase: "done", settlement: closed });
      // The server removes closed items from admission. A failed refresh cannot undo a known write.
      await refreshAdmission(hostId, sessionId).catch(() => {});
      return;
    }
    const { status, code } = result.error;
    if (!DEFINITIVE_REFUSALS[status]?.includes(code)) {
      put(key, { phase: "uncertain", request, settlement, error: "unavailable", checked: false });
    } else {
      put(key, { phase: "error", settlement, error: status === 409 ? "conflict" : status === 403 ? "unauthorized" : status === 404 ? "missing" : "unknown" });
    }
  } catch {
    put(key, { phase: "uncertain", request, settlement, error: "unknown", checked: false });
  }
  await recheckSettlement(hostId, messageId, sessionId, false);
}
