// Agent messages v2 state (lib/agentMessages), kept in its own zustand store like the delegation
// store: the app store feeds it every cutex agent-bus event (host feed and session feeds) and the
// bootstrap snapshots, and resets it on a host switch. Components subscribe per message id
// (`useAgentMessage`) so a status change re-renders only that row, never the timeline.
// Failed rows the owner closed stay closed across restarts (state surfaces L3): the ids are kept per host in
// localStorage, newest MAX_DISMISSED per host, and reloaded when the focus host changes.
import { useMemo } from "react";
import { create } from "zustand";
import type { EventEnvelope, MessageSettlement } from "@cutex-desktop/protocol";
import { MESSAGE_SETTLEMENT_EVENT } from "../../../shared/messageSettlement";
import { focusHostId, onKeyFocus } from "./hostKeys";
import { AGENT_BUS_METHODS, applyMessageEvent, lastFinishedTurnStart, pendingMessagesFor, seedMessages, type AgentMessageRecord, type MessageMap } from "./legacyDelivery/agentMessages";

export interface AgentMessagesState {
  byId: MessageMap;
  /** Failed rows the owner closed in the 待读留言 section (the focus host's, persisted). */
  dismissed: ReadonlySet<string>;
  apply(envelope: EventEnvelope): void;
  /** Server settlement from a close response or recovery read, merged like a replayable event. */
  applySettlement(messageId: string, settlement: MessageSettlement): void;
  /** An authoritative read can remove expired sidecar evidence; a proven closure remains sticky. */
  applySettlementRead(messageId: string, settlement: MessageSettlement | undefined): void;
  seed(sessionId: string, received: unknown[] | null | undefined, sent: unknown[] | null | undefined): void;
  /**
   * A bus-messages page read is about to start: its place in the store's order of reads (beginPageRead → the
   * `readSeq` given to mergePage with that page's rows).
   */
  beginPageRead(): number;
  /**
   * bus-messages pages (bootstrap-bounded-bus): merged by messageId, delivery only forward, settlement by
   * observation time (not authoritative). A row's settlement evidence applies only when its page read began
   * after the last authoritative observation of that message (`readSeq`, per row or for all; omitted = the
   * oldest). A closure always applies.
   */
  mergePage(sessionId: string, received: unknown[], sent: unknown[], readSeq?: number | ((row: unknown) => number)): void;
  dismiss(messageId: string): void;
  reset(): void;
}

/**
 * Client-side order of bus reads and authoritative observations (no clocks: host and client time never
 * meet here). Every page read start and every authoritative observation takes the next number.
 */
let sequence = 0;
/**
 * Per message, the number of its last authoritative observation (settlement read, settlement event,
 * bootstrap row) — also when it found no evidence. A page read numbered at or below it carries what that
 * observation replaced or ruled out, so its evidence is dropped (mergePage). Bounded: the oldest entries go
 * first past the cap (an evicted message falls back to the observation-time merge).
 */
const observedAtSeq = new Map<string, number>();
const MAX_FENCES = 20_000;
/**
 * The highest observation number dropped by the cap. A message without an entry may have lost one: a page
 * read begun at or below this mark is treated as older than its observation (its settlement is skipped).
 */
let evictedUpToSeq = 0;
function fence(ids: Iterable<string>): void {
  const at = ++sequence;
  for (const id of ids) {
    observedAtSeq.delete(id);
    observedAtSeq.set(id, at);
  }
  for (const id of observedAtSeq.keys()) {
    if (observedAtSeq.size <= MAX_FENCES) break;
    evictedUpToSeq = Math.max(evictedUpToSeq, observedAtSeq.get(id)!);
    observedAtSeq.delete(id);
  }
}
const rowIds = (rows: unknown[] | null | undefined) => (rows ?? []).flatMap((raw) => {
  const id = ((raw ?? {}) as { messageId?: unknown }).messageId;
  return typeof id === "string" && id ? [id] : [];
});
const isClosedSettlement = (v: unknown) => (v as { state?: unknown } | null | undefined)?.state === "closed";
/** A page row without settlement evidence an observation numbered at or after its read ruled on (a closure stays). */
function fencePageRow(raw: unknown, readSeq: number): unknown {
  const row = (raw ?? {}) as { messageId?: unknown; settlement?: unknown };
  if (!row.settlement || typeof row.messageId !== "string" || isClosedSettlement(row.settlement)) return raw;
  const observed = observedAtSeq.get(row.messageId) ?? (evictedUpToSeq || -Infinity);
  if (readSeq > observed) return raw;
  const { settlement: _dropped, ...rest } = row;
  return rest;
}

// ---------- closed failed rows (persisted per host) ----------

const DISMISSED_KEY = "cutex-desktop.dismissedFailedMessages.v1";
/** Most closed ids kept per host (the oldest go first). */
export const MAX_DISMISSED = 300;
type DismissedByHost = Record<string, string[]>;

