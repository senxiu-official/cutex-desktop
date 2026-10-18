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
