// Pure helpers for the composer's "+" menu (DESIGN §4.3): draft token insertion, skill and MCP
// status summaries. Kept out of components/*.tsx so Fast Refresh works and they are unit-tested.
import type { McpServerStatus, SkillMetadata } from "@cutex-desktop/protocol/codex/v2";

/** Append `token` to the draft, separated by a space unless the draft is empty or ends in whitespace. */
export function appendToken(text: string, token: string): string {
  return `${text}${text && !/\s$/.test(text) ? " " : ""}${token}`;
}

/** Skills sorted for the menus: enabled first, then by name. */
export function sortSkills<T extends Pick<SkillMetadata, "name" | "enabled">>(skills: readonly T[]): T[] {
  return [...skills].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

/** "enabled / total" for the 技能 row. */
export function skillsSummary(skills: readonly Pick<SkillMetadata, "enabled">[] | null): string | null {
  if (!skills) return null;
  return `${skills.filter((s) => s.enabled).length}/${skills.length}`;
}

export type McpTone = "ok" | "warn" | "error" | "muted";
export interface McpState {
  /** i18n suffix: `composer.tools.mcp.state.<key>`. */
  key: "connected" | "starting" | "auth" | "failed" | "disabled" | "tools" | "unknown";
  tone: McpTone;
  tools: number;
}

/**
 * Status of one server from `mcpServerStatus/list`. cutex runs that on a config app-server with no
 * thread, so `runtimeStatus` is often null; then a tool catalog means it started, `toolsError` that
 * it failed.
 */
export function mcpState(s: Pick<McpServerStatus, "runtimeStatus" | "tools" | "toolsError" | "authStatus">): McpState {
  const tools = Object.keys(s.tools ?? {}).length;
  switch (s.runtimeStatus) {
    case "connected":
      return { key: "connected", tone: "ok", tools };
    case "starting":
    case "notStarted":
      return { key: "starting", tone: "muted", tools };
    case "authenticationRequired":
      return { key: "auth", tone: "warn", tools };
    case "failed":
    case "cancelled":
      return { key: "failed", tone: "error", tools };
    case "disabled":
      return { key: "disabled", tone: "muted", tools };
  }
  if (s.toolsError) return { key: "failed", tone: "error", tools };
  if (s.authStatus === "notLoggedIn") return { key: "auth", tone: "warn", tools };
  if (tools > 0) return { key: "tools", tone: "ok", tools };
  return { key: "unknown", tone: "muted", tools };
}

/** "2/3" connected-ish servers for the MCP row; errors win the tone. */
export function mcpSummary(servers: readonly McpServerStatus[] | null): { text: string; tone: McpTone } | null {
  if (!servers) return null;
  const states = servers.map(mcpState);
  const ok = states.filter((s) => s.tone === "ok").length;
  const tone: McpTone = states.some((s) => s.tone === "error") ? "error" : states.some((s) => s.tone === "warn") ? "warn" : ok > 0 ? "ok" : "muted";
  return { text: `${ok}/${servers.length}`, tone };
}
