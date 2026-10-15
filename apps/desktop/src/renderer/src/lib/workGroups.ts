// Folding of tool steps (DESIGN §4.14). Consecutive foldable items (tools, and reasoning with text)
// form a work group. A non-foldable item after it — agent text (commentary / final answer), a user
// message, an agent-bus message — closes the group: it renders as one summary line. A group with
// nothing after it (still running, or the tail of a finished / interrupted turn) stays open: newest
// steps + "N earlier". Pure, so it is unit-tested.
import { reasoningText, type ReasoningEntry } from "./reasoning";
import { taskRowOutcome, taskToolRow } from "./taskRows";
import type { RawItem, TimelineEntry } from "./timeline";

export interface WorkSummary {
  commands: number;
  /** Distinct files touched by fileChange items. */
  files: number;
  /** MCP / dynamic / web-search / image tools. */
  tools: number;
  /** collabAgentToolCall items (sub-agent spawn / message / wait …). */
  agents: number;
  failed: number;
  /** Sum of command durations, ms (null when none reported). */
  durationMs: number | null;
  /** Reasoning steps (folded with the tools; named in the summary only when nothing else is). */
  reasoning: number;
}

export type ToolEntry = Extract<TimelineEntry, { kind: "tool" }>;
/** A foldable step: a tool call or a reasoning item with text. */
export type StepEntry = ToolEntry | ReasoningEntry;

export type Segment =
  | { kind: "entry"; entry: TimelineEntry }
  | { kind: "work"; id: string; turnId: string; steps: StepEntry[]; open: boolean; summary: WorkSummary };

/** One-line detail of a tool row: the command, the files, `server.tool`, `namespace.tool`, … */
export function toolDetail(item: RawItem): string {
  switch (item.type) {
    case "commandExecution":
      return String(item.command ?? "");
    case "fileChange":
      return ((item.changes as { path: string }[] | undefined) ?? []).map((c) => c.path).join(", ");
    case "mcpToolCall":
      return `${String(item.server ?? "")}.${String(item.tool ?? "")}`;
    case "dynamicToolCall": {
      // Claude agents report their other tools (WebFetch, MCP, …) this way: `claude.WebFetch`.
      const ns = typeof item.namespace === "string" && item.namespace ? item.namespace : null;
      const tool = typeof item.tool === "string" ? item.tool : "";
      return ns ? `${ns}.${tool}` : tool || item.type;
    }
    case "collabAgentToolCall":
      return `${String(item.tool ?? "")}${item.prompt ? ` · ${String(item.prompt)}` : ""}`;
    case "webSearch":
      return String((item as { query?: unknown }).query ?? "");
    default:
      return item.type;
  }
}

/**
 * Text shown when a tool row is expanded: command output, the unified diffs of a file change, the
 * text content of a dynamic tool call; null = fall back to the raw item.
 */
export function toolOutput(item: RawItem): string | null {
  if (typeof item.aggregatedOutput === "string") return item.aggregatedOutput;
  if (item.type === "fileChange") {
    const diffs = ((item.changes as { path?: string; diff?: unknown }[] | undefined) ?? []).filter((c) => typeof c.diff === "string" && c.diff);
    if (diffs.length) return diffs.map((c) => (String(c.diff).startsWith("---") || String(c.diff).startsWith("diff ") ? String(c.diff) : `--- ${c.path ?? ""}\n${String(c.diff)}`)).join("\n");
  }
  if (item.type === "dynamicToolCall" && Array.isArray(item.contentItems)) {
    const text = (item.contentItems as { type?: string; text?: unknown }[]).filter((c) => typeof c.text === "string").map((c) => c.text as string);
    if (text.length) return text.join("\n");
  }
  return null;
}

export function isFailed(item: RawItem): boolean {
  const status = item.status as string | undefined;
  if (status === "failed" || status === "declined" || status === "errored") return true;
  // cutex tools answer a refusal as a completed call with `ok: false`.
  if (taskToolRow(item) && taskRowOutcome(item)?.kind === "failed") return true;
  return item.type === "commandExecution" && typeof item.exitCode === "number" && item.exitCode !== 0 && status !== "inProgress";
}

export function isRunning(item: RawItem): boolean {
  return item.status === "inProgress" || item.status === "running";
}

/**
 * What a still-"inProgress" tool row really is. cute-codex keeps unified-exec processes alive when
 * a turn is interrupted (by design), and no item/completed follows for them: once the turn is no
 * longer running, a command whose process is still listed in thread/backgroundTerminals is running
 * in the background; anything else was cut off by the interrupt. Null when the row isn't running.
 */
export function toolLiveness(item: RawItem, turnRunning: boolean, backgroundItemIds: readonly string[]): "running" | "background" | "interrupted" | null {
  if (!isRunning(item)) return null;
  if (turnRunning) return "running";
  return backgroundItemIds.includes(item.id) ? "background" : "interrupted";
}

export function summarize(steps: StepEntry[]): WorkSummary {
  const files = new Set<string>();
  const s: WorkSummary = { commands: 0, files: 0, tools: 0, agents: 0, failed: 0, durationMs: null, reasoning: 0 };
  for (const step of steps) {
    if (step.kind === "reasoning") {
      s.reasoning += 1;
      continue;
    }
    const { item } = step;
    if (item.type === "commandExecution") {
      s.commands += 1;
      if (typeof item.durationMs === "number") s.durationMs = (s.durationMs ?? 0) + item.durationMs;
    } else if (item.type === "fileChange") {
      for (const c of (item.changes as { path: string }[] | undefined) ?? []) files.add(c.path);
    } else if (item.type === "collabAgentToolCall") s.agents += 1;
    else s.tools += 1;
    if (isFailed(item)) s.failed += 1;
  }
  s.files = files.size;
  return s;
}

/**
 * `reasoning: false` (Settings → 推理过程 = 隐藏) leaves reasoning out entirely. Reasoning with no
 * text (encrypted / summaries off) is never a step: the turn's live line says 推理中 instead.
 */
export function segmentEntries(entries: TimelineEntry[], opts: { reasoning?: boolean; interactions?: boolean; standalone?: (item: RawItem) => boolean } = {}): Segment[] {
  const showReasoning = opts.reasoning ?? true;
  // Settings → 在时间线中保留已处理的交互 off: a hidden row must not split a work group either.
  const showInteractions = opts.interactions ?? true;
  // A selected module can keep its card outside the foldable work group.
  const standalone = opts.standalone ?? (() => false);
  const out: Segment[] = [];
  let group: StepEntry[] | null = null;
  const close = () => {
    if (!group) return;
    out.push({ kind: "work", id: `work:${group[0]!.id}`, turnId: group[0]!.turnId, steps: group, open: false, summary: summarize(group) });
    group = null;
  };
  for (const entry of entries) {
    if (entry.kind === "other") continue; // invisible, doesn't split a group
    if (entry.kind === "interaction" && !showInteractions) continue;
    if (entry.kind === "reasoning") {
      if (showReasoning && reasoningText(entry)) (group ??= []).push(entry);
      continue;
    }
    if (entry.kind === "tool" && !standalone(entry.item)) {
      (group ??= []).push(entry);
      continue;
    }
    close();
    out.push({ kind: "entry", entry });
  }
  close();
  const last = out[out.length - 1];
  if (last?.kind === "work") last.open = true;
  return out;
}
