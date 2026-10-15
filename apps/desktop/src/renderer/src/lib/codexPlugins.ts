// Pure helpers for Settings → 插件 (codex plugins / marketplaces on the shared CODEX_HOME through
// cutex `POST /v2/codex/requests`, capability `codex-plugins`; docs/research/codex-plugins.md).
import type { PluginDetail, PluginListResponse, PluginSource, PluginSummary } from "@cutex-desktop/protocol/codex/v2";

export const CODEX_PLUGINS_FEATURE = "codex-plugins";

export type PluginRow = {
  id: string;
  name: string;
  displayName: string;
  marketplace: string;
  marketplaceDisplay: string;
  /** marketplace.json path (plugin/read / plugin/install `marketplacePath`); null for remote-only. */
  marketplacePath: string | null;
  description: string | null;
  category: string | null;
  developer: string | null;
  keywords: string[];
  installed: boolean;
  enabled: boolean;
  installable: boolean;
  source: string;
};

/** Marketplaces Cutex treats as built in (not removable from the UI). */
export function isOfficialMarketplace(name: string): boolean {
  return name.startsWith("openai-");
}

/** Drop the Windows verbatim prefix (`\\?\`) that canonical paths from cutex / codex keep. */
export function displayPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}

export function sourceLabel(source: PluginSource | null | undefined): string {
  if (!source) return "";
  switch (source.type) {
    case "local":
      return displayPath(source.path);
    case "git":
      return [source.url, source.path, source.refName && `#${source.refName}`].filter(Boolean).join(" ");
    case "npm":
      return `npm:${source.package}${source.version ? `@${source.version}` : ""}`;
    default:
      return "remote";
  }
}

export function isInstallable(summary: Pick<PluginSummary, "installed" | "installPolicy" | "availability">): boolean {
  return !summary.installed && summary.installPolicy !== "NOT_AVAILABLE" && (summary.availability ?? "AVAILABLE") === "AVAILABLE";
}

/** Flatten plugin/list into rows (marketplace order kept, plugins by display name). */
export function pluginRows(list: Pick<PluginListResponse, "marketplaces"> | null | undefined): PluginRow[] {
  const rows: PluginRow[] = [];
  for (const m of list?.marketplaces ?? []) {
    const plugins = m.plugins.map((p): PluginRow => ({
      id: p.id,
      name: p.name,
      displayName: p.interface?.displayName || p.name,
      marketplace: m.name,
      marketplaceDisplay: m.interface?.displayName || m.name,
      marketplacePath: m.path ?? null,
      description: p.interface?.shortDescription ?? null,
      category: p.interface?.category ?? null,
      developer: p.interface?.developerName ?? null,
      keywords: p.keywords ?? [],
      installed: p.installed,
      enabled: p.enabled,
      installable: isInstallable(p),
      source: sourceLabel(p.source),
    }));
    plugins.sort((a, b) => a.displayName.localeCompare(b.displayName));
    rows.push(...plugins);
  }
  return rows;
}

/** Case-insensitive substring match over names, id, description, category, developer, keywords. */
export function filterPlugins(rows: PluginRow[], query: string): PluginRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.displayName, r.name, r.id, r.description, r.category, r.developer, ...r.keywords].some((field) => field?.toLowerCase().includes(q)),
  );
}

export function groupByMarketplace(rows: PluginRow[]): { marketplace: string; display: string; rows: PluginRow[] }[] {
  const groups = new Map<string, { marketplace: string; display: string; rows: PluginRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.marketplace) ?? { marketplace: r.marketplace, display: r.marketplaceDisplay, rows: [] };
    g.rows.push(r);
    groups.set(r.marketplace, g);
  }
  return [...groups.values()];
}

/** Installed plugins, enabled first. */
export function installedRows(rows: PluginRow[]): PluginRow[] {
  return rows.filter((r) => r.installed).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.displayName.localeCompare(b.displayName));
}

/** config keyPath of a plugin entry; the id is quoted (plugin names may contain dots). */
export function pluginKeyPath(id: string): string {
  return `plugins."${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type PluginComponents = {
  skills: string[];
  mcpServers: string[];
  hooks: string[];
  apps: string[];
  scheduledTasks: string[];
  /** MCP servers or hooks: the plugin starts processes / runs commands inside agents. */
  runsCode: boolean;
};

export function pluginComponents(detail: Pick<PluginDetail, "skills" | "mcpServers" | "hooks" | "apps"> & { scheduledTasks?: PluginDetail["scheduledTasks"] }): PluginComponents {
  const hooks = [...new Set((detail.hooks ?? []).map((h) => h.eventName))];
  const mcpServers = detail.mcpServers ?? [];
  return {
    skills: (detail.skills ?? []).map((s) => s.interface?.displayName || s.name),
    mcpServers,
    hooks,
    apps: (detail.apps ?? []).map((a) => a.name),
    scheduledTasks: (detail.scheduledTasks ?? []).map((s) => s.name),
    runsCode: mcpServers.length > 0 || (detail.hooks ?? []).length > 0,
  };
}

export type MarketplaceSource = { sourceType: string | null; source: string | null; ref: string | null; lastUpdated: string | null };

/** `[marketplaces.*]` of config/read → source facts by marketplace name. */
export function marketplaceSources(config: Record<string, unknown> | null | undefined): Record<string, MarketplaceSource> {
  const table = (config?.marketplaces ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return Object.fromEntries(
    Object.entries(table).map(([name, m]) => [name, { sourceType: str(m?.source_type), source: typeof m?.source === "string" ? displayPath(m.source) : null, ref: str(m?.ref), lastUpdated: str(m?.last_updated) }]),
  );
}

export type MarketplaceRow = {
  name: string;
  display: string;
  path: string | null;
  plugins: number;
  installed: number;
  official: boolean;
  configured: MarketplaceSource | null;
  /** Only configured git marketplaces can be upgraded. */
  canUpgrade: boolean;
  /** User-added (configured, not built in) marketplaces can be removed. */
  canRemove: boolean;
};

export function marketplaceRows(list: Pick<PluginListResponse, "marketplaces"> | null | undefined, sources: Record<string, MarketplaceSource>): MarketplaceRow[] {
  const listed = (list?.marketplaces ?? []).map((m): MarketplaceRow => {
    const configured = sources[m.name] ?? null;
    const official = isOfficialMarketplace(m.name);
    return {
      name: m.name,
      display: m.interface?.displayName || m.name,
      path: m.path ? displayPath(m.path) : null,
      plugins: m.plugins.length,
      installed: m.plugins.filter((p) => p.installed).length,
      official,
      configured,
      canUpgrade: configured?.sourceType === "git",
      canRemove: !!configured && !official,
    };
  });
  // Configured but not listed (failed to load): still removable.
  for (const [name, configured] of Object.entries(sources)) {
    if (listed.some((m) => m.name === name)) continue;
    const official = isOfficialMarketplace(name);
    listed.push({ name, display: name, path: null, plugins: 0, installed: 0, official, configured, canUpgrade: configured.sourceType === "git", canRemove: !official });
  }
  return listed;
}

/** Trim a marketplace/add source; `owner/repo`, git URL or absolute local path. */
export function normalizeMarketplaceSource(input: string): { source: string; refName: string | null } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // `source#ref` like the TUI.
  const hash = trimmed.lastIndexOf("#");
  if (hash > 0) {
    const ref = trimmed.slice(hash + 1).trim();
    return { source: trimmed.slice(0, hash).trim(), refName: ref || null };
  }
  return { source: trimmed, refName: null };
}
