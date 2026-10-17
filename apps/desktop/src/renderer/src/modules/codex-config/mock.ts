// Browser-preview data for codex-config (dev/mockTypes.ts): the shared CODEX_HOME config requests
// (MCP servers, skills, hooks, experimental features) and codex plugins / marketplaces (Settings → 插件;
// cutex `codex-plugins`).
import type { ModuleMock } from "../../dev/mockTypes";
import type { SkillArchiveRecord } from "../../../../shared/skillsArchive";
// Shapes follow the r207 codex-app-server answers captured by cutex's live_plugins_smoke.
const HOME = "C:\\Users\\sam\\.cutex\\codex-home";

type MockPlugin = {
  name: string;
  displayName: string;
  description: string;
  category?: string;
  developer?: string;
  website?: string;
  keywords?: string[];
  skills: string[];
  mcpServers: string[];
  hooks: string[];
  apps: string[];
  installPolicy?: "AVAILABLE" | "NOT_AVAILABLE" | "INSTALLED_BY_DEFAULT";
};
type MockMarket = { name: string; displayName: string | null; path: string; source?: { source_type: string; source: string; ref?: string; last_updated?: string }; plugins: MockPlugin[] };

const markets: MockMarket[] = [
  {
    name: "openai-curated",
    displayName: "OpenAI Curated",
    path: `${HOME}\\.tmp\\plugins\\.agents\\plugins\\marketplace.json`,
    plugins: [
      { name: "github", displayName: "GitHub", description: "Issues, pull requests and code review from GitHub.", category: "Coding", developer: "OpenAI", website: "https://github.com", keywords: ["git", "pr"], skills: ["github:review-pr", "github:triage"], mcpServers: ["github"], hooks: [], apps: ["GitHub"] },
      { name: "linear", displayName: "Linear", description: "Plan and track issues in Linear.", category: "Productivity", developer: "OpenAI", skills: ["linear:issues"], mcpServers: ["linear"], hooks: [], apps: [] },
      { name: "notion", displayName: "Notion", description: "Search and edit Notion pages.", category: "Productivity", developer: "OpenAI", skills: ["notion:pages"], mcpServers: [], hooks: [], apps: ["Notion"] },
      { name: "openai-developers", displayName: "OpenAI Developers", description: "Docs and API reference for building with OpenAI.", category: "Coding", developer: "OpenAI", skills: ["openai-docs"], mcpServers: [], hooks: [], apps: [] },
    ],
  },
  {
    name: "openai-bundled",
    displayName: "OpenAI Bundled",
    path: `${HOME}\\.tmp\\bundled-marketplaces\\openai-bundled\\.agents\\plugins\\marketplace.json`,
    source: { source_type: "local", source: `\\\\?\\${HOME}\\.tmp\\bundled-marketplaces\\openai-bundled` },
    plugins: [
      { name: "visualize", displayName: "Visualize", description: "Charts and diagrams inline.", category: "Productivity", skills: ["visualize"], mcpServers: [], hooks: [], apps: [] },
      { name: "browser", displayName: "Browser", description: "Drive a headless browser.", category: "Tools", skills: ["browser"], mcpServers: ["node_repl"], hooks: [], apps: [] },
    ],
  },
  {
    name: "team-tools",
    displayName: null,
    path: `${HOME}\\.tmp\\marketplaces\\team-tools\\.agents\\plugins\\marketplace.json`,
    source: { source_type: "git", source: "https://github.com/example/team-tools.git", ref: "main", last_updated: "2026-10-07T21:14:03Z" },
    plugins: [
      { name: "commit.guard", displayName: "Commit guard", description: "Blocks commits that touch generated files.", category: "Coding", developer: "Example team", skills: [], mcpServers: [], hooks: ["preToolUse", "stop"], apps: [] },
      { name: "format.on.stop", displayName: "Format on stop", description: "Runs the formatter when a turn ends.", category: "Coding", developer: "Example team", skills: [], mcpServers: [], hooks: ["stop", "postToolUse"], apps: [] },
      { name: "sql-notes", displayName: "SQL notes", description: "Query the team analytics warehouse.", developer: "Example team", skills: ["sql-notes:query"], mcpServers: ["warehouse"], hooks: [], apps: [] },
      { name: "legacy", displayName: "Legacy helper", description: "No longer offered.", skills: ["legacy"], mcpServers: [], hooks: [], apps: [], installPolicy: "NOT_AVAILABLE" },
    ],
  },
];
// installed: id → enabled
const installed = new Map<string, boolean>([
  ["github@openai-curated", true],
  ["visualize@openai-bundled", true],
  ["browser@openai-bundled", true],
  ["commit.guard@team-tools", true],
]);

