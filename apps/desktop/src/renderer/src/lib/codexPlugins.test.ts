import { describe, expect, it } from "vitest";
import type { PluginListResponse, PluginSummary } from "@cutex-desktop/protocol/codex/v2";
import {
  displayPath,
  filterPlugins,
  groupByMarketplace,
  installedRows,
  isInstallable,
  marketplaceRows,
  marketplaceSources,
  normalizeMarketplaceSource,
  pluginComponents,
  pluginKeyPath,
  pluginRows,
  sourceLabel,
} from "./codexPlugins";

const plugin = (name: string, market: string, over: Partial<PluginSummary> = {}): PluginSummary =>
  ({
    id: `${name}@${market}`,
    name,
    remotePluginId: null,
    version: null,
    localVersion: null,
    shareContext: null,
    source: { type: "local", path: `/m/${market}/plugins/${name}` },
    installed: false,
    installedAt: null,
    enabled: false,
    installPolicy: "AVAILABLE",
    installPolicySource: null,
    mustShowInstallationInterstitial: null,
    authPolicy: "ON_INSTALL",
    availability: "AVAILABLE",
    disabledReason: null,
    eligiblePlanTypes: null,
    interface: null,
    keywords: [],
    ...over,
  }) as PluginSummary;

const LIST = {
  marketplaces: [
    {
      name: "openai-curated",
      path: "/home/.tmp/plugins/.agents/plugins/marketplace.json",
      interface: { displayName: "OpenAI Curated" },
      plugins: [
        plugin("linear", "openai-curated", { interface: { displayName: "Linear", shortDescription: "Issues and projects", category: "Productivity" } as never }),
        plugin("github", "openai-curated", { installed: true, enabled: true, keywords: ["git", "pull requests"] }),
      ],
    },
    {
      name: "team",
      path: "/home/.tmp/marketplaces/team/.agents/plugins/marketplace.json",
      interface: null,
      plugins: [plugin("docs.helper", "team", { installed: true, enabled: false }), plugin("gone", "team", { installPolicy: "NOT_AVAILABLE" })],
    },
  ],
  marketplaceLoadErrors: [],
  featuredPluginIds: [],
} as unknown as PluginListResponse;

