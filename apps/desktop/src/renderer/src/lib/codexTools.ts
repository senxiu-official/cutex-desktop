// Pure helpers for Settings → 工具 (MCP / 技能 / 钩子 / 插件): config keyPaths, the hook trust
// writes (same edits as cute-codex's TUI, tui/src/hooks_rpc.rs + app/background_requests.rs), the
// MCP server edit diff that never writes a redacted secret back, and args / SKILL.md parsing.
// All writes go through cutex `POST /v2/codex/requests` (`config/batchWrite`), which refuses any
// edit containing the redaction placeholder.
import type { ConfigEdit, HookMetadata, HookSource, HookTrustStatus, HooksListResponse } from "@cutex-desktop/protocol/codex/v2";

/** What cutex puts in place of a secret on `config/read` (management/v2/codex_config.rs REDACTED). */
export const REDACTED = "<redacted>";

/** One keyPath segment, quoted (codex `parse_key_path`: `"…"` with `\` escapes; dots inside stay). */
export function quoteKey(segment: string): string {
  return `"${segment.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function hookNeedsReview(hook: Pick<HookMetadata, "trustStatus">): boolean {
  return hook.trustStatus === "untrusted" || hook.trustStatus === "modified";
}

const hookStatePath = (key: string, field: "trusted_hash" | "enabled") => `hooks.state.${quoteKey(key)}.${field}`;

/** Trust = record the hook's current hash (`hooks.state."<key>".trusted_hash`). */
export function hookTrustEdits(hooks: readonly Pick<HookMetadata, "key" | "currentHash">[]): ConfigEdit[] {
  return hooks.map((h) => ({ keyPath: hookStatePath(h.key, "trusted_hash"), value: h.currentHash, mergeStrategy: "upsert" }));
}

/** Revoke = clear the stored hash, so the hook is untrusted again. */
export function hookRevokeEdits(hooks: readonly Pick<HookMetadata, "key">[]): ConfigEdit[] {
  return hooks.map((h) => ({ keyPath: hookStatePath(h.key, "trusted_hash"), value: null, mergeStrategy: "replace" }));
}

export function hookEnabledEdit(key: string, enabled: boolean): ConfigEdit {
  return { keyPath: hookStatePath(key, "enabled"), value: enabled, mergeStrategy: "upsert" };
}

/** user / project / one group per plugin / managed (system, MDM, cloud…) / other. */
export type HookGroupKind = "user" | "project" | "plugin" | "managed" | "other";
export interface HookGroup {
  id: string;
  kind: HookGroupKind;
  /** Plugin id for `plugin` groups. */
  pluginId: string | null;
  hooks: HookMetadata[];
}

const MANAGED_SOURCES: readonly HookSource[] = ["system", "mdm", "cloudRequirements", "cloudManagedConfig", "legacyManagedConfigFile", "legacyManagedConfigMdm"];
const KIND_ORDER: HookGroupKind[] = ["user", "project", "plugin", "managed", "other"];

function hookKind(h: HookMetadata): HookGroupKind {
  if (h.source === "plugin" || h.pluginId) return "plugin";
  if (h.source === "user" || h.source === "project") return h.source;
  if (h.isManaged || MANAGED_SOURCES.includes(h.source)) return "managed";
  return "other";
}

/** All hooks of a `hooks/list` answer (deduplicated by key across cwds), grouped by source. */
export function groupHooks(entries: HooksListResponse["data"]): HookGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, HookGroup>();
  for (const entry of entries) {
    for (const h of entry.hooks) {
      if (seen.has(h.key)) continue;
      seen.add(h.key);
      const kind = hookKind(h);
      const pluginId = kind === "plugin" ? (h.pluginId ?? "?") : null;
      const id = pluginId ? `plugin:${pluginId}` : kind;
      const group = groups.get(id) ?? { id, kind, pluginId, hooks: [] };
      group.hooks.push(h);
      groups.set(id, group);
    }
  }
  for (const g of groups.values()) g.hooks.sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder) || a.key.localeCompare(b.key));
  return [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.pluginId ?? "").localeCompare(b.pluginId ?? ""));
}

/** What a hook runs: the command line, `server · tool` for an MCP tool, or the handler type. */
export function hookHandlerText(h: HookMetadata): string {
  if (h.handlerType === "command") return h.command;
  if (h.handlerType === "mcpTool") return `${h.server} · ${h.tool}`;
  return h.handlerType;
}

export const HOOK_TRUST_TONE: Record<HookTrustStatus, string> = {
  trusted: "text-accent",
  untrusted: "text-warn",
  modified: "text-warn",
  managed: "text-subtle",
};

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

/** One `[mcp_servers.<name>]` table as `config/read` returns it (secrets redacted). */
export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  bearer_token_env_var?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  enabled?: boolean;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled_tools?: string[];
  disabled_tools?: string[];
  [k: string]: unknown;
};

/** Args: one per line (no splitting on spaces, so quoted / spaced values stay whole); blank lines dropped. */
export function parseArgLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatArgLines(args: readonly string[] | undefined): string {
  return (args ?? []).join("\n");
}

/** One key / value of a map field (env, headers). `kept`: an existing secret left as it is. */
export interface MapEntry {
  key: string;
  value: string;
  /** Key exists in the saved config (its name is fixed; remove + add to rename). */
  existing: boolean;
  /** Existing secret whose value was not touched: never written back. */
  kept: boolean;
}

export function mapEntries(map: Record<string, string> | undefined): MapEntry[] {
  return Object.entries(map ?? {}).map(([key, value]) => (value === REDACTED ? { key, value: "", existing: true, kept: true } : { key, value, existing: true, kept: false }));
}

export interface McpDraft {
  transport: "stdio" | "http";
  command: string;
  args: string;
  cwd: string;
  env: MapEntry[];
  url: string;
  bearerTokenEnvVar: string;
  httpHeaders: MapEntry[];
  envHttpHeaders: MapEntry[];
  startupTimeoutSec: number | null;
  toolTimeoutSec: number | null;
  enabledTools: string[] | null;
  disabledTools: string[];
}

export function emptyMcpDraft(): McpDraft {
  return { transport: "stdio", command: "", args: "", cwd: "", env: [], url: "", bearerTokenEnvVar: "", httpHeaders: [], envHttpHeaders: [], startupTimeoutSec: null, toolTimeoutSec: null, enabledTools: null, disabledTools: [] };
}

export function mcpDraftFrom(cfg: McpServerConfig): McpDraft {
  return {
    transport: cfg.url !== undefined && cfg.command === undefined ? "http" : "stdio",
    command: cfg.command ?? "",
    args: formatArgLines(cfg.args),
    cwd: cfg.cwd ?? "",
    env: mapEntries(cfg.env),
    url: cfg.url ?? "",
    bearerTokenEnvVar: cfg.bearer_token_env_var ?? "",
    httpHeaders: mapEntries(cfg.http_headers),
    envHttpHeaders: mapEntries(cfg.env_http_headers),
    startupTimeoutSec: typeof cfg.startup_timeout_sec === "number" ? cfg.startup_timeout_sec : null,
    toolTimeoutSec: typeof cfg.tool_timeout_sec === "number" ? cfg.tool_timeout_sec : null,
    enabledTools: cfg.enabled_tools ?? null,
    disabledTools: cfg.disabled_tools ?? [],
  };
}

export function toolEnabled(draft: Pick<McpDraft, "enabledTools" | "disabledTools">, tool: string): boolean {
  return (draft.enabledTools === null || draft.enabledTools.includes(tool)) && !draft.disabledTools.includes(tool);
}

/** Turn one tool on / off: off adds it to disabled_tools; on removes it there and, when an allow-list exists, adds it to it. */
export function setToolEnabled<D extends Pick<McpDraft, "enabledTools" | "disabledTools">>(draft: D, tool: string, on: boolean): D {
  if (on) {
    return {
      ...draft,
      disabledTools: draft.disabledTools.filter((t) => t !== tool),
      enabledTools: draft.enabledTools && !draft.enabledTools.includes(tool) ? [...draft.enabledTools, tool] : draft.enabledTools,
    };
  }
  return draft.disabledTools.includes(tool) ? draft : { ...draft, disabledTools: [...draft.disabledTools, tool] };
}

const sameList = (a: readonly string[] | undefined | null, b: readonly string[] | undefined | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A map field's changes: the values to set (`set`) and the keys to clear. Kept secrets are omitted. */
function mapDiff(original: Record<string, string> | undefined, entries: readonly MapEntry[]): { set: Record<string, string>; clear: string[] } {
  const set: Record<string, string> = {};
  const live = new Set<string>();
  for (const e of entries) {
    const key = e.key.trim();
    if (!key) continue;
    live.add(key);
    if (e.kept) continue;
    if (original?.[key] === e.value) continue;
    set[key] = e.value;
  }
  const clear = Object.keys(original ?? {}).filter((k) => !live.has(k));
  return { set, clear };
}

export function mcpDraftErrors(draft: McpDraft): ("command" | "url" | "redacted" | "duplicateKey")[] {
  const errors: ("command" | "url" | "redacted" | "duplicateKey")[] = [];
  if (draft.transport === "stdio" && !draft.command.trim()) errors.push("command");
  if (draft.transport === "http" && !draft.url.trim()) errors.push("url");
  const maps = draft.transport === "stdio" ? [draft.env] : [draft.httpHeaders, draft.envHttpHeaders];
  for (const m of maps) {
    const keys = m.map((e) => e.key.trim()).filter(Boolean);
    if (new Set(keys).size !== keys.length) errors.push("duplicateKey");
    if (m.some((e) => !e.kept && e.value === REDACTED)) errors.push("redacted");
  }
  return [...new Set(errors)];
}

/**
 * `config/batchWrite` edits turning `original` (null = new server) into `draft`: one upsert of the
 * changed fields (codex deep-merges tables, so untouched env / header secrets stay as they are)
 * plus a null edit per removed field / key. Never contains {@link REDACTED}.
 */
export function mcpServerEdits(name: string, original: McpServerConfig | null, draft: McpDraft): ConfigEdit[] {
  const base = `mcp_servers.${quoteKey(name)}`;
  const orig: McpServerConfig = original ?? {};
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  const scalar = (field: keyof McpServerConfig & string, value: string | number | null) => {
    const empty = value === null || value === "";
    if (empty) {
      if (orig[field] !== undefined) clear.push(`${base}.${field}`);
    } else if (orig[field] !== value) set[field] = value;
  };
  const list = (field: "args" | "enabled_tools" | "disabled_tools", value: string[] | null, clearWhenEmpty: boolean) => {
    if (value === null || (clearWhenEmpty && value.length === 0)) {
      if (orig[field] !== undefined) clear.push(`${base}.${field}`);
    } else if (!sameList(orig[field] as string[] | undefined, value)) set[field] = value;
  };
  const map = (field: "env" | "http_headers" | "env_http_headers", entries: readonly MapEntry[]) => {
    const before = orig[field] as Record<string, string> | undefined;
    // Every key removed: drop the whole table instead of leaving an empty one.
    if (!entries.some((e) => e.key.trim())) {
      if (before !== undefined) clear.push(`${base}.${field}`);
      return;
    }
    const d = mapDiff(before, entries);
    if (Object.keys(d.set).length) set[field] = d.set;
    for (const k of d.clear) clear.push(`${base}.${field}.${quoteKey(k)}`);
  };
  const drop = (...fields: string[]) => {
    for (const f of fields) if (orig[f] !== undefined) clear.push(`${base}.${f}`);
  };

  if (draft.transport === "stdio") {
    scalar("command", draft.command.trim());
    list("args", parseArgLines(draft.args), true);
    scalar("cwd", draft.cwd.trim());
    map("env", draft.env);
    drop("url", "bearer_token_env_var", "http_headers", "env_http_headers");
  } else {
    scalar("url", draft.url.trim());
    scalar("bearer_token_env_var", draft.bearerTokenEnvVar.trim());
    map("http_headers", draft.httpHeaders);
    map("env_http_headers", draft.envHttpHeaders);
    drop("command", "args", "env", "env_vars", "cwd");
  }
  scalar("startup_timeout_sec", draft.startupTimeoutSec);
  scalar("tool_timeout_sec", draft.toolTimeoutSec);
  list("enabled_tools", draft.enabledTools, false);
  list("disabled_tools", draft.disabledTools, true);

  const edits: ConfigEdit[] = [];
  if (Object.keys(set).length || !original) edits.push({ keyPath: base, value: set as ConfigEdit["value"], mergeStrategy: "upsert" });
  for (const keyPath of clear) edits.push({ keyPath, value: null, mergeStrategy: "replace" });
  if (JSON.stringify(edits).includes(JSON.stringify(REDACTED))) throw new Error("refusing to write a redacted secret back");
  return edits;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** `SkillMetadata.path` is the SKILL.md itself; tolerate a skill directory too. */
export function skillMdPath(path: string): string {
  return /(^|[\\/])SKILL\.md$/i.test(path) ? path : `${path.replace(/[\\/]+$/, "")}${path.includes("\\") ? "\\" : "/"}SKILL.md`;
}

/** SKILL.md without its leading YAML front matter (name / description are shown above it). */
export function stripFrontMatter(text: string): string {
  const m = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length).replace(/^\s*\n/, "") : text;
}
