// `?claudeDiag`: cutex r295 Claude launch / runtime diagnostics in the mock preview (claude-runtime-diagnostics-v1).
// - Kai (Claude): startup warnings (a setting not applied, an MCP connection failed) and a PreToolUse hook running
//   for 95 s; a background subagent whose tool approval was declined unattended (`claude/task/updated`).
// - Sora (Claude): a failed turn whose provider could not be reached (`additionalDetails.diagnosticCode`).
// - Akari (offline Claude): 启动 fails with `runtime_unreachable` (main's fixed wire message).
import type { SessionResource } from "@cutex-desktop/protocol";
import { runtimeUnreachableWire } from "../../../shared/runtimeUnreachable";

export const CLAUDE_DIAG_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("claudeDiag");
const KAI_TASK = "claude:mock-kai:task:task-bg-lint";

export function withMockClaudeDiagnostics(s: SessionResource): SessionResource {
  if (!CLAUDE_DIAG_SCENE) return s;
  if (s.cutexSessionId === "kai")
    return { ...s, runtime: { ...s.runtime, claudeDiagnostics: { warnings: ["configurationNotApplied", "mcpConnectionFailed"], activeHooks: [{ event: "PreToolUse", startedAtMs: Date.now() - 95_000 }] } } };
  return s;
}

/** Kai's running turn: a background lint subagent (its row shows the declined approval). */
export const MOCK_DIAG_KAI_ITEMS: unknown[] = CLAUDE_DIAG_SCENE ? [
  { type: "dynamicToolCall", id: "toolu_bg_lint", namespace: "claude", tool: "Agent", arguments: { description: "跑 lint 并修复", subagent_type: "general-purpose", prompt: "跑 pnpm lint，能自动修的都修掉。", run_in_background: true }, status: "completed", contentItems: [], success: true, durationMs: 900, agentThreadId: KAI_TASK },
  { type: "subAgentActivity", id: "kbg1", kind: "started", agentThreadId: KAI_TASK, agentPath: "/claude/task-bg-lint" },
] : [];

/** Sora's last turn: the model provider could not be reached. */
export const MOCK_DIAG_SORA_TURNS: unknown[] = CLAUDE_DIAG_SCENE ? [{
  id: "sora-t3", status: "failed", startedAt: Date.now() / 1000 - 120, completedAt: Date.now() / 1000 - 110,
  items: [{ type: "userMessage", id: "su3", content: [{ type: "text", text: "再查一下 WebFetch 的重试逻辑。" }] }],
  error: { message: "Claude request failed", additionalDetails: JSON.stringify({ diagnosticCode: "unreachable" }), codexErrorInfo: null },
}] : [];

/** 启动 on Akari: cutex could not reach the runtime. */
export function mockDiagOnlineRefusal(sessionId: string): string | null {
  return CLAUDE_DIAG_SCENE && sessionId === "d-akari" ? runtimeUnreachableWire({ code: "runtime_unreachable", details: { diagnosticCode: "unreachable" } }) : null;
}

/** The adapter's task update for Kai's background subagent (repeated: the preview may open Kai later). */
export function startMockDiagTaskEvents(nativeEvent: (sessionId: string, method: string, params: unknown) => void): void {
  if (!CLAUDE_DIAG_SCENE) return;
  const send = () => nativeEvent("kai", "claude/task/updated", { threadId: "thread-kai", task: { taskId: "task-bg-lint", taskType: "local_agent", status: "running", background: true, approvalState: "deniedUnattended" } });
  setInterval(send, 2000);
}
