// One sent message, one row. An agent's agent_tell (plain or with `delegation`) is written twice: as the native tool
// call (给 X 留言 <text>) and as cutex's `cutex/agentBus/messageSent` on the sender's stream (发给 X 留言 ○ 未读 <body>).
// Since fix/tell-result-message-id the call's result carries `messageId`, the same id as the bus event's: a call and
// a sent message with the same id are one row. Nothing else pairs them: a result without `messageId` (hosts before
// that release, refusals, uncertain outcomes, cross-host tells) leaves both rows as they are.
// The sent row stays: delivery status, receipt and settlement, and the whole body when opened (a revision's header
// and hint included). Its one-line preview is the call's `text` argument, what the agent wrote.
// Order: the bus event lands between item/started and item/completed, so until the result arrives both rows show;
// then the call's row goes and the sent row, kept in place under the same key, changes only its preview.
import { toolResultObject } from "./taskRows";
import type { TimelineEntry } from "./timeline";

type Sent = Extract<TimelineEntry, { kind: "sent" }>;

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** The bus message id a cutex tool call's result names, if any. */
function sentMessageId(entry: TimelineEntry): string | null {
  if (entry.kind !== "tool" || entry.item.type !== "mcpToolCall" || entry.item.server !== "cutex") return null;
  return str(toolResultObject(entry.item)?.messageId);
}

const shown = new WeakMap<Sent, { preview: string | undefined; entry: Sent }>();
/** The same sent entry with its preview, stable across renders (memoised rows compare by identity). */
function withPreview(sent: Sent, preview: string | undefined): Sent {
  if (preview === undefined || sent.text === preview) return sent;
  const cached = shown.get(sent);
  if (cached?.preview === preview) return cached.entry;
  const entry = { ...sent, preview };
  shown.set(sent, { preview, entry });
  return entry;
}

/** `entries` with each call whose result names a sent message folded into that message's row. */
export function pairSentCalls(entries: readonly TimelineEntry[]): TimelineEntry[] {
  const sent = new Set<string>();
  for (const entry of entries) if (entry.kind === "sent" && entry.messageId) sent.add(entry.messageId);
  if (!sent.size) return entries as TimelineEntry[];
  const calls = new Map<string, { id: string; text: string | undefined }>();
  for (const entry of entries) {
    const messageId = sentMessageId(entry);
    if (!messageId || !sent.has(messageId) || calls.has(messageId) || entry.kind !== "tool") continue;
    calls.set(messageId, { id: entry.id, text: str((entry.item.arguments as Record<string, unknown> | undefined)?.text) ?? undefined });
  }
  if (!calls.size) return entries as TimelineEntry[];
  const folded = new Set([...calls.values()].map(call => call.id));
  const out: TimelineEntry[] = [];
  for (const entry of entries) {
    if (folded.has(entry.id)) continue;
    const call = entry.kind === "sent" && entry.messageId ? calls.get(entry.messageId) : undefined;
    out.push(call && entry.kind === "sent" ? withPreview(entry, call.text) : entry);
  }
  return out;
}
