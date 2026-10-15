// Claude task references (claude-r8 adapter `runtime_tasks.py`). A Claude agent's SDK sub-agent
// tasks reach the timeline as `subAgentActivity` items whose `agentThreadId` is
// `claude:<native session>:task:<task id>`. Each is an activity inside that Claude session, not a
// thread: cutex has nothing to `thread/read` for it. So the desktop never opens one (sub-agent
// chips, the 子 agent status rows, the right-side sub-agent thread card) and never reads it to
// settle its status (the adapter reports completion with its own `subAgentActivity` items).
// Pure (no React, no store) so it is unit-tested.

/**
 * True for a Claude adapter's namespaced reference: `claude:<session>:task:<id>` today, and any other
 * `claude:` id (a Codex sub-agent thread id is a bare UUID, never `claude:`-prefixed).
 */
export function isClaudeTaskRef(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("claude:");
}
