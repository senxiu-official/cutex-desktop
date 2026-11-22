import { useMemo, type ReactNode } from "react";
import { ConversationScope } from "../lib/conversationScope";
import { MarkdownOpenSource } from "../lib/markdownOpenSource";

/**
 * Markdown (components/Markdown) outside a conversation pane resolves file links against this agent (its host and
 * workspace), not the selected one: a side chat, a note. Opening one (click, preview, the file menu) targets the same agent
 * and host (lib/markdownOpenSource). `sessionId` null: the host only (relative links need a base).
 */
export function AgentMarkdownScope({ paneId, hostId, sessionId, visible = true, children }: { paneId: string; hostId: string; sessionId: string | null; visible?: boolean; children: ReactNode }) {
  const value = useMemo(() => ({ paneId, hostId, sessionId, focused: false, visible }), [paneId, hostId, sessionId, visible]);
  const source = useMemo(() => ({ hostId, sessionId }), [hostId, sessionId]);
  return <ConversationScope.Provider value={value}><MarkdownOpenSource.Provider value={source}>{children}</MarkdownOpenSource.Provider></ConversationScope.Provider>;
}