/** A plugin's hooks as codex keys them (`<pluginId>:<file>:<event>:<group>:<handler>`). */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function pluginHookKeys(m: MockMarket, p: MockPlugin) {
  return p.hooks.map((eventName, i) => ({ key: `${p.name}@${m.name}:hooks/hooks.json:${snake(eventName)}:${i}:0`, eventName }));
}

const summary = (m: MockMarket, p: MockPlugin) => ({
  id: `${p.name}@${m.name}`,
  name: p.name,
  remotePluginId: null,
  version: null,
  localVersion: installed.has(`${p.name}@${m.name}`) ? "1.0.0" : null,
  shareContext: null,
  source: { type: "local", path: m.path.replace(/\\\.agents\\plugins\\marketplace\.json$/, `\\plugins\\${p.name}`) },
  installed: installed.has(`${p.name}@${m.name}`),
  installedAt: null,
  enabled: installed.get(`${p.name}@${m.name}`) ?? false,
  installPolicy: p.installPolicy ?? "AVAILABLE",
  installPolicySource: null,
  mustShowInstallationInterstitial: null,
  authPolicy: "ON_INSTALL",
  availability: "AVAILABLE",
  disabledReason: null,
  eligiblePlanTypes: null,
  interface: { displayName: p.displayName, shortDescription: p.description, longDescription: null, developerName: p.developer ?? null, category: p.category ?? null, capabilities: [], websiteUrl: p.website ?? null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: null, brandColor: null, composerIcon: null, composerIconUrl: null, logo: null, logoDark: null, logoUrl: null, logoUrlDark: null, screenshots: [], screenshotUrls: [] },
  keywords: p.keywords ?? [],
});

function find(marketplacePath: unknown, pluginName: unknown) {
  const m = markets.find((x) => x.path === marketplacePath);
  const p = m?.plugins.find((x) => x.name === pluginName);
  if (!m || !p) throw new Error(`plugin ${String(pluginName)} not found`);
  return { m, p };
}

/** Marketplaces table for the mock config/read. */
function mockMarketplaceConfig(): Record<string, unknown> {
  return Object.fromEntries(markets.filter((m) => m.source).map((m) => [m.name, m.source]));
}

/** config/value/write `plugins."<id>"` {enabled}: true when handled. */
function mockPluginEnabledWrite(keyPath: string | undefined, value: unknown): boolean {
  const id = /^plugins\."(.+)"$/.exec(keyPath ?? "")?.[1];
  if (!id) return false;
  if (installed.has(id)) installed.set(id, (value as { enabled?: boolean } | null)?.enabled !== false);
  return true;
}

