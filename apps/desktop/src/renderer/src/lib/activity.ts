// Per-agent "latest activity" line for the sidebar (like the cutex TUI action panel): the latest
// tool action, or the beginning of the latest output message. Seeded from the session resource's
// `activity` (server-side safe projection) and refined live from host-wide events.
import type { EventEnvelope, SessionResource } from "@cutex-desktop/protocol";
import { translate } from "../i18n";
import { senderLabel } from "./systemSenders";
import { parseExternalInput, type RawItem } from "./timeline";

export type ActivityKind = "output" | "tool" | "input" | "received";

export interface ActivityPreview {
  kind: ActivityKind;
  text: string;
  /** epoch ms */
  at: number;
  /** item currently being streamed into `text` (output kind). */
  itemId?: string;
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

/** Seed from the server-side activity projection (`lastOutput` / `lastToolCall`). */
export function previewFromResource(session: SessionResource): ActivityPreview | null {
  const activity = session.activity as
    | { lastOutput?: { displayText?: string; updatedAt?: string }; lastToolCall?: { displayText?: string; updatedAt?: string } }
    | null;
  const output = activity?.lastOutput;
  const tool = activity?.lastToolCall;
  const outAt = ts(output?.updatedAt);
  const toolAt = ts(tool?.updatedAt);
  if (output?.displayText && outAt >= toolAt) return { kind: "output", text: oneLine(output.displayText), at: outAt };
  if (tool?.displayText) return { kind: "tool", text: oneLine(tool.displayText), at: toolAt };
  return null;
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
      const text = toolText(params.item as RawItem);
      return text ? { kind: "tool", text: oneLine(text), at } : undefined;
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
      if (item.type === "agentMessage") return { kind: "output", text: oneLine(String(item.text ?? "")), at, itemId: item.id };
      const received = parseExternalInput(item);
      if (received) return { kind: "received", text: oneLine(`${senderLabel(translate, received.senderId, received.sourceKind, received.senderName)}: ${received.text}`), at };
      return undefined;
    }
    default:
      return undefined;
  }
}
