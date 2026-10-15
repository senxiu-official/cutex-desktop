import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { SideChat } from "../../../../shared/sideChat";
import { applyEvent, emptyTimeline, orderedEntries } from "../../lib/timeline";

export const SUMMARY_PROMPT = "Summarize the user's questions and the resulting discussion in this side conversation as a concise standalone note. Use the user's language. Give a short heading, the confirmed conclusions, and any unresolved questions. Treat inherited main-thread history only as background; do not summarize it wholesale. Do not execute tasks or use tools for this request. Return only the note in Markdown.";

/** Local rendering only: these envelopes are NEVER submitted to the parent's store or feed. */
export function sideTimeline(chat: SideChat) {
  const timeline = emptyTimeline();
  timeline.threadId = chat.threadId;
  for (const event of chat.events) {
    const envelope: EventEnvelope = {
      contractVersion: 2, eventId: String(event.seq), cursor: String(event.seq), streamId: chat.id,
      sequence: event.seq, receivedAt: chat.updatedAt, cutexSessionId: chat.sessionId,
      hostId: "side", source: "app_server", sensitivity: "owner", correlation: { threadId: chat.threadId },
      native: { kind: "notification", message: { method: event.method, params: event.params } },
    };
    applyEvent(timeline, envelope);
  }
  timeline.activeTurnId = chat.activeTurnId;
  return timeline;
}

export function completedSummary(chat: SideChat, turnId: string): { body: string; title: string } | null {
  const timeline = sideTimeline(chat);
  if (timeline.turns.find(turn => turn.id === turnId)?.status !== "completed") return null;
  const replies = orderedEntries(timeline).filter(e => e.kind === "agent" && e.turnId === turnId && !e.streaming);
  const last = replies.at(-1);
  if (!last || last.kind !== "agent" || !last.text.trim()) return null;
  const body = last.text.trim();
  return { body, title: body.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 200) ?? "" };
}

export function sideError(chat: SideChat): string | null {
  const event = chat.events.findLast(e => e.method === "error");
  if (!event) return null;
  const params = event.params as { message?: string; error?: { message?: string } } | undefined;
  return params?.error?.message ?? params?.message ?? null;
}
