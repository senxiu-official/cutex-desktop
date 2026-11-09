// Gate of the per-agent MCP switches (lib/agentMcpLive: live statuses; components/AgentMcpDialog: the dialog).
import type { SessionResource } from "@cutex-desktop/protocol";
import { SCOPED_MCP_FEATURE } from "../../../shared/sessionMcp";
import { isAcpRuntime } from "./acpRuntimes";
import { runtimeOf } from "./agentList";

/** The 设置 › MCP 服务器… row: hosts with `scoped-mcp`, Codex and Claude agents (ACP runtimes launch without cutex's MCP layers). */
export function showsAgentMcp(session: SessionResource, host: { has(feature: string): boolean }): boolean {
  return host.has(SCOPED_MCP_FEATURE) && session.lifecycle !== "retired" && !isAcpRuntime(runtimeOf(session));
}
