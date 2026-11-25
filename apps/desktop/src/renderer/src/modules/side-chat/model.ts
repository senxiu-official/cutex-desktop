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

/** A passage quoted into the side chat (批注追问): its text and the main-timeline turn it came from (null: none known,
 *  e.g. selected in a side chat or a note). Composer state like the draft: it lives until sent or removed. */
export interface SideQuote { text: string; turnId: string | null }

/** Markdown quote lines of a passage (an empty line stays inside the quote). */
export function quoteLines(text: string): string {
  return text.split("\n").map(line => (line.trim() ? `> ${line}` : ">")).join("\n");
}

/** The message sent for a quote and the owner's note: the quoted passage, a blank line, then the note. */
export function quotedMessage(quote: SideQuote | null | undefined, note: string): string {
  if (!quote) return note;
  return note.trim() ? `${quoteLines(quote.text)}\n\n${note}` : quoteLines(quote.text);
}

/** A sent user message → its leading quote (`> ` lines) and the rest, for the bubble; null when it starts otherwise. */
export function splitQuoted(text: string): { quote: string; note: string } | null {
  const lines = text.split("\n");
  let end = 0;
  while (end < lines.length && /^>( |$)/.test(lines[end]!)) end++;
  if (!end) return null;
  return { quote: lines.slice(0, end).map(line => line.replace(/^> ?/, "")).join("\n"), note: lines.slice(end).join("\n").replace(/^\n+/, "") };
}