function readDismissed(): DismissedByHost {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([host, ids]) => [host, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && !!id) : []]));
  } catch {
    return {};
  }
}

/** Add `messageId` to `hostId`'s closed ids, newest last, at most `max`. Pure. */
export function withDismissed(all: DismissedByHost, hostId: string, messageId: string, max = MAX_DISMISSED): DismissedByHost {
  const ids = [...(all[hostId] ?? []).filter((id) => id !== messageId), messageId];
  return { ...all, [hostId]: ids.slice(-max) };
}

function persistDismissed(hostId: string, messageId: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(withDismissed(readDismissed(), hostId, messageId)));
  } catch {
    // best effort: the row stays closed for this session
  }
}

/** The focus host's closed ids. */
export function loadDismissed(hostId = focusHostId()): ReadonlySet<string> {
  return new Set(readDismissed()[hostId] ?? []);
}

export const useAgentMessages = create<AgentMessagesState>((set, get) => ({
  byId: {},
  dismissed: loadDismissed(),
  applySettlementRead(messageId, settlement) {
    fence([messageId]);
    const previous = get().byId[messageId];
    if (previous?.settlement?.state === "closed") return;
    if (previous?.state === "delivered" && settlement?.state !== "closed") settlement = undefined;
    if (!previous) {
      if (settlement) get().applySettlement(messageId, settlement);
      return;
    }
    set((s) => ({ byId: { ...s.byId, [messageId]: { ...previous, settlement, settlementKnown: true } } }));
  },
  applySettlement(messageId, settlement) {
    fence([messageId]);
    const byId = applyMessageEvent(get().byId, MESSAGE_SETTLEMENT_EVENT, { messageId, settlement }, Date.now() / 1000);
    if (byId !== get().byId) set({ byId });
  },
  apply(envelope) {
    const cutex = envelope.cutex;
    if (!cutex || !AGENT_BUS_METHODS.has(cutex.method)) return;
    const received = Date.parse(envelope.receivedAt);
    const at = (Number.isFinite(received) ? received : Date.now()) / 1000;
    const before = get().byId;
    const byId = applyMessageEvent(before, cutex.method, (cutex.params ?? {}) as Record<string, unknown>, at);
    const id = (cutex.params as { messageId?: unknown } | undefined)?.messageId;
    if (cutex.method === MESSAGE_SETTLEMENT_EVENT && typeof id === "string") fence([id]);
    if (byId !== before) set({ byId });
  },
  seed(sessionId, received, sent) {
    // The rows a bootstrap lists are authoritative for those messages (a bounded one says nothing of the others).
    fence([...rowIds(received), ...rowIds(sent)]);
    const byId = seedMessages(get().byId, sessionId, received, sent);
    if (byId !== get().byId) set({ byId });
  },
  beginPageRead: () => ++sequence,
  mergePage(sessionId, received, sent, readSeq = 0) {
    const seqOf = typeof readSeq === "function" ? readSeq : () => readSeq;
    const guard = (rows: unknown[]) => (observedAtSeq.size || evictedUpToSeq ? rows.map((row) => fencePageRow(row, seqOf(row))) : rows);
    const byId = seedMessages(get().byId, sessionId, guard(received), guard(sent), false);
    if (byId !== get().byId) set({ byId });
  },
  dismiss(messageId) {
    persistDismissed(focusHostId(), messageId);
    set((s) => ({ dismissed: new Set([...s.dismissed, messageId]) }));
  },
  reset: () => {
    observedAtSeq.clear();
    evictedUpToSeq = 0;
    set({ byId: {}, dismissed: loadDismissed() });
  },
}));

// A host switch shows that host's closed rows (reset may run before the focus moves).
onKeyFocus(() => useAgentMessages.setState({ dismissed: loadDismissed() }));

/** One message's record (null until cutex said anything about it). */
export function useAgentMessage(messageId: string | null): AgentMessageRecord | null {
  return useAgentMessages((s) => (messageId ? (s.byId[messageId] ?? null) : null));
}

/**
 * The 待读留言 rows of an agent; `readIn(id)`: already in its timeline. `turns`: its timeline turns
 * (mutated in place; older cutex's cross-host notes leave once a later turn finished). Recomputed
 * when the message map changes (agent-bus events are rare), the caller's `version` moves or a turn finishes.
 */
export function usePendingMessages(sessionId: string, readIn: (messageId: string) => boolean, version: number, turns?: Parameters<typeof lastFinishedTurnStart>[0], claudeRecipient = false): AgentMessageRecord[] {
  const byId = useAgentMessages((s) => s.byId);
  const dismissed = useAgentMessages((s) => s.dismissed);
  const readSince = lastFinishedTurnStart(turns);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- readIn changes with `version`
  return useMemo(() => pendingMessagesFor(byId, sessionId, readIn, dismissed, readSince, claudeRecipient), [byId, dismissed, sessionId, version, readSince, claudeRecipient]);
}