/** Handle plugin/* and marketplace/* codex requests; `undefined` for other methods. */
function mockPluginRequest(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "plugin/list":
      return {
        marketplaces: markets.map((m) => ({ name: m.name, path: m.path, interface: m.displayName ? { displayName: m.displayName } : null, plugins: m.plugins.map((p) => summary(m, p)) })),
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      };
    case "plugin/read": {
      const { m, p } = find(params.marketplacePath, params.pluginName);
      return {
        plugin: {
          marketplaceName: m.name,
          marketplacePath: m.path,
          summary: summary(m, p),
          shareUrl: null,
          description: p.description,
          skills: p.skills.map((name) => ({ name, description: `${name} skill`, shortDescription: null, interface: null, path: null, enabled: true })),
          onboardingSkill: null,
          hooks: pluginHookKeys(m, p),
          apps: p.apps.map((name) => ({ id: `connector_${name.toLowerCase()}`, name, description: null, installUrl: null, category: null })),
          appTemplates: [],
          mcpServers: p.mcpServers,
          scheduledTasks: null,
        },
      };
    }
    case "plugin/install": {
      const { m, p } = find(params.marketplacePath, params.pluginName);
      if ((p.installPolicy ?? "AVAILABLE") === "NOT_AVAILABLE") throw new Error(`plugin ${p.name} is not available for install`);
      installed.set(`${p.name}@${m.name}`, true);
      return { authPolicy: "ON_INSTALL", appsNeedingAuth: p.apps.map((name) => ({ id: `connector_${name.toLowerCase()}`, name, description: null, installUrl: null, category: null })) };
    }
    case "plugin/uninstall":
      installed.delete(String(params.pluginId));
      return {};
    case "marketplace/add": {
      const source = String(params.source ?? "");
      const name = source.replace(/\.git$/, "").split(/[/\\]/).filter(Boolean).pop() ?? "market";
      if (markets.some((m) => m.name === name)) return { marketplaceName: name, installedRoot: `${HOME}\\.tmp\\marketplaces\\${name}`, alreadyAdded: true };
      markets.push({ name, displayName: null, path: `${HOME}\\.tmp\\marketplaces\\${name}\\.agents\\plugins\\marketplace.json`, source: { source_type: "git", source, ...(params.refName ? { ref: String(params.refName) } : {}), last_updated: new Date().toISOString() }, plugins: [{ name: "hello", displayName: "Hello", description: `Sample plugin from ${source}`, skills: ["hello"], mcpServers: [], hooks: [], apps: [] }] });
      return { marketplaceName: name, installedRoot: `${HOME}\\.tmp\\marketplaces\\${name}`, alreadyAdded: false };
    }
    case "marketplace/remove": {
      const i = markets.findIndex((m) => m.name === params.marketplaceName);
      if (i < 0) throw new Error(`marketplace ${String(params.marketplaceName)} is not configured`);
      const [m] = markets.splice(i, 1);
      return { marketplaceName: m!.name, installedRoot: `${HOME}\\.tmp\\marketplaces\\${m!.name}` };
    }
    case "marketplace/upgrade": {
      const selected = markets.filter((m) => m.source?.source_type === "git" && (!params.marketplaceName || m.name === params.marketplaceName));
      for (const m of selected) m.source!.last_updated = new Date().toISOString();
      return { selectedMarketplaces: selected.map((m) => m.name), upgradedRoots: selected.slice(0, 1).map((m) => `${HOME}\\.tmp\\marketplaces\\${m.name}`), errors: [] };
    }
    default:
      return undefined;
  }
}

// Shared CODEX_HOME config (MCP servers, hook trust state) for the capabilities pages: one tree that
// config/read returns (secrets redacted like cutex) and config/value/write + config/batchWrite edit.
type Json = unknown;
const REDACTED = "<redacted>";
const mockConfig: { mcp_servers: Record<string, Record<string, Json>>; hooks: { state: Record<string, { enabled?: boolean; trusted_hash?: string }> } } = {
  mcp_servers: {
    playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
    linear: { url: "https://mcp.linear.app/mcp" },
    postgres: { command: "uvx", args: ["postgres-mcp"] },
    "github-local": {
      command: "node",
      args: ["C:\\Program Files\\github-mcp\\server.js", "--toolsets", "repos,issues"],
      cwd: "C:\\Users\\sam\\work",
      env: { GITHUB_TOKEN: "ghp_mock_secret", LOG_LEVEL: "info" },
      startup_timeout_sec: 20,
      disabled_tools: ["delete_repository"],
    },
    "search-api": { url: "https://search.example.com/mcp", http_headers: { "X-Api-Key": "sk-mock" }, env_http_headers: { "X-Team": "SEARCH_TEAM" }, bearer_token_env_var: "SEARCH_TOKEN" },
  },
  hooks: {
    state: {
      "user:config.toml:pre_tool_use:0:0": { trusted_hash: "sha256:aa01" },
      // trusted once, then the command changed → Modified
      "project:.codex/hooks.json:post_tool_use:0:0": { trusted_hash: "sha256:old" },
      "user:config.toml:session_start:0:0": { trusted_hash: "sha256:aa03", enabled: false },
    },
  },
};
const MCP_TOOLS: Record<string, string[]> = {
  playwright: ["browser_navigate", "browser_click", "browser_snapshot"],
  "github-local": ["search_repositories", "get_issue", "create_issue", "create_pull_request", "delete_repository"],
  "search-api": ["web_search"],
};

