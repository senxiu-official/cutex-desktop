// Per-agent MCP on / off (cutex `scoped-mcp`, upstream/cutex src/management/v2/scoped_mcp.rs):
// `GET /v2/sessions/{id}/mcp/effective` is the merged configuration this agent launches with (shared
// CODEX_HOME + project + agent layers, cutex built-ins), `GET|PUT /v2/sessions/{id}/mcp` the agent layer
// whose `disabled` names turn inherited servers off for this agent only. Changes apply at the agent's
// next launch (`appliesOn`). What is actually connected now is not in these routes: the desktop shows
// the last native `mcpServer/startupStatus/updated` it saw on the agent's stream.

export const SCOPED_MCP_FEATURE = "scoped-mcp";
export const MCP_STARTUP_STATUS_METHOD = "mcpServer/startupStatus/updated";

/** Where a server's configuration comes from: cutex built-in, shared CODEX_HOME config.toml, project, this agent. */
export type McpLayer = "builtin" | "global" | "project" | "agent";

export interface AgentMcpServer {
  name: string;
  /** The highest layer that defines it. */
  layer: McpLayer | string;
  layers: string[];
  /** On in the configuration this agent launches with. */
  enabled: boolean;
  /** Why it is off: "agent" (this agent's switch), "config" (`enabled = false` in its config), "cutex" (built-in not active). */
  disabledBy: "agent" | "config" | "cutex" | string | null;
  /** Transport summary from the (redacted) merged config. */
  transport: "stdio" | "http" | null;
}

export interface AgentMcpView {
  cutexSessionId: string;
  /** The agent layer's revision (PUT expectedRevision). */
  revision: number;
  /** Names this agent turns off. */
  disabled: string[];
  /** Names the agent layer defines itself (cutex refuses to also disable those). */
  agentServers: string[];
  /** cutex's word for when a change applies ("next launch"). */
  appliesOn: string | null;
  servers: AgentMcpServer[];
}

/** `code`: cutex error (`revision_conflict`, `invalid_mcp_config`, `session_not_found`, …), `unsupported`, `unreachable`. */
export type AgentMcpResult = { ok: true; view: AgentMcpView } | { ok: false; code: string; message: string };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function transportOf(config: unknown): AgentMcpServer["transport"] {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (typeof c.url === "string") return "http";
  if (typeof c.command === "string") return "stdio";
  return null;
}

/** The agent's view from cutex's two answers; null when they aren't the scoped-MCP shapes. */
export function agentMcpView(sessionId: string, scope: unknown, effective: unknown): AgentMcpView | null {
  if (!scope || typeof scope !== "object" || !effective || typeof effective !== "object") return null;
  const s = scope as Record<string, unknown>;
  const e = effective as Record<string, unknown>;
  if (typeof s.revision !== "number" || !Array.isArray(e.servers)) return null;
  const servers = e.servers.flatMap((raw): AgentMcpServer[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) return [];
    return [{
      name: r.name,
      layer: typeof r.layer === "string" ? r.layer : "global",
      layers: strings(r.layers),
      enabled: r.enabled === true,
      disabledBy: typeof r.disabledBy === "string" ? r.disabledBy : null,
      transport: transportOf(r.config),
    }];
  });
  return {
    cutexSessionId: sessionId,
    revision: s.revision,
    disabled: strings(s.disabled),
    agentServers: s.servers && typeof s.servers === "object" ? Object.keys(s.servers as object) : [],
    appliesOn: typeof e.appliesOn === "string" ? e.appliesOn : null,
    servers,
  };
}

/** This agent can switch it: an inherited (shared / project) server; built-ins and the agent's own servers cannot. */
export function switchable(view: AgentMcpView, server: AgentMcpServer): boolean {
  return server.layer !== "builtin" && !view.agentServers.includes(server.name);
}

/** Startup state of one server as the native reported it (`McpServerStartupState`). */
export type McpStartupState = "starting" | "ready" | "failed" | "cancelled";

export interface McpStartupStatus {
  name: string;
  status: McpStartupState;
  error: string | null;
  /** cutex receivedAt of the notification. */
  at: string | null;
}

/** A native `mcpServer/startupStatus/updated` notification's status, else null. */
export function mcpStartupStatusOf(envelope: { native?: { message?: { method?: string; params?: unknown } } | null; receivedAt?: string } | null | undefined): McpStartupStatus | null {
  const message = envelope?.native?.message;
  if (message?.method !== MCP_STARTUP_STATUS_METHOD) return null;
  const p = message.params as Record<string, unknown> | undefined;
  if (!p || typeof p.name !== "string" || !["starting", "ready", "failed", "cancelled"].includes(p.status as string)) return null;
  return { name: p.name, status: p.status as McpStartupState, error: typeof p.error === "string" && p.error ? p.error : null, at: typeof envelope?.receivedAt === "string" ? envelope.receivedAt : null };
}
