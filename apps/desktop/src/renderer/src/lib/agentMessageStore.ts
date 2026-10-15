// Agent messages v2 state (lib/agentMessages), kept in its own zustand store like the delegation
// store: the app store feeds it every cutex agent-bus event (host feed and session feeds) and the
// bootstrap snapshots, and resets it on a host switch. Components subscribe per message id
// (`useAgentMessage`) so a status change re-renders only that row, never the timeline.
import { useMemo } from "react";
import { create } from "zustand";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { AGENT_BUS_METHODS, applyMessageEvent, pendingMessagesFor, seedMessages, type AgentMessageRecord, type MessageMap } from "./agentMessages";

export interface AgentMessagesState {
  byId: MessageMap;
  /** Failed rows the owner closed in the 待读留言 section (this app session only). */
  dismissed: ReadonlySet<string>;
  apply(envelope: EventEnvelope): void;
  seed(sessionId: string, received: unknown[] | null | undefined, sent: unknown[] | null | undefined): void;
  dismiss(messageId: string): void;
  reset(): void;
}

export const useAgentMessages = create<AgentMessagesState>((set, get) => ({
  byId: {},
  dismissed: new Set(),
  apply(envelope) {
    const cutex = envelope.cutex;
    if (!cutex || !AGENT_BUS_METHODS.has(cutex.method)) return;
    const received = Date.parse(envelope.receivedAt);
    const at = (Number.isFinite(received) ? received : Date.now()) / 1000;
    const byId = applyMessageEvent(get().byId, cutex.method, (cutex.params ?? {}) as Record<string, unknown>, at);
    if (byId !== get().byId) set({ byId });
  },
  seed(sessionId, received, sent) {
    const byId = seedMessages(get().byId, sessionId, received, sent);
    if (byId !== get().byId) set({ byId });
  },
  dismiss(messageId) {
    set((s) => ({ dismissed: new Set([...s.dismissed, messageId]) }));
  },
  reset: () => set({ byId: {}, dismissed: new Set() }),
}));

/** One message's record (null until cutex said anything about it). */
export function useAgentMessage(messageId: string | null): AgentMessageRecord | null {
  return useAgentMessages((s) => (messageId ? (s.byId[messageId] ?? null) : null));
}

/**
 * The 待读留言 rows of an agent; `readIn(id)`: already in its timeline. Recomputed when the
 * message map changes (agent-bus events are rare) or the caller's `version` moves.
 */
export function usePendingMessages(sessionId: string, readIn: (messageId: string) => boolean, version: number): AgentMessageRecord[] {
  const byId = useAgentMessages((s) => s.byId);
  const dismissed = useAgentMessages((s) => s.dismissed);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- readIn changes with `version`
  return useMemo(() => pendingMessagesFor(byId, sessionId, readIn, dismissed), [byId, dismissed, sessionId, version]);
}