function parseKeyPath(path: string): string[] {
  const out: string[] = [];
  let seg = "";
  let quoted = false;
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    if (c === '"' && !quoted && seg === "") quoted = true;
    else if (c === '"' && quoted) quoted = false;
    else if (c === "\\" && quoted) seg += path[++i] ?? "";
    else if (c === "." && !quoted) (out.push(seg), (seg = ""));
    else seg += c;
  }
  out.push(seg);
  return out;
}
const isObj = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
function deepMerge(base: Record<string, Json>, over: Record<string, Json>) {
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(base[k])) deepMerge(base[k] as Record<string, Json>, v);
    else base[k] = structuredClone(v);
  }
}
function applyEdit(keyPath: string, value: Json, strategy: string) {
  if (JSON.stringify(value ?? null).includes(REDACTED)) throw new Error(`write contains the ${REDACTED} placeholder; omit secret values you do not want to change`);
  const segs = parseKeyPath(keyPath);
  const last = segs.pop()!;
  let node = mockConfig as unknown as Record<string, Json>;
  for (const s of segs) {
    if (!isObj(node[s])) {
      if (value === null) return;
      node[s] = {};
    }
    node = node[s] as Record<string, Json>;
  }
  if (value === null) delete node[last];
  else if (strategy === "upsert" && isObj(value) && isObj(node[last])) deepMerge(node[last] as Record<string, Json>, value);
  else node[last] = structuredClone(value);
}
function redact(value: Json, secret = false): Json {
  if (Array.isArray(value)) return value.map((v) => redact(v, secret));
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, secret || k === "env" || k === "http_headers")]));
  return secret ? REDACTED : value;
}

// Hooks: user config, project, a managed one, and the hooks of every enabled plugin.
type MockHook = { key: string; eventName: string; matcher: string | null; source: string; sourcePath: string; pluginId: string | null; isManaged: boolean; currentHash: string; handler: Record<string, Json> };
const USER_HOOKS: MockHook[] = [
  { key: "user:config.toml:pre_tool_use:0:0", eventName: "preToolUse", matcher: "shell", source: "user", sourcePath: `${HOME}\\config.toml`, pluginId: null, isManaged: false, currentHash: "sha256:aa01", handler: { handlerType: "command", command: "python ~/.codex/hooks/deny_rm_rf.py", async: false } },
  { key: "user:config.toml:session_start:0:0", eventName: "sessionStart", matcher: null, source: "user", sourcePath: `${HOME}\\config.toml`, pluginId: null, isManaged: false, currentHash: "sha256:aa03", handler: { handlerType: "command", command: "git fetch --quiet", async: true } },
  { key: "user:config.toml:user_prompt_submit:0:0", eventName: "userPromptSubmit", matcher: null, source: "user", sourcePath: `${HOME}\\config.toml`, pluginId: null, isManaged: false, currentHash: "sha256:aa04", handler: { handlerType: "mcpTool", server: "github-local", tool: "get_issue" } },
  { key: "project:.codex/hooks.json:post_tool_use:0:0", eventName: "postToolUse", matcher: "apply_patch", source: "project", sourcePath: "D:\\Apps\\cutex-desktop\\.codex\\hooks.json", pluginId: null, isManaged: false, currentHash: "sha256:new", handler: { handlerType: "command", command: "pnpm -s prettier --write $CODEX_CHANGED_FILES", async: false } },
  { key: "mdm:managed.toml:stop:0:0", eventName: "stop", matcher: null, source: "mdm", sourcePath: "C:\\ProgramData\\OpenAI\\Codex\\managed.toml", pluginId: null, isManaged: true, currentHash: "sha256:m1", handler: { handlerType: "command", command: "audit-log --turn-end", async: true } },
];
function allHooks(): MockHook[] {
  const plugin = markets.flatMap((m) =>
    m.plugins
      .filter((p) => installed.get(`${p.name}@${m.name}`) === true)
      .flatMap((p) =>
        pluginHookKeys(m, p).map(({ key, eventName }, i) => ({
          key, eventName, matcher: eventName === "preToolUse" ? "apply_patch" : null, source: "plugin",
          sourcePath: `${HOME}\\plugins\\cache\\${m.name}\\${p.name}\\hooks\\hooks.json`, pluginId: `${p.name}@${m.name}`, isManaged: false,
          currentHash: `sha256:${p.name}-${i}`, handler: { handlerType: "command", command: `node ./hooks/${snake(eventName)}.mjs`, async: false },
        })),
      ),
  );
  return [...USER_HOOKS, ...plugin];
}
function hooksList() {
  return {
    data: [{
      cwd: HOME,
      warnings: ["hooks.json in team-tools/commit.guard: unknown field `timeout_ms` ignored"],
      errors: [],
      hooks: allHooks().map((h, i) => {
        const st = mockConfig.hooks.state[h.key] ?? {};
        const trustStatus = h.isManaged ? "managed" : !st.trusted_hash ? "untrusted" : st.trusted_hash === h.currentHash ? "trusted" : "modified";
        return { key: h.key, eventName: h.eventName, matcher: h.matcher, timeoutSec: 60, statusMessage: null, additionalContextLimit: null, sourcePath: h.sourcePath, source: h.source, pluginId: h.pluginId, displayOrder: i, enabled: st.enabled !== false, isManaged: h.isManaged, currentHash: h.currentHash, trustStatus, ...h.handler };
      }),
    }],
  };
}

