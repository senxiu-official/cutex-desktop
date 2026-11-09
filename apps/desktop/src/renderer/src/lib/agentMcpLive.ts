// Per-agent MCP switches (cutex `scoped-mcp`, shared/sessionMcp.ts). Two separate things are shown:
// the configuration the agent launches with (cutex's effective view; a switch changes it for the next
// launch) and what the running agent actually reported — the last native `mcpServer/startupStatus/updated`
// per server seen on the host feed during the agent's current runtime generation (memory only; nothing
// seen = unknown, e.g. the desktop was not connected when the agent started).
import { create } from "zustand";
import type { SessionResource } from "@cutex-desktop/protocol";
import { mcpStartupStatusOf, type McpStartupStatus } from "../../../shared/sessionMcp";
import { bridge } from "../bridge";

interface LiveStatus {
  generation: number | null;
  servers: Record<string, McpStartupStatus>;
}

interface AgentMcpLive {
  /** `${hostId}|${sessionId}` → statuses of the runtime generation they came from. */
  byKey: Record<string, LiveStatus>;
}

export const useAgentMcpLive = create<AgentMcpLive>(() => ({ byKey: {} }));

export const agentMcpKey = (hostId: string, sessionId: string) => `${hostId}|${sessionId}`;

/** Record one notification (exported for tests). A newer runtime generation starts a fresh set. */
export function noteMcpStartup(hostId: string, sessionId: string, generation: number | null, status: McpStartupStatus): void {
  const key = agentMcpKey(hostId, sessionId);
  useAgentMcpLive.setState((s) => {
    const prev = s.byKey[key];
    const fresh = !prev || (generation !== null && prev.generation !== null && generation > prev.generation);
    if (prev && generation !== null && prev.generation !== null && generation < prev.generation) return s;
    const servers = fresh ? {} : prev.servers;
    return { byKey: { ...s.byKey, [key]: { generation: generation ?? prev?.generation ?? null, servers: { ...servers, [status.name]: status } } } };
  });
}

let following = false;
/** Follow the host feeds (started once, at app start: statuses arrive when an agent starts, before any dialog opens). */
export function followAgentMcpStatus(): void {
  if (following || typeof bridge?.on !== "function") return;
  following = true;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const status = mcpStartupStatusOf(envelope);
    if (status && envelope.cutexSessionId) noteMcpStartup(hostId, envelope.cutexSessionId, envelope.correlation?.runtimeGeneration ?? null, status);
  });
}

/** What the running agent reported for `name`: null = not running, "unknown" = nothing seen this run. */
export function liveStatusOf(live: LiveStatus | undefined, session: Pick<SessionResource, "runtime">, name: string): McpStartupStatus | "unknown" | null {
  if (session.runtime?.status !== "online") return null;
  if (!live || (live.generation !== null && live.generation !== session.runtime.runtimeGeneration)) return "unknown";
  return live.servers[name] ?? "unknown";
}