describe("codexPlugins", () => {
  it("flattens plugin/list into sorted rows per marketplace", () => {
    const rows = pluginRows(LIST);
    expect(rows.map((r) => r.id)).toEqual(["github@openai-curated", "linear@openai-curated", "docs.helper@team", "gone@team"]);
    const linear = rows.find((r) => r.name === "linear")!;
    expect(linear).toMatchObject({ displayName: "Linear", marketplaceDisplay: "OpenAI Curated", category: "Productivity", installable: true });
    expect(rows.find((r) => r.name === "gone")!.installable).toBe(false);
    expect(rows.find((r) => r.name === "github")!.installable).toBe(false);
    expect(pluginRows(null)).toEqual([]);
  });

  it("filters on names, description, category and keywords", () => {
    const rows = pluginRows(LIST);
    expect(filterPlugins(rows, "  ").length).toBe(4);
    expect(filterPlugins(rows, "PULL").map((r) => r.name)).toEqual(["github"]);
    expect(filterPlugins(rows, "issues").map((r) => r.name)).toEqual(["linear"]);
    expect(filterPlugins(rows, "productivity").map((r) => r.name)).toEqual(["linear"]);
    expect(filterPlugins(rows, "@team").map((r) => r.name)).toEqual(["docs.helper", "gone"]);
  });

  it("groups by marketplace and lists installed (enabled first)", () => {
    const rows = pluginRows(LIST);
    expect(groupByMarketplace(rows).map((g) => [g.marketplace, g.rows.length])).toEqual([["openai-curated", 2], ["team", 2]]);
    expect(installedRows(rows).map((r) => r.id)).toEqual(["github@openai-curated", "docs.helper@team"]);
  });

  it("quotes plugin ids in config key paths", () => {
    expect(pluginKeyPath("docs.helper@team")).toBe('plugins."docs.helper@team"');
    expect(pluginKeyPath('a"b\\c@m')).toBe('plugins."a\\"b\\\\c@m"');
  });

  it("summarizes components and flags code execution", () => {
    const quiet = pluginComponents({ skills: [{ name: "x:hello", description: "", shortDescription: null, interface: null, path: null, enabled: true }], mcpServers: [], hooks: [], apps: [] });
    expect(quiet).toMatchObject({ skills: ["x:hello"], runsCode: false, scheduledTasks: [] });
    const loud = pluginComponents({
      skills: [],
      mcpServers: ["linear"],
      hooks: [{ key: "a", eventName: "preToolUse" }, { key: "b", eventName: "preToolUse" }] as never,
      apps: [{ id: "c", name: "Linear app", description: null, installUrl: null, category: null }],
    });
    expect(loud).toMatchObject({ mcpServers: ["linear"], hooks: ["preToolUse"], apps: ["Linear app"], runsCode: true });
    expect(pluginComponents({ skills: [], mcpServers: [], hooks: [{ key: "h", eventName: "stop" }] as never, apps: [] }).runsCode).toBe(true);
  });

  it("derives marketplace rows from plugin/list + config sources", () => {
    const sources = marketplaceSources({
      marketplaces: {
        team: { source_type: "git", source: "https://example.com/team.git", ref: "main", last_updated: "2026-10-08" },
        "openai-bundled": { source_type: "local", source: "/home/.tmp/bundled-marketplaces/openai-bundled" },
        broken: { source_type: "local", source: "/missing" },
      },
    });
    expect(sources.team).toEqual({ sourceType: "git", source: "https://example.com/team.git", ref: "main", lastUpdated: "2026-10-08" });
    const rows = marketplaceRows(LIST, sources);
    expect(rows.map((m) => [m.name, m.plugins, m.installed, m.canUpgrade, m.canRemove])).toEqual([
      ["openai-curated", 2, 1, false, false],
      ["team", 2, 1, true, true],
      ["openai-bundled", 0, 0, false, false],
      ["broken", 0, 0, false, true],
    ]);
    expect(marketplaceSources(null)).toEqual({});
  });

  it("parses marketplace sources with an optional #ref", () => {
    expect(normalizeMarketplaceSource("  owner/repo ")).toEqual({ source: "owner/repo", refName: null });
    expect(normalizeMarketplaceSource("owner/repo#v2")).toEqual({ source: "owner/repo", refName: "v2" });
    expect(normalizeMarketplaceSource("https://x/y.git#")).toEqual({ source: "https://x/y.git", refName: null });
    expect(normalizeMarketplaceSource("   ")).toBeNull();
  });

  it("strips the Windows verbatim prefix", () => {
    expect(displayPath("\\\\?\\C:\\Users\\x")).toBe("C:\\Users\\x");
    expect(displayPath("\\\\?\\UNC\\srv\\share")).toBe("\\\\srv\\share");
    expect(displayPath("/home/x")).toBe("/home/x");
  });

  it("labels sources and installability", () => {
    expect(sourceLabel({ type: "git", url: "https://g/x.git", path: "plugins/a", refName: "main", sha: null })).toBe("https://g/x.git plugins/a #main");
    expect(sourceLabel({ type: "npm", package: "@s/p", version: "1.2", registry: null })).toBe("npm:@s/p@1.2");
    expect(sourceLabel({ type: "remote" })).toBe("remote");
    expect(isInstallable({ installed: false, installPolicy: "AVAILABLE", availability: "DISABLED_BY_ADMIN" })).toBe(false);
    expect(isInstallable({ installed: false, installPolicy: "INSTALLED_BY_DEFAULT", availability: "AVAILABLE" })).toBe(true);
  });
});