// Skills: SKILL.md files served by the core hostFile mock through `hostFile` below.
const SKILLS_DIR = `${HOME}\\skills`;
const mockSkills: { name: string; description: string; scope: string; pluginId: string | null; body: string }[] = [
  { name: "pdf", description: "Read and fill PDFs", scope: "user", pluginId: null, body: "# PDF\n\nUse this skill to **read**, fill and merge PDF files.\n\n## Steps\n\n1. Extract the text with `pdftotext`.\n2. Fill form fields with `scripts/fill.py`.\n\n| Tool | Use |\n|---|---|\n| pdftotext | text |\n| qpdf | merge / split |\n" },
  { name: "xlsx", description: "Spreadsheets", scope: "user", pluginId: null, body: "# Spreadsheets\n\nOpen `.xlsx` files with openpyxl; keep formulas intact.\n" },
  { name: "github:review-pr", description: "Review a pull request", scope: "user", pluginId: "github@openai-curated", body: "# Review a PR\n\nFetch the diff, run the tests, comment inline.\n" },
  { name: "skill-creator", description: "Create new skills", scope: "system", pluginId: null, body: "# Skill creator\n\nScaffold a new skill folder with a `SKILL.md`.\n" },
];
const skillPath = (name: string) => `${SKILLS_DIR}\\${name.replace(/[:]/g, "-")}\\SKILL.md`;
const skillEnabled: Record<string, boolean> = { [skillPath("xlsx")]: false };

let sharedWindowsSandbox: "ready" | "notConfigured" = "notConfigured";
const codexFeatures: Record<string, boolean> = { goals: true, collaboration_modes: true, js_repl: false };

