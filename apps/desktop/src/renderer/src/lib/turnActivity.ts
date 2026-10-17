// What the running turn is doing right now — the live line at the end of the timeline (Timeline.tsx
// TurnTail). Pure; derived from the timeline only.
import type { ReasoningEntry } from "./reasoning";
import type { MessageKey } from "../i18n";
import type { RawItem, TimelineState } from "./timeline";
import { isRunning } from "./workGroups";

export type TurnActivity = "approval" | "question" | "command" | "editing" | "tool" | "search" | "subagent" | "reasoning" | "replying" | "planning" | "working";

const TOOL_ACTIVITY: Record<string, TurnActivity> = {
  commandExecution: "command",
  fileChange: "editing",
  mcpToolCall: "tool",
  dynamicToolCall: "tool",
  imageView: "tool",
  webSearch: "search",
};

const QUESTION_METHODS = new Set(["item/tool/requestUserInput", "mcpServer/elicitation/request"]);

type TimelineView = Pick<TimelineState, "activeTurnId" | "turns" | "entries" | "pending">;

/**
 * Null when no turn runs. A pending approval / question wins (the turn waits on the owner). Otherwise
 * the newest live step of the trailing run of steps (tools and reasoning; checklist updates and
 * other invisible items don't end the run): a running tool — skipping commands already moved to the
 * background (`backgroundItemIds`: unified-exec processes stay "inProgress" while the model moves
 * on) — or reasoning in progress (推理中, even with no text to show); then streaming text; else
 * the turn is just working (工作中: nothing tells us more).
 */
export function turnActivity(timeline: TimelineView, backgroundItemIds: readonly string[] = [], activity?: (item: RawItem) => MessageKey | null): TurnActivity | MessageKey | null {
  if (!timeline.activeTurnId) return null;
  const pending = [...timeline.pending.values()];
  if (pending.length > 0) return pending.some((r) => !QUESTION_METHODS.has(r.method)) ? "approval" : "question";
  for (const entry of trailing(timeline)) {
    if (entry.kind === "other" || entry.kind === "checklist" || entry.kind === "interaction" || entry.kind === "notice") continue;
    if (entry.kind === "tool") {
      if (isRunning(entry.item) && !backgroundItemIds.includes(entry.id)) return activity?.(entry.item) ?? TOOL_ACTIVITY[entry.item.type] ?? "tool";
      continue;
    }
    if (entry.kind === "reasoning") {
      if (entry.streaming) return "reasoning";
      continue;
    }
    if (entry.kind === "agent" && entry.streaming) return "replying";
    if (entry.kind === "plan" && entry.streaming) return "planning";
    break;
  }
  return "working";
}

/** The active turn's reasoning item still streaming, if any (newest first). */
export function liveReasoning(timeline: TimelineView): ReasoningEntry | null {
  if (!timeline.activeTurnId) return null;
  for (const entry of trailing(timeline)) if (entry.kind === "reasoning" && entry.streaming) return entry;
  return null;
}

/** The active turn's entries, newest first. */
function* trailing(timeline: TimelineView) {
  const ids = timeline.turns.find((t) => t.id === timeline.activeTurnId)?.entryIds ?? [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const entry = timeline.entries.get(ids[i]!);
    if (entry) yield entry;
  }
}
