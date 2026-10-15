// Settings → 指令 → 运行环境说明: which agent the launch-harness preview shows.

/**
 * The agent picked in the section's select, else the agent selected in the conversation — only if it
 * is still an active sidebar agent. No fallback to an arbitrary agent: a preview of some unrelated
 * agent (its workspace path, project, memory) reads like a leak. `null` = show "pick one", fetch nothing.
 */
export function pickHarnessAgent(picked: string | null, selectedId: string | null, activeIds: readonly string[]): string | null {
  return [picked, selectedId].find((id): id is string => !!id && activeIds.includes(id)) ?? null;
}
