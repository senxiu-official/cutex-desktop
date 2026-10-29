// Per-agent "latest activity" line for the sidebar (like the cutex TUI action panel): the latest
// tool action, or the beginning of the latest output message. Seeded from the session resource's
// `activity` (server-side safe projection) and refined live from host-wide events.
import type { EventEnvelope, SessionResource } from "@cutex-desktop/protocol";
import { translate } from "../i18n";
import { senderLabel } from "./systemSenders";
import { parseExternalInput, userText, type RawItem } from "./timeline";
import { retryNoticeOf, retryNoticeText } from "./retryNotice";
import { applyMark, revertMarkOf } from "./revertedPreview";

export type ActivityKind = "output" | "tool" | "input" | "received" | "retry";

export interface ActivityPreview {
  kind: ActivityKind;
  text: string;
  /** epoch ms */
  at: number;
  /** item currently being streamed into `text` (output kind). */
  itemId?: string;
  /** retry kind: the line it covers, back when the turn ends without new output. */
  previous?: ActivityPreview;
  /**
   * tool / retry kinds: the last message before it (an IM-style row keeps showing the conversation, not
   * the command running; `messageOf`). The message kinds are their own message.
   */
  message?: ActivityPreview;
}

/** Kinds that are a message of the conversation: the agent's reply, the owner's message, a message from another agent. */
const MESSAGE_KINDS: ReadonlySet<ActivityKind> = new Set(["output", "input", "received"]);

/** The last message of a preview (null: none seen yet — only tool actions, or nothing). */
export function messageOf(preview: ActivityPreview | undefined | null): ActivityPreview | null {
  if (!preview) return null;
  if (MESSAGE_KINDS.has(preview.kind)) return preview.text.trim() ? preview : (preview.message ?? null);
  return preview.message ?? null;
}

/**
 * A reply's Markdown as one line of plain text for a list row: fences, inline code ticks, emphasis
 * markers, headings, list bullets, quotes and link targets go; whitespace collapses. Cheap and
 * forgiving (a half-streamed marker stays as typed); idempotent.
 */
export function plainPreview(text: string): string {
  return text
    .replace(/```[^\s`]*/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*\*|~~/g, "")
    .replace(/(^|[^\w])__(\S(?:.*?\S)?)__(?![\w])/g, "$1$2")
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?;:，。！？；：])/g, "$1$2")
    .replace(/(^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]+/g, "$1")
    .replace(/(^|\n)[ \t]*>[ \t]?/g, "$1")
    .replace(/(^|\s)#{1,6}[ \t]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX = 140;

// Collapse whitespace but keep a trailing space: streamed deltas are concatenated onto this.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trimStart().slice(0, MAX);
}

function ts(value: unknown): number {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Times (epoch ms) of the projection's `lastOutput` / `lastToolCall` (0 = none), unaffected by a revert mark. */
export function activityTimes(session: SessionResource): [number, number] {
  const activity = session.activity as { lastOutput?: { updatedAt?: string }; lastToolCall?: { updatedAt?: string } } | null;
  return [ts(activity?.lastOutput?.updatedAt), ts(activity?.lastToolCall?.updatedAt)];
}

/** Seed from the server-side activity projection (`lastOutput` / `lastToolCall`). */
export function previewFromResource(session: SessionResource): ActivityPreview | null {
  const activity = session.activity as
    | { lastOutput?: { displayText?: string; updatedAt?: string }; lastToolCall?: { displayText?: string; updatedAt?: string } }
    | null;
  const output = activity?.lastOutput;
  const tool = activity?.lastToolCall;
  const outAt = ts(output?.updatedAt);
  const toolAt = ts(tool?.updatedAt);
  // After a 回退 the projection still names the removed reply (cutex does not trim it): lib/revertedPreview.
  const { said, tool: step, fallback } = applyMark(
    output?.displayText ? { kind: "output", text: oneLine(plainPreview(output.displayText)), at: outAt } : null,
    tool?.displayText ? { kind: "tool", text: oneLine(tool.displayText), at: toolAt } : null,
    revertMarkOf(session.cutexSessionId),
  );
  if (said && (!step || said.at >= step.at)) return said;
  if (step) return { ...step, ...(said ? { message: said } : {}) };
  return fallback;
}

function toolText(item: RawItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return `$ ${String(item.command ?? "")}`;
    case "fileChange": {
      const paths = ((item.changes as { path: string }[] | undefined) ?? []).map((c) => c.path.split(/[\\/]/).pop());
      return `✎ ${paths.join(", ")}`;
    }
    case "mcpToolCall":
      return `⚙ ${String(item.server ?? "")}.${String(item.tool ?? "")}`;
    case "dynamicToolCall":
      return `⚙ ${typeof item.namespace === "string" && item.namespace ? `${item.namespace}.` : ""}${String(item.tool ?? "")}`;
    case "webSearch":
      return `⌕ ${String((item as { query?: string }).query ?? "")}`;
    default:
      return null;
  }
}

