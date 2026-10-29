// Claude task references (claude-r8 adapter `runtime_tasks.py`). A Claude agent's SDK sub-agent
// tasks reach the timeline as `subAgentActivity` items whose `agentThreadId` is
// `claude:<native session>:task:<task id>`. Each is an activity inside that Claude session, not a
// native thread. An adapter that declares `subagentTranscripts` (P2) answers `thread/read` on such a
// reference with the subagent's stored transcript (parent = the agent's thread), so the desktop
// opens it like a Codex sub-agent: read-only, right-side card. Older adapters: never opened (status
// rows only) and never read to settle their status (the adapter reports completion with its own
// `subAgentActivity` items).
// Pure (no React, no store) so it is unit-tested.
import { opensClaudeSubagents, type AgentFeatures } from "./agentFeatures";
import type { RawItem } from "./timeline";

/**
 * True for a Claude adapter's namespaced reference: `claude:<session>:task:<id>` today, and any other
 * `claude:` id (a Codex sub-agent thread id is a bare UUID, never `claude:`-prefixed).
 */
export function isClaudeTaskRef(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("claude:");
}

/** Whether the sub-agent `threadId` of an agent with features `f` can be opened / read. */
export function canOpenSubAgent(threadId: string, f: AgentFeatures): boolean {
  return !isClaudeTaskRef(threadId) || opensClaudeSubagents(f);
}

/** A Claude agent's Agent / Task tool call (the adapter's `dynamicToolCall` in namespace `claude`). */
export function isClaudeAgentTool(item: RawItem): boolean {
  return item.type === "dynamicToolCall" && item.namespace === "claude" && (item.tool === "Agent" || item.tool === "Task");
}

/** A Claude Agent / Task card that started a background subagent (`run_in_background` not false). */
export function isBackgroundClaudeAgentTool(item: RawItem): boolean {
  const args = item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : {};
  return isClaudeAgentTool(item) && args.run_in_background !== false;
}

/** The task id of a `claude:<session>:task:<id>` reference (null for anything else). */
export function claudeTaskIdOf(ref: unknown): string | null {
  if (!isClaudeTaskRef(ref)) return null;
  const at = (ref as string).lastIndexOf(":task:");
  return at < 0 ? null : (ref as string).slice(at + 6) || null;
}

/**
 * Status of a Claude SDK task (adapter `claude/task/updated`, claude-r23 background subagents) as a
 * sub-agent status (`CollabAgentStatus` words): running / completed / errored / interrupted; null for
 * shell tasks and anything unknown. `lost` = the Claude runtime restarted while it ran.
 */
export function claudeTaskStatus(task: { taskType?: unknown; status?: unknown } | null | undefined): string | null {
  if (!task || !["local_agent", "agent", "subagent"].includes(String(task.taskType))) return null;
  switch (task.status) {
    case "running":
    case "pending":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "errored";
    case "stopped":
    case "killed":
    case "cancelled":
    case "lost":
      return "interrupted";
    default:
      return null;
  }
}