// skills-archive: archived user skills (cutex moves the folder to <cutex home>/archive/skills/<id>/skill).
const ARCHIVE_DIR = "C:\\Users\\sam\\.cutex\\archive\\skills";
type MockSkill = (typeof mockSkills)[number];
const archivedSkills: { record: SkillArchiveRecord; skill: MockSkill }[] = [
  (() => {
    const skill: MockSkill = { name: "docx", description: "Word documents", scope: "user", pluginId: null, body: "# Word\n\nEdit `.docx` with python-docx.\n" };
    const id = "20261012T081500Z-docx";
    return { skill, record: { id, name: "docx", dirName: "docx", description: skill.description, scope: "user", root: "codexHome", originalPath: `${SKILLS_DIR}\\docx`, skillMdPath: `${SKILLS_DIR}\\docx\\SKILL.md`, entryKind: "directory", archivedAt: "2026-10-12T08:15:00.000Z", by: "owner", archivePath: `${ARCHIVE_DIR}\\${id}\\skill` } };
  })(),
];
const refused = (code: string, message: string) => ({ ok: false as const, error: { code, message } });
export const mock: ModuleMock = {
  features: { new: ["skills-archive"] },
  hostFile(path) {
    const s = mockSkills.find((x) => skillPath(x.name) === path);
    return s ? `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}` : null;
  },
  api: () => ({
    async codexRequest(method, params) {
      const p = (params ?? {}) as { keyPath?: string; value?: unknown; mergeStrategy?: string; path?: string; enabled?: boolean; edits?: { keyPath: string; value: unknown; mergeStrategy: string }[] };
      switch (method) {
        // windows-sandbox-readiness: the shared home starts without a sandbox; setup sets the unelevated one.
        case "windowsSandbox/readiness":
          return { status: sharedWindowsSandbox };
        case "windowsSandbox/setupStart":
          await new Promise((r) => setTimeout(r, 600));
          sharedWindowsSandbox = "ready";
          return { started: true, completed: { mode: "unelevated", success: true, error: null } };
        case "config/read":
          return { config: { ...(redact(mockConfig) as object), features: codexFeatures, marketplaces: mockMarketplaceConfig() }, origins: {}, layers: null };
        case "config/value/write": {
          if (mockPluginEnabledWrite(p.keyPath, p.value)) return { status: "ok", version: "v4" };
          if (p.keyPath?.startsWith("features.")) {
            codexFeatures[p.keyPath.slice("features.".length)] = p.value as boolean;
            return { status: "ok", version: "v3" };
          }
          applyEdit(p.keyPath ?? "", p.value ?? null, p.mergeStrategy ?? "replace");
          return { status: "ok", version: "v2" };
        }
        case "config/batchWrite":
          for (const e of p.edits ?? []) applyEdit(e.keyPath, e.value, e.mergeStrategy);
          return { status: "ok", version: "v5" };
        case "mcpServerStatus/list": {
          const servers = mockConfig.mcp_servers;
          return {
            nextCursor: null,
            data: Object.keys(servers).map((name) => {
              const off = servers[name]!.enabled === false;
              return {
                name, runtimeStatus: off ? "disabled" : name === "linear" ? "authenticationRequired" : name === "postgres" ? "failed" : "connected",
                pluginId: null, httpOrigin: null, serverInfo: null, serverCapabilities: null,
                tools: Object.fromEntries((MCP_TOOLS[name] ?? []).map((tool) => [tool, { name: tool, inputSchema: {} }])),
                toolsError: name === "postgres" && !off ? "MCP startup failed: program not found: uvx\n(searched PATH: C:\\Windows\\system32;C:\\Users\\sam\\AppData\\Local\\Programs\\Python\\Python313\\Scripts)" : null, resources: [], resourceTemplates: [],
                authStatus: name === "linear" ? "notLoggedIn" : "unsupported",
              };
            }),
          };
        }
        case "skills/list":
          return {
            data: [{
              cwd: HOME,
              errors: [],
              skills: mockSkills.map((s) => ({ name: s.name, description: s.description, path: skillPath(s.name), scope: s.scope, enabled: skillEnabled[skillPath(s.name)] ?? true, pluginId: s.pluginId })),
            }],
          };
        case "skills/config/write":
          skillEnabled[p.path ?? ""] = p.enabled ?? true;
          return {};
        case "hooks/list":
          return hooksList();
        default:
          return mockPluginRequest(method, (params ?? {}) as Record<string, unknown>) ?? {};
      }
    },
    async skillArchives() {
      return { archives: archivedSkills.map((a) => a.record).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)) };
    },
    async archiveSkill(path) {
      const i = mockSkills.findIndex((x) => skillPath(x.name) === path);
      const skill = mockSkills[i];
      if (!skill) return refused("skill_not_found", "no skill at this path");
      if (skill.scope !== "user" || skill.pluginId) return refused("skill_not_archivable", "only user skills in CODEX_HOME/skills or ~/.agents/skills can be archived");
      const dirName = skill.name.replace(/[:]/g, "-");
      const now = new Date();
      const id = `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${dirName}`;
      const record: SkillArchiveRecord = { id, name: skill.name, dirName, description: skill.description, scope: "user", root: "codexHome", originalPath: `${SKILLS_DIR}\\${dirName}`, skillMdPath: path, entryKind: "directory", archivedAt: now.toISOString(), by: "owner", archivePath: `${ARCHIVE_DIR}\\${id}\\skill` };
      mockSkills.splice(i, 1);
      archivedSkills.push({ record, skill });
      return { ok: true as const, archive: record };
    },
    async restoreSkill(archiveId) {
      const i = archivedSkills.findIndex((a) => a.record.id === archiveId);
      const entry = archivedSkills[i];
      if (!entry) return refused("skill_archive_not_found", "no archived skill with this id");
      if (mockSkills.some((x) => x.name === entry.skill.name)) return refused("skill_name_taken", "a skill already exists at the original path; archive or rename it first");
      archivedSkills.splice(i, 1);
      mockSkills.push(entry.skill);
      return { ok: true as const, archive: { ...entry.record, restoredAt: new Date().toISOString() } };
    },
    async experimentalFeatures() {
      return {
        source: "native",
        features: [
          { name: "goals", displayName: "Goals", description: "Long-running tasks with a persistent objective (/goal).", stage: "beta", enabled: codexFeatures.goals ?? true, defaultEnabled: false },
          { name: "collaboration_modes", displayName: "Plan mode", description: "Collaboration mode presets such as Plan.", stage: "beta", enabled: codexFeatures.collaboration_modes ?? true, defaultEnabled: true },
          { name: "js_repl", displayName: "JavaScript REPL", description: "A persistent Node REPL tool for the agent.", stage: "experimental", enabled: codexFeatures.js_repl ?? false, defaultEnabled: false },
        ],
      };
    },
    async setExperimentalFeature(name, enabled) {
      codexFeatures[name] = enabled;
    },
  }),
};