/**
 * Returns the new preview for `envelope.cutexSessionId`, or undefined if this event does not
 * change it.
 */
export function nextPreview(current: ActivityPreview | undefined, envelope: EventEnvelope): ActivityPreview | undefined {
  const message = envelope.native?.message;
  if (!message || envelope.native?.kind !== "notification") return undefined;
  const params = (message.params ?? {}) as Record<string, unknown>;
  const at = ts(envelope.receivedAt) || Date.now();
  switch (message.method) {
    case "item/started": {
      const item = params.item as RawItem;
      // The owner's message (sent here or elsewhere): the row shows it until the reply starts.
      if (item?.type === "userMessage") {
        const said = oneLine(userText(item)).trim();
        return said ? { kind: "input", text: said, at } : undefined;
      }
      const text = toolText(item);
      const message = messageOf(current);
      return text ? { kind: "tool", text: oneLine(text), at, ...(message ? { message } : {}) } : undefined;
    }
    case "item/agentMessage/delta": {
      const itemId = String(params.itemId);
      const delta = String(params.delta ?? "");
      if (current?.kind === "output" && current.itemId === itemId) {
        if (current.text.length >= MAX) return undefined;
        return { ...current, text: oneLine(current.text + delta), at };
      }
      return { kind: "output", text: oneLine(delta), at, itemId };
    }
    case "item/completed": {
      const item = params.item as RawItem;
      if (item.type === "agentMessage") {
        const text = oneLine(plainPreview(String(item.text ?? "")));
        // An empty reply (tool-only turn) keeps the last message.
        if (!text) return current?.kind === "output" && current.itemId === item.id ? { ...current, text: "" } : undefined;
        return { kind: "output", text, at, itemId: item.id };
      }
      const received = parseExternalInput(item);
      if (received) return { kind: "received", text: oneLine(`${senderLabel(translate, received.senderId, received.sourceKind, received.senderName)}: ${received.text}`), at };
      return undefined;
    }
    case "error": {
      // Native retries the model request: say so instead of the stale last line (lib/retryNotice).
      if (params.willRetry !== true) return undefined;
      const notice = retryNoticeOf(params.error);
      if (!notice) return undefined;
      const previous = current?.kind === "retry" ? current.previous : current;
      const message = messageOf(previous);
      return { kind: "retry", text: retryNoticeText(notice, translate), at, ...(previous ? { previous } : {}), ...(message ? { message } : {}) };
    }
    case "turn/completed":
      // Retries ended without output (failed / interrupted): the line it covered comes back.
      return current?.kind === "retry" ? current.previous ?? { kind: "output", text: "", at: current.at } : undefined;
    default:
      return undefined;
  }
}

/** What an IM-style sidebar row shows under the name. */
export interface PreviewLine {
  kind: ActivityKind;
  /** Plain text, one line (the row truncates it). */
  text: string;
  at: number;
}

/**
 * A row's second line: the last message of the conversation (the agent's reply as plain text, the
 * owner's message, a message from another agent); while a turn runs, its current step instead (a
 * command, a file change, a retry notice). Null: nothing seen yet (the row shows its status).
 */
export function previewLine(preview: ActivityPreview | undefined | null, running: boolean): PreviewLine | null {
  if (!preview) return null;
  const live = preview.kind === "tool" || preview.kind === "retry";
  if (live && preview.text.trim() && (running || preview.kind === "retry")) return { kind: preview.kind, text: preview.text, at: preview.at };
  const message = messageOf(preview);
  if (message) {
    const text = message.kind === "output" ? plainPreview(message.text) : message.text.trim();
    if (text) return { kind: message.kind, text, at: message.at };
  }
  return live && preview.text.trim() ? { kind: preview.kind, text: preview.text, at: preview.at } : null;
}

/**
 * Any agent's latest activity, open conversation or not: the focus host's live map (`s.activity`, followed
 * from host-wide events), another host's session-resource projection (refreshed with its sidebar snapshot).
 * `useApp((s) => agentActivityOf(s, focus, row))` in a widget or card; with `previewLine(…, true)` a running
 * agent's line is its current step (a command, a file change, a retry notice) or else its last message.
 */
export function agentActivityOf(s: { activity: Readonly<Record<string, ActivityPreview>> }, focusHost: string, row: { id: string; hostId?: string; session: SessionResource }): ActivityPreview | null {
  return (row.hostId ?? focusHost) === focusHost ? (s.activity[row.id] ?? null) : previewFromResource(row.session);
}

/** A running agent's current step as one line (a tool / retry line only; null = nothing more specific than 工作中). */
export function runningStepOf(preview: ActivityPreview | null): string | null {
  const line = previewLine(preview, true);
  return line && (line.kind === "tool" || line.kind === "retry") ? line.text : null;
}
