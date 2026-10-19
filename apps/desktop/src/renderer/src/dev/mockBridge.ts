// Browser-preview bridge: lets the renderer run in a plain browser (vite dev server) with canned
// data, for UI work without Electron or a daemon. Never used inside Electron (preload sets
// window.cutex first).
//
// This file is the core only: hosts, agents / sidebar, threads and the timeline, queue, profiles,
// settings. Module-owned daemon data (delegations, jobs, services, approvals, …) lives in
// `modules/<id>/mock.ts` (dev/mockTypes.ts ModuleMock), collected by dev/mockModules.ts and merged in
// below through `core` — a new module adds its own mock.ts and never edits this file.
import { mockRemoteCloseShell } from "./mockRemoteClose";
import type { CutexBuild } from "@cutex-desktop/cutex-client";
import type { EventEnvelope, QueueItem, SessionBootstrap, SessionResource } from "@cutex-desktop/protocol";
import { mockFrames } from "./mockFrames";
import { mockModulePacks } from "./mockModulePacks";
import type { DesktopApi, DesktopEvents, ModelOption, PreloadBridge, ProfilePreset, QuotaGauge, QuotaReaderConfig, SessionSandboxExtras, ShellState, SidebarSnapshot, UnavailableModel, UpdateStatus } from "../../../shared/ipc";
import { HOST_TAGGED_EVENTS, MESSAGES_WAKE_METHOD } from "../../../shared/ipc";
import { HOST_PALETTE, normalizeHostGroups, scopeAfterRemoval, scopeHosts, type HostConnView, type HostOwner, type SshConnectAs, type ViewScope } from "../../../shared/hosts";
import { BUILTIN_THREAD_DEFAULTS, LAUNCH_FIELDS, THREAD_KINDS, type LaunchPermissions, type NewThreadDefaults } from "../../../shared/launch";
import { presetById } from "../lib/profilePresets";
import type { ProfileTransferWarning } from "../../../shared/profileTransfer";
import { classifySshPrompt, type SshPromptAnswer, type SshPromptView } from "../../../shared/sshPrompt";
import { MOCK_BASE_FEATURES, MOCK_NEW_FEATURES } from "./mockFeatures";
import { MODULE_MOCKS } from "./mockModules";
import { mockClaudeRules, mockRememberClaudeRules, mockSetClaudeRules, soraPendingApproval } from "./mockClaudePermissions";
import { mockLaunchArt } from "./mockLaunchArt";
import { registerMockTokenList, renameMockToken, revokeMockToken, scopeMockToken } from "./mockTokenNames";
import type { MockCore, MockEvents, MockProfileRef } from "./mockTypes";

/** cutex profile-presets-v2 `GET /v2/profile-presets` (src/profiles/providers.rs presets_json). */
const mp = (id: string, label: string, providerId: string, baseUrl: string | null, defaultModel: string | null, family: string | null, familyLabel: string | null, extra: { aliases?: string[]; quotaReader?: string; modelCatalog?: boolean; webSearch?: string | null } = {}) => ({
  id, aliases: extra.aliases ?? [], label, providerId, baseUrl, baseUrlRequired: baseUrl === null, defaultModel, providerFamily: family, providerFamilyLabel: familyLabel,
  // profile-generic-switches: `quotaReader` per preset; `autoQuota` = it is set.
  quotaReader: extra.quotaReader ?? null, autoQuota: !!extra.quotaReader, modelCatalog: extra.modelCatalog ?? false, webSearch: extra.webSearch ?? null,
});
const MOCK_GLM_FAMILY = "Zhipu GLM (Z.ai / BigModel)";
const MOCK_PRESETS: ProfilePreset[] = [
  mp("deepseek", "DeepSeek", "deepseek", "https://api.deepseek.com/", "deepseek-flash", "deepseek", "DeepSeek", { quotaReader: "deepseek_balance", modelCatalog: true, webSearch: "disabled" }),
  mp("zai", "Z.ai (GLM Coding Plan)", "zai", "https://api.z.ai/api/v1", "glm-5.3", "zhipu", MOCK_GLM_FAMILY, { aliases: ["glm", "z.ai"], quotaReader: "zhipu_coding_plan", modelCatalog: true }),
  mp("zhipu", "Zhipu BigModel (GLM Coding Plan)", "zhipu", "https://open.bigmodel.cn/api/v1", "glm-5.3", "zhipu", MOCK_GLM_FAMILY, { aliases: ["bigmodel"], quotaReader: "zhipu_coding_plan", modelCatalog: true }),
  mp("moonshot", "Moonshot (Kimi)", "moonshot", "https://api.moonshot.ai/v1", "kimi-k3", "moonshot", "Moonshot (Kimi)", { aliases: ["kimi"], quotaReader: "moonshot_balance", modelCatalog: true }),
  mp("moonshot-cn", "Moonshot (Kimi, China)", "moonshot", "https://api.moonshot.cn/v1", "kimi-k3", "moonshot", "Moonshot (Kimi)", { aliases: ["kimi-cn"], quotaReader: "moonshot_cn_balance", modelCatalog: true }),
  mp("kimi-code", "Kimi Code (membership plan)", "kimi-code", "https://api.kimi.ai/coding/v1", "kimi-for-coding", "kimi-code", "Kimi Code", { aliases: ["kimi-for-coding"], quotaReader: "kimi_code_plan", modelCatalog: true, webSearch: "live" }),
  mp("kimi-code-cn", "Kimi Code (membership plan, China)", "kimi-code", "https://api.kimi.com/coding/v1", "kimi-for-coding", "kimi-code", "Kimi Code", { quotaReader: "kimi_code_plan", modelCatalog: true, webSearch: "live" }),
  mp("minimax", "MiniMax", "minimax", "https://api.minimax.io/v1", "MiniMax-M3.1-Flash-Preview", "minimax", "MiniMax", { modelCatalog: true }),
  mp("minimax-cn", "MiniMax (China)", "minimax", "https://api.minimaxi.com/v1", "MiniMax-M3.1-Flash-Preview", "minimax", "MiniMax", { modelCatalog: true }),
  mp("xai", "xAI (Grok)", "xai", "https://api.x.ai/v1", "grok-4.7", "xai", "xAI (Grok)", { aliases: ["grok", "x.ai"], modelCatalog: true, webSearch: "disabled" }),
  mp("openrouter", "OpenRouter", "openrouter", "https://openrouter.ai/api/v1", null, "openrouter", "OpenRouter", { quotaReader: "openrouter_key" }),
  mp("openai", "OpenAI API", "openai-api", "https://api.openai.com/v1", null, "openai-api", "OpenAI API"),
  mp("gemini", "Gemini (OpenAI-compatible relay)", "gemini", null, "gemini-3.8-flash-tiered", null, null, { aliases: ["google"], webSearch: "disabled" }),
  mp("custom", "Custom (OpenAI Responses compatible)", "custom", null, null, null, null),
];


/** `?legacy` in the preview URL: behave like a cutex without quick chats / new-thread defaults. */
const LEGACY = typeof location !== "undefined" && new URLSearchParams(location.search).has("legacy");
/**
 * `?fresh`: a first run on a colleague's machine — only this machine as host, no agents, no projects,
 * no update source. `?fresh` = cutex not installed (no config / token), `?fresh=stopped` = installed
 * but not running, `?fresh=empty` = running with nothing in it yet, `?fresh=nohost` = no host at all
 * (macOS without a local cutex, main/localHost.ts: the add-SSH-host guide; best with `?platform=darwin`).
 */
const FRESH: "notInstalled" | "stopped" | "empty" | "noHost" | null = (() => {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  if (!q.has("fresh")) return null;
  const v = q.get("fresh");
  return v === "stopped" ? "stopped" : v === "empty" ? "empty" : v === "nohost" ? "noHost" : "notInstalled";
})();
/** `?platform=darwin|linux|win32`: the platform the mock bridge reports (⌘ / Ctrl labels, title bar); default win32. */
const MOCK_PLATFORM: NodeJS.Platform = (() => {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("platform");
  return v === "darwin" || v === "linux" ? v : "win32";
})();
/** The local daemon a fresh first run sees before cutex runs (main/daemon.ts: unreachable + setup). */
const FRESH_DOWN = { kind: "unreachable" as const, baseUrl: "http://127.0.0.1:24270", message: "connect ECONNREFUSED 127.0.0.1:24270", setup: FRESH === "stopped" ? ("notRunning" as const) : ("notInstalled" as const) };


// Per-profile thread settings / models / quota, mirroring the three dev profiles.
const full = { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
const MOCK_SETTINGS: Record<string, Record<string, unknown>> = {
  omega: { model: "deepseek-v4-flash", modelProvider: "deepseek", effort: "high", ...full },
  gamma: { model: "gpt-5.5", modelProvider: "openai", effort: "medium", approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } },
  GLM: { model: "glm-5.3", modelProvider: "zai", effort: "high", ...full },
  claude: { model: "sonnet", modelProvider: "anthropic", effort: "high", ...full },
};
/** session-sandbox-extras view of a mock agent (from its profile's live thread settings). */
function mockSandboxExtras(sessionId: string): SessionSandboxExtras {
  const profile = profileOf(sessionId);
  const policy = (MOCK_SETTINGS[profile]?.sandboxPolicy ?? {}) as { type?: string; networkAccess?: boolean; writableRoots?: string[] };
  const workspace = policy.type === "workspaceWrite";
  const reason = profile === "claude" ? "unsupported_runtime" : workspace ? null : "sandbox_not_workspace_write";
  return { cutexSessionId: sessionId, sandbox: workspace ? "workspace-write" : policy.type === "readOnly" ? "read-only" : "danger-full-access", networkAccess: !!policy.networkAccess, writableRoots: policy.writableRoots ?? [], editable: !reason, reason };
}
const effortsOf = (...e: string[]) => e;
const RAW_MODELS: Record<string, Omit<ModelOption, "inputModalities">[]> = {
  omega: [
    { id: "deepseek-v4-flash", model: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", description: "便宜、快", efforts: effortsOf("low", "medium", "high", "max"), defaultEffort: "high", isDefault: true },
    { id: "deepseek-v4-pro", model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", description: "", efforts: effortsOf("low", "medium", "high", "max"), defaultEffort: "high", isDefault: false },
  ],
  gamma: [
    { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "", efforts: effortsOf("low", "medium", "high", "xhigh"), defaultEffort: "medium", isDefault: true, fastTier: "priority" },
    { id: "gpt-5.5-mini", model: "gpt-5.5-mini", displayName: "GPT-5.5 mini", description: "", efforts: effortsOf("low", "medium", "high"), defaultEffort: "medium", isDefault: false },
    { id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", description: "Latest workhorse model for coding and everyday work.", efforts: effortsOf("minimal", "low", "medium", "high", "xhigh", "max"), defaultEffort: "medium", isDefault: false, fastTier: "priority" },
    { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Frontier intelligence for the most demanding work.", efforts: effortsOf("minimal", "low", "medium", "high", "xhigh", "max"), defaultEffort: "medium", isDefault: false, fastTier: "priority" },
    { id: "gpt-6-luna", model: "gpt-6-luna", displayName: "GPT-6-Luna", description: "Fast and affordable model for easier tasks.", efforts: effortsOf("minimal", "low", "medium", "high", "xhigh", "max"), defaultEffort: "medium", isDefault: false },
    { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", description: "Older generation workhorse model.", efforts: effortsOf("minimal", "low", "medium", "high", "xhigh", "max"), defaultEffort: "medium", isDefault: false },
  ],
  // glm-5.3 / GLM-5.3: the raw id and the catalog name the owner wants shown alike (Settings → 通用 → 模型显示名).
  GLM: [
    { id: "glm-5.3", model: "glm-5.3", displayName: "GLM-5.3", description: "", efforts: effortsOf("medium", "high"), defaultEffort: "high", isDefault: true },
    { id: "glm-5", model: "glm-5", displayName: "GLM-5", description: "", efforts: effortsOf("medium", "high"), defaultEffort: "high", isDefault: false },
  ],
  claude: [
    { id: "sonnet", model: "sonnet", displayName: "Claude Sonnet", description: "", efforts: effortsOf("low", "medium", "high"), defaultEffort: "high", isDefault: true },
    { id: "opus", model: "opus", displayName: "Claude Opus", description: "", efforts: effortsOf("low", "medium", "high"), defaultEffort: "high", isDefault: false, fastTier: "priority" },
  ],
};
const MOCK_MODELS: Record<string, ModelOption[]> = Object.fromEntries(
  Object.entries(RAW_MODELS).map(([p, list]) => [p, list.map((m) => ({ ...m, inputModalities: p === "gamma" || p === "claude" ? ["text", "image"] : ["text"] }))]),
);
const inHours = (h: number) => Math.round(Date.now() / 1000 + h * 3600);
// codex-native rate limits (ChatGPT account: weekly window only, no 5h).
const MOCK_LIMITS: Record<string, unknown> = {
  gamma: { primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: inHours(43) }, secondary: null, credits: null },
};
// cutex per-profile quota readers: GLM custom 5h + weekly windows, DeepSeek auto balance preset.
const gauge = (id: string, label: string, over: Partial<QuotaGauge>): QuotaGauge => ({
  id, label, kind: "window", remainingPercent: null, balance: null, resetAt: null, windowLabel: null, observedAt: Date.now() / 1000, stale: false, ...over,
});
const MOCK_QUOTA: Record<string, QuotaGauge[]> = {
  GLM: [
    gauge("primary", "GLM", { windowLabel: "5h", remainingPercent: 62, resetAt: inHours(2.3) }),
    gauge("extra-0", "GLM", { windowLabel: "7d", remainingPercent: 18, resetAt: inHours(70) }),
  ],
  omega: [gauge("primary", "DS", { kind: "balance", balance: "¥18.42" })],
  // Identity menu → 用量: one nearly used up, one untouched.
  Kimi: [
    gauge("primary", "Kimi", { windowLabel: "5h", remainingPercent: 7, resetAt: inHours(0.6) }),
    gauge("extra-0", "Kimi", { windowLabel: "7d", remainingPercent: 41, resetAt: inHours(96) }),
    // cutex kimi-code-plan: the membership's monthly total (window caption `month` → 本月).
    gauge("extra-1", "Kimi", { windowLabel: "month", remainingPercent: 83, resetAt: inHours(330) }),
  ],
  "claude-work": [gauge("primary", "5h", { windowLabel: "5h", remainingPercent: 100, resetAt: inHours(5) }), gauge("extra-0", "7d", { windowLabel: "7d", remainingPercent: 96, resetAt: inHours(150) })],
  // cutex-native ChatGPT quota (profile-quota-native), read 6 minutes ago; live
  // account/rateLimits/updated during a turn replaces codex-primary (same id, newer).
  gamma: [
    gauge("codex-primary", "7d", { windowLabel: "7d", remainingPercent: 76, resetAt: inHours(43), observedAt: Date.now() / 1000 - 360 }),
    gauge("codex-credits", "Credits", { kind: "balance", balance: "62419.1846900000", observedAt: Date.now() / 1000 - 360 }),
  ],
};
const REVIEW_TEXT = `**1 个问题**

- **[P2] \`Composer.tsx\` 里 Esc 会同时关闭面板并中断回合** — 面板打开时应只关闭面板。
  位置：apps/desktop/src/renderer/src/components/Composer.tsx:612

总体：改动结构清晰，测试覆盖了过滤与分发。`;
const PNG_1PX = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#6c8cff"/><circle cx="30" cy="28" r="10" fill="#fff"/></svg>');

// Profiles / model catalogs / global settings / user instructions (cutex settings routes).
type MockModel = { id: string; requestModel?: string | null; displayName: string | null; contextWindow: number | null; maxContextWindow: number | null; autoCompactTokenLimit: number | null; inputModalities: string[]; supportedReasoningEfforts: string[]; defaultReasoningEffort: string | null; /** Claude reference rows */ kind?: string; effortSupportKnown?: boolean };
const mockModel = (id: string, contextWindow: number, over: Partial<MockModel> = {}): MockModel => ({
  id, displayName: null, contextWindow, maxContextWindow: contextWindow, autoCompactTokenLimit: null, inputModalities: ["text"], supportedReasoningEfforts: ["low", "medium", "high", "max"], defaultReasoningEffort: "high", ...over,
});
// Kinds shown: official login (gamma = ChatGPT, claude = Claude CLI), API-key profiles on an official
// endpoint (deepseek) and on relays (GLM: provider "zai" on a third-party relay with a /usage endpoint → custom;
// relay: a chat-wire relay).
type MockProfileAgentOptions = { nativeSubagents?: boolean | null; delegationWait?: boolean | null; agentApproval?: boolean; turnQuestions?: "decide" | "wait"; planLabel?: string | null; /** claude-tool-defaults: null / absent = unset (on). */ claudeWrite?: boolean | null; claudeExec?: boolean | null; claudeCheckpoints?: boolean | null; /** profile-search-tool (Codex API-key profiles) */ searchTool?: boolean; /** profile-generic-switches (Codex profiles) */ privateAuthFile?: boolean; /** profile-tool-schema-compat (Codex profiles) */ toolSchemaCompat?: "strict" | null };
/**
 * cutex profile-import-cc-switch `GET /v2/profile-imports/cc-switch`: CC Switch's providers on the mock
 * host (never with keys). DeepSeek was imported before (profile omega); Claude Official is an OAuth
 * login cutex cannot copy; Kimi has no key; `?legacy`: no such route.
 */
const MOCK_CC_SWITCH: import("../../../shared/ccSwitchImport").CcSwitchProvider[] = [
  { id: "c-official", app: "claude", name: "Claude Official", baseUrl: null, model: null, current: false, hasKey: false, supported: false, reason: "OAuth login: sign in to Claude in a Claude profile instead", existingProfile: null },
  { id: "c-glm", app: "claude", name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-5.3", current: true, hasKey: true, supported: true, reason: null, existingProfile: null },
  { id: "c-kimi", app: "claude", name: "Kimi", baseUrl: "https://api.moonshot.cn/anthropic", model: "kimi-k3", current: false, hasKey: false, supported: true, reason: null, existingProfile: null },
  { id: "x-deepseek", app: "codex", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", current: false, hasKey: true, supported: true, reason: null, existingProfile: "omega" },
  { id: "x-relay", app: "codex", name: "PackyCode", baseUrl: "https://api.packycode.example/v1", model: "gpt-5.5", current: true, hasKey: true, supported: true, reason: null, existingProfile: null },
];

const mockProfiles: Record<string, { name: string; cliKind?: "codex" | "claude"; authKind: "apiKey" | "chatgpt" | "none"; apiKeyPresent: boolean; color: string | null; allowSwitch: boolean | null; config: Record<string, unknown>; models: MockModel[]; /** profile-model-display-names */ modelNames?: Record<string, string>; /** profile-catalog-overlay: edited entries whose model left upstream */ unavailable?: UnavailableModel[] } & MockProfileAgentOptions> = {
  // Fixed preview fixture: no credential and no network call; survives page reloads.
  Kimi: {
    name: "Kimi", authKind: "apiKey", apiKeyPresent: false, color: "#7950f2", allowSwitch: null,
    config: { modelProvider: "moonshot", providerBaseUrl: "https://api.moonshot.ai/v1", providerWireApi: "chat" },
    models: [],
  },
  omega: {
    name: "omega", authKind: "apiKey", apiKeyPresent: true, color: "#4c8dff", allowSwitch: null,
    config: { model: "deepseek-v4-flash", modelProvider: "deepseek", modelReasoningEffort: "high", modelContextWindow: null, modelAutoCompactTokenLimit: null, providerBaseUrl: "https://api.deepseek.com/v1", providerWireApi: "responses", requestMaxRetries: 4, streamMaxRetries: 5, streamIdleTimeoutMs: 300000, supportsWebsockets: false },
    models: [mockModel("deepseek-v4-flash", 1_000_000), mockModel("deepseek-v4-pro", 1_000_000)],
  },
  GLM: {
    name: "GLM", authKind: "apiKey", apiKeyPresent: true, color: "#40c057", allowSwitch: null, planLabel: "GLM Pro",
    config: { model: "glm-5.3", modelProvider: "zai", modelReasoningEffort: "high", modelContextWindow: 256_000, modelAutoCompactTokenLimit: 204_800, providerBaseUrl: "https://api.example-relay.com/v1", providerWireApi: "responses" },
    models: [mockModel("glm-5.3", 500_000, { displayName: "GLM-5.3", inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "high", "max"] }), mockModel("glm-5", 500_000, { inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "high", "max"] }), mockModel("glm-5-flash", 500_000)],
  },
  Gemini: {
    name: "Gemini", authKind: "apiKey", apiKeyPresent: true, color: "#4285f4", allowSwitch: null,
    config: { model: "gemini-3.8-flash", modelProvider: "gemini", modelReasoningEffort: null, modelContextWindow: null, modelAutoCompactTokenLimit: null, providerBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", providerWireApi: "chat" },
    models: [mockModel("gemini-3.8-flash", 1_000_000, { supportedReasoningEfforts: [], defaultReasoningEffort: null })],
  },
  relay: {
    name: "relay", authKind: "apiKey", apiKeyPresent: false, color: "#e8590c", allowSwitch: null,
    config: { model: "qwen3-coder", modelProvider: "relay", modelReasoningEffort: null, modelContextWindow: null, modelAutoCompactTokenLimit: null, providerBaseUrl: "https://relay.example.net/v1", providerWireApi: "chat", requestMaxRetries: null, streamMaxRetries: null, streamIdleTimeoutMs: null, supportsWebsockets: false },
    models: [mockModel("qwen3-coder", 256_000, { supportedReasoningEfforts: [], defaultReasoningEffort: null })],
  },
  gamma: {
    name: "gamma", authKind: "chatgpt", apiKeyPresent: false, color: "#7950f2", allowSwitch: null, agentApproval: true, nativeSubagents: false, planLabel: "plus",
    modelNames: { "gpt-5.5": "GPT 5.5", "Astra [400K]": "Astra 400K", "Astra [285K]": "Astra 285K" },
    unavailable: [{ id: "Codex 5.2 [200K]", requestModel: "gpt-5.2-codex", displayName: null, entryDisplayName: null, reason: "baseModelMissing" }],
    config: { model: "gpt-5.5", modelProvider: "openai", modelReasoningEffort: "medium", modelReasoningSummary: "auto", updatePlanEnabled: true, modelContextWindow: null, modelAutoCompactTokenLimit: null },
    models: [
      ...RAW_MODELS.gamma!.map((m) => mockModel(m.id, 272_000, { displayName: m.displayName, maxContextWindow: 872_000, inputModalities: ["text", "image"], supportedReasoningEfforts: [...m.efforts], defaultReasoningEffort: m.defaultEffort })),
      ...(!LEGACY ? [400_000, 285_000].map((context) => mockModel(`Astra [${context / 1000}K]`, context, { requestModel: "gpt-6-astra", displayName: `Astra [${context / 1000}K]`, maxContextWindow: 872_000, inputModalities: ["text", "image"] })) : []),
    ],
  },
  claude: {
    // profile-plan-label-claude: a manual label (Claude profiles have no live plan).
    name: "claude", cliKind: "claude", authKind: "none", apiKeyPresent: false, color: "#EE7B32", allowSwitch: null, planLabel: "Max 20x",
    modelNames: { opus: "Opus 5.5" },
    config: {},
    // claude-profile-default-model: the adapter's reference catalog as cutex lists it (claude-model-context:
    // nominal windows, null for aliases; Haiku 4.5 knowingly has no effort levels).
    models: [
      mockModel("claude-opus-5-5", 1_000_000, { displayName: "Opus 5.5", kind: "pinned", effortSupportKnown: true, inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: null }),
      mockModel("claude-sonnet-5-5", 1_000_000, { displayName: "Sonnet 5.5", kind: "pinned", effortSupportKnown: true, inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: null }),
      mockModel("claude-opus-4-6", 200_000, { displayName: "Opus 4.6", kind: "pinned", effortSupportKnown: true, inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "medium", "high", "max"], defaultReasoningEffort: null }),
      mockModel("claude-haiku-4-5-20251001", 200_000, { displayName: "Haiku 4.5", kind: "pinned", effortSupportKnown: true, inputModalities: ["text", "image"], supportedReasoningEfforts: [], defaultReasoningEffort: null }),
      ...[["sonnet", "Sonnet (alias)"], ["opus", "Opus (alias)"], ["haiku", "Haiku (alias)"]].map(([id, name]) => ({ ...mockModel(id!, 0, { displayName: name!, kind: "alias", effortSupportKnown: false, inputModalities: ["text", "image"], supportedReasoningEfforts: [], defaultReasoningEffort: null }), contextWindow: null, maxContextWindow: null })),
      { ...mockModel("opus[1m]", 1_000_000, { displayName: "Opus 1M (alias)", kind: "alias", effortSupportKnown: false, inputModalities: ["text", "image"], supportedReasoningEfforts: [], defaultReasoningEffort: null }), maxContextWindow: null },
    ],
  },
  // A second preview-only Claude profile demonstrates the inline account choices.
  "claude-work": {
    name: "claude-work", cliKind: "claude", authKind: "none", apiKeyPresent: false, color: "#EE7B32", allowSwitch: null,
    config: {}, models: [mockModel("sonnet", 200_000, { supportedReasoningEfforts: [], defaultReasoningEffort: null })],
  },
};
function mockFamily(p: (typeof mockProfiles)[string]): { providerFamily: string; providerFamilyLabel: string } {
  if (p.cliKind === "claude") return { providerFamily: "claude", providerFamilyLabel: "Claude" };
  if (p.authKind === "chatgpt") return { providerFamily: "openai-chatgpt", providerFamilyLabel: "ChatGPT" };
  return p.config.providerWireApi === "chat" ? { providerFamily: "chat-completions", providerFamilyLabel: "Chat Completions" } : { providerFamily: "responses-api", providerFamilyLabel: "Responses API" };
}
// profile-plan-label(-override / -claude): a stored label wins; else a signed-in ChatGPT profile shows the login's plan.
function mockPlanLabel(p: (typeof mockProfiles)[string]): { planLabel: string | null; planLabelSource?: "account" | "manual" | null } {
  if (LEGACY) return { planLabel: p.authKind === "chatgpt" ? "Pro" : null };
  if (p.authKind === "chatgpt" && !p.planLabel) return { planLabel: "pro", planLabelSource: "account" };
  return { planLabel: p.planLabel ?? null, planLabelSource: p.planLabel ? "manual" : null };
}
// cutex `profile-avatar`: Profile looks the mock host stores (by profile id = name here).
const mockLooks: Record<string, { avatar?: { dataUrl: string; etag: string }; intro?: { dataUrl: string; etag: string }; avatarThemes?: string[]; introGreeting?: string }> = {};
const MOCK_AVATAR_THEMES = ["animals", "sea", "gems", "plants", "food", "sky", "birds", "insects", "fantasy", "prehistoric", "desserts", "seasons", "transport", "music", "cats"];
/** A stable 16-hex ETag of a data URL (not cutex's SHA-256; the mock only needs change detection). */
function mockEtag(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const mockLookFields = (name: string) =>
  LEGACY
    ? {}
    : { avatarEtag: mockLooks[name]?.avatar?.etag ?? null, introPortraitEtag: mockLooks[name]?.intro?.etag ?? null };
const mockLookAppearance = (name: string) => (LEGACY ? {} : { avatarThemes: mockLooks[name]?.avatarThemes ?? null, introGreeting: mockLooks[name]?.introGreeting ?? null });

const mockProfileItem = (name: string) => {
  const p = mockProfiles[name]!;
  const c = p.config as Record<string, string | number | null>;
  return {
    id: name, name, cliKind: p.cliKind ?? "codex", source: null, provider: (c.modelProvider as string) ?? null, model: (c.model as string) ?? (p.cliKind === "claude" ? "sonnet" : null), modelProvider: (c.modelProvider as string) ?? null,
    baseUrl: (c.providerBaseUrl as string) ?? null, modelReasoningEffort: (c.modelReasoningEffort as string) ?? null,
    modelContextWindow: (c.modelContextWindow as number) ?? null, modelAutoCompactTokenLimit: (c.modelAutoCompactTokenLimit as number) ?? null,
    authPresent: p.authKind === "apiKey" ? p.apiKeyPresent : p.authKind === "chatgpt", authKind: p.authKind, ...mockPlanLabel(p), isDefault: name === mockSettings.defaultProfile,
    appearance: { color: p.color, effectiveColor: p.color, providerCategory: null, ...mockLookAppearance(name) }, quotaEnabled: p.authKind === "apiKey", ...mockLookFields(name),
    allowSessionSwitch: p.allowSwitch ?? p.authKind === "apiKey", lastUsedAt: null,
    // profile-switch-family: Responses-API key profiles swap among themselves; chat-wire relay is its own.
    ...(LEGACY ? {} : mockFamily(p)),
    // profile-native-subagents / profile-agent-approval
    ...(LEGACY ? {} : { nativeSubagents: p.cliKind === "claude" ? null : (p.nativeSubagents ?? true), agentUseRequiresApproval: !!p.agentApproval }),
    // delegation-tools: effective delegation_wait (default Codex on, Claude off)
    ...(LEGACY ? {} : { delegationWait: p.delegationWait ?? p.cliKind !== "claude" }),
    // profile-search-tool: Codex API-key profiles only (owner switch, default off)
    ...(LEGACY ? {} : { searchTool: p.cliKind !== "claude" && p.authKind === "apiKey" && !!p.searchTool }),
    // profile-generic-switches: Codex profiles bool, Claude null
    ...(LEGACY ? {} : { privateChatgptAuthFile: p.cliKind === "claude" ? null : !!p.privateAuthFile, toolSchemaCompat: p.cliKind === "claude" ? null : (p.toolSchemaCompat ?? null) }),
    // claude-tools-settings
    ...(LEGACY || p.cliKind !== "claude" ? {} : { claudeAllowWrite: p.claudeWrite ?? true, claudeAllowExec: p.claudeExec ?? true, claudeFileCheckpointing: p.claudeCheckpoints ?? false }),
    // Module-owned profile fields (claude-accounts: claudeAccount).
    ...moduleProfileFields(mockProfileRef(name)),
    ...(LEGACY ? {} : { modelDisplayNames: { ...(p.modelNames ?? {}) } }),
  };
};
/** cutex r222: the auto quota reader follows the base URL host (relay /usage, DeepSeek / Moonshot balance); other hosts have none. */
function mockAutoQuotaError(name: string): string | null {
  const p = mockProfiles[name];
  if (p?.authKind !== "apiKey") return null;
  const baseUrl = String(p.config.providerBaseUrl ?? "");
  const host = URL.canParse(baseUrl) ? new URL(baseUrl).hostname : "";
  if (/(^|\.)(example-relay\.com|deepseek\.com)$|^api\.moonshot\.(ai|cn)$/.test(host)) return null;
  return `No automatic quota preset for provider "${String(p.config.modelProvider)}" / base URL "${baseUrl}"`;
}
/** profile-generic-switches readers (cutex src/profiles/quota.rs Reader::ALL). */
const MOCK_READER_NAMES = ["usage_endpoint", "deepseek_balance", "moonshot_balance", "moonshot_cn_balance", "zhipu_coding_plan", "openrouter_key", "kimi_code_plan"];
/** Starting quota source per fixture profile: a relay /usage reader, official balances, one unresolved legacy `auto`. */
const MOCK_QUOTA_READERS: Record<string, string> = { GLM: "usage_endpoint", omega: "deepseek_balance", Kimi: "moonshot_balance", relay: "auto" };
/** Saved quota-config drafts (preview session only). */
const mockQuotaConfigs: Record<string, { preset: string; primary: QuotaReaderConfig; extras: QuotaReaderConfig[] }> = {};
const mockProfileRef = (name: string): MockProfileRef => ({ id: name, name, cliKind: mockProfiles[name]!.cliKind ?? "codex" });
const mockProfileDetail = (name: string) => {
  const p = mockProfiles[name]!;
  const keys = ["model", "modelProvider", "forcedLoginMethod", "modelReasoningEffort", "modelReasoningSummary", "updatePlanEnabled", "webSearch", "modelCatalogJson", "modelContextWindow", "modelAutoCompactTokenLimit", "providerName", "providerBaseUrl", "providerEnvKey", "providerWireApi", "requestMaxRetries", "streamMaxRetries", "streamIdleTimeoutMs", "websocketConnectTimeoutMs", "requiresOpenaiAuth", "supportsWebsockets"];
  const claude = p.cliKind === "claude";
  const config = claude ? null : Object.fromEntries(keys.map((k) => [k, p.config[k] ?? null]));
  // Like cutex: Claude profiles only edit colour / switching; nothing advertises `name` (rename) yet.
  const editable = claude
    ? { allowSessionSwitch: true, apiKey: false, color: true, model: false, modelReasoningEffort: false, modelContextWindow: false, modelAutoCompactTokenLimit: false, modelProvider: false, providerOptions: false }
    : { allowSessionSwitch: true, apiKey: p.authKind === "apiKey", color: true, model: true, modelReasoningEffort: true, modelContextWindow: true, modelAutoCompactTokenLimit: true, modelProvider: p.authKind === "apiKey", providerOptions: p.authKind === "apiKey" };
  const agentOptions = LEGACY
    ? {}
    : { nativeSubagentsExplicit: claude ? null : (p.nativeSubagents ?? null), nativeSubagentsDefault: claude ? null : true, ...(claude ? { agentTurnQuestions: p.turnQuestions ?? "decide" } : {}), planLabelManual: p.planLabel ?? null, delegationWaitExplicit: p.delegationWait ?? null, delegationWaitDefault: !claude, // claude-tool-defaults
        claudeAllowWriteExplicit: claude ? (p.claudeWrite ?? null) : null, claudeAllowWriteDefault: claude ? true : null, claudeAllowExecExplicit: claude ? (p.claudeExec ?? null) : null, claudeAllowExecDefault: claude ? true : null, claudeFileCheckpointingExplicit: claude ? (p.claudeCheckpoints ?? null) : null, claudeFileCheckpointingDefault: claude ? false : null };
  const agentEditable = LEGACY ? {} : { nativeSubagents: !claude, agentUseRequiresApproval: true, delegationWait: true, ...(claude ? { agentTurnQuestions: true, claudeTools: true, claudeFileCheckpointing: true } : {}), planLabel: true, privateChatgptAuthFile: !claude, toolSchemaCompat: !claude };
  // profile-reasoning-summary: OpenAI-family Codex profiles only (DeepSeek-style ones strip the key).
  const summaryEditable = LEGACY ? {} : { modelReasoningSummary: !claude && p.config.modelProvider === "openai", updatePlanEnabled: !claude, webSearch: !claude, searchTool: !claude && p.authKind === "apiKey" };
  // claude-profile-default-model: the Claude default (built-in sonnet) is editable; no newSessionDefaults override in the mock.
  const claudeModel = LEGACY || !claude ? {} : { claudeProfileModel: (p.config.model as string) ?? "sonnet", claudeNewSessionModel: null, claudeBuiltinDefaultModel: "sonnet" };
  if (claude && !LEGACY) (agentEditable as Record<string, boolean>).claudeDefaultModel = true;
  return { ...mockProfileItem(name), model: (p.config.model as string) ?? (claude ? "sonnet" : null), detail: { ...claudeModel, config, apiKeyPresent: p.apiKeyPresent, allowSessionSwitchExplicit: p.allowSwitch, allowSessionSwitchDefault: p.authKind === "apiKey", catalogEditable: p.authKind === "apiKey" || (!LEGACY && !claude), editable: { ...editable, ...agentEditable, ...summaryEditable }, ...agentOptions } } as never;
};
const mockModelsView = (name: string) => {
  const p = mockProfiles[name]!;
  const profileWindow = (p.config.modelContextWindow as number | null) ?? null;
  const profileCompact = (p.config.modelAutoCompactTokenLimit as number | null) ?? null;
  const variants = !LEGACY && p.cliKind !== "claude";
  const catalog = p.authKind === "apiKey" || variants;
  // Non-catalog sources as cutex reports them; gamma shows the "upstream changed" notice.
  const nativeCache = { kind: "nativeCache", clientVersion: "0.161.0", fetchedAt: "2026-10-06T13:46:02.856Z", native: { version: "0.160.0-r47", cliSha256: "9f2c41d0a7be" }, notInBundled: ["gpt-6.1-sol", "gpt-6-luna"] };
  // profile-catalog-overlay: official lists follow upstream; edits are the profile's overlay.
  const followsUpstream = !LEGACY && p.cliKind !== "claude" && p.authKind !== "apiKey";
  const modelsSource = p.authKind === "apiKey"
    ? { kind: "catalog" }
    : p.cliKind === "claude"
      ? (LEGACY ? { kind: "claudeAliases" } : { kind: "claudeReference", updatedAt: "2026-10-18" })
      : followsUpstream && p.models.some((m) => m.requestModel)
        ? { kind: "overlay", upstream: nativeCache }
        : nativeCache;
  return {
    profile: { id: name, name }, catalogSupported: catalog, ...(!LEGACY && p.cliKind === "claude" ? { autoCompactApplies: false } : {}), catalogPresent: catalog && p.models.length > 0, selectedModel: (p.config.model as string) ?? (p.cliKind === "claude" ? "sonnet" : null),
    modelsSource, modelsUnavailableReason: null, ...(!LEGACY ? { modelVariantsSupported: variants, discoverySupported: p.authKind === "apiKey" } : {}),
    ...(!LEGACY ? { followsUpstream, catalogOverlay: modelsSource.kind === "overlay" ? { entries: p.models.filter((m) => m.requestModel).length, migratedFrom: null } : null, unavailableModels: p.unavailable ?? [] } : {}),
    profileOverrides: { modelContextWindow: profileWindow, modelAutoCompactTokenLimit: profileCompact },
    discovery: p.authKind === "apiKey" ? { sourceUrl: `${String(p.config.providerBaseUrl)}/models`, fetchedAt: "2026-10-06T08:12:00Z", models: p.models.map((m) => m.id) } : null,
    unsupportedModelFields: ["maxOutputTokens"], precedence: null,
    models: p.models.map((m) => {
      const window = profileWindow ? Math.min(profileWindow, m.maxContextWindow ?? profileWindow) : m.contextWindow;
      const compactRaw = profileCompact ?? m.autoCompactTokenLimit;
      return {
        ...m, effectiveContextWindowPercent: null, isDefault: m.id === ((p.config.model as string) ?? (p.cliKind === "claude" ? "sonnet" : null)), discovered: true, ...(LEGACY ? {} : { entryDisplayName: p.modelNames?.[m.id] ?? null }),
        effective: p.cliKind === "claude" ? {
          contextWindow: LEGACY ? null : m.contextWindow, contextWindowSource: !LEGACY && m.contextWindow ? "reference" : "unknown",
          autoCompactTokenLimit: null, autoCompactTokenLimitSource: "notApplicable",
        } : {
          contextWindow: window, contextWindowSource: profileWindow ? "profile" : m.contextWindow ? "catalog" : "unknown",
          autoCompactTokenLimit: window ? Math.min(compactRaw ?? Infinity, Math.round(window * 0.9)) : compactRaw,
          autoCompactTokenLimitSource: profileCompact ? "profile" : m.autoCompactTokenLimit ? "catalog" : "default90Percent",
        },
      };
    }),
  } as never;
};
const mockSettings = {
  defaultProfile: "omega", defaultProfileDirectLaunch: false, newSessionDefaults: { omega: { model: "deepseek-v4-flash", reasoning: "high" } },
  newSessionNotification: "normal" as const, agentBusEnabled: true, agentBusPort: 24360, agentBusEffectivePort: 24360,
  agentMessagePrefixTemplate: null, agentMessageSuffixTemplate: null, claudeUsageRefreshMinutes: 10,
  secretsPresent: { agentBusToken: true, managementApiToken: true }, restartRequiredFields: ["agentBusEnabled", "agentBusPort"], newRuntimesOnlyFields: ["proxy"],
  // session-delete-empty-on-archive / quick-chat-default-profile
  archiveDeleteEmpty: true, quickChatDefaultProfile: null as string | null,
  // auto-thread-titles
  autoThreadTitles: true, threadTitleModel: null as string | null,
  // codex-plugins
  codexConfigFollowShared: true,
  // listen-settings
  managementListen: ["127.0.0.1:24270", "tailscale", "0.0.0.0:24271"] as string[] | null,
  managementCorsOrigins: null as string[] | null,
};
// agent-project-boundary / agent-external-grants: Wave (waveline's Director) may be messaged from
// cutex-desktop; scratch (independent) is linked to the whole desktop project.
const mockSecurity: import("../../../shared/ipc").AgentSecurity = {
  crossProjectAccess: "isolated", crossProjectAccessOptions: ["isolated", "host"], crossProjectAccessDefault: "isolated",
  links: [["project:desktop", "agent:scratch"]], maxLinks: 256,
  externalAgents: [{ project: "desktop", agent: "wave" }], maxExternalAgents: 256,
};
const clonePerms = (d: LaunchPermissions): LaunchPermissions => ({ ...d, writableRoots: [...d.writableRoots] });
// The mock host is a current cutex (fresh-agent-auto-permissions): its built-in agent default is the
// composer's 自动 mode; the configured agent default is full access, as an existing home keeps it.
const MOCK_BUILTIN_THREAD_DEFAULTS: NewThreadDefaults = {
  agent: { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", networkAccess: true, writableRoots: [] },
  quickChat: { ...clonePerms(BUILTIN_THREAD_DEFAULTS.quickChat), approvalsReviewer: "auto_review" },
};
// Configured newThreadDefaults: quick chats get network access here so the reset UI shows.
const mockThreadDefaults: NewThreadDefaults = {
  agent: { ...clonePerms(BUILTIN_THREAD_DEFAULTS.agent), approvalsReviewer: "auto_review" },
  quickChat: { ...clonePerms(BUILTIN_THREAD_DEFAULTS.quickChat), approvalsReviewer: "auto_review", networkAccess: true },
};
const settingsView = () => (LEGACY ? mockSettings : { ...mockSettings, queue: { ownerMayPassAsks: true, ...(mockSettings as { queue?: object }).queue }, queueDefault: { ownerMayPassAsks: true }, ...moduleSettings(), newThreadDefaults: structuredClone(mockThreadDefaults), newThreadDefaultsBuiltin: structuredClone(MOCK_BUILTIN_THREAD_DEFAULTS), agentSecurity: structuredClone(mockSecurity) });
const QUICK_CHAT_SETTINGS = { model: "deepseek-v4-flash", modelProvider: "deepseek", effort: "high", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false } };
/** A quick chat as cutex reports it: local-only owned session, no formal agent name, scratch cwd. */
function quickChat(id: string, name: string, minutesAgo: number, over: { output?: string } = {}): SessionResource {
  const s = session(id, name, { cwd: `C:\\Users\\sam\\.cutex\\chats\\${id}`, output: over.output, idle: minutesAgo });
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return { ...s, registrationClass: "local_only", formalAgentName: null, threadName: name, createdAt: at, updatedAt: at, runtime: { ...s.runtime, lastEventAt: at, threadSettings: QUICK_CHAT_SETTINGS } };
}
let mockInstructions = "# 用户级指令\n\n- 用中文回复。\n- 提交前先跑测试。\n";

/** A hidden agent (not in GET /v2/sessions) still on the claude profile: profile_in_use names it, delete works by id. */
const mockHiddenRefs = new Map([["hidden-claude", { profile: "claude", displayName: "explicit-launch-probe" }]]);
const profileOf = (id: string) => [...snapshot.active, ...snapshot.retired].find((s) => s.cutexSessionId === id)?.profile ?? "omega";
/**
 * `idle`: minutes since the agent's last conversation activity (cutex activity.lastConversationAt);
 * without it an agent with output / a tool call was active at a random time in the last hour, one
 * without any has no activity yet. The sidebar folds online idle agents only after 30 minutes.
 */
function session(id: string, name: string, over: { status?: string; turn?: string | null; lifecycle?: "active" | "retired"; cwd?: string; output?: string; tool?: string; profile?: string; idle?: number } = {}): SessionResource {
  const at = new Date(Date.now() - (over.idle !== undefined ? over.idle * 60_000 : Math.random() * 3_600_000)).toISOString();
  const activity = over.output || over.tool || over.idle !== undefined
    ? { lastOutput: over.output ? { displayText: over.output, updatedAt: at } : undefined, lastToolCall: over.tool ? { displayText: over.tool, updatedAt: at } : undefined, ...(LEGACY ? {} : { lastConversationAt: at }) }
    : null;
  return {
    contractVersion: 2,
    cutexSessionId: id,
    revision: 1,
    lifecycle: over.lifecycle ?? "active",
    retiredAt: null,
    hostId: "HOST-A",
    displayName: name,
    threadName: null,
    cwd: over.cwd ?? "D:\\Apps\\cutex-desktop",
    profile: over.profile ?? "omega",
    configuredProfile: over.profile ?? "omega",
    launchedProfile: over.profile ?? "omega",
    effectiveNextLaunch: { profile: over.profile ?? "omega", source: "session_configured" },
    groups: [],
    registrationClass: null,
    visible: true,
    native: { threadId: `thread-${id}`, schema: null },
    runtime: {
      backend: "managed",
      status: over.status ?? "online",
      appServerConnected: (over.status ?? "online") === "online",
      runtimeGeneration: 3,
      runtimeAgentId: null,
      activeTurnId: over.turn ?? null,
      activeTurnObservedAt: over.turn ? new Date(Date.now() - 20_000 - Math.random() * 900_000).toISOString() : null,
      threadStatus: null,
      threadSettings: MOCK_SETTINGS[over.profile ?? "omega"] ?? null,
      requiresVisibleTerminal: false,
      tuiAttached: false,
      lastEventAt: new Date(Date.now() - Math.random() * 3_600_000).toISOString(),
      lastError: null,
    },
    runtimeDefaults: null,
    activity,
    focus: null,
    management: null,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * A Claude agent (cutex claude-runtime-features): native.schema is the adapter's Codex subset and
 * lists unsupported features (goals, review, background terminals, fork). skillInput is false
 * as cutex reports it (hidden from older desktops); the picker uses managedSkills + cutex
 * claude-session-skills instead. Revert with files (fileRewind), Fast (fastMode on Opus) and the
 * answering-model badge (modelObservation) are on, as in claude-r14+. memoryMode is left unknown (null)
 * so the "not available for this agent" notice can be tried through /memories. Steer (read after the
 * next tool call), Claude Code's own permission modes and persistent allow rules
 * (dev/mockClaudePermissions.ts) are on too.
 */
const CLAUDE_FEATURES = {
  turnStart: true, turnSteer: true, queueWhileBusy: true, turnInterrupt: true, imageInput: true, skillInput: false, agentMessageStreaming: true,
  reasoning: true, commandItems: true, fileChangeItems: true, turnDiff: true, commandOutputStreaming: false, approvals: true, userInputRequests: true,
  planMode: true, planChecklist: true, goals: false, review: false, compact: true, modelList: true, effort: true, tokenUsage: true, rateLimits: true,
  history: true, historyRevert: true, fork: false, backgroundTerminals: false, memoryMode: null, permissionPresets: ["full", "auto", "readOnly"],
  managedSkills: true, fileRewind: true, fileCheckpointing: true, fastMode: true, modelObservation: true,
  subagents: true, subagentTranscripts: true, threadSearch: true,
  claudePermissionModes: ["default", "acceptEdits", "plan", "auto", "bypassPermissions"], livePermissionMode: true, permissionRules: true,
};
/**
 * Kai: a claude-r21 adapter — Side chat (`sideChat`) and fork while busy (`forkWhileBusy`), fork on.
 * Sora keeps the older adapter's map (no Side, no fork), so the preview shows both.
 */
const CLAUDE_R21_FEATURES = { ...CLAUDE_FEATURES, fork: true, sideChat: true, forkWhileBusy: true };
/** `GET /v2/sessions/{id}/skills` of the mock Claude agent (Codex skills/list shape). */
const MOCK_CLAUDE_SKILLS = {
  data: [{
    cwd: "/work/cutex-desktop",
    skills: [
      { name: "release-notes", description: "Write the CHANGELOG entry for the current branch", shortDescription: "CHANGELOG entry", path: "/work/cutex-desktop/.agents/skills/release-notes/SKILL.md", scope: "repo", enabled: true, pluginId: null },
      { name: "pdf-extract", description: "Extract tables and text from PDF files", path: "/home/owner/.cutex/claude-skills/pdf-extract/SKILL.md", scope: "user", enabled: true, pluginId: null },
    ],
    errors: [],
  }],
};
function claudeSession(id: string, name: string, output: string, features: Record<string, unknown> = CLAUDE_FEATURES, turn?: string): SessionResource {
  const s = session(id, name, { profile: "claude", output, turn });
  return {
    ...s,
    native: { threadId: `thread-${id}`, schema: { protocol: "claude-app-server-subset", majorVersion: 1, version: "0.3.0+cutex", sha256: "", channel: "experimental", capabilities: { experimentalApi: true, features: LEGACY ? null : features }, extensions: ["claude-runtime-v1"] } },
    runtime: { ...s.runtime, backend: "claude_subscription" },
    runtimeDefaults: LEGACY ? null : { claudeAllowWrite: false, claudeAllowExec: false },
  };
}
/** Throws what main throws for a Claude agent's -32601 data.unsupported (as it arrives over IPC). */
function unsupportedFor(sessionId: string, feature: string): void {
  if (sessionId === "sora") throw new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: agent_feature_unsupported: ${feature}`);
}

const hostRow = (id: string, projectId: string | null) => ({
  id, name: id, kind: "Agent", hostId: "HOST-A", profile: "pro", projectId, cwd: null, state: "", generation: 3, nativeId: null,
});

let snapshot: SidebarSnapshot = {
  active: [
    // Idle 5 minutes (just finished): a full row; Lead, idle 2 hours, folds into 「N 个空闲」.
    session("eva", "Eva", { profile: "gamma", output: "收到，我切到生成的类型上。顺便通知 Mika 开始做 composer。", idle: 5 }),
    session("alden", "Alden", { turn: "turn-live", tool: "$ cargo build --locked --bin cutex" }),
    session("mika", "Mika", { profile: "GLM", output: "Composer 的队列面板已经接上 cutex/userInput/queue/list。", idle: 140 }),
    session("rei", "Rei", { status: "offline", output: "迁移脚本已完成。" }),
    session("scratch", "scratch", { cwd: "C:\\Users\\sam\\scratch" }),
    session("wave", "Wave-Director", { tool: "✎ release-notes.md" }),
    { ...claudeSession("sora", "Sora", "WebFetch 读完了 adapter 的 DESKTOP_PARITY.md。"), activity: { lastOutput: { displayText: "WebFetch 读完了 adapter 的 DESKTOP_PARITY.md。", updatedAt: new Date(Date.now() - 70 * 60_000).toISOString() }, ...(LEGACY ? {} : { lastConversationAt: new Date(Date.now() - 70 * 60_000).toISOString() }) } },
    // A busy claude-r21 agent: 分叉 stays available while it runs, 回退 waits; Side chat is offered.
    claudeSession("kai", "Kai", "在跑 vitest，先看 structuralGate 的用例。", CLAUDE_R21_FEATURES, "kai-t2"),
    // Delegations (modules/delegations/mock.ts): Lead delegates, Helper handles.
    session("lead", "Lead", { profile: "gamma", output: "三件都交出去了，结果回来我再汇总。", idle: 120 }),
    session("helper", "Helper", { turn: "helper-t2", tool: "$ cargo test --lib management::v2::user_input" }),
    quickChat("chat-rust", "Rust 生命周期报错", 3, { output: "这个 borrow 的问题在于返回值活得比 buf 久…" }),
    quickChat("chat-trip", "东京三日行程", 180, { output: "第二天建议先去浅草寺，人少。" }),
  ],
  retired: [session("old1", "old-refactor", { lifecycle: "retired", status: "offline" })],
  projects: {
    schema: "cutex/human-management-projects/v1",
    projects: [
      {
        project_id: "desktop",
        workspace_root: "D:\\Apps\\cutex-desktop",
        authority_epoch: 1,
        director_cutex_session_id: "eva",
        presentation: { display_name: "cutex-desktop", badge_label: "CD", color: "cyan" },
        active_member_count: 4,
        lifecycle: "active",
      },
      {
        project_id: "waveline",
        authority_epoch: 1,
        director_cutex_session_id: "wave",
        presentation: { display_name: "waveline", badge_label: "W", color: "magenta" },
        active_member_count: 1,
        lifecycle: "active",
      },
    ],
    archived_projects: [
      {
        project_id: "proto",
        authority_epoch: 1,
        director_cutex_session_id: "old5",
        presentation: { display_name: "proto-lab", badge_label: "P", color: "yellow" },
        active_member_count: 0,
        archived_member_count: 1,
        lifecycle: "archived",
        project_revision: 3,
      },
    ],
  },
  hostRows: {
    eva: hostRow("eva", "desktop"),
    alden: hostRow("alden", "desktop"),
    mika: hostRow("mika", "desktop"),
    rei: hostRow("rei", "desktop"),
    old1: hostRow("old1", "desktop"),
    wave: hostRow("wave", "waveline"),
    sora: hostRow("sora", "desktop"),
    kai: hostRow("kai", "desktop"),
    lead: hostRow("lead", "desktop"),
    helper: hostRow("helper", "desktop"),
    scratch: hostRow("scratch", null),
    "chat-rust": { ...hostRow("chat-rust", null), kind: "Session" },
    "chat-trip": { ...hostRow("chat-trip", null), kind: "Session" },
  },
};

/**
 * Many offline agents (全部 agent list / compact sidebar rows): mostly AUTO_… and a… names, so the
 * initials collide; spread over days, some with notes, Claude ones, model defaults, a last output.
 * `…fail…` ids refuse to start (bulk start progress shows 失败).
 */
function offlineAgent(id: string, name: string, minutesAgo: number, over: { note?: string; claude?: boolean; model?: string; output?: string; tool?: string; profile?: string; lifecycle?: "retired" } = {}): SessionResource {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const created = new Date(Date.now() - (minutesAgo + 600 + (name.length % 7) * 1440) * 60_000).toISOString();
  const base = over.claude ? claudeSession(id, name, over.output ?? "") : session(id, name, { profile: over.profile ?? "omega", output: over.output, tool: over.tool });
  const activity = base.activity ? Object.fromEntries(Object.entries(base.activity).map(([k, v]) => [k, v && typeof v === "object" ? { ...v, updatedAt: at } : v])) : null;
  return {
    ...base,
    lifecycle: over.lifecycle ?? "active",
    retiredAt: over.lifecycle ? at : null,
    note: over.note ?? null,
    effectiveNextLaunch: over.claude ? { profile: null, source: "claude_subscription", model: over.model ?? "sonnet" } : base.effectiveNextLaunch,
    runtime: { ...base.runtime, status: "offline", appServerConnected: false, threadSettings: null, lastEventAt: at },
    runtimeDefaults: over.model && !over.claude ? { ...(base.runtimeDefaults ?? {}), model: over.model } : base.runtimeDefaults,
    activity: { ...(activity ?? {}), ...(LEGACY ? {} : { lastConversationAt: at }) } as SessionResource["activity"],
    createdAt: created,
    updatedAt: at,
  };
}
const OFFLINE_AUTO = ["review-1832", "nightly-sync", "lint-fix", "build-check", "deps-bump", "flaky-hunt", "doc-sweep", "i18n-pass", "perf-probe", "release-notes", "migrate-db", "triage", "bench-ci", "clippy", "snapshot-diff", "fuzz-ws", "acl-audit", "schema-hash", "rollout-scan", "queue-replay", "tray-icons", "ssh-tunnel", "gc-logs", "pr-212", "pr-219", "pr-224", "cache-warm", "deadlinks", "a11y", "theme-tokens", "codex-160", "claude-r3", "mcp-sweep", "deploy-r203", "deploy-r204", "rust-1-95", "vite-7", "tailwind-4", "electron-44", "pnpm-10"];
const OFFLINE_A = ["alpha-scan", "aria", "atlas", "audit-bot", "api-docs", "archiver", "ash", "aurora", "axiom", "ayu", "asahi", "aoi", "akane", "fail-probe"];
const NOTES = ["每晚跑 cargo test 并汇报失败用例", "盯 PR #212 的回归，修完通知 Eva", "清理 7 天前的运行日志", "", "", "只读：看代码，不要改文件", ""];
const independentOffline = [
  ...OFFLINE_AUTO.map((n, i) => offlineAgent(`auto-${i}`, `AUTO_${n}`, 25 + i * i * 9, { note: NOTES[i % NOTES.length] || undefined, claude: i % 9 === 4, model: i % 5 === 0 ? "deepseek-v4-pro" : undefined, output: i % 3 === 0 ? `${n}: 完成，没有新的问题。` : undefined, tool: i % 3 === 1 ? `$ cargo test -p ${n}` : undefined })),
  ...OFFLINE_A.map((n, i) => offlineAgent(n === "fail-probe" ? "a-fail" : `a-${i}`, n, 50 + i * 170, { note: i === 2 ? "地图类任务：读仓库结构，写 ARCHITECTURE.md" : undefined, profile: i % 2 ? "gamma" : "deepseek", output: i % 2 ? "已整理成表格，等你确认。" : undefined })),
];
const desktopOffline = [
  offlineAgent("d-ayumi", "Ayumi", 12, { note: "composer 队列面板", profile: "GLM", output: "队列面板的拖拽排序做完了。" }),
  offlineAgent("d-beta", "Beta", 95, { tool: "✎ Sidebar.tsx" }),
  offlineAgent("d-akari", "Akari", 300, { claude: true, model: "opus", note: "Claude：读 ZCode 组件，列出可移植的" }),
  offlineAgent("d-anna", "Anna", 1600, { output: "i18n 的 en 文案补齐了。" }),
  offlineAgent("d-auto-ui", "AUTO_ui-review", 4000),
  offlineAgent("d-auto-e2e", "AUTO_e2e-smoke", 9000, { note: "冒烟测试：新建 agent → 发消息 → 归档" }),
  offlineAgent("d-fail-x", "AUTO_fail-start", 20000),
];
/** Runtime restore candidates (restoreCandidates): online before the mock unclean stop 25 min ago. */
const RESTORE_IDS = ["rei", "d-ayumi", "d-beta", "d-fail-x"];
const RESTORE_AT = Date.now() - 25 * 60_000;
let restoreDismissed = false;
const archivedMore = [
  offlineAgent("old2", "AUTO_old-migration", 30000, { lifecycle: "retired", note: "v3 → v4 数据迁移（已完成）", output: "迁移完成，共 1,204 条记录。" }),
  offlineAgent("old3", "atlas-v1", 60000, { lifecycle: "retired", claude: true }),
  offlineAgent("old4", "AUTO_spike-ws", 90000, { lifecycle: "retired", tool: "$ pnpm vitest run ws" }),
  // Archived together with its project (proto, in archived_projects): restoring it restores the project first.
  // Only an archived agent on relay: deleting relay offers 已归档的改用默认 Profile (profile-delete-detach-archived).
  offlineAgent("old5", "proto-spike", 45000, { lifecycle: "retired", profile: "relay", output: "原型跑通了，结论写在 NOTES.md。" }),
];
snapshot = {
  ...snapshot,
  active: [...snapshot.active, ...desktopOffline, ...independentOffline],
  retired: [...snapshot.retired, ...archivedMore],
  hostRows: {
    ...snapshot.hostRows,
    ...Object.fromEntries(desktopOffline.map((s) => [s.cutexSessionId, hostRow(s.cutexSessionId, "desktop")])),
    old5: hostRow("old5", "proto"),
    ...Object.fromEntries(independentOffline.map((s) => [s.cutexSessionId, hostRow(s.cutexSessionId, null)])),
  },
};

const SCP_MORE: [string, string, number, Parameters<typeof offlineAgent>[3]][] = [
  ["demo-pm-codex", "demo-polyadb-mouse-codex-r1", 120, { note: "PolyA DB：小鼠数据的 Codex 版本", output: "小鼠 polyA 位点表导出完成。" }],
  ["demo-pm-claude", "demo-polyadb-mouse-claude-r1", 180, { claude: true, model: "opus", note: "PolyA DB：Claude 版本" }],
  ["demo-atac", "demo-atac-qc", 260, { tool: "$ Rscript qc_atac.R" }],
  ["demo-deseq", "demo-deseq2", 400, { profile: "gamma", output: "差异表达结果写进 results/deseq.tsv。" }],
  ["demo-figs", "demo-figures", 520, { note: "论文图 1–4", tool: "✎ fig3.R" }],
  ["demo-review", "demo-reviewer", 900, { claude: true, model: "sonnet", note: "只读：审稿意见逐条核对" }],
  ["demo-annot", "demo-annotation", 1300, { output: "细胞类型注释更新到 v3。" }],
  ["demo-cluster", "demo-cluster-r3", 1900, { profile: "gamma" }],
  ["demo-traj", "demo-trajectory", 2600, { note: "拟时序分析" }],
  ["demo-velo", "demo-velocity", 3900, { claude: true }],
  ["demo-integ", "demo-integration", 5200, { tool: "$ python harmony.py" }],
  ["demo-doublet", "demo-doublets", 8800, { output: "去掉了 3.1% 的 doublets。" }],
];

/**
 * Sidebar v2 states across projects: demo (running Director with an owner question, a running and an
 * idle agent, one finishing a turn after start), ifm-ema (an agent with a result awaiting acceptance,
 * one whose turn fails after start), kks / notes (nothing online: collapsed rows with a flyout).
 */
const projectSessions: [SessionResource, string][] = [
  [session("demo-dir", "demo-director-r2", { turn: "demo-t1", tool: "$ python power.py --n 400", cwd: "D:\\Research\\demo" }), "demo"],
  [session("demo-run", "demo-sampler", { turn: "demo-t2", tool: "$ Rscript sample.R", cwd: "D:\\Research\\demo" }), "demo"],
  // Finished 3 minutes ago: stays a full row (folds into 「N 个空闲」 after 30 minutes idle).
  [session("demo-done", "demo-writer", { output: "第二节改完了，等你看。", cwd: "D:\\Research\\demo", idle: 3 }), "demo"],
  [offlineAgent("demo-idle", "demo-lit", 40, { output: "文献表更新到 42 篇。" }), "demo"],
  [offlineAgent("demo-idle2", "demo-stats", 75), "demo"],
  // A big project (the agent tab as member management): 17 members, 3 online, shared "demo-" prefix.
  ...SCP_MORE.map(([id, name, minutes, over]) => [offlineAgent(id, name, minutes, over), "demo"] as [SessionResource, string]),
  // ifm-ema-figures finished 6 minutes ago (a full row), ifm-ema-plots has been idle 95 minutes (folded).
  [session("ifm-dir", "ifm-director", { output: "图表的任务已经交给 figures。", cwd: "D:\\Research\\ifm-ema", idle: 50 }), "ifm-ema"],
  [session("ifm-figures", "ifm-ema-figures", { output: "三张图重画完了。", cwd: "D:\\Research\\ifm-ema", idle: 6 }), "ifm-ema"],
  [session("ifm-plot", "ifm-ema-plots", { output: "开始重跑 bootstrap。", cwd: "D:\\Research\\ifm-ema", idle: 95 }), "ifm-ema"],
  // Freshly created by ifm-director 4 minutes ago, idle after its first turn, never opened: a full row
  // with the 「新」 marker instead of folding into 「N 个空闲」 (lib/freshAgents).
  [{ ...session("ifm-review", "ifm-ema-review", { output: "初稿审完了，意见写在 review.md。", cwd: "D:\\Research\\ifm-ema" }), createdAt: new Date(Date.now() - 4 * 60_000).toISOString() }, "ifm-ema"],
  [offlineAgent("kks-dir", "kks-director", 2900, { output: "上周的部署都完成了。" }), "kks"],
  [offlineAgent("kks-web", "kks-web", 3100, { tool: "$ pnpm build" }), "kks"],
  [offlineAgent("kks-api", "kks-api", 4300), "kks"],
  [offlineAgent("notes-1", "notes-indexer", 15000), "notes"],
  // Quiet projects (offline agents only) for the sidebar's one-row / starred header rows and icons.
  [offlineAgent("proj-dir", "proj-director", 300), "demo2026"],
  [offlineAgent("reader-dir", "reader-director", 400), "reader"],
  [offlineAgent("chores-1", "chores-helper", 65), "chores"],
  [offlineAgent("demo-cs-1", "demo-cs-writer", 70), "demo-cs"],
  [offlineAgent("vcc-1", "vcc-runner", 3 * 1440), "vcc-2026"],
];
// `?manydemo`: a dozen more demo-* members sharing the prefix (default avatars at a glance); `?sidebarpins` too.
if (typeof location !== "undefined" && (new URLSearchParams(location.search).has("manydemo") || new URLSearchParams(location.search).has("sidebarpins"))) {
  for (const name of ["demo-ui-r3", "demo-quant-config-r1", "demo-quant-engine-r1", "demo-quant-integration-r1", "demo-quant-review-r1", "demo-analysis-retina-r1", "demo-analysis-public-r1", "demo-analysis-spatial-r1", "demo-analysis-protocol-r1", "demo-polyadb-human-glm-r1", "demo-kidney-glm-r2", "demo-heart-nuclei-claude-r3"])
    projectSessions.push([session(`${name}-sid`, name, { cwd: "D:\\Research\\demo" }), "demo"]);
}
snapshot = {
  ...snapshot,
  active: [...snapshot.active, ...projectSessions.map(([s]) => s)],
  projects: {
    ...snapshot.projects!,
    projects: [
      ...snapshot.projects!.projects,
      { project_id: "demo", workspace_root: "D:\\Research\\demo", authority_epoch: 1, director_cutex_session_id: "demo-dir", presentation: { display_name: "demo-study", badge_label: "S", color: "green" }, active_member_count: 17, lifecycle: "active" },
      { project_id: "ifm-ema", workspace_root: "D:\\Research\\ifm-ema", authority_epoch: 1, director_cutex_session_id: "ifm-dir", presentation: { display_name: "ifm-ema", badge_label: "IE", color: "yellow" }, active_member_count: 4, lifecycle: "active" },
      { project_id: "kks", workspace_root: "D:\\Apps\\kks", authority_epoch: 1, director_cutex_session_id: "kks-dir", presentation: { display_name: "kks", badge_label: "K", color: "red" }, active_member_count: 3, lifecycle: "active" },
      { project_id: "notes", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "notes", badge_label: "N", color: "blue" }, active_member_count: 1, lifecycle: "active" },
      { project_id: "demo2026", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "DEMO2026", badge_label: "DE", color: "red" }, active_member_count: 1, lifecycle: "active" },
      { project_id: "reader", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "Reader", badge_label: "RE", color: "cyan" }, active_member_count: 1, lifecycle: "active" },
      { project_id: "chores", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "Chores", badge_label: "CH", color: "cyan" }, active_member_count: 1, lifecycle: "active" },
      { project_id: "demo-cs", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "DEMO-CS", badge_label: "CS", color: "#f4a6b0" }, active_member_count: 1, lifecycle: "active" },
      { project_id: "vcc-2026", authority_epoch: 1, director_cutex_session_id: null, presentation: { display_name: "VCC-2026", badge_label: "VC", color: "#a89f8a" }, active_member_count: 1, lifecycle: "active" },
    ],
  },
  hostRows: { ...snapshot.hostRows, ...Object.fromEntries(projectSessions.map(([s, p]) => [s.cutexSessionId, hostRow(s.cutexSessionId, p)])) },
};

/**
 * `?sidebarpins` (with the `?manydemo` members): the device-local sidebar state for pins and folds
 * (seeded before the store reads it; bare ids = legacy entries the local host claims): a pinned online
 * idle agent (demo-ui-r3) and pinned offline ones (demo-stats; kks-web in a collapsed project), a
 * pinned older quick chat (东京三日行程, sorts first), and unseen done turns on idle agents
 * (demo-quant-engine-r1, demo-quant-config-r1, Lead) that stay in the collapsed 「N 个空闲」 with a ✓.
 * The agent bookmark
 * (Mika) comes from the bookmarks module's preview data.
 */
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("sidebarpins")) {
  try {
    localStorage.setItem("cutex-desktop.pinned", JSON.stringify(["demo-ui-r3-sid", "demo-idle2", "kks-web", "chat-trip"]));
    const at = Date.now() - 5 * 60_000;
    const done = (turnId: string, ago = 0) => ({ at: at - ago, failed: false, turnId });
    localStorage.setItem("cutex-desktop.turnMarks", JSON.stringify({ "demo-quant-engine-r1-sid": done("dqe-t3"), "demo-quant-config-r1-sid": done("dqc-t2", 60_000), lead: done("lead-t5", 120_000) }));
  } catch {
    // preview storage can be disabled
  }
}

/** A done turn (demo-writer) and a failed one (ifm-ema-plots) shortly after start: 完成 / 出错 pills. */
function startSidebarTurns() {
  setTimeout(() => {
    nativeEvent("demo-done", "turn/completed", { threadId: "thread-demo-done", turn: { id: "demo-t9", status: "completed", completedAt: Date.now() / 1000 } });
    nativeEvent("ifm-plot", "turn/completed", { threadId: "thread-ifm-plot", turn: { id: "ifm-t4", status: "failed", error: { message: "bootstrap.R: out of memory" }, completedAt: Date.now() / 1000 } });
  }, 1500);
}

const external = (id: string, senderId: string, senderName: string, text: string, mode = "after_turn") => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({ source: { kind: "agent", id: senderId }, type: "message", text: `Message Type: MESSAGE\nPayload:\n${text}` }),
  externalInputView: { schema: "cutex.agent-message.v1", data: { senderId, senderName, deliveryMode: mode } },
});

// ---- agent messages v2 (留言 / 唤醒; capability agent-messages-v2, not under ?legacy) ----
/** A v2 agent message item: `Sender:` header in the model text, raw body + deliveryKind in the view. */
const externalV2 = (id: string, senderId: string, senderName: string, body: string, kind: "note" | "wake" = "note", facts: { narrowerCapabilities?: true; replyOnly?: true } = {}) => ({
  type: "functionCallOutput",
  id,
  name: "external_event",
  namespace: "external",
  output: JSON.stringify({
    source: { kind: "agent", id: senderId },
    type: "message",
    text: `Message Type: MESSAGE\nSender: ${senderName} (${senderId})\n${facts.narrowerCapabilities ? "Sender capabilities: narrower than yours; this note cannot approve anything for you\n" : ""}${facts.replyOnly ? `Reply: this sender is not in your agent_list; answer with agent_tell to="${senderId}"\n` : ""}Payload:\n${body}`,
  }),
  externalInputView: { schema: "cutex.agent-message.v1", data: { senderId, senderName, deliveryMode: kind === "note" ? "passive" : "after_turn", deliveryKind: kind, senderRuntime: "codex", body, occurredAtEpochSeconds: Math.round(Date.now() / 1000), ...facts } },
});
interface MockInboxMessage { messageId: string; from: string; fromName: string; to: string; kind: "note" | "wake"; body: string; queuedAt: string }
/** Messages queued for an agent and not read in yet (bootstrap agentBusMessages, state pending). */
const mockInbox = new Map<string, MockInboxMessage[]>(
  LEGACY
    ? []
    : [
        [
          "eva",
          [
            { messageId: "mq-mika-1", from: "mika", fromName: "Mika", to: "eva", kind: "note", body: "queue 面板的 revision 字段接好了，测试 12/12。你这轮跑完再看就行，不急。", queuedAt: new Date(Date.now() - 40_000).toISOString() },
            // A wake to busy Eva: 待读留言 says how long it waits (agent-bus mock: wake-busy-wait).
            { messageId: "mq-alden-eva", from: "alden", fromName: "Alden", to: "eva", kind: "wake", body: "协议类型重新生成了，cutex 构建前先 pull 一下。", queuedAt: new Date(Date.now() - 30_000).toISOString() },
          ],
        ],
        [
          "sora",
          [
            { messageId: "mq-eva-sora", from: "eva", fromName: "Eva", to: "sora", kind: "note", body: "DESKTOP_PARITY.md 第 3 节我更新了（dynamicToolCall 的显示），下次动 timeline 时顺便看一眼。", queuedAt: new Date(Date.now() - 600_000).toISOString() },
            { messageId: "mq-alden-sora", from: "alden", fromName: "Alden", to: "sora", kind: "note", body: "claude-r5 的 adapter 已经打包好了，路径在 runtimes/claude-r5。", queuedAt: new Date(Date.now() - 120_000).toISOString() },
          ],
        ],
      ],
);
/** A system alarm fired while Eva is busy: no agent sender; cutex reads it only after her turn. */
const mockAlarmSnapshot = (id: string) =>
  LEGACY || id !== "eva"
    ? []
    : [{
        messageId: "alarm-mock-eva", fromCutexSessionId: null, toCutexSessionId: "eva", deliveryMode: "after_turn", content: "提醒：检查夜间构建结果。", state: "pending",
        sender: { id: "Cutex Alarm", name: null, runtime: null }, senderKind: "alarm_service", afterTurnOnly: true, queuedAt: new Date(Date.now() - 20_000).toISOString(),
        externalInput: { message: { id: "alarm-mock-eva", source: { kind: "service", id: "Cutex Alarm" }, type: "alarm", delivery: "after_turn" } },
      }];
const inboxSnapshot = (id: string) => [
  ...(mockInbox.get(id) ?? []).map((m) => ({ messageId: m.messageId, fromCutexSessionId: m.from, toCutexSessionId: m.to, deliveryMode: m.kind === "note" ? "passive" : "after_turn", deliveryKind: m.kind, content: m.body, body: m.body, state: "pending", sender: { id: m.from, name: m.fromName, runtime: "codex" }, queuedAt: m.queuedAt })),
  ...mockAlarmSnapshot(id),
];

const now = Date.now() / 1000;
const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
/** A finished Plan-mode turn: proposed plan card with the "implement?" actions, plus a checklist. */
const scratchRead = {
  thread: {
    id: "thread-scratch",
    turns: [
      {
        id: "turn-plan",
        status: "completed",
        startedAt: Date.now() / 1000 - 300,
        completedAt: Date.now() / 1000 - 289,
        items: [
          { type: "userMessage", id: "su1", content: [{ type: "text", text: "随便写个计划：给 scratch 加一个 README。" }] },
          { type: "agentMessage", id: "sa1", text: "我先只读确认目录状态，然后给出计划，不修改任何文件。" },
          { type: "commandExecution", id: "sc1", command: "Get-ChildItem -Force", status: "completed", exitCode: 0, durationMs: 300 },
          { type: "plan", id: "sp1", text: "## 初始化项目说明页\n\n1. 读取目录结构，确认没有现成的 README。\n2. 新建 `README.md`：项目一句话介绍、目录说明、如何运行。\n3. 在 `.gitignore` 里补上 `node_modules/`。\n\n**验证**：`Get-Content README.md` 能看到三节内容。" },
        ],
      },
    ],
  },
};
const threadRead = {
  thread: {
    id: "thread-eva",
    turns: [
      // Long-message folding preview: a very long prompt and a long (older) agent reply.
      {
        id: "turn-0",
        status: "completed",
        startedAt: now - 1500,
        completedAt: now - 1380,
        items: [
          {
            type: "userMessage",
            id: "u0",
            content: [
              {
                type: "text",
                text: [
                  "背景：下面是上周评审会的完整记录，帮我整理成行动项。",
                  "",
                  ...Array.from({ length: 24 }, (_, i) => `${i + 1}. 讨论点 ${i + 1}：${"队列 flush 要带 revision，management v2 的 schema 保持 LF，桌面端不直接碰本地文件系统。".repeat(i % 3 === 0 ? 2 : 1)}`),
                  "",
                  "最后：每条行动项写清负责人和截止时间。",
                ].join("\n"),
              },
            ],
          },
          {
            type: "agentMessage",
            id: "a0",
            text: [
              "整理好了，按负责人分组：",
              "",
              ...Array.from({ length: 6 }, (_, g) => [`### 第 ${g + 1} 组`, "", ...Array.from({ length: 4 }, (_, i) => `- 行动项 ${g * 4 + i + 1}：核对 flush 的 revision 校验，补测试，并在 PROGRESS.md 记一笔。`), ""]).flat(),
              "```ts",
              "export const owners = { queue: \"Alden\", desktop: \"Mika\", schema: \"Eva\" };",
              "```",
              "",
              "以上，截止时间统一定在下周五。",
            ].join("\n"),
          },
        ],
      },
      {
        id: "turn-1",
        status: "completed",
        startedAt: now - 900,
        completedAt: now - 840,
        items: [
          { type: "userMessage", id: "u1", content: [{ type: "text", text: "把侧边栏改成 IM 风格，按项目分组。" }] },
          { type: "commandExecution", id: "c1", command: "rg -n \"Sidebar\" apps/desktop/src", status: "completed", aggregatedOutput: "apps/desktop/src/renderer/src/components/Sidebar.tsx:1: ..." },
          {
            type: "agentMessage",
            id: "a1",
            text: [
              "好的。分组规则：",
              "",
              "1. 每个**项目**下分 `在线` / `离线` 两层；",
              "2. 已归档的 agent 移到 *设置 → 归档*；",
              "3. 独立 agent 放到最后。",
              "",
              "排序逻辑在 [sidebar.ts](apps/desktop/src/renderer/src/lib/sidebar.ts:42)，设计见 [DESIGN.md](docs/DESIGN.md#L115)。",
              "",
              "```ts",
              "export function compareRows(a: AgentRow, b: AgentRow): number {",
              "  return Number(b.isDirector) - Number(a.isDirector) || a.name.localeCompare(b.name);",
              "}",
              "```",
              "",
              "| 状态 | 显示 |",
              "|---|---|",
              "| running | 蓝色脉冲点 |",
              "| needsInput | ⚠ 等待确认 |",
            ].join("\n"),
          },
        ],
      },
      {
        id: "turn-2",
        status: "completed",
        startedAt: now - 300,
        completedAt: now - 240,
        items: [
          external("x1", "alden", "Alden", "协议类型已经生成好了，在 packages/protocol/src/codex，你那边可以直接用。"),
          { type: "agentMessage", id: "a2", text: "收到，我切到生成的类型上。顺便通知 Mika 开始做 composer。" },
        ],
      },
      {
        id: "turn-3",
        status: "completed",
        startedAt: now - 200,
        completedAt: now - 110,
        items: [
          { type: "userMessage", id: "u3", content: [{ type: "text", text: "修一下队列 flush 的竞态，然后跑测试。" }] },
          { type: "reasoning", id: "r31", summary: [], content: ["先看 flush 的调用点：server.rs 的 dispatch_queue_flush，还有 user_input 里那一处。\n\n两个 flush 并发时，如果没校验 revision，同一批消息会投递两次。先跑一遍测试确认。"] },
          { type: "commandExecution", id: "c31", command: "rg -n \"queue/flush\" src", status: "completed", exitCode: 0, durationMs: 300, aggregatedOutput: "src/management/v2/server.rs:3830: fn dispatch_queue_flush(" },
          { type: "commandExecution", id: "c32", command: "sed -n 3830,3890p src/management/v2/server.rs", status: "completed", exitCode: 0, durationMs: 120, aggregatedOutput: "fn dispatch_queue_flush(\n    ..." },
          { type: "commandExecution", id: "c33", command: "cargo test --lib management::v2::user_input", status: "failed", exitCode: 101, durationMs: 41000, aggregatedOutput: "test user_input::flush_respects_revision ... FAILED\n\nfailures:\n    assertion `left == right` failed: revision 4 != 5" },
          { type: "reasoning", id: "r32", summary: ["**确认失败原因**\n\n失败在 revision 校验：并发 flush 会重复投递，需要在 dispatch 时做一次 CAS。"], content: [] },
          { type: "agentMessage", id: "a31", text: "测试有一个失败：flush 时没校验队列 revision，两个 flush 并发会重复投递。我加一个 CAS 检查。" },
          { type: "fileChange", id: "f31", status: "completed", changes: [{ path: "src/management/v2/user_input.rs" }, { path: "src/management/v2/server.rs" }] },
          { type: "commandExecution", id: "c34", command: "cargo test --lib management::v2::user_input", status: "completed", exitCode: 0, durationMs: 38000, aggregatedOutput: "test result: ok. 41 passed; 0 failed" },
          { type: "subAgentActivity", id: "sa1", kind: "started", agentThreadId: "thread-sub-explorer", agentPath: "/root/explorer" },
          { type: "collabAgentToolCall", id: "s30", tool: "spawnAgent", status: "completed", senderThreadId: "thread-eva", receiverThreadIds: ["thread-sub-explorer"], prompt: "找出所有调用 queue flush 的地方，列出每处是否校验了 revision。只读，不要改代码。", model: null, reasoningEffort: null, agentsStates: { "thread-sub-explorer": { status: "running", message: null } } },
          { type: "subAgentActivity", id: "sa2", kind: "started", agentThreadId: "thread-sub-acl", agentPath: "/root/acl_checker" },
          { type: "collabAgentToolCall", id: "s31", tool: "spawnAgent", status: "completed", senderThreadId: "thread-eva", receiverThreadIds: ["thread-sub-acl"], prompt: "并行检查 Windows 上 ACL 相关测试为什么不稳定", model: null, reasoningEffort: null, agentsStates: { "thread-sub-acl": { status: "running", message: "正在跑 task_service 测试…" } } },
          { type: "collabAgentToolCall", id: "s32", tool: "wait", status: "completed", senderThreadId: "thread-eva", receiverThreadIds: ["thread-sub-explorer"], prompt: null, model: null, reasoningEffort: null, agentsStates: { "thread-sub-explorer": { status: "completed", message: "共 3 处调用 flush：server.rs:3830（未校验 revision）、user_input.rs:212（已校验）、queue_panel 的「立即发送」路径（未校验）。建议在 dispatch_queue_flush 统一加 expectedRevision。" } } },
          // A failed sub-agent: listed under 子代理 → 最近完成 (modules/subagents/mock.ts has its thread).
          { type: "collabAgentToolCall", id: "s33", tool: "spawnAgent", status: "completed", senderThreadId: "thread-eva", receiverThreadIds: ["thread-sub-bench"], prompt: "跑一遍 queue 的基准测试，对比 flush 加 CAS 前后的吞吐", model: null, reasoningEffort: null, agentsStates: { "thread-sub-bench": { status: "errored", message: "cargo bench 编译失败：缺少 criterion 依赖" } } },
          { type: "mcpToolCall", id: "m31", server: "cutex", tool: "send_message", status: "completed", arguments: {} },
          { type: "mcpToolCall", id: "m31a", server: "cutex", tool: "cutex_task_service_director", status: "completed", arguments: { operation: "create_and_assign", action_id: "a1", task_id: "task-queue-rev", assignment_id: "as-1", assignee_cutex_session_id: "mika", summary: "queue 面板「立即发送」带上 expectedRevision" } },
          { type: "mcpToolCall", id: "m31b", server: "cutex", tool: "cutex_task_service_terminal", status: "completed", arguments: { operation: "request_changes", action_id: "a2", assignment_id: "as-1", decision_reference: "并发 flush 还会重复投递，补一个测试" } },
          // Refused / uncertain / awaiting-approval cutex tool results (failed task rows).
          { type: "mcpToolCall", id: "m31c", server: "cutex", tool: "agent_delegate", status: "completed", arguments: { target: "Mika", title: "补 flush 并发测试", text: "给 dispatch_queue_flush 加一个并发测试" }, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, status: "no_write", code: "busy", detail: "Mika already has an open delegation from you (d-7); close or wait for it first" }) }], structuredContent: null, isError: true } },
          { type: "mcpToolCall", id: "m31d", server: "cutex", tool: "agent_ask", status: "failed", arguments: { target: "Mika", text: "ping" }, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, status: "no_write", code: "tool_removed", detail: "agent_ask was removed; use agent_delegate for work or agent_tell for a note" }) }], structuredContent: null, isError: true } },
          { type: "mcpToolCall", id: "m31e", server: "cutex", tool: "agent_tell", status: "completed", arguments: { to: "Alden", text: "release 构建好了，可以 smoke test" }, result: { content: [{ type: "text", text: JSON.stringify({ ok: false, status: "response_uncertain", code: "bus_timeout", detail: "agent bus did not confirm delivery within 10s; the note may or may not have arrived" }) }], structuredContent: null } },
          { type: "mcpToolCall", id: "m31f", server: "cutex", tool: "agent_create", status: "completed", arguments: { name: "release-checker" }, result: { content: [], structuredContent: { ok: false, status: "approval_required", state: "pendingReview", code: "approval_required", detail: "creating an agent needs the owner's approval" } } },
          // Failed agent_create, Management envelope: Codex shape (status failed, no item error) and Claude-adapter shape (generic item error).
          { type: "mcpToolCall", id: "m31g", server: "cutex", tool: "agent_create", status: "failed", durationMs: 412, arguments: { action_id: "create-demo-1", spec: { name: "demo-polyadb-mouse-codex-r1" }, start_mode: "bootstrap_only" }, result: { content: [{ type: "text", text: JSON.stringify({ schema: "cutex/agent-management/v1", action_id: "create-demo-1", outcome: { status: "no_write", code: "conflict", detail: "unresolved_agent_reservation" } }) }], structuredContent: null, _meta: null }, error: null },
          { type: "mcpToolCall", id: "m31h", server: "cutex", tool: "agent_create", status: "failed", durationMs: 380, arguments: { action_id: "create-demo-2", spec: { name: "demo-polyadb-mouse-claude-r1" }, start_mode: "bootstrap_only" }, result: { content: [{ type: "text", text: JSON.stringify({ schema: "cutex/agent-management/v1", action_id: "create-demo-2", outcome: { status: "no_write", code: "unsupported_profile", detail: "Default profile unavailable" } }) }], structuredContent: null, _meta: null }, error: { message: "Cutex tool returned an error" } },
          { type: "mcpToolCall", id: "m31i", server: "github", tool: "create_issue", status: "failed", durationMs: 900, arguments: { title: "x" }, result: { content: [{ type: "text", text: "GitHub API 422: Validation Failed — body is too long (maximum is 65536 characters)" }], structuredContent: null, _meta: null }, error: null },
          {
            type: "functionCallOutput",
            id: "x31a",
            name: "external_event",
            namespace: "external",
            output: JSON.stringify({ source: { kind: "agent", id: "wave-director" }, type: "message", text: "Assignment ID: as-9\nTask: task-release revision 1\nTitle: 发布说明里补上桌面端\nAction: start" }),
            externalInputView: { schema: "cutex.task-assignment.v1", data: { assignmentId: "as-9", taskId: "task-release", taskRevision: 1, projectId: "waveline", title: "发布说明里补上桌面端", coordinatorCutexSessionId: "wave-director", coordinatorName: "Wave-Director" } },
          },
          external("x31", "mika", "Mika", "queue 面板那边我已经接上新的 revision 字段了。"),
          ...(LEGACY ? [] : [externalV2("x31v2", "wave-director", "Wave-Director", "release notes 草稿放在 docs/release-notes.md 了，桌面端那一节留给你补。", "note", { narrowerCapabilities: true, replyOnly: true })]),
          { type: "agentMessage", id: "a32", text: "修好了：flush 现在带 `expectedRevision`，并发 flush 会被拒绝而不是重复投递。测试 41/41 通过；ACL 不稳定的问题交给了一个子 agent 在查。\n\n文件链接：[issue report](</home/alex/.cutex/reports/issue 42.md>) · [ACL 笔记](~/notes/acl.md) · [日志](file:///C:/Users/sam/scratch/log.txt:12) · [队列代码](src/queue.rs:88) · [AGENTS](D:/Apps/cutex-desktop/AGENTS.md:3) · [vscode](vscode://file/x)\n\n验收材料：[完整验收记录](docs/acceptance/queue-flush/report.md) · [配置](package.json) · [截图](docs/acceptance/queue-flush/flush-before.png)\n\n![修复后的队列面板](C:/Users/sam/Pictures/flush-after.png)\n\n![架构图](docs/acceptance/queue-flush/arch.svg) ![旧截图](docs/acceptance/queue-flush/missing.png)" },
        ],
      },
      {
        id: "turn-4",
        status: "inProgress",
        startedAt: now - 25,
        completedAt: null,
        items: [
          { type: "userMessage", id: "u4", content: [{ type: "text", text: "再把整个 management::v2 跑一遍。" }] },
          { type: "commandExecution", id: "c41", command: "cargo fmt --check", status: "completed", exitCode: 0, durationMs: 2100 },
          { type: "commandExecution", id: "c42", command: "cargo clippy --lib -q", status: "completed", exitCode: 0, durationMs: 9000 },
          { type: "commandExecution", id: "c43", command: "git diff --stat", status: "completed", exitCode: 0, durationMs: 90, aggregatedOutput: " 2 files changed, 29 insertions(+), 1 deletion(-)" },
          { type: "commandExecution", id: "c44", command: "cargo build --locked --bin cutex", status: "completed", exitCode: 0, durationMs: 21000 },
          { type: "commandExecution", id: "c45", command: "cargo test --lib management::v2", status: "inProgress", aggregatedOutput: "test management::v2::usage::tests::groups_by_day ... ok\ntest management::v2::workspace_fs::tests::dir_lists_entries ... ok\ntest management::v2::user_input::flush_respects_revision ... ok" },
        ],
      },
    ],
  },
};


/** Sora (Claude): a dynamicToolCall shown as `claude.WebFetch`, a reasoning item, a file change with its diff, a running SDK task. */
const soraRead = {
  thread: {
    id: "thread-sora",
    turns: [
      {
        id: "sora-t1",
        status: "completed",
        startedAt: Date.now() / 1000 - 900,
        completedAt: Date.now() / 1000 - 840,
        items: [
          { type: "userMessage", id: "su1", content: [{ type: "text", text: "读一下 claude-adapter 的 DESKTOP_PARITY.md，然后把 dynamicToolCall 的显示修一下。" }] },
          { type: "reasoning", id: "sr1", summary: ["先读文档，再找 timeline 的工具行。"], content: [] },
          { type: "dynamicToolCall", id: "sd1", namespace: "claude", tool: "WebFetch", arguments: { url: "https://example.invalid/DESKTOP_PARITY.md" }, status: "completed", contentItems: [{ type: "inputText", text: "# Claude agents in cutex-desktop: interface parity\n…" }], success: true, durationMs: 1340 },
          { type: "commandExecution", id: "sc1", command: "rg -n dynamicToolCall src", status: "completed", exitCode: 0, durationMs: 210, aggregatedOutput: "src/renderer/src/components/WorkGroup.tsx:35:      return { key: \"tool.other\", detail: item.type };" },
          { type: "fileChange", id: "sf1", status: "completed", changes: [{ path: "src/renderer/src/components/WorkGroup.tsx", kind: { type: "update", move_path: null }, diff: "@@ -35 +35 @@\n-      return { key: \"tool.other\", detail: item.type };\n+      return { key: \"tool.mcp\", detail: ns + \".\" + tool };" }] },
          { type: "agentMessage", id: "sa1", text: "改好了：dynamicToolCall 现在显示成 `claude.WebFetch`，展开能看到返回的文本。" },
          // A Claude foreground subagent (Agent tool): its card and the 子 agent status row open the
          // transcript (adapter subagentTranscripts; modules/subagents/mock.ts). `?legacy`: status only.
          { type: "dynamicToolCall", id: "toolu_docs_review", namespace: "claude", tool: "Agent", arguments: { description: "核对文档", subagent_type: "Explore", prompt: "读 docs/DESKTOP_PARITY.md 和 timeline 的工具行代码，列出 dynamicToolCall 显示上还缺什么。只读。" }, status: "completed", contentItems: [{ type: "inputText", text: "缺两处：1. dynamicToolCall 没显示 namespace；2. 失败时错误文本被截断。其余与 DESKTOP_PARITY 一致。" }], success: true, durationMs: 48_000, ...(LEGACY ? {} : { agentThreadId: "claude:mock-sora:task:task-docs" }) },
          { type: "subAgentActivity", id: "sta1", kind: "started", agentThreadId: "claude:mock-sora:task:task-docs", agentPath: "/claude/task-docs" },
          { type: "subAgentActivity", id: "sta2", kind: "completed", agentThreadId: "claude:mock-sora:task:task-docs", agentPath: "/claude/task-docs" },
          // An older background subagent (no `run_in_background: false`; refused since claude-r21): the card
          // ended at the launch and no transcript was kept — 最近完成 shows it unclickable.
          { type: "dynamicToolCall", id: "toolu_bg_scan", namespace: "claude", tool: "Agent", arguments: { description: "扫描旧日志", subagent_type: "general-purpose", prompt: "在 logs/ 里找出最近一周所有 flush 超时的记录，按天汇总。" }, status: "completed", contentItems: [{ type: "inputText", text: "Async agent launched successfully." }], success: true, durationMs: 900 },
        ],
      },
      // A finished plan: Claude Code's plan approval choices (modules/plan/ClaudePlanChoices).
      {
        id: "sora-t2",
        status: "completed",
        startedAt: Date.now() / 1000 - 300,
        completedAt: Date.now() / 1000 - 280,
        items: [
          { type: "userMessage", id: "su2", content: [{ type: "text", text: "规划一下：给 PlanCard 加 Claude 的三个审批选项。" }] },
          { type: "plan", id: "sp2", text: "## PlanCard 的 Claude 审批选项\n\n1. Claude agent 显示「执行，自动接受编辑」「执行，编辑逐个审批」「继续规划」。\n2. 模式与计划模式在一次 thread/settings/update 里切换。\n3. 补单元测试。" },
        ],
      },
    ],
  },
};

/** Kai (Claude, claude-r21): a finished turn to fork / revert from, and a running one. */
const kaiRead = {
  thread: {
    id: "thread-kai",
    turns: [
      {
        id: "kai-t1",
        status: "completed",
        startedAt: Date.now() / 1000 - 600,
        completedAt: Date.now() / 1000 - 560,
        items: [
          { type: "userMessage", id: "ku1", content: [{ type: "text", text: "看一下 structuralGate 现在怎么处理忙碌的 Claude agent。" }] },
          { type: "agentMessage", id: "ka1", text: "忙时分叉和回退都灰掉；claude-r21 起分叉可以从实时记录里做，回退仍要等这一轮结束。" },
        ],
      },
      {
        id: "kai-t2",
        status: "inProgress",
        startedAt: Date.now() / 1000 - 40,
        items: [
          { type: "userMessage", id: "ku2", content: [{ type: "text", text: "跑一下相关的 vitest。" }] },
          { type: "commandExecution", id: "kc2", command: "npx vitest run test/structuralGate.test.ts", status: "inProgress", aggregatedOutput: "" },
        ],
      },
    ],
  },
};

/** Wave-Director: a long thread (history pages: newest page first, older ones on scroll to the top). */
const waveRead = {
  thread: {
    id: "thread-wave",
    turns: Array.from({ length: 240 }, (_, i) => ({
      id: `wave-t${i + 1}`,
      status: "completed",
      startedAt: Date.now() / 1000 - (240 - i) * 600,
      completedAt: Date.now() / 1000 - (240 - i) * 600 + 40,
      items: [
        { type: "userMessage", id: `wu${i + 1}`, content: [{ type: "text", text: `第 ${i + 1} 轮：看一下 release-notes 的第 ${i + 1} 条。` }] },
        { type: "commandExecution", id: `wc${i + 1}`, command: `rg -n "note-${i + 1}" docs`, status: "completed", exitCode: 0, durationMs: 120, aggregatedOutput: `docs/release-notes.md:${i + 1}: note-${i + 1}` },
        { type: "agentMessage", id: `wa${i + 1}`, text: `第 ${i + 1} 条已核对，措辞没问题。` },
      ],
    })),
  },
};

/**
 * Mika: her pending question + approval (MOCK_PENDING) belong to the running turn `t`, so answering
 * either leaves a handled-interaction row inside it (lib/interactionLog).
 */
const mikaRead = {
  thread: {
    id: "thread-mika",
    turns: [
      {
        id: "t-prev",
        status: "completed",
        startedAt: Date.now() / 1000 - 1800,
        completedAt: Date.now() / 1000 - 1700,
        items: [
          { type: "userMessage", id: "mu1", content: [{ type: "text", text: "队列面板先列出 cutex/userInput/queue/list 的字段。" }] },
          { type: "agentMessage", id: "ma1", text: "字段列好了：position、state、submittedAt、expectedRevision，面板直接吃这个快照。" },
        ],
      },
      {
        id: "t",
        status: "inProgress",
        startedAt: Date.now() / 1000 - 240,
        items: [
          { type: "userMessage", id: "mu2", content: [{ type: "text", text: "「立即发送」要做拖拽排序吗？先问我要不要网络权限。" }] },
          { type: "commandExecution", id: "mc2", command: "rg -n \"queue/reorder\" upstream/cutex/src", status: "completed", exitCode: 1, durationMs: 180, aggregatedOutput: "" },
        ],
      },
    ],
  },
};
const OLDER_FAIL = typeof location !== "undefined" && new URLSearchParams(location.search).has("olderFail");
const failedOnce = new Set<string>();
/** Mock history-pages cursor: index (in waveRead order) of the oldest turn already sent. */
const pageCursor = (start: number) => (start > 0 ? `mock-before:${start}` : null);
function mockPage(read: MockThread, limit: number, cursor: string | null) {
  const end = cursor ? Number(cursor.slice("mock-before:".length)) : read.thread.turns.length;
  const start = Math.max(0, end - limit);
  const nextCursor = pageCursor(start);
  return { thread: { ...read.thread, turns: read.thread.turns.slice(start, end) }, page: { limit, cursor, nextCursor, hasMore: nextCursor !== null } };
}

/** Canned pending server requests so the interaction dock can be previewed. */
const MOCK_PENDING: Record<string, { message: { id: number; method: string; params: unknown } }[]> = {
  // One running turn with both a question and an approval: answering either leaves a
  // handled-interaction row in the timeline (lib/interactionLog).
  mika: [
    {
      message: {
        id: 41,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-mika", turnId: "t", itemId: "i", isBlocking: true, autoResolutionMs: null,
          questions: [
            {
              id: "q1", header: "Queue UI", question: "队列面板要支持拖拽排序吗？cutex 目前还没有 reorder 接口。", isOther: true, isSecret: false,
              options: [
                { label: "先不做", description: "等 cutex 加上 queue/reorder 再说" },
                { label: "前端先做", description: "拖拽后用 remove + 重新提交模拟" },
              ],
            },
            { id: "q2", header: "Steer", question: "\"立即\" 按钮的行为？", isOther: false, isSecret: false, options: [{ label: "转成 steer", description: "" }, { label: "flush 队列", description: "" }] },
          ],
        },
      },
    },
    {
      message: {
        id: 44,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command", threadId: "thread-mika", turnId: "t", itemId: "c2b", startedAtMs: Date.now(), environmentId: null,
          command: "cargo add serde --features derive", cwd: "/mnt/data/Projects/Cutex/cutex-desktop", reason: "needs network to fetch the crate index (outside the sandbox)",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      },
    },
    {
      message: {
        id: 45,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thread-mika", turnId: "t", itemId: "f2", startedAtMs: Date.now(),
          grantRoot: "/mnt/data/Projects/Cutex/cutex-desktop/apps", reason: "面板要写 components/InteractionRow.tsx，在工作区根之外",
        },
      },
    },
  ],
  // Quick chats default to on-request approval: the dock must surface the native approval.
  "chat-rust": [
    {
      message: {
        id: 43,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command", threadId: "thread-chat-rust", turnId: "t-chat", itemId: "c1", startedAtMs: Date.now(), environmentId: null,
          command: "cargo add serde --features derive", cwd: "C:\\Users\\sam\\.cutex\\chats\\chat-rust", reason: "needs network to fetch the crate index (outside the sandbox)",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      },
    },
  ],
  // Claude: a command approval offering "always allow in this project" (claudePermissionRules).
  sora: LEGACY ? [] : [soraPendingApproval("D:\\Apps\\cutex-desktop")],
  alden: [
    {
      message: {
        id: 42,
        method: "item/commandExecution/requestApproval",
        params: {
          kind: "command", threadId: "thread-alden", turnId: "turn-live", itemId: "c9", startedAtMs: Date.now(), environmentId: null,
          command: "cargo build --locked --release --bin cutex", cwd: "D:\\Apps\\cutex-desktop\\upstream\\cutex", reason: "release build for smoke test",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      },
    },
  ],
};

/** Request ids answered in this preview: cutex would not re-send them on the next bootstrap. */
const mockResolved = new Set<string>();

// cutex display metadata (`cutex/session/metadata/update`).
Object.assign(snapshot.active[0]!, { avatar: { kind: "emoji", value: "🦊" }, note: "desktop 总设计 · 盯 Management v2 合约" });
// 显示名 (displayNameOverride) over a long formal name; emoji + own colour (agent-avatar-color).
if (snapshot.active[1]) {
  const s = snapshot.active[1];
  Object.assign(s, { formalAgentName: s.formalAgentName ?? s.displayName, displayNameOverride: "小侦探", displayName: "小侦探", avatar: LEGACY ? { kind: "emoji", value: "🦉" } : { kind: "emoji", value: "🦉", color: "#7950f2" } });
}

/** Forks made in the preview: source session + the turn they continue after (null = latest). */
const forkedFrom = new Map<string, { from: string; afterTurnId: string | null }>();
/** `cutex/session/history/revert` in the preview: turns from this one on are gone. */
const revertedFrom = new Map<string, string>();
/** Quick chats created in the preview that never got a message (archive deletes them when deleteEmpty). */
const emptyChats = new Set<string>();
type MockThread = { thread: { id: string; turns: { id: string }[] } };
function mockThread(id: string): MockThread {
  const fork = forkedFrom.get(id);
  let read: MockThread;
  if (fork) {
    const src = mockThread(fork.from);
    const end = fork.afterTurnId ? src.thread.turns.findIndex((t) => t.id === fork.afterTurnId) + 1 : src.thread.turns.length;
    read = { thread: { ...src.thread, id: `thread-${id}`, turns: src.thread.turns.slice(0, end || src.thread.turns.length) } };
  } else read = (id === "eva" ? threadRead : id === "scratch" ? scratchRead : id === "sora" ? soraRead : id === "kai" ? kaiRead : id === "wave" ? waveRead : id === "mika" ? mikaRead : (moduleThread(id) ?? { thread: { id: `thread-${id}`, turns: [] } })) as MockThread;
  const cut = revertedFrom.get(id);
  const at = cut ? read.thread.turns.findIndex((t) => t.id === cut) : -1;
  return at >= 0 ? { thread: { ...read.thread, turns: read.thread.turns.slice(0, at) } } : read;
}

/** The session's current runtime generation (advanced by each 启动运行时 after a stop). */
function runtimeGenerationOf(id: string): number {
  return [...snapshot.active, ...snapshot.retired].find((x) => x.cutexSessionId === id)?.runtime.runtimeGeneration ?? 3;
}

/** `turnLimit` (history-pages): newest turns + historyPage; `?legacy` = an older cutex (every turn). */
const bootstrap =(id: string, turnLimit?: number): SessionBootstrap => ({
  contractVersion: 2,
  cutexSessionId: id,
  hostId: "HOST-A",
  checkpoint: { streamId: "mock", sequence: 10, cursor: "c10" },
  schema: null,
  management: null,
  ...(id === "rei"
    ? { native: null, ...(turnLimit && !LEGACY ? { historyPage: null } : {}) }
    : turnLimit && !LEGACY
      ? (({ thread, page }) => ({ native: { method: "thread/read" as const, result: { thread } }, historyPage: page }))(mockPage(mockThread(id), turnLimit, null))
      : { native: { method: "thread/read" as const, result: mockThread(id) } }),
  cutexState: {
    sessionRevision: 1,
    runtime: { status: "online", runtimeGeneration: runtimeGenerationOf(id) },
    focus: null,
    userInputQueue: [],
    // Same shape as cutex server_requests::snapshot: `native` is the raw request.
    pendingServerRequests: (MOCK_PENDING[id] ?? []).filter((p) => !mockResolved.has(String(p.message.id))).map((p) => ({ runtimeGeneration: 1, native: p.message })),
    ...(LEGACY ? {} : { asksPaused: asksPauses.get(id) ?? null }),
    agentBusMessages: inboxSnapshot(id),
    ...(LEGACY ? {} : { agentBusSentMessages: [] }),
    ...moduleCutexState(id),
    // scratch gets no live token report after opening; cutex recovers its usage from the rollout.
    latestTokenUsage: id === "scratch" ? MOCK_SCRATCH_TOKEN_USAGE : null,
  },
});

const MOCK_SCRATCH_TOKEN_USAGE = {
  threadId: "thread-scratch",
  turnId: "turn-plan",
  tokenUsage: {
    total: { totalTokens: 96_400, inputTokens: 92_000, cachedInputTokens: 60_000, cacheWriteInputTokens: 0, outputTokens: 4_400, reasoningOutputTokens: 1_200 },
    last: { totalTokens: 47_300, inputTokens: 46_000, cachedInputTokens: 40_000, cacheWriteInputTokens: 0, outputTokens: 1_300, reasoningOutputTokens: 400 },
    modelContextWindow: 400_000,
  },
  updatedAt: new Date(Date.now() - 290_000).toISOString(),
};

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const TAGGED = new Set<string>(HOST_TAGGED_EVENTS);
/** An event of `hostId`'s connection, tagged like main tags it (`HostTag`). */
function emitOn<K extends keyof MockEvents>(hostId: string, event: K, payload: MockEvents[K]) {
  let out: unknown = payload;
  if (TAGGED.has(event)) {
    const tag = { hostId, epoch: mockConn(hostId)?.epoch ?? "" };
    out = event === "daemonState" ? { ...tag, state: payload } : event === "hostEvent" ? { ...tag, envelope: payload } : { ...tag, ...(payload as object) };
  }
  for (const l of listeners.get(event) ?? []) l(out);
}
/** The core mock is one world that follows the shown host: its connection events are that host's. */
function emit<K extends keyof MockEvents>(event: K, payload: MockEvents[K]) {
  // A session subscribed through `apiFor(host)` (an open agent of another host) streams on that host.
  const sessionId = event === "sessionEvent" || event === "sessionStatus" || event === "sessionResync" ? (payload as { sessionId?: string }).sessionId : undefined;
  const host = sessionId ? mockViewHosts.get(sessionId) : undefined;
  emitOn(host && mockConn(host)?.epoch ? host : mockHosts.active, event, payload);
}
/** SSH questions (main/sshAskpass.ts): a target containing "askpass" asks for a host key and a passphrase. */
let mockSshPrompts: SshPromptView[] = [];
const mockSshWaiters = new Map<string, (answer: SshPromptAnswer) => void>();
function mockSshAsk(target: string, message: string): Promise<SshPromptAnswer> {
  const id = `p-${Math.random().toString(16).slice(2, 10)}`;
  mockSshPrompts = [...mockSshPrompts, { id, target, createdAt: Date.now(), ...classifySshPrompt(message) }];
  emit("sshPrompts", { prompts: mockSshPrompts });
  return new Promise((resolve) => mockSshWaiters.set(id, resolve));
}
/** Sessions subscribed through another host's `apiFor` → that host. */
const mockViewHosts = new Map<string, string>();

let seq = 10;
function envelope(sessionId: string, partial: Pick<EventEnvelope, "source"> & Partial<EventEnvelope>): EventEnvelope {
  seq++;
  return {
    contractVersion: 2, eventId: `e${seq}`, cursor: `c${seq}`, streamId: "mock", sequence: seq, receivedAt: new Date().toISOString(),
    cutexSessionId: sessionId, hostId: "HOST-A", sensitivity: "owner", correlation: { runtimeGeneration: runtimeGenerationOf(sessionId) }, ...partial,
  };
}
const nativeEvent = (sessionId: string, method: string, params: unknown) => {
  const e = envelope(sessionId, { source: "app_server", native: { kind: "notification", message: { method, params } } });
  emit("sessionEvent", { sessionId, envelope: e });
  emit("hostEvent", e);
};

/** Play a short scripted turn: user message, live reasoning, agent-bus send, streaming reply. */
const currentTurn = new Map<string, string>();
const cancelled = new Set<string>();
async function playTurn(sessionId: string, text: string, extra: unknown[] = [], clientId?: string) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const turnId = `turn-${seq}`;
  currentTurn.set(sessionId, turnId);
  const userItemId = `u-${seq}`;
  nativeEvent(sessionId, "turn/started", { turn: { id: turnId, status: "inProgress", startedAt: Date.now() / 1000 } });
  // cute-codex records the userMessage only after the turn's pre-sampling work (auto-compaction, MCP
  // startup, prompt hooks): localStorage "cutex-mock-preturn" = ms between turn/started and it.
  const preturn = Number((() => { try { return localStorage.getItem("cutex-mock-preturn"); } catch { return null; } })()) || 0;
  if (preturn > 0) await sleep(preturn);
  const userItem = { type: "userMessage", id: userItemId, ...(clientId ? { clientId } : {}), content: [...(text ? [{ type: "text", text }] : []), ...extra] };
  nativeEvent(sessionId, "item/started", { turnId, item: userItem });
  nativeEvent(sessionId, "item/completed", { turnId, item: userItem });
  await sleep(400);
  if (cancelled.has(turnId)) return;
  // Native retrying a failing model request (`error` with willRetry, lib/retryNotice): localStorage
  // "cutex-mock-retry" = attempts before the request goes through (of 5), "cutex-mock-retry-ms" = gap.
  const retries = Math.min(5, Number((() => { try { return localStorage.getItem("cutex-mock-retry"); } catch { return null; } })()) || 0);
  const retryMs = Number((() => { try { return localStorage.getItem("cutex-mock-retry-ms"); } catch { return null; } })()) || 2500;
  for (let n = 1; n <= retries; n++) {
    const details = "unexpected status 524 <none>: error code: 524, url: https://relay.example.invalid/v1/responses, cf-ray: 0000000000000000-SYD";
    nativeEvent(sessionId, "error", { turnId, willRetry: true, error: { message: `Reconnecting... ${n}/5`, codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 524 } }, additionalDetails: details, misalignment: null } });
    await sleep(retryMs);
    if (cancelled.has(turnId)) return;
  }
  // Live raw reasoning (Kimi / DeepSeek style): streams into a 推理中 row (shimmers while live).
  // localStorage "cutex-mock-reasoning-ms" = ms per chunk (default 90; raise it to inspect the row).
  const chunkMs = Number((() => { try { return localStorage.getItem("cutex-mock-reasoning-ms"); } catch { return null; } })()) || 90;
  const reasoningId = `r-${seq}`;
  nativeEvent(sessionId, "item/started", { turnId, item: { type: "reasoning", id: reasoningId, summary: [], content: [] } });
  const thought = "用户要改队列 flush 的协议字段。先确认 Alden 那边生成的类型里有没有 expectedRevision——\n\n如果没有，composer 的「立即发送」会继续走旧路径，并发时还是会重复投递。\n\n所以顺序是：先同步给 Alden 确认字段，再让 Mika 改面板。";
  for (const chunk of thought.match(/.{1,6}/gsu) ?? []) {
    if (cancelled.has(turnId)) return;
    nativeEvent(sessionId, "item/reasoning/textDelta", { turnId, itemId: reasoningId, contentIndex: 0, delta: chunk });
    await sleep(chunkMs);
  }
  nativeEvent(sessionId, "item/completed", { turnId, item: { type: "reasoning", id: reasoningId, summary: [], content: [thought] } });
  // Like a real turn: tool calls (here an agent-bus send) first, the final answer last.
  emit("sessionEvent", {
    sessionId,
    envelope: envelope(sessionId, {
      source: "cutex",
      correlation: {},
      cutex: {
        method: "cutex/agentBus/messageSent",
        params: { messageId: `m${seq}`, fromCutexSessionId: sessionId, toCutexSessionId: "alden", deliveryMode: LEGACY ? "soon" : "after_turn", content: "请确认 functionCallOutput.output 的数组形式我们已经兼容。", ...(LEGACY ? {} : { deliveryKind: "wake", body: "请确认 functionCallOutput.output 的数组形式我们已经兼容。", recipient: { id: "alden", name: "Alden", runtime: "codex" } }) },
      },
    }),
  });
  if (!LEGACY) {
    const sent = { messageId: `m${seq - 1}`, from: sessionId, to: "alden", kind: "wake" as const };
    setTimeout(() => mockDelivered(sent, "turn-live"), 3000);
  }
  await sleep(300);
  if (cancelled.has(turnId)) return;
  // localStorage "cutex-mock-reply" = the streamed reply's Markdown (e.g. with a code block).
  const reply = (() => { try { return localStorage.getItem("cutex-mock-reply"); } catch { return null; } })() || "明白。我已经把这个改动同步给 Alden，让他确认协议字段。";
  const itemId = `a-${seq}`;
  for (const chunk of reply.match(/.{1,4}/gsu) ?? []) {
    nativeEvent(sessionId, "item/agentMessage/delta", { turnId, itemId, delta: chunk });
    await sleep(60);
  }
  // A silent gap like a model streaming a freeform apply_patch (no item until it is complete;
  // docs/research/send-latency-r233-20261014.md): localStorage "cutex-mock-silent-ms" = its length.
  const silentMs = Number((() => { try { return localStorage.getItem("cutex-mock-silent-ms"); } catch { return null; } })()) || 0;
  if (silentMs > 0) {
    nativeEvent(sessionId, "item/completed", { turnId, item: { type: "agentMessage", id: itemId, text: reply, phase: "commentary" } });
    await sleep(silentMs);
    if (cancelled.has(turnId)) return;
    const changes = [{ path: "src/queue/flush.ts", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old\n+new\n" }];
    const patchId = `p-${itemId}`;
    nativeEvent(sessionId, "item/started", { turnId, item: { type: "fileChange", id: patchId, status: "inProgress", changes } });
    nativeEvent(sessionId, "item/completed", { turnId, item: { type: "fileChange", id: patchId, status: "completed", changes } });
  }
  await sleep(5000);
  if (cancelled.has(turnId)) return;
  nativeEvent(sessionId, "turn/completed", { turn: { id: turnId, status: "completed", completedAt: Date.now() / 1000 } });
  currentTurn.delete(sessionId);
  busy.delete(sessionId);
  // cutex flushes the queue only after turn/completed reached it, and the next turn/started is a
  // separate event: localStorage "cutex-mock-flush-gap" = ms between them (default 0: same task).
  const flushGap = Number((() => { try { return localStorage.getItem("cutex-mock-flush-gap"); } catch { return null; } })()) || 0;
  if (flushGap > 0) await sleep(flushGap);
  if (!busy.has(sessionId)) flushQueue(sessionId);
}

/** Native turn/interrupt: the running turn ends "interrupted" (unread steers are dropped). */
function stopNativeTurn(sessionId: string): boolean {
  const turnId = currentTurn.get(sessionId);
  if (!turnId) return false;
  cancelled.add(turnId);
  currentTurn.delete(sessionId);
  busy.delete(sessionId);
  nativeEvent(sessionId, "turn/completed", { turn: { id: turnId, status: "interrupted", completedAt: Date.now() / 1000 } });
  return true;
}

/** Like cutex: queued input is delivered at the turn boundary — unless the queue is paused. */
function flushQueue(sessionId: string) {
  if (pauses.has(sessionId)) return;
  const next = queues.get(sessionId)?.shift();
  if (next) {
    busy.add(sessionId);
    // Like cutex: the native turn starts (turn/started), then cutex says the queued input was
    // submitted (with its clientUserMessageId, input and turn) and removes the row; the userMessage
    // item follows after the turn's pre-sampling work ("cutex-mock-preturn").
    void playTurn(sessionId, (next.input[0] as { text: string }).text, [], next.clientUserMessageId);
    emitCutex(sessionId, "cutex/userInput/submitted", { queueId: next.queueId, clientUserMessageId: next.clientUserMessageId, input: next.input, disposition: "started", turnId: currentTurn.get(sessionId) ?? null });
  }
}

const busy = new Set<string>();
let evaDemoPlayed = false;
const queues = new Map<string, QueueItem[]>();

// ---------- admission-order (docs/cutex-agent-asks.md §5.3; turn groups) ----------
// Turns: owner items ordered by their key (enqueue time; a move writes a key between its new
// neighbours) and the delegations module mocks report (MockModule.admission), interleaved.
// Ride-along items (`nextStep`) per agent, with their timing; `currentTurn` from the module that
// owns the running turn (a delegation), else the owner's while the agent is busy.
//   helper  delegation turn running: a note waiting ~90 s, a delegation result and a peer note at
//           the next step, a Job completion and an alarm after the turn (many rows: the card folds);
//           turns: you / delegation (+1 tell) / you / delegation / you
//   ?oldridealong: the same items as a cutex without admission-ridealong-detail lists them
//   eva     owner turn running (turn-4): the same three ride-along kinds; turns: you / you — drag
//           one into 「下个工具边界」 to insert it (its steer lands after INSERT_DEMO_MS)
//   scratch idle, stopped by the owner (stop-holds-ridealongs): two paused owner messages and three
//           ride-alongs held by the stop (「已随停止暂停」); 继续发送 releases them (「马上开始」)
// The admission revision is a hash of the order, so any change fails a stale move's CAS.
const ownerKeys = new Map<string, number>();
const agoIso = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const inIso = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const mockQueued = (text: string, secondsAgo: number): QueueItem => {
  const id = ++seq;
  return { queueId: `q${id}`, clientUserMessageId: `cu${id}`, origin: { kind: "other", clientId: "mock" }, input: [{ type: "text", text, text_elements: [] }], position: 0, revision: 1, state: "queued", createdAt: agoIso(secondsAgo), updatedAt: agoIso(secondsAgo) };
};
type MockNextStep = import("@cutex-desktop/protocol").AdmissionNextStep;
/**
 * `?oldridealong` (and `?legacy`): a cutex before admission-ridealong-detail — bus ride-alongs carry
 * only cutex's fixed English labels ("Alarm" / "Agent message" / "Bus delivery"), no `from` /
 * `preview` / `fromHost`; delegation results keep their title (management/v2/agent_bus_state.rs).
 */
const OLD_RIDEALONG = LEGACY || (typeof location !== "undefined" && new URLSearchParams(location.search).has("oldridealong"));
/** cutex `ridealong_preview`: the first non-empty line, whitespace collapsed, ≤ 80 chars. */
const mockPreview = (text: string): string | null => {
  const line = text.split("\n").find((l) => l.trim())?.split(/\s+/).filter(Boolean).join(" ") ?? "";
  if (!line) return null;
  const chars = [...line];
  return chars.length <= 80 ? line : `${chars.slice(0, 79).join("")}…`;
};
/** A bus ride-along as cutex lists it: label = preview (alarm / tell) or a control description (bus). */
const busItem = (item: Omit<MockNextStep, "label" | "preview"> & { body: string; label?: string }): MockNextStep => {
  const { body, ...rest } = item;
  const preview = mockPreview(body);
  if (OLD_RIDEALONG) {
    const { from: _from, fromHost: _host, askId: _ask, ...old } = rest;
    return { ...old, deliveryKind: rest.fromHost ? "bus" : rest.deliveryKind, label: rest.deliveryKind === "alarm" ? "Alarm" : rest.deliveryKind === "tell" && !rest.fromHost ? "Agent message" : "Bus delivery" };
  }
  return { ...rest, label: item.label ?? preview ?? null, preview };
};
/** A delegation result as cutex lists it: label = the delegation's title, `from` = the delegate. */
const askItem = (item: MockNextStep & { body?: string }): MockNextStep => {
  const { body, ...rest } = item;
  if (OLD_RIDEALONG) {
    const { from: _from, ...old } = rest;
    return old;
  }
  return { ...rest, preview: body ? mockPreview(body) : null };
};
/** A bus wake to a busy agent: waits `waitSecs` (agentBus.wakeBusyWaitSecs) in all, `leftSecs` of it still to go. */
const wake = (id: string, deliveryKind: string, from: string, body: string, waitSecs: number, leftSecs: number): MockNextStep =>
  busItem({ id, deliveryKind, from, body, enqueuedAt: agoIso(waitSecs - leftSecs), timing: "afterTurn", nextStepAt: inIso(leftSecs) });
const MOCK_NEXT_STEP: Record<string, MockNextStep[]> = LEGACY
  ? {}
  : {
      // Many items (the card folds past 3 rows): a wake, a result, a peer note, a Job completion, an alarm.
      helper: [
        wake("ns-h-note", "tell", "Lead", "flush 的并发测试别忘了跑 --release\n（上次 debug 构建漏掉了一个竞态）", 120, 90),
        askItem({ id: "ns-h-answer", deliveryKind: "answer", label: "更新 queue 面板文案", from: "Mika", body: "面板文案改好了，截图在 shots/queue.png。", enqueuedAt: agoIso(140), timing: "nextStep" }),
        busItem({ id: "ns-h-peer", deliveryKind: "tell", from: "builder@build-host", fromHost: "build-host", body: "nightly 构建通过，产物在 /srv/out/nightly", enqueuedAt: agoIso(180), timing: "nextStep" }),
        busItem({ id: "ns-h-job", deliveryKind: "bus", from: "Cutex Job Service", label: "Job job-7f3a exited (exit 0)", body: "Job job-7f3a exited (exit 0)", enqueuedAt: agoIso(220), timing: "afterTurn" }),
        busItem({ id: "ns-h-alarm", deliveryKind: "alarm", body: "每日构建检查", enqueuedAt: agoIso(250), timing: "afterTurn" }),
      ],
      // Eva's notes / wake / alarm come from her bus inbox (inboxNextStep); this is the rest.
      eva: [askItem({ id: "ns-e-answer", deliveryKind: "answer", label: "找出所有 queue flush 调用点", from: "Helper", body: "一共 7 处，列表在 docs/flush-callers.md。", enqueuedAt: agoIso(200), timing: "nextStep" })],
      // A delegation's ride-alongs carry `askId` (modules/delegations/mock.ts asks): the row shows that delegation.
      scratch: [
        askItem({ id: "ns-s-answer", deliveryKind: "answer", label: "写 r208 发布说明", askId: "ask-accept", from: "Alden", body: "发布说明草稿在 docs/release/r208.md。", enqueuedAt: agoIso(70), timing: "nextStep" }),
        askItem({ id: "ns-s-question", deliveryKind: "question", label: "确认队列面板要不要拖拽", askId: "ask-question", from: "Mika", body: "队列面板要支持拖拽排序吗？", enqueuedAt: agoIso(65), timing: "nextStep" }),
        busItem({ id: "ns-s-note", deliveryKind: "tell", from: "Eva", body: "scratch 里的临时文件可以删了", enqueuedAt: agoIso(60), timing: "afterTurn" }),
        busItem({ id: "ns-s-alarm", deliveryKind: "alarm", body: "每小时同步笔记", enqueuedAt: agoIso(30), timing: "afterTurn" }),
      ],
    };
/** agentBus.wakeBusyWaitSecs of the mock (agent-bus mock default). */
const MOCK_WAKE_WAIT_SECS = 120;
/**
 * The unread bus messages of an agent as ride-along items (the same messages the old 待读留言 section
 * listed): notes are read at the next step; a wake to a busy agent waits up to the wake wait; alarms
 * wait for the turn end.
 */
function inboxNextStep(sessionId: string): MockNextStep[] {
  return [
    ...(mockInbox.get(sessionId) ?? []).map((m): MockNextStep =>
      m.kind === "note"
        ? busItem({ id: m.messageId, deliveryKind: "tell", from: m.fromName, body: m.body, enqueuedAt: m.queuedAt, timing: "nextStep" })
        : busItem({ id: m.messageId, deliveryKind: "tell", from: m.fromName, body: m.body, enqueuedAt: m.queuedAt, timing: "afterTurn", nextStepAt: new Date(Date.parse(m.queuedAt) + MOCK_WAKE_WAIT_SECS * 1000).toISOString() }),
    ),
    ...mockAlarmSnapshot(sessionId).map((a): MockNextStep => busItem({ id: a.messageId, deliveryKind: "alarm", body: a.content, enqueuedAt: a.queuedAt, timing: "afterTurn" })),
  ];
}
/** A ride-along item as cutex lists it now (a wake past its wait reads at the next step). */
const nextStepNow = (item: MockNextStep): MockNextStep => (item.nextStepAt && Date.parse(item.nextStepAt) <= Date.now() ? { ...item, timing: "nextStep" } : item);
/** Eva's steers land this late, so 「下个工具边界」 shows the insert for a while. */
const INSERT_DEMO_MS: Record<string, number> = { eva: 20_000 };
if (!LEGACY) {
  queues.set("helper", [mockQueued("先把 flush 的日志级别调成 debug", 500), mockQueued("顺便看一下队列面板在窄屏下的样子", 350), mockQueued("做完告诉我截图路径", 120)]);
  queues.set("eva", [mockQueued("跑完测试把失败的列出来", 200), mockQueued("然后更新 PROGRESS.md", 90)]);
  queues.set("scratch", [mockQueued("顺手整理一下 scratch 目录", 40), mockQueued("把 log.txt 里的错误归个类", 20)]);
}
const ownerKey = (sessionId: string, q: QueueItem) => ownerKeys.get(`${sessionId}|${q.queueId}`) ?? Date.parse(q.createdAt);
type KeyedEntry = (import("./mockTypes").MockAdmissionEntry | { kind: "owner"; id: string; key: number; enqueuedAt: string; state: "waiting" | "paused" }) & { key: number };
function admissionEntries(sessionId: string): KeyedEntry[] {
  const owner: KeyedEntry[] = (queues.get(sessionId) ?? []).map((q) => ({ kind: "owner", id: q.queueId, key: ownerKey(sessionId, q), enqueuedAt: q.createdAt, state: pauses.has(sessionId) ? "paused" : "waiting" }));
  const others = MODULE_MOCKS.flatMap(({ mock }) => mock.admission?.(sessionId, core) ?? []);
  return [...owner, ...others].sort((a, b) => a.key - b.key);
}
const admissionRevision = (entries: readonly KeyedEntry[]) => {
  let h = 17;
  for (const ch of entries.map((e) => `${e.kind}:${e.id}`).join("|")) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_007;
  return h;
};
function admissionOf(sessionId: string): import("@cutex-desktop/protocol").QueueAdmission {
  const entries = admissionEntries(sessionId);
  if (!busy.has(sessionId)) ownerYields.delete(sessionId);
  const moduleTurn = MODULE_MOCKS.map(({ mock }) => mock.currentTurn?.(sessionId) ?? null).find((x) => x !== null) ?? null;
  return {
    revision: admissionRevision(entries),
    orderRevision: admissionRevision(entries),
    items: entries.map(({ key: _key, ...e }, i) => ({ ...e, position: i + 1 }) as import("@cutex-desktop/protocol").AdmissionItem),
    nextStep: [...inboxNextStep(sessionId), ...(MOCK_NEXT_STEP[sessionId] ?? [])].map(nextStepNow).map((item) => heldNextStep(sessionId, item)),
    // ?delivery: running turns were started by a ride-along (the owner's queued turn then goes first).
    currentTurn: busy.has(sessionId) ? (DELIVERY_TURNS ? { kind: "delivery" } : (moduleTurn ?? { kind: "owner" })) : null,
    ...(!LEGACY && asksPauses.get(sessionId)?.stopHold ? { ridealongsHeld: "ownerStop" as const } : {}),
    ...(!LEGACY && ownerYields.has(sessionId) ? { ownerYielded: true } : {}),
  };
}
const DELIVERY_TURNS = typeof location !== "undefined" && new URLSearchParams(location.search).has("delivery");
/** admission-owner-yield: one-shot, consumed when the session's turn ends (mock: on going idle). */
const ownerYields = new Set<string>();
/** stop-holds-ridealongs: a stop hold holds every ride-along; an explicit 暂停委托 only ask results. */
function heldNextStep(sessionId: string, item: MockNextStep): MockNextStep {
  const p = LEGACY ? undefined : asksPauses.get(sessionId);
  if (p?.stopHold) return { ...item, held: "ownerStop" };
  if (p && (item.deliveryKind === "answer" || item.deliveryKind === "question")) return { ...item, held: "ownerPause" };
  return item;
}
/** queue-pause: set by stopTurn on a non-empty queue; cleared by queueResume or an emptied queue. */
const pauses = new Map<string, import("@cutex-desktop/protocol").QueuePause>();
/** asks-pause-v2: the owner's 暂停委托; cleared by asksResume or the owner's next message (submit). */
const asksPauses = new Map<string, import("@cutex-desktop/protocol").AsksPause>();
const setAsksPause = (sessionId: string, on: boolean, reason: "paused" | "resumed" | "ownerMessage") => {
  const was = asksPauses.get(sessionId);
  // 暂停委托 on a stop hold turns it into an explicit pause (the stop hold stays on it).
  const changed = on ? !was || was.origin === "ownerStop" : !!was;
  if (on && changed) asksPauses.set(sessionId, { since: new Date().toISOString(), by: "owner", origin: "ownerPause", ...(was?.stopHold ? { stopHold: true } : {}) });
  if (!on) asksPauses.delete(sessionId);
  const asksPaused = asksPauses.get(sessionId) ?? null;
  if (changed) emitCutex(sessionId, "cutex/asks/pauseChanged", { asksPaused, reason });
  return { asksPaused, changed };
};
/** stop-holds-ridealongs: `cutex/turn/stop` records a stop hold (on an explicit pause: `stopHold`). */
const stopHoldOn = (sessionId: string) => {
  if (LEGACY) return;
  const was = asksPauses.get(sessionId);
  if (was?.stopHold) return;
  asksPauses.set(sessionId, was ? { ...was, stopHold: true } : { since: new Date().toISOString(), by: "owner", origin: "ownerStop", stopHold: true });
  emitCutex(sessionId, "cutex/asks/pauseChanged", { asksPaused: asksPauses.get(sessionId), reason: "ownerStop" });
};
/** Queue resume / a turn-starting owner message: the stop hold ends (an explicit pause stays). */
const stopHoldOff = (sessionId: string, reason: "resumed" | "ownerMessage") => {
  const was = asksPauses.get(sessionId);
  if (!was?.stopHold) return;
  if (was.origin === "ownerStop") asksPauses.delete(sessionId);
  else asksPauses.set(sessionId, { since: was.since, by: was.by, origin: was.origin });
  emitCutex(sessionId, "cutex/asks/pauseChanged", { asksPaused: asksPauses.get(sessionId) ?? null, reason });
};
if (!LEGACY) {
  // scratch was stopped by the owner a moment ago: its queue is paused and the stop holds everything.
  pauses.set("scratch", { pausedAt: agoIso(15), reason: "interrupted", turnId: null });
  asksPauses.set("scratch", { since: agoIso(15), by: "owner", origin: "ownerStop", stopHold: true });
  // runtime-gate-pause: Sora's last turn stopped on the Claude usage limit; the adapter closed its input
  // and refused a delegation result → 「已暂停：上一轮被中断，工具效果不确定 · 恢复」.
  asksPauses.set("sora", { since: agoIso(6 * 60), by: "owner", origin: "runtimeGate", stopHold: false });
}

// claude-quota-auto-continue: Sora hit its usage limit; cutex continues it ~23 min from now.
type MockQuotaView = import("../../../shared/quotaContinue").QuotaContinueView;
const quotaViews = new Map<string, MockQuotaView>();
if (!LEGACY) {
  const reset = Date.now() + 22 * 60_000;
  quotaViews.set("sora", {
    cutexSessionId: "sora",
    enabled: true,
    pending: { at: new Date(reset + 71_000).toISOString(), resetAt: new Date(reset).toISOString(), accountId: "default", turnId: "sora-t9", scheduledAt: agoIso(6 * 60) },
    last: null,
  });
}
const quotaViewOf = (sessionId: string): MockQuotaView => quotaViews.get(sessionId) ?? { cutexSessionId: sessionId, enabled: true, pending: null, last: null };
/** cutex: the owner's message / stop / offline ends a pending continuation (host event). */
function quotaCancel(sessionId: string, reason: string): MockQuotaView | null {
  const view = quotaViews.get(sessionId);
  if (!view?.pending) return null;
  const next: MockQuotaView = { ...view, pending: null, last: { at: new Date().toISOString(), result: "cancelled", reason, resetAt: view.pending.resetAt } };
  quotaViews.set(sessionId, next);
  emit("hostEvent", envelope("cutex.host", { source: "cutex", correlation: {}, cutex: { method: "cutex/quotaAutoContinue/changed", params: { cutexSessionId: sessionId, reason: "cancelled", quotaAutoContinue: structuredClone(next), hostId: "mock" } } }));
  return next;
}
const mockAccounts = new Map<string, import("../../../shared/ipc").ProfileAccountView>();
const mockLoggedOut = new Set<string>();
const mockLogins = new Map<string, { login: import("../../../shared/ipc").ProfileLogin; polls: number }>();
const mockNotify = new Map<string, import("../../../shared/ipc").NotificationLevel>();
/** fs/file body for image paths (message thumbnails): PNG drawn on a canvas, SVG as utf8 text. */
async function mockImageFile(path: string): Promise<import("../../../shared/ipc").FsFile | null> {
  const modifiedAt = new Date().toISOString();
  if (/missing/i.test(path) && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)) throw new Error("path_not_found: the path does not exist");
  if (/\.svg$/i.test(path)) {
    const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" width="360" height="120"><rect width="360" height="120" rx="10" fill="#eef2ff"/><g font-family="sans-serif" font-size="13" fill="#1e293b">${["composer", "queue", "runtime"].map((n, i) => `<rect x="${20 + i * 115}" y="40" width="95" height="40" rx="6" fill="#fff" stroke="#6366f1"/><text x="${67 + i * 115}" y="65" text-anchor="middle">${n}</text>`).join("")}</g></svg>`;
    return { path, size: content.length, modifiedAt, encoding: "utf8", content, truncated: false, mime: "image/svg+xml" };
  }
  if (!/\.png$/i.test(path)) return null;
  await new Promise((r) => setTimeout(r, 300));
  const canvas = document.createElement("canvas");
  const after = /after/i.test(path);
  canvas.width = after ? 640 : 480;
  canvas.height = after ? 360 : 480;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, after ? "#0ea5e9" : "#f97316");
  grad.addColorStop(1, after ? "#6366f1" : "#db2777");
  g.fillStyle = grad;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#ffffff";
  g.font = "bold 32px sans-serif";
  g.fillText(after ? "queue flush · after" : "queue flush · before", 32, 64);
  g.font = "20px sans-serif";
  g.fillText(path.split(/[\\/]/).pop() ?? path, 32, 104);
  const content = canvas.toDataURL("image/png").split(",")[1] ?? "";
  return { path, size: Math.floor((content.length * 3) / 4), modifiedAt, encoding: "base64", content, truncated: false, mime: "image/png" };
}

function emitCutex(sessionId: string, method: string, params: Record<string, unknown>) {
  emit("sessionEvent", { sessionId, envelope: envelope(sessionId, { source: "cutex", correlation: {}, cutex: { method, params } }) });
}

/** A cutex agent-bus event on these agents' streams, plus the host feed (like cutex's event store). */
function emitBus(sessionIds: string[], method: string, params: Record<string, unknown>) {
  for (const id of new Set(sessionIds)) {
    const e = envelope(id, { source: "cutex", correlation: {}, cutex: { method, params } });
    emit("sessionEvent", { sessionId: id, envelope: e });
    emit("hostEvent", e);
  }
}
const busMode = (kind: "note" | "wake") => (kind === "note" ? "passive" : "after_turn");
/** A v2 send from `from` (sender stream: messageSent; recipient stream: messageQueued). */
function mockSend(m: MockInboxMessage, toName: string) {
  const common = { messageId: m.messageId, fromCutexSessionId: m.from, toCutexSessionId: m.to, deliveryMode: busMode(m.kind), deliveryKind: m.kind, content: m.body, body: m.body, sender: { id: m.from, name: m.fromName, runtime: "codex" }, recipient: { id: m.to, name: toName, runtime: "codex" } };
  emitBus([m.from], "cutex/agentBus/messageSent", { ...common, sentAt: m.queuedAt });
  emitBus([m.to], "cutex/agentBus/messageQueued", { ...common, queuedAt: m.queuedAt });
  // Unread until delivered: also a ride-along item of the recipient's admission list.
  const inbox = mockInbox.get(m.to) ?? [];
  if (!inbox.some((x) => x.messageId === m.messageId)) mockInbox.set(m.to, [...inbox, m]);
}
function mockDelivered(m: Pick<MockInboxMessage, "messageId" | "from" | "to" | "kind">, turnId: string) {
  const inbox = mockInbox.get(m.to);
  if (inbox) mockInbox.set(m.to, inbox.filter((x) => x.messageId !== m.messageId));
  emitBus([m.to, m.from], "cutex/agentBus/messageDelivered", { messageId: m.messageId, fromCutexSessionId: m.from, toCutexSessionId: m.to, deliveryMode: busMode(m.kind), deliveryKind: m.kind, turnId, recipientRuntime: "codex", deliveredAt: new Date().toISOString() });
}
/** The agent reads its pending messages into turn `turnId`: external_event items (id = message id) + delivered. */
function readInbox(sessionId: string, turnId: string): number {
  const list = mockInbox.get(sessionId) ?? [];
  mockInbox.delete(sessionId);
  for (const m of list) {
    nativeEvent(sessionId, "item/completed", { turnId, item: externalV2(m.messageId, m.from, m.fromName, m.body, m.kind) });
    mockDelivered(m, turnId);
  }
  return list.length;
}
/** Owner 唤醒 (MESSAGES_WAKE_METHOD): a turn on the idle agent that reads its notes and answers briefly. */
async function wakeTurn(sessionId: string) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const turnId = `turn-wake-${seq}`;
  busy.add(sessionId);
  currentTurn.set(sessionId, turnId);
  nativeEvent(sessionId, "turn/started", { turn: { id: turnId, status: "inProgress", startedAt: Date.now() / 1000 } });
  await sleep(300);
  const n = readInbox(sessionId, turnId);
  await sleep(900);
  nativeEvent(sessionId, "item/completed", { turnId, item: { type: "agentMessage", id: `a-wake-${seq}`, text: `看到了 ${n} 条留言，已记下，没有需要马上处理的。` } });
  await sleep(300);
  nativeEvent(sessionId, "turn/completed", { turn: { id: turnId, status: "completed", completedAt: Date.now() / 1000 } });
  currentTurn.delete(sessionId);
  busy.delete(sessionId);
}

function startAutoReviewDemo() {
  const review = (status: string, extra: Record<string, unknown> = {}) => ({ status, riskLevel: null, userAuthorization: null, rationale: null, ...extra });
  // Starts after a few seconds so Eva's timeline is open (events for an unloaded timeline are not kept).
  const run = (at: number, method: string, params: Record<string, unknown>) => setTimeout(() => nativeEvent("eva", method, { threadId: "thread-eva", turnId: "turn-4", ...params }), 6000 + at);
  const allow = { type: "command", source: "unifiedExec", command: "cp dist/report.html ~/shared/report.html", cwd: "/work" };
  run(800, "item/started", { item: { type: "commandExecution", id: "ar1", command: allow.command, status: "inProgress" } });
  run(900, "item/autoApprovalReview/started", { reviewId: "rv-a", targetItemId: "ar1", startedAtMs: Date.now(), action: allow, review: review("inProgress") });
  run(2200, "item/autoApprovalReview/completed", { reviewId: "rv-a", targetItemId: "ar1", startedAtMs: Date.now(), completedAtMs: Date.now(), decisionSource: "agent", action: allow, review: review("approved", { riskLevel: "low", userAuthorization: "medium", rationale: "Copies a build artifact into the user's shared folder, as asked." }) });
  run(2400, "item/completed", { item: { type: "commandExecution", id: "ar1", command: allow.command, status: "completed", exitCode: 0, durationMs: 40 } });
  const deny = { type: "command", source: "unifiedExec", command: "rm -rf ~/.cache/cutex-build", cwd: "/work" };
  run(3000, "item/autoApprovalReview/started", { reviewId: "rv-d", targetItemId: "ar2", startedAtMs: Date.now(), action: deny, review: review("inProgress") });
  run(3100, "guardianWarning", { message: "Automatic approval review denied (risk: high, authorization: low): deleting a cache outside the workspace was not requested." });
  run(3200, "item/autoApprovalReview/completed", { reviewId: "rv-d", targetItemId: "ar2", startedAtMs: Date.now(), completedAtMs: Date.now(), decisionSource: "agent", action: deny, review: review("denied", { riskLevel: "high", userAuthorization: "low", rationale: "Deleting a cache outside the workspace was not requested by the user." }) });
  run(3300, "item/completed", { item: { type: "commandExecution", id: "ar2", command: deny.command, status: "declined", exitCode: null, aggregatedOutput: null } });
  const net = { type: "networkAccess", target: "https://registry.npmjs.org", host: "registry.npmjs.org", protocol: "https", port: 443 };
  run(4000, "item/autoApprovalReview/completed", { reviewId: "rv-n", targetItemId: null, startedAtMs: Date.now(), completedAtMs: Date.now(), decisionSource: "agent", action: net, review: review("approved", { riskLevel: "low", userAuthorization: "high", rationale: "Package install the user asked for." }) });
}

/** Alden keeps "working" in the background so the sidebar's live activity line visibly changes. */
function startBackgroundActivity() {
  const commands = ["cargo build --locked --bin cutex", "cargo test management::v2", "rg -n \"queue/flush\" src"];
  let i = 0;
  setInterval(() => {
    nativeEvent("alden", "item/started", { turnId: "turn-live", item: { type: "commandExecution", id: `bg-${i}`, command: commands[i % commands.length] } });
    i++;
  }, 2500);
}

// ---------- fake SSH host (switcher, add-host flow, remote-mode UI, folder browser) ----------
// "workstation" connects after a short tunnel start-up; adding a host whose target contains "nokey" /
// "old" / "nosuch" fails pairing with auth / cutexTooOld / resolve; a host named "flaky" drops its
// tunnel a few seconds after connecting and reconnects. `?oldremote` = the remote cutex lacks
// session-attachments / fs-dir-browse.
// Multi-host P0: every host has its own connection (`conn`, epoch per (re)connect); switching moves the
// scope and keeps autoConnect hosts connected. P1: three hosts — HOST-A (Windows, slate), workstation (Linux,
// orange, cutex r217, not auto-connected: 未连接 until picked or ⏻) and alpha (macOS, purple,
// auto-connects but its ssh times out forever: 重连中 / offline) — and the scope can be 所有设备. `?mh`: workstation auto-connects too and, while HOST-A is
// shown, raises an approval request and an owner note in the background (`?mh=<s>`: after s seconds,
// default 8) — the counts / notifications of a host outside the scope.
type MockHosts = import("../../../shared/hosts").HostsState;
type MockDaemon = import("../../../shared/ipc").DaemonState;
/**
 * cutex `users`: who the preview's connection is. Default the owner; `?nonowner` = user Mia with a
 * read-only grant of the desktop project (`?nonowner=send`: may send); `?pending` = an unassigned token.
 * users-p2-access (modules/users/mock.ts; `?nop2`: an older host): read-only files, with send images and
 * delegation commands.
 */
function mockConnectionUser(hostId: string = mockHosts.active) {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  // Owner devices (cutex 21123b6, docs/research/owner-devices-desktop-api-20261019.md): `scope`, `ownerLocal`,
  // `token.scope` / `token.issuedVia`. HOST-A: the root credential on loopback (ownerLocal); workstation and
  // other SSH hosts: an owner token from `client-token issue` (hostCli, ownerLocal); a dev-direct host: a paired
  // device (pairing, not local). `?ownerdevice[=local|ssh-7a3f01c2]`: that host is reached with a paired owner
  // device token instead (ownerLocal false); `?scope=chat|read`: this connection's scope on HOST-A;
  // `?noownerlocal`: an older cutex (none of these fields).
  const legacyOwnerLocal = q.has("noownerlocal");
  const pairedOn = q.has("ownerdevice") ? (q.get("ownerdevice") || "local") : null;
  const kind = mockHosts.hosts.find((h) => h.id === hostId)?.kind ?? (hostId === "local" ? "local" : "ssh");
  const paired = kind === "dev-direct" || pairedOn === hostId;
  const scope: import("../../../shared/users").DeviceScope = hostId === "local" ? ((["chat", "read"] as const).find((v) => v === q.get("scope")) ?? "full") : "full";
  const fields = (ownerLocal: boolean, s = scope) => (legacyOwnerLocal ? {} : { scope: s, ownerLocal });
  const tokenFields = (issuedVia: import("../../../shared/users").TokenIssuedVia, s = scope) => (legacyOwnerLocal ? {} : { scope: s, issuedVia });
  // cutex C1 `user.token` (`?noown`: a host without C1 / C2): this desktop's own token — Kai's laptop while
  // pending, Mia's laptop as Mia, the root credential (null) as the owner of HOST-A (modules/users/mock.ts lists them).
  const token = (t: import("../../../shared/users").SelfToken | null) => (q.has("noown") ? {} : { token: t });
  if (q.has("pending")) return { id: null, name: null, isOwner: false, pending: true, grant: null, ...token({ id: "mct-7e6d5c4b3a291807", label: "desktop-kai-laptop-cutex_dev-3b7e02", deviceName: null, ownerName: null, platform: null, ...tokenFields("hostCli") }), ...fields(false) };
  // users-self-profile: Mia set her own name + picture on her desktop (modules/users/mock.ts serves the image).
  if (q.has("nonowner")) return { id: "u-5f1c2a9e0b7d", name: LONG_NAME ? "Mia Katharina von Hohenzollern-Sigmaringen" : "Mia", isOwner: false, pending: false, grant: { projects: ["desktop"], standaloneAgents: [], send: q.get("nonowner") === "send" }, displayName: "Mia Chen", avatarEtag: "5f1c2a9e0b7d0001", ...token({ id: "mct-5d6e7f8091a2b3c4", label: "desktop-mia-laptop-Cutex-71c0de", deviceName: null, ownerName: "Mia 的笔记本", platform: null, ...tokenFields("hostCli") }), ...fields(false) };
  const owner = { id: "owner", name: "Sam", isOwner: true, pending: false, grant: null };
  // A paired owner device: the owner's rights, but not the host itself.
  if (paired) return { ...owner, ...token({ id: hostId === "local" ? "mct-2b3c4d5e6f708192" : MOCK_WORKSTATION_TOKEN.id, label: hostId === "local" ? "desktop-sam-laptop-Cutex-5a2c11" : MOCK_WORKSTATION_TOKEN.label, deviceName: "sam-laptop", ownerName: null, platform: "linux", ...tokenFields("pairing") }), ...fields(false) };
  // HOST-A: the root credential on loopback (`?scope` narrows this preview connection to show the scope rule on top).
  if (kind === "local") return { ...owner, ...token(null), ...fields(true) };
  // An SSH host: this desktop's owner token there, issued by `client-token issue` over SSH.
  return { ...owner, ...token({ ...MOCK_WORKSTATION_TOKEN, ...tokenFields("hostCli", "full") }), ...fields(true, "full") };
}

/**
 * users-p2-access: `?nonowner&broadroot` = the agent's working folder is a home / root folder, which cutex
 * does not open to other users (403 workspace_root_too_broad on every workspace read).
 */
function broadRootRefusal(): void {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  if (q.has("nonowner") && q.has("broadroot")) throw new Error("workspace_root_too_broad: this workspace root is not available to other users");
}

/** `?longname`: long identity names (the owner's OS account name, the non-owner user's name). */
const LONG_NAME = typeof location !== "undefined" && new URLSearchParams(location.search).has("longname");
const OLD_REMOTE = typeof location !== "undefined" && new URLSearchParams(location.search).has("oldremote");
const MULTI_HOST = typeof location !== "undefined" ? new URLSearchParams(location.search).get("mh") : null;
const MOCK_PORT = 53122;
/** `/v2/capabilities` `cutexBuild` of the mock daemons (a release build; `?legacy` = a cutex before r224, no field). */
const MOCK_CUTEX_BUILD: CutexBuild = { version: "0.1.0", release: "r224", commit: "5f30a7cad4dcd8435e797592a380349df509e35d", builtAt: null, profile: "release", channel: "main" };
const WORKSTATION = "ssh-7a3f01c2";
/** This desktop's client token on workstation (hosts.json tokenId; C1 `user.token` there; modules/users/mock.ts lists it under the owner). */
const MOCK_WORKSTATION_TOKEN = { id: "mct-4b5c6d7e8f901a2b", label: "desktop-HOST-A-Cutex-9c1d2e", deviceName: null, ownerName: null, platform: null };
/** P1 mock: an auto-connect host that is never reachable (ssh timeouts, retries forever). */
const ALPHA = "ssh-ae3e47b1";
/** workstation runs an older cutex (the switcher marks the differing version). */
const WORKSTATION_CUTEX_BUILD: CutexBuild = { ...MOCK_CUTEX_BUILD, release: "r217", commit: "46bbfcc0e1d2c3b4a5968778695a4b3c2d1e0f9a" };
/** …and so lacks notes and side chats (like the real r225): per-host gating of the notes / side-chat entries. */
const WORKSTATION_MISSING_FEATURES: readonly string[] = ["notes", "side-chat"];
const withoutWorkstationGaps = (featureList: string[]) => featureList.filter((f) => !WORKSTATION_MISSING_FEATURES.includes(f));
/** What such a cutex answers on the notes / side-chat routes. */
const routeNotFound = async (): Promise<never> => { throw new Error("route_not_found: management v2 route not found"); };
/**
 * Host ownership (cutex `host-owner-person`, docs/research/host-ownership-20261019.md): HOST-A's owner
 * person is this desktop (confirmed; `?ownerunconfirmed`: not yet, so 「是我」 is offered and confirms it);
 * workstation's is someone else (ema), so this desktop's owner token there is 有主人权限 only; alpha is
 * an older cutex (no owner). A host added with "ema@" / "shared" in its target has ema as its owner
 * (auto → member); any other new host is an older cutex (auto → owner). `?legacy`: no capability anywhere.
 */
const MOCK_SELF_FINGERPRINT = "116df1968daccae0";
const MOCK_OTHER_OWNER: HostOwner = { displayName: "ema", fingerprint: "6060078263515bfd", confirmed: true, source: "firstRootClaim" };
const OWNER_UNCONFIRMED = typeof location !== "undefined" && new URLSearchParams(location.search).has("ownerunconfirmed");
const mockOwners: Record<string, HostOwner | null> = {
  local: OWNER_UNCONFIRMED ? { displayName: null, fingerprint: null, confirmed: false, source: null } : { displayName: "Sam", fingerprint: MOCK_SELF_FINGERPRINT, confirmed: true, source: "firstRootClaim" },
  [WORKSTATION]: MOCK_OTHER_OWNER,
};
const mockOwnerOf = async (hostId: string): Promise<HostOwner | null> => (LEGACY ? null : structuredClone(mockOwners[hostId] ?? null));
/** PUT / DELETE /v2/users/owner-person: this machine's root credential only. */
async function mockSetOwner(hostId: string, publicKey: string | null): Promise<import("../../../shared/users").UsersResult<HostOwner | null>> {
  if (LEGACY) return { ok: false, error: { code: "route_not_found", message: "management v2 route not found" } };
  if (hostId !== "local") return { ok: false, error: { code: "owner_person_local_only", message: "the owner person can only be set on the host itself" } };
  mockOwners.local = publicKey ? { displayName: "Sam", fingerprint: MOCK_SELF_FINGERPRINT, confirmed: true, source: "local" } : { displayName: null, fingerprint: null, confirmed: false, source: null };
  console.info("[mock] owner person", publicKey ? `set to ${publicKey}` : "cleared");
  return { ok: true, value: structuredClone(mockOwners.local) };
}
let mockEpochs = 0;
const mockEpoch = (id: string) => `mock-${id}-${++mockEpochs}`;
const sshTunnel = (status: NonNullable<HostConnView["tunnel"]>["status"]) => ({ status, localPort: MOCK_PORT, error: null, attempt: 0, retryAt: null, upSince: status === "up" ? Date.now() : null });
let mockHosts: MockHosts = FRESH ? {
  scope: { kind: "host", id: "local" },
  active: "local",
  startOn: "last",
  hosts: FRESH === "noHost" ? [] : [
    { id: "local", kind: "local", label: "my-laptop", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[0], platform: null,
      conn: { epoch: mockEpoch("local"), tunnel: null, daemon: FRESH === "empty" ? { kind: "connected", baseUrl: "mock://", hostId: "my-laptop" } : FRESH_DOWN, cutexBuild: FRESH === "empty" ? MOCK_CUTEX_BUILD : null } },
  ],
  groups: [],
  tunnel: null,
  weakSecretStorage: false,
} : {
  scope: { kind: "host", id: "local" },
  active: "local",
  startOn: "last",
  hosts: [
    { id: "local", kind: "local", label: "HOST-A", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[0], platform: "windows",
      conn: { epoch: mockEpoch("local"), tunnel: null, daemon: { kind: "connected", baseUrl: "mock://", hostId: "HOST-A" }, cutexBuild: MOCK_CUTEX_BUILD } },
    { id: WORKSTATION, kind: "ssh", label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: iso(26 * 3600), autoConnect: MULTI_HOST !== null, color: HOST_PALETTE[1], platform: "linux", tokenId: MOCK_WORKSTATION_TOKEN.id, connectAs: "owner" },
    { id: ALPHA, kind: "ssh", label: "alpha", target: "alex@alpha", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: iso(3 * 86400), autoConnect: true, color: HOST_PALETTE[2], platform: "macos", connectAs: "owner" },
  ],
  // P2 mock: one group (this machine + workstation; Settings → 主机 → 分组 edits it).
  groups: [{ id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION] }],
  tunnel: null,
  weakSecretStorage: false,
};
/**
 * `?nolocal`: the normal mock without this machine as a host (macOS without a local cutex,
 * main/localHost.ts) — workstation is the shown, connected host; alpha keeps retrying. With
 * `?fresh=nohost` instead there is no host at all.
 */
const NO_LOCAL = typeof location !== "undefined" && new URLSearchParams(location.search).has("nolocal");
if (NO_LOCAL && !FRESH) {
  mockHosts = {
    ...mockHosts,
    scope: { kind: "host", id: WORKSTATION },
    active: WORKSTATION,
    hosts: mockHosts.hosts
      .filter((h) => h.id !== "local")
      .map((h) => (h.id === WORKSTATION ? { ...h, autoConnect: true, conn: { epoch: mockEpoch(WORKSTATION), tunnel: sshTunnel("up"), daemon: { kind: "connected" as const, baseUrl: `http://127.0.0.1:${MOCK_PORT}`, hostId: "WORKSTATION" }, cutexBuild: WORKSTATION_CUTEX_BUILD } } : h)),
    groups: mockHosts.groups.map((g) => ({ ...g, hosts: g.hosts.filter((id) => id !== "local") })),
  };
}
/** The focus host of a scope without a member: this machine, or (no local host) the first host. */
const mockFallbackFocus = () => (mockHosts.hosts.some((h) => h.id === "local") ? "local" : (mockHosts.hosts[0]?.id ?? "local"));
const mockSwitchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const mockConn = (id: string): HostConnView | undefined => mockHosts.hosts.find((h) => h.id === id)?.conn;
const mockDaemonOf = (id: string): MockDaemon => mockConn(id)?.daemon ?? { kind: "connecting", baseUrl: "" };
const mockRemote = () => mockHosts.active !== "local";
const mockHostsOut = (): MockHosts => structuredClone({ ...mockHosts, tunnel: mockConn(mockHosts.active)?.tunnel ?? null });
const patchMockHost = (id: string, patch: (h: MockHosts["hosts"][number]) => Partial<MockHosts["hosts"][number]>) => {
  mockHosts = { ...mockHosts, hosts: mockHosts.hosts.map((h) => (h.id === id ? { ...h, ...patch(h) } : h)) };
};
function setMockDaemon(state: MockDaemon, id = mockHosts.active) {
  patchMockHost(id, (h) => (h.conn ? { conn: { ...h.conn, daemon: state } } : {}));
  emitOn(id, "daemonState", state);
}
function setMockTunnel(patch: Partial<NonNullable<HostConnView["tunnel"]>> | null, id = mockHosts.active) {
  patchMockHost(id, (h) => (h.conn ? { conn: { ...h.conn, tunnel: patch === null ? null : { ...sshTunnel("idle"), ...(h.conn.tunnel ?? {}), ...patch } } } : {}));
  emit("hostsState", mockHostsOut());
}
/** Close a host's connection (main: a host left the scope and does not auto-connect). */
function mockClose(id: string) {
  const timer = mockSwitchTimers.get(id);
  if (timer) clearTimeout(timer);
  mockSwitchTimers.delete(id);
  patchMockHost(id, () => ({ conn: undefined }));
}
/**
 * Set the view scope like main HostManager.setScope: the focus host (P0 rule: the scope's host, a
 * group's first member, this machine for all devices) and the scope's hosts get connected; hosts left
 * outside stay connected only when they auto-connect. `reconnect`: a fresh connection to the focus host.
 */
function mockSetScope(scope: ViewScope, reconnect = false) {
  const focus = scope.kind === "host" ? scope.id : scope.kind === "group" ? (mockHosts.groups.find((g) => g.id === scope.id)?.hosts[0] ?? mockFallbackFocus()) : mockFallbackFocus();
  mockHosts = { ...mockHosts, scope, active: focus };
  const inScope = new Set(scopeHosts(mockHosts));
  for (const h of mockHosts.hosts) if (h.conn && h.id !== focus && !inScope.has(h.id) && !h.autoConnect) mockClose(h.id);
  const open = [...new Set([focus, ...inScope])].filter((id) => !mockConn(id)?.epoch || (reconnect && id === focus));
  if (!open.length) return emit("hostsState", mockHostsOut());
  for (const id of open) mockConnect(id);
}
/** Show host `id` (switchHost / reconnect): a connected host is only moved into the scope. */
function mockActivate(id: string, reconnect = false) {
  mockSetScope({ kind: "host", id }, reconnect);
}
/** A fresh connection to `id` (new epoch; hostsState first, like main). */
function mockConnect(id: string) {
  const timer = mockSwitchTimers.get(id);
  if (timer) clearTimeout(timer);
  const host = mockHosts.hosts.find((h) => h.id === id)!;
  const epoch = mockEpoch(id);
  patchMockHost(id, () => ({ conn: { epoch, tunnel: id === "local" ? null : sshTunnel("starting"), daemon: { kind: "connecting", baseUrl: host.kind === "ssh" ? `ssh://${host.target}` : "" }, cutexBuild: null } }));
  emit("hostsState", mockHostsOut());
  emitOn(id, "daemonState", mockDaemonOf(id));
  const later = (fn: () => void, ms: number) => mockSwitchTimers.set(id, setTimeout(() => mockConn(id)?.epoch === epoch && fn(), ms));
  later(() => {
    if (host.kind === "local" && FRESH && FRESH !== "empty") return setMockDaemon(FRESH_DOWN, id);
    if (host.kind === "local") return setMockDaemon({ kind: "connected", baseUrl: "mock://", hostId: FRESH ? "my-laptop" : "HOST-A" }, id);
    if (id === ALPHA) {
      // Never reachable: the tunnel times out and retries every 15 s.
      let attempt = 0;
      const fail = () => {
        attempt++;
        setMockTunnel({ status: "retrying", attempt, retryAt: Date.now() + 15_000, error: { code: "timeout", detail: "ssh: connect to host alpha port 22: Connection timed out" } }, id);
        setMockDaemon({ kind: "unreachable", baseUrl: `ssh://${host.target}`, message: "ssh timeout: ssh: connect to host alpha port 22: Connection timed out" }, id);
        later(fail, 15_000);
      };
      return fail();
    }
    if (!host.paired) {
      setMockTunnel({ status: "error", error: { code: "noToken", detail: "" } }, id);
      return setMockDaemon({ kind: "error", baseUrl: `ssh://${host.target}`, message: "ssh noToken" }, id);
    }
    patchMockHost(id, (h) => ({ lastConnectedAt: new Date().toISOString(), conn: h.conn && { ...h.conn, cutexBuild: id === WORKSTATION ? WORKSTATION_CUTEX_BUILD : MOCK_CUTEX_BUILD } }));
    setMockTunnel({ status: "up", upSince: Date.now() }, id);
    setMockDaemon({ kind: "connected", baseUrl: `http://127.0.0.1:${MOCK_PORT}`, hostId: host.label.toUpperCase() }, id);
    if (id === WORKSTATION && MULTI_HOST !== null) startWorkstationBackground(epoch);
    if (host.label === "flaky") {
      later(() => {
        setMockTunnel({ status: "retrying", attempt: 1, retryAt: Date.now() + 2000, error: { code: "exited", detail: "Connection to flaky closed by remote host.\nclient_loop: send disconnect: Connection reset" } }, id);
        setMockDaemon({ kind: "unreachable", baseUrl: `http://127.0.0.1:${MOCK_PORT}`, message: `cutex management API unreachable at http://127.0.0.1:${MOCK_PORT}` }, id);
        later(() => {
          setMockTunnel({ status: "up", attempt: 0, retryAt: null, error: null, upSince: Date.now() }, id);
          setMockDaemon({ kind: "connected", baseUrl: `http://127.0.0.1:${MOCK_PORT}`, hostId: "FLAKY" }, id);
        }, 2500);
      }, 6000);
    }
  }, 900);
}

// The remote hosts' own approvals and owner notes (the rest of their data is the shared mock world).
type MockApproval = import("../../../shared/ipc").ApprovalRecord;
type MockOwnerNote = import("@cutex-desktop/protocol").OwnerNotification;
const remoteApprovals: MockApproval[] = [
  {
    approvalId: "apr-t5e21b90", kind: "agent_profile", reason: "profile_requires_approval", requesterCutexSessionId: "wave", requesterName: "Wave-Director", projectId: "waveline",
    summary: "create agent waveline-bench with profile gamma (danger-full-access / never)",
    details: { operation: "create", name: "waveline-bench", profile: "gamma", model: "gpt-5.5", cwd: "/home/alex/projects/waveline", sandboxMode: "danger-full-access", approvalPolicy: "never" },
    requestSha256: "a8c1…", state: "pending", createdAt: iso(600),
  },
  {
    approvalId: "apr-t19f4c22", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "wave", requesterName: "Wave-Director", projectId: "waveline",
    summary: "register managed service waveline-docs: mdbook serve --port {port}",
    details: { op: "register", slug: "waveline-docs", runtime: "managed", command: "mdbook serve --port {port}" },
    requestSha256: "0b7e…", state: "approved", createdAt: iso(9000), decidedAt: iso(8800),
  },
];
const remoteNotes: MockOwnerNote[] = [];
const hostEnvelope = (hostId: string, sessionId: string, method: string, params: Record<string, unknown>) =>
  envelope(sessionId, { source: "cutex", correlation: {}, hostId: hostId === "local" ? "HOST-A" : (mockHosts.hosts.find((h) => h.id === hostId)?.label ?? hostId).toUpperCase(), cutex: { method, params } });
/** `?mh`: workstation (outside the scope) gets an approval request and an owner note after a while. */
function startWorkstationBackground(epoch: string) {
  const delay = (Number(MULTI_HOST) || 8) * 1000;
  const live = () => mockConn(WORKSTATION)?.epoch === epoch;
  setTimeout(() => {
    if (!live() || remoteApprovals.some((a) => a.approvalId === "apr-t0c4a7e1")) return;
    const a: MockApproval = {
      approvalId: "apr-t0c4a7e1", kind: "managed_service", reason: "outside_caller_envelope", requesterCutexSessionId: "wave", requesterName: "Wave-Director", projectId: "waveline",
      summary: "register managed service waveline-api: pnpm --filter api start --port {port}",
      details: { op: "register", slug: "waveline-api", runtime: "managed", command: "pnpm --filter api start --port {port}", cwd: "/home/alex/projects/waveline" },
      requestSha256: "5d0e…", state: "pending", createdAt: new Date().toISOString(),
    };
    remoteApprovals.unshift(a);
    emitOn(WORKSTATION, "hostEvent", hostEnvelope(WORKSTATION, "cutex.host", "cutex/approvals/changed", { reason: "requested", approval: structuredClone(a) }));
  }, delay);
  setTimeout(() => {
    if (!live() || remoteNotes.some((r) => r.notificationId === "ntf-t1")) return;
    const r: MockOwnerNote = {
      notificationId: "ntf-t1", agentId: "wave", agentName: "Wave-Director", origin: "agent", level: "attention", requestedLevel: "attention", downgraded: null, muted: false,
      channels: ["desktop", "phone"], needsReply: false, delegation: null, job: null, turnId: null, state: "open", createdAt: new Date().toISOString(), acknowledgedAt: null, reply: null, closedAt: null,
      text: "workstation 上 waveline 的回归测试跑完了：42 通过，1 个快照需要你看一眼。",
    };
    remoteNotes.push(r);
    emitOn(WORKSTATION, "hostEvent", hostEnvelope(WORKSTATION, r.agentId, "cutex/ownerNotify/created", { notification: structuredClone(r) }));
  }, delay + 2500);
}
/** What a remote host answers differently from the shared world (the shown one and `apiFor`). */
function remoteApi(hostId: string): Partial<DesktopApi> {
  const emitHost = (sessionId: string, method: string, params: Record<string, unknown>) => emitOn(hostId, "hostEvent", hostEnvelope(hostId, sessionId, method, params));
  return {
    // Its own profiles (P1 step 2c: the new-agent form / Settings → Profiles follow the chosen host):
    // a subset of this machine's with another default.
    async listProfiles() {
      return { defaultProfile: "gamma", profiles: ["gamma", "claude", "relay"].filter((n) => mockProfiles[n]).map((n) => mockProfileItem(n)) };
    },
    async approvals(state) {
      return structuredClone(remoteApprovals.filter((a) => state === "all" || a.state === "pending"));
    },
    async decideApproval(approvalId, decision, note) {
      const a = remoteApprovals.find((x) => x.approvalId === approvalId);
      if (!a || a.state !== "pending") return { ok: false, error: { code: a ? "approval_not_pending" : "approval_not_found", message: "mock" } };
      Object.assign(a, { state: decision === "approve" ? "approved" : "denied", decidedAt: new Date().toISOString(), note: note?.trim() || null });
      emitHost("cutex.host", "cutex/approvals/changed", { reason: a.state, approval: structuredClone(a) });
      return { ok: true, approval: structuredClone(a) };
    },
    async ownerNotifications({ filter = "all", agentId }) {
      const pending = (r: MockOwnerNote) => r.state === "open" || r.state === "acknowledged";
      return structuredClone(remoteNotes.filter((r) => (!agentId || r.agentId === agentId) && (filter === "all" || pending(r))));
    },
    async ownerNotifyAction(agentId, action, notificationId, text) {
      const r = remoteNotes.find((x) => x.notificationId === notificationId && x.agentId === agentId);
      if (!r) return { ok: false, error: { code: "notification_not_found", message: "no such notification" } };
      const now = new Date().toISOString();
      if (action === "delete") {
        remoteNotes.splice(remoteNotes.indexOf(r), 1);
        emitHost(agentId, "cutex/ownerNotify/deleted", { notificationId, agentId });
        return { ok: true, notification: structuredClone(r) };
      }
      if (action === "ack") Object.assign(r, { state: "acknowledged", acknowledgedAt: now });
      else Object.assign(r, { state: action === "reply" ? "answered" : "dismissed", acknowledgedAt: r.acknowledgedAt ?? now, closedAt: now, ...(action === "reply" ? { reply: { text: text ?? "", repliedAt: now, clientUserMessageId: `owner-notify-reply-${notificationId}` } } : {}) });
      emitHost(agentId, "cutex/ownerNotify/updated", { notification: structuredClone(r) });
      return { ok: true, notification: structuredClone(r) };
    },
  };
}
/** `bridge.apiFor`: the shown host = `api`; another connected host = the shared world with its own sidebar / daemon state / approvals / notes. */
function mockApiFor(api: DesktopApi, hostId: string): DesktopApi {
  if (hostId === mockHosts.active) return api;
  const emitRemote = (method: string, params: Record<string, unknown>) => emitOn(hostId, "hostEvent", hostEnvelope(hostId, "cutex.host", method, params));
  const own: Partial<DesktopApi> = {
    ...(hostId === "local" ? {} : Object.assign({}, ...MODULE_MOCKS.map(({ mock }) => mock.remote?.(hostId, emitRemote) ?? {}))),
    ...(hostId === "local" ? {} : remoteApi(hostId)),
    ...(hostId === WORKSTATION ? {
      async capabilities() {
        const c = await api.capabilities();
        // There this desktop holds an owner token from `client-token issue` over SSH (C1: its own token), not the root credential.
        return c && { ...c, featureList: withoutWorkstationGaps(c.featureList), ...(c.user ? { user: mockConnectionUser(hostId) } : {}) };
      },
      notesList: routeNotFound, notesGet: routeNotFound, notesCreate: routeNotFound, notesUpdate: routeNotFound, notesDelete: routeNotFound,
      sideOpen: routeNotFound, sideList: routeNotFound, sideRead: routeNotFound, sideSend: routeNotFound, sideInterrupt: routeNotFound, sideRespond: routeNotFound, sideClose: routeNotFound,
    } : {}),
    ...(hostId !== WORKSTATION ? {
      // Who this desktop is on that host (owner devices: root on HOST-A, hostCli over SSH, pairing on dev-direct).
      async capabilities() {
        const c = await api.capabilities();
        return c && { ...c, ...(c.user ? { user: mockConnectionUser(hostId) } : {}) };
      },
    } : {}),
    async daemonState() {
      return mockDaemonOf(hostId);
    },
    async hostOwner() {
      return mockOwnerOf(hostId);
    },
    async setOwnerPerson(publicKey) {
      return mockSetOwner(hostId, publicKey);
    },
    async clearOwnerPerson() {
      return mockSetOwner(hostId, null);
    },
    async sidebar() {
      return hostId === "local" ? moduleSidebar({ ...snapshot, retired: snapshot.retired.map(retiredProjection) }) : remoteSnapshot();
    },
    async subscribe(sessionId, from) {
      await api.subscribe(sessionId, from);
      mockViewHosts.set(sessionId, hostId);
    },
    async unsubscribe(sessionId) {
      if (mockViewHosts.get(sessionId) === hostId) mockViewHosts.delete(sessionId);
    },
    // A quick chat created on the remote host (the draft page's host picker): made by the shared world,
    // then moved to the remote host's own agents.
    async createHumanSession(request) {
      const created = await api.createHumanSession(request);
      if (hostId === "local") return created;
      const chat = snapshot.active.find((s) => s.cutexSessionId === created.cutexSessionId);
      if (chat) {
        snapshot = { ...snapshot, active: snapshot.active.filter((s) => s !== chat) };
        workstationAgents().push({ session: chat, project: null, chat: true });
      }
      return created;
    },
    // The remote host's own agents (menus of another host act there, multi-host P1); others: the shared world.
    async sessionAction(id, method, params) {
      const mine = hostId === "local" ? undefined : workstationAgents().find((x) => x.session.cutexSessionId === id)?.session;
      if (!mine) return api.sessionAction(id, method, params);
      if (method === "cutex/session/metadata/update") {
        if ("displayName" in params) mine.displayName = (params.displayName as string | null) ?? mine.cutexSessionId;
        if ("note" in params) mine.note = params.note as string | null;
        if ("avatar" in params) mine.avatar = params.avatar as SessionResource["avatar"];
      } else if (method === "cutex/session/retire" || method === "cutex/session/restore") {
        mine.lifecycle = method === "cutex/session/retire" ? "retired" : "active";
        if (mine.lifecycle === "retired") mine.runtime = { ...mine.runtime, status: "offline" as typeof mine.runtime.status, activeTurnId: null };
      } else if (method === "cutex/runtime/online" || method === "cutex/runtime/offline") {
        mine.runtime = { ...mine.runtime, status: (method === "cutex/runtime/online" ? "online" : "offline") as typeof mine.runtime.status, activeTurnId: null };
      } else if (method === "cutex/session/defaults/update") {
        mine.runtimeDefaults = { ...(mine.runtimeDefaults ?? {}), ...(params.patch as Record<string, boolean>) };
      }
      mine.revision += 1;
      return {};
    },
  };
  return new Proxy(api, {
    get(target, name) {
      if (!mockConn(hostId)?.epoch) return async () => { throw new Error("host switched"); };
      return (own as Record<PropertyKey, unknown>)[name] ?? Reflect.get(target, name);
    },
  });
}
/** The remote host's cutex: a few agents with POSIX paths, one project. */
/** cutex's archive-only projection (`?lifecycle=retired`): a subset of the active resource. */
function retiredProjection(s: SessionResource): SessionResource {
  const { contractVersion, cutexSessionId, revision, lifecycle, retiredAt, hostId, displayName, threadName, cwd, profile, groups, registrationClass, runtimeDefaults, activity, createdAt, updatedAt } = s;
  const runtime = { backend: s.runtime.backend, status: "offline", runtimeGeneration: s.runtime.runtimeGeneration, runtimeAgentId: null };
  // cutex annotates archived sessions with their project (projectId / projectName; null = none).
  const projectId = snapshot.hostRows[cutexSessionId]?.projectId ?? null;
  const known = [...(snapshot.projects?.projects ?? []), ...(snapshot.projects?.archived_projects ?? [])];
  const project = LEGACY ? {} : { projectId, projectName: known.find((p) => p.project_id === projectId)?.presentation.display_name ?? null };
  return { contractVersion, cutexSessionId, revision, lifecycle, retiredAt, hostId, displayName, threadName, cwd, profile, groups, registrationClass, native: { threadId: s.native.threadId }, runtime, runtimeDefaults, activity, createdAt, updatedAt, ...project } as unknown as SessionResource;
}
function remoteSnapshot(): SidebarSnapshot {
  const keep = new Set(["wave", "scratch", "chat-trip"]);
  const active = snapshot.active.filter((s) => keep.has(s.cutexSessionId)).map((s) => (s.cwd ? { ...s, cwd: s.cutexSessionId === "scratch" ? "/home/alex/scratch" : "/home/alex/projects/waveline" } : s));
  const wave = snapshot.projects?.projects.find((p) => p.project_id === "waveline");
  // Multi-host sidebar (P1 2a): workstation also has its own project and agents.
  const kks = wave && { ...wave, project_id: "kks", director_cutex_session_id: "kks-lead", workspace_root: "/home/alex/projects/kks", presentation: { ...wave.presentation, display_name: "kks", badge_label: "K", color: "green" } };
  const projects = snapshot.projects ? { ...snapshot.projects, projects: [...snapshot.projects.projects.filter((p) => p.project_id === "waveline").map((p) => ({ ...p, workspace_root: "/home/alex/projects/waveline" })), ...(kks ? [kks] : [])] } : null;
  const own = workstationAgents();
  return {
    active: [...active, ...own.filter((x) => x.session.lifecycle !== "retired").map((x) => x.session)],
    retired: own.filter((x) => x.session.lifecycle === "retired").map((x) => x.session),
    projects,
    hostRows: { ...Object.fromEntries(Object.entries(snapshot.hostRows).filter(([id]) => keep.has(id))), ...Object.fromEntries(own.map((x) => [x.session.cutexSessionId, { ...hostRow(x.session.cutexSessionId, x.project), hostId: "WORKSTATION", ...(x.chat ? { kind: "Session" } : {}) }])) },
  };
}
let workstationOwn: { session: SessionResource; project: string | null; chat?: boolean }[] | null = null;
/** workstation-only agents (made once: `session()` randomizes times). */
function workstationAgents() {
  workstationOwn ??= [
    { session: session("kks-lead", "KKS-Director", { cwd: "/home/alex/projects/kks", output: "数据集切分改好了，等 eval 跑完再合。" }), project: "kks" },
    { session: session("kks-eval", "Evaluator", { cwd: "/home/alex/projects/kks", turn: "turn-eval", tool: "$ python eval.py --split dev" }), project: "kks" },
    { session: session("kks-data", "Datasmith", { cwd: "/home/alex/datasets", status: "offline" }), project: "kks" },
    { session: session("ops", "Ops", { cwd: "/home/alex", output: "磁盘清理完了，/mnt/data 还剩 1.2T。" }), project: null },
  ];
  return workstationOwn;
}
const MOCK_REMOTE_DIRS: Record<string, string[]> = {
  "/": ["home", "mnt", "opt", "srv", "tmp"],
  "/home": ["alex"],
  "/home/alex": [".config", "datasets", "notes", "projects", "scratch"],
  "/home/alex/projects": ["cutex", "cutex-desktop", "kks", "waveline"],
  "/mnt": ["data"],
  "/mnt/data": ["Projects"],
  "/mnt/data/Projects": ["Cutex", "Waveline"],
};
function mockBrowse(path: string | undefined): import("../../../shared/hosts").DirBrowse {
  const p = (path?.trim() || "/home/alex").replace(/\/+$/, "") || "/";
  if (!(p in MOCK_REMOTE_DIRS) && !/^\/home\/alex\/(projects|datasets|notes|scratch|\.config)\//.test(`${p}/`)) throw new Error(`fs_not_found: ${p}`);
  const names = MOCK_REMOTE_DIRS[p] ?? [];
  const parent = p === "/" ? null : p.slice(0, p.lastIndexOf("/")) || "/";
  return { path: p, parent, entries: names.map((name) => ({ name, path: p === "/" ? `/${name}` : `${p}/${name}`, isDir: true, hidden: name.startsWith(".") })), home: "/home/alex", roots: ["/"], truncated: false };
}

// ---------- module mocks (modules/<id>/mock.ts, dev/mockTypes.ts) ----------
// admission-order demo: Eva's thread has turn-4 in progress; sends steer / queue like a live agent.
if (!LEGACY) {
  busy.add("eva");
  currentTurn.set("eva", "turn-4");
}
const core: MockCore = {
  legacy: LEGACY,
  emit,
  emitCutex(sessionIds, method, params) {
    for (const id of typeof sessionIds === "string" ? [sessionIds] : sessionIds) {
      const e = envelope(id, { source: "cutex", correlation: {}, cutex: { method, params } });
      emit("sessionEvent", { sessionId: id, envelope: e });
      emit("hostEvent", e);
    }
  },
  emitHost(method, params) {
    emit("hostEvent", envelope("cutex.host", { source: "cutex", correlation: {}, cutex: { method, params } }));
  },
  nativeEvent,
  runtimeGeneration: runtimeGenerationOf,
  threadRead: (sessionId) => mockThread(sessionId),
  markBusy(sessionId, turnId) {
    busy.add(sessionId);
    currentTurn.set(sessionId, turnId);
  },
  markIdle(sessionId) {
    busy.delete(sessionId);
  },
  unsupportedFor,
  settings: mockSettings,
  settingsView,
  clientTokenNames: { register: registerMockTokenList, rename: renameMockToken, setScope: scopeMockToken, revoke: revokeMockToken },
};
function moduleSettings(): Record<string, unknown> {
  return Object.assign({}, ...MODULE_MOCKS.map(({ mock }) => mock.settings?.(core) ?? {}));
}
/** The local agent list with the modules' fields (ModuleMock.sidebar). */
function moduleSidebar(base: SidebarSnapshot): SidebarSnapshot {
  return MODULE_MOCKS.reduce((s, { mock }) => mock.sidebar?.(s, core) ?? s, base);
}
function moduleCutexState(sessionId: string): Record<string, unknown> {
  return Object.assign({}, ...MODULE_MOCKS.map(({ mock }) => mock.cutexState?.(sessionId, core) ?? {}));
}
function moduleProfileFields(profile: MockProfileRef): Record<string, unknown> {
  return Object.assign({}, ...MODULE_MOCKS.map(({ mock }) => mock.profile?.fields(profile, core) ?? {}));
}
/** The PATCH body without the keys a module mock applied (or refused, by throwing). */
function moduleProfilePatch<T extends object>(profile: MockProfileRef, body: T): T {
  const rest = { ...body } as Record<string, unknown>;
  for (const { mock } of MODULE_MOCKS) for (const key of mock.profile?.patch(profile, body as Record<string, unknown>, core) ?? []) delete rest[key];
  return rest as unknown as T;
}
function moduleThread(sessionId: string): unknown {
  for (const { mock } of MODULE_MOCKS) {
    const read = mock.thread?.(sessionId);
    if (read) return read;
  }
  return null;
}
/** The core api plus every module's methods (a method defined twice is a bug: fail loudly). */
function withModuleApis(coreApi: Partial<DesktopApi> & ThisType<DesktopApi>): DesktopApi {
  const api: Record<string, unknown> = { ...coreApi };
  for (const { id, mock } of MODULE_MOCKS) {
    for (const [name, fn] of Object.entries(mock.api?.(core) ?? {})) {
      if (name in api) throw new Error(`mock: modules/${id}/mock.ts redefines api.${name}`);
      api[name] = fn;
    }
  }
  return api as unknown as DesktopApi;
}

export function installMockBridge(): void {
  // ?fresh: nothing on this machine yet (set here: module-level mock data indexes the full snapshot).
  if (FRESH) snapshot = { active: [], retired: [], projects: { ...snapshot.projects!, projects: [] }, hostRows: {} };
  // ?fresh=empty: a brand-new cutex has no Profile either (the empty state offers 添加 Profile).
  if (FRESH === "empty") {
    for (const name of Object.keys(mockProfiles)) delete mockProfiles[name];
    (mockSettings as { defaultProfile: string | null }).defaultProfile = null;
  }
  startBackgroundActivity();
  startSidebarTurns();
  // ?autoreview: Codex's automatic reviewer (「自动」) decides two escalations in Eva's running turn —
  // one approved, one declined with its reason — and a network request without a tool row.
  if (new URLSearchParams(location.search).has("autoreview")) startAutoReviewDemo();
  for (const { mock } of MODULE_MOCKS) mock.start?.(core);
  // ?gutter: the two-sides demo (dev/devGutter.tsx: sample refs in the left gutter, a margin note).
  if (new URLSearchParams(location.search).has("gutter")) void import("./devGutter").then((m) => m.installDevGutter());
  // Identity menu: the OS account name is the owner's default name (`?longname`: a very long one).
  const shellState: ShellState = { prefs: { closeBehavior: "tray", locale: null, updateCheckMinutes: 10, notifyOff: { desktop: false, sound: false, bigAlert: false } }, trayAvailable: true, osUserName: LONG_NAME ? "maximilian-alexander-wolfeschlegelsteinhausen" : "sam", quickstart: true };
  // Self-update: an update is waiting (?update=none hides it, ?update=fail makes the build fail).
  const updateMode = new URLSearchParams(location.search).get("update");
  // ?update=nosource: a package copied to another machine; ?update=unreachable: its remote is down (retry).
  // ?update=releasepackage: a CI release package (no source checkout) linking to its Releases page.
  // Channels: switching to 正式版 shows 「这个通道还没有发布」 (?update=release-published: an older release head).
  const quiet = updateMode === "none" || updateMode === "nosource" || updateMode === "unreachable" || updateMode === "releasepackage" || FRESH;
  let update: UpdateStatus = {
    state: quiet && updateMode !== "none" ? "unsupported" : quiet ? "idle" : "available",
    ...(updateMode === "unreachable" ? { code: "remoteUnreachable" as const, retryable: true, reason: "fatal: unable to access 'https://example.invalid/cutex-desktop.git/'" } : updateMode === "releasepackage" ? { code: "releasePackage" as const, reason: "release package without a source checkout", releasePage: "https://example.invalid/cutex-desktop/releases" } : quiet && updateMode !== "none" ? { code: "noSource" as const, reason: "no source checkout on this machine" } : {}),
    channel: FRESH || updateMode === "nosource" || updateMode === "unreachable" || updateMode === "releasepackage" ? "release" : "main",
    ...(quiet && updateMode !== "none" ? {} : { canSwitchChannel: true, source: "ssh://buildbox/srv/git/cutex-desktop.git" }),
    current: { commit: "c20812e".padEnd(40, "0"), committedAt: "2026-10-07T12:20:00+11:00" },
    latest: quiet ? null : { commit: "7422695".padEnd(40, "0"), committedAt: "2026-10-07T13:05:00+11:00", subject: "Settings → 通用: 文字对比度", count: 3 },
    checkedAt: new Date().toISOString(),
    // Old releases moved out of releases/ (?update=none: none left).
    ...(FRESH || updateMode === "none" ? {} : { oldReleases: { count: 18, bytes: 6.9e9, autoDeleteDays: 30, dir: "/home/sam/Applications/cutex-desktop/old-releases" } }),
  };
  // ?update=binary: a GitHub-release (binary) install, up to date: checks at most hourly (main/updater.ts).
  if (updateMode === "binary") update = { ...update, state: "idle", binary: true, channel: "release", canSwitchChannel: false, source: "github.com/example-org/cutex-desktop", latest: null, releasePage: "https://example.invalid/cutex-desktop/releases", current: { ...update.current!, version: "0.1.2" } };
  const setUpdate = (patch: Partial<UpdateStatus>) => {
    update = { ...update, ...patch };
    emit("updateStatus", structuredClone(update));
  };
  // client-remote-close: the countdown main would run (`?remoteclose`: host-a asks this desktop to close).
  const remoteCloseShell = mockRemoteCloseShell({ state: shellState, emitView: (view) => emit("remoteClose", { view }), emitHost: (method, params) => core.emitHost(method, params) });
  const bridge: PreloadBridge = {
    platform: MOCK_PLATFORM,
    // ?platform=darwin: the title bar keeps clear of the traffic lights (no real buttons in a browser).
    ...(MOCK_PLATFORM === "darwin" ? { window: { control: async () => {}, setChrome: async () => {}, nativeControls: "left" as const } } : {}),
    shell: {
      ...remoteCloseShell,
      async state() {
        return structuredClone(shellState);
      },
      async setCloseBehavior(value) {
        shellState.prefs.closeBehavior = value;
        return structuredClone(shellState);
      },
      async setLocale(value) {
        shellState.prefs.locale = value;
      },
      async setTerms(value) {
        shellState.prefs.terms = value;
      },
      async setAttention(count) {
        document.title = count > 0 ? `(${count}) Cutex` : "Cutex";
      },
      async logError(entry) {
        console.info("[mock error log]", entry);
      },
      async openLogs() {},
      async openQuickstart() {
        console.info("[mock] open docs/QUICKSTART.md");
      },
      async quit() {
        console.info("[mock] quit");
      },
      async rendererReady() {},
      async setUpdateProxy(value) {
        // Like main/shell.ts: the URL is kept without its login (hasCredentials says one was given), and
        // stays when switching to system / none.
        const old = shellState.prefs.updateProxy;
        const kept = old?.url ? { url: old.url, ...(old.hasCredentials ? { hasCredentials: true } : {}) } : null;
        if (value.mode === "manual") {
          const m = /^(?:([a-z0-9+.-]+):\/\/)?(?:([^@/]*)@)?([^/:@]+(?::\d+)?)\/?$/i.exec((value.url ?? old?.url ?? "").trim());
          if (!m || (m[1] && !/^(https?|socks5h?|socks4a?)$/i.test(m[1]))) throw new Error("invalid proxy URL (invalid)");
          const keep = !m[2] && shellState.prefs.updateProxy?.hasCredentials;
          shellState.prefs.updateProxy = { mode: "manual", url: `${(m[1] ?? "http").toLowerCase()}://${m[3]}`, ...(m[2] || keep ? { hasCredentials: true } : {}) };
        } else if (value.mode === "none") shellState.prefs.updateProxy = { mode: "none", ...kept };
        else if (kept) shellState.prefs.updateProxy = { mode: "system", ...kept };
        else delete shellState.prefs.updateProxy;
        return structuredClone(shellState);
      },
      async setUpdateCheckMinutes(value) {
        shellState.prefs.updateCheckMinutes = value;
        return structuredClone(shellState);
      },
    },
    launchArt: mockLaunchArt(),
    update: {
      async state() {
        return structuredClone(update);
      },
      async check() {
        setUpdate({ checkedAt: new Date().toISOString() });
        return structuredClone(update);
      },
      async apply() {
        const steps = ["pull", "install", "build", "package", "switch"] as const;
        steps.forEach((step, i) =>
          setTimeout(() => {
            if (updateMode === "fail" && step === "build") setUpdate({ state: "error", step, error: "apps/desktop build exited 1\nsrc/renderer/src/x.ts(1,1): error TS2304" });
            else if (update.state !== "error") setUpdate({ state: "updating", step });
          }, i * 1200),
        );
        setTimeout(() => update.state !== "error" && setUpdate({ state: "ready" }), steps.length * 1200);
        setTimeout(() => update.state === "ready" && setUpdate({ state: "idle", latest: null, current: { commit: update.latest?.commit ?? "", committedAt: update.latest?.committedAt ?? null } }), steps.length * 1200 + 2000);
        setUpdate({ state: "updating", step: "pull", error: undefined });
        return structuredClone(update);
      },
      async deleteOldReleases() {
        await new Promise((r) => setTimeout(r, 1200));
        setUpdate({ oldReleases: update.oldReleases ? { ...update.oldReleases, count: 0, bytes: 0 } : undefined });
        return structuredClone(update);
      },
      // 开发版 / 正式版: release has no branch yet (?update=release-published: it has, older than main).
      async setChannel(channel) {
        const published = updateMode === "release-published";
        if (channel === "release" && !published) setUpdate({ channel, state: "unsupported", code: "channelMissing", retryable: true, reason: "no branch release on the update source", latest: null });
        else if (channel === "release") setUpdate({ channel, state: "available", code: undefined, retryable: undefined, reason: undefined, latest: { commit: "5f1e2d3".padEnd(40, "0"), committedAt: "2026-10-05T09:00:00+11:00", subject: "Release 0.3", count: 0, switchChannel: true } });
        else setUpdate({ channel, state: "idle", code: undefined, retryable: undefined, reason: undefined, latest: null });
        return structuredClone(update);
      },
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as Listener);
      listeners.set(event, set);
      return () => set.delete(listener as Listener);
    },
    api: withModuleApis({
      async daemonState() {
        return mockDaemonOf(mockHosts.active);
      },
      async hosts() {
        return mockHostsOut();
      },
      async sshConfigHosts() {
        return ["workstation", "eva-01", "lab-gpu", "flaky"];
      },
      async addSshHost(request) {
        await new Promise((r) => setTimeout(r, 1200));
        const target = request.target.trim();
        if (!target) return { ok: false, error: { code: "badInput", detail: "target" } };
        if (target.includes("askpass")) {
          const host = target.replace(/^.*@/, "");
          const trust = await mockSshAsk(target, `The authenticity of host '${host} (192.0.2.10)' can't be established.\nED25519 key fingerprint is SHA256:Xq3M2b8u1mZ0eV7tq0n8yJm1lI0p9yX4cQm7a2Kc9sE.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `);
          if (trust !== "yes") return { ok: false, error: { code: "hostKey", detail: "Host key verification failed." } };
          const pass = await mockSshAsk(target, "Enter passphrase for key '/home/sam/.ssh/id_ed25519': ");
          if (pass === null) return { ok: false, error: { code: "auth", detail: `${target}: Permission denied (publickey).` } };
        }
        if (target.includes("nokey")) return { ok: false, error: { code: "auth", detail: `${target}: Permission denied (publickey).` } };
        if (target.includes("old")) return { ok: false, error: { code: "cutexTooOld", detail: "error: unrecognized subcommand 'client-token'\n\nUsage: cutex management <COMMAND>" } };
        if (target.includes("nosuch")) return { ok: false, error: { code: "resolve", detail: `ssh: Could not resolve hostname ${target}: No such host is known.` } };
        // "nocutex": not on PATH anywhere; "workstation": only a login shell finds it (discovery fills the path).
        if (target.includes("nocutex")) return { ok: false, error: { code: "cutexNotFound", detail: "bash: line 1: cutex: command not found", tried: ["cutex", "$SHELL -lc 'command -v cutex'", "bash -lc 'command -v cutex'", "~/Resources/Shortcuts/cutex", "~/.local/bin/cutex", "~/.cargo/bin/cutex"] } };
        const cutexPath = request.cutexPath?.trim() || (target.includes("workstation") ? "/home/sam/Resources/Shortcuts/cutex" : "cutex");
        const id = `ssh-${Math.random().toString(16).slice(2, 10)}`;
        const label = request.label?.trim() || target.replace(/^.*@/, "").replace(/:\d+$/, "");
        // Host ownership: "auto" keeps the member token when the host's confirmed owner is someone else.
        if (!LEGACY && (target.includes("ema@") || target.includes("shared"))) mockOwners[id] = MOCK_OTHER_OWNER;
        const mode = request.connectAs ?? "auto";
        const connectAs: SshConnectAs = mode !== "auto" ? mode : mockOwners[id] ? "member" : "owner";
        mockHosts = { ...mockHosts, hosts: [...mockHosts.hosts, { id, kind: "ssh", label, target, remotePort: request.remotePort ?? 24270, cutexPath, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[1 + (mockHosts.hosts.length % (HOST_PALETTE.length - 1))], platform: null, connectAs }] };
        emit("hostsState", mockHostsOut());
        // No local host (?fresh=nohost): the first host added becomes the shown one (main: reachableScope).
        if (!mockHosts.hosts.some((h) => h.id === "local") && mockHosts.hosts.length === 1) mockActivate(id);
        console.info("[mock] ssh", target, `${cutexPath} management client-token issue --label desktop-HOST-A${connectAs === "member" ? " --pending" : ""}`);
        return { ok: true, hostId: id, cutexPath, connectAs, ...(connectAs === "member" ? { pending: true, userId: null } : {}), ...(mode === "auto" ? { autoReason: mockOwners[id] ? "ownerIsSomeoneElse" : "noCapability" } : {}) };
      },
      async setSshConnectAs(hostId, mode) {
        await new Promise((r) => setTimeout(r, 800));
        const host = mockHosts.hosts.find((h) => h.id === hostId && h.kind === "ssh");
        if (!host || (mode !== "owner" && mode !== "member")) return { ok: false, error: { code: "badInput", detail: host ? "connectAs" : "host" } };
        console.info("[mock] ssh", host.target, `cutex management client-token issue --label desktop-HOST-A${mode === "member" ? " --pending" : ""}; revoke the old token`);
        mockHosts = { ...mockHosts, hosts: mockHosts.hosts.map((h) => (h.id === hostId ? { ...h, connectAs: mode } : h)) };
        if (mockHosts.active === hostId) mockActivate(hostId, true);
        else emit("hostsState", mockHostsOut());
        return { ok: true, hostId, connectAs: mode, ...(mode === "member" ? { pending: true, userId: null } : {}) };
      },
      async pairSshHost(hostId) {
        await new Promise((r) => setTimeout(r, 800));
        mockHosts = { ...mockHosts, hosts: mockHosts.hosts.map((h) => (h.id === hostId ? { ...h, paired: true } : h)) };
        if (mockHosts.active === hostId) mockActivate(hostId, true);
        else emit("hostsState", mockHostsOut());
        return { ok: true, hostId, connectAs: mockHosts.hosts.find((h) => h.id === hostId)?.connectAs ?? "owner" };
      },
      async updateSshHost(hostId, patch) {
        mockHosts = { ...mockHosts, hosts: mockHosts.hosts.map((h) => (h.id === hostId ? { ...h, ...(patch.label !== undefined ? { label: patch.label.trim() || h.label } : {}), ...(patch.remotePort !== undefined ? { remotePort: patch.remotePort } : {}), ...(patch.cutexPath !== undefined ? { cutexPath: patch.cutexPath.trim() || "cutex" } : {}) } : h)) };
        emit("hostsState", mockHostsOut());
        return { ok: true, hostId };
      },
      async removeSshHost(hostId) {
        mockClose(hostId);
        mockHosts = { ...mockHosts, hosts: mockHosts.hosts.filter((h) => h.id !== hostId), groups: mockHosts.groups.map((g) => ({ ...g, hosts: g.hosts.filter((id) => id !== hostId) })) };
        // ★ RFC Q20 (shared scopeAfterRemoval, as main): the removed scope host → all devices.
        const scope = scopeAfterRemoval(mockHosts.scope, { hosts: mockHosts.hosts.filter((h) => h.kind !== "local").map((h) => h.id), groups: mockHosts.groups });
        if (scope !== mockHosts.scope || mockHosts.active === hostId) mockSetScope(scope);
        else emit("hostsState", mockHostsOut());
        await new Promise((r) => setTimeout(r, 600));
        return { revoked: true };
      },
      async switchHost(hostId) {
        mockActivate(hostId);
      },
      async setScope(scope) {
        mockSetScope(scope.kind === "all" ? { kind: "all" } : { kind: scope.kind, id: scope.id });
      },
      async reconnectHost(hostId) {
        const id = hostId ?? mockHosts.active;
        // No host at all (?fresh=nohost): nothing to reconnect (main: HostManager.reconnectHost).
        if (hostId === undefined && !mockHosts.hosts.some((h) => h.id === id)) return;
        if (id === mockHosts.active) return mockActivate(id, true);
        mockClose(id);
        mockConnect(id);
      },
      async connectHost(hostId, on) {
        if (on === !!mockConn(hostId)?.epoch) return;
        if (on) return mockConnect(hostId);
        mockClose(hostId);
        emit("hostsState", mockHostsOut());
      },
      async setHostAutoConnect(hostId, on) {
        patchMockHost(hostId, () => ({ autoConnect: on }));
        if (on && !mockConn(hostId)?.epoch) mockConnect(hostId);
        else if (!on && mockConn(hostId)?.epoch && hostId !== mockHosts.active && !scopeHosts(mockHosts).includes(hostId)) mockClose(hostId);
        emit("hostsState", mockHostsOut());
        return mockHostsOut();
      },
      async setHostAppearance(hostId, patch) {
        if (patch.color) patchMockHost(hostId, () => ({ color: patch.color!.toLowerCase() }));
        emit("hostsState", mockHostsOut());
        return mockHostsOut();
      },
      async saveHostGroups(drafts) {
        const r = normalizeHostGroups(drafts, (id) => mockHosts.hosts.some((h) => h.id === id), () => `grp-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`);
        if (!r.ok) throw new Error(`bad groups: ${r.error}`);
        mockHosts = { ...mockHosts, groups: r.groups };
        // As main: a group scope that lost its group / members falls back; membership changes reconnect.
        mockSetScope(scopeAfterRemoval(mockHosts.scope, { hosts: mockHosts.hosts.filter((h) => h.kind !== "local").map((h) => h.id), groups: r.groups }));
        return mockHostsOut();
      },
      // profile-transfer (main → main in the app): the mock profiles are shared by every mock host, so the
      // copy lands in the same list under its new name; warnings as cutex answers them.
      async copyProfileToHost(request) {
        await new Promise((r) => setTimeout(r, 900));
        const src = mockProfiles[request.profile];
        if (!src) return { ok: false, stage: "export", error: { code: "profile_not_found", message: `no profile ${request.profile}` } };
        if (mockProfiles[request.name]) return { ok: false, stage: "import", error: { code: "profile_name_conflict", status: 409, message: `a profile named ${request.name} already exists` } };
        const claude = src.cliKind === "claude";
        const keyCopied = !claude && src.authKind === "apiKey" && src.apiKeyPresent && request.includeApiKey;
        mockProfiles[request.name] = { ...structuredClone(src), name: request.name, apiKeyPresent: keyCopied };
        if (src.authKind === "chatgpt") mockLoggedOut.add(request.name);
        const warnings: ProfileTransferWarning[] = claude
          ? [{ code: "claudeAccountRebound", matched: false, account: "default", accountLabel: null, sourceLabel: "work", loggedIn: true }]
          : src.authKind === "chatgpt" ? [{ code: "needsLogin", credential: "chatgpt" }]
          : keyCopied ? [] : [{ code: "needsLogin", credential: "apiKey" }];
        console.info("[mock] profile-transfer", request.sourceHostId, "→", request.targetHostId, request.profile, "as", request.name);
        return { ok: true, profile: { id: `mock-${request.name}`, name: request.name }, credentialKind: claude ? "claude" : src.authKind, credentialsCopied: keyCopied, warnings };
      },
      async testHost(hostId) {
        await new Promise((r) => setTimeout(r, 700));
        const host = mockHosts.hosts.find((h) => h.id === hostId);
        if (!host) return { ok: false, error: { code: "badInput", detail: "host" } };
        if (host.kind === "local") return { ok: true, cutexBuild: MOCK_CUTEX_BUILD, hostId: "HOST-A", missing: [] };
        return { ok: true, cutexBuild: OLD_REMOTE ? null : MOCK_CUTEX_BUILD, hostId: host.label.toUpperCase(), missing: OLD_REMOTE ? ["session-attachments", "fs-dir-browse"] : [] };
      },
      async sshPrompts() {
        return mockSshPrompts;
      },
      async answerSshPrompt(id, answer) {
        const waiter = mockSshWaiters.get(id);
        mockSshWaiters.delete(id);
        mockSshPrompts = mockSshPrompts.filter((p) => p.id !== id);
        emit("sshPrompts", { prompts: mockSshPrompts });
        waiter?.(answer);
        return !!waiter;
      },
      async setHostStartOn(value) {
        mockHosts = { ...mockHosts, startOn: value };
        emit("hostsState", mockHostsOut());
        return mockHostsOut();
      },
      async hostOwner() {
        return mockOwnerOf(mockHosts.active);
      },
      async setOwnerPerson(publicKey) {
        return mockSetOwner(mockHosts.active, publicKey);
      },
      async clearOwnerPerson() {
        return mockSetOwner(mockHosts.active, null);
      },
      async browseDirs(path) {
        await new Promise((r) => setTimeout(r, 150));
        if (OLD_REMOTE) return null;
        return mockBrowse(path);
      },
      async sidebar() {
        return mockRemote() ? remoteSnapshot() : moduleSidebar({ ...snapshot, retired: snapshot.retired.map(retiredProjection) });
      },
      async bootstrap(id, turnLimit) {
        // Like cutex: bootstrap only knows active sessions (archived ones read GET /history).
        if (snapshot.retired.some((s) => s.cutexSessionId === id)) throw new Error("session_not_found: the owner-visible cutex session does not exist on this host");
        return bootstrap(id, turnLimit);
      },
      async history(id, cursor, limit = 20) {
        // An archived session: the stored thread from the offline reader (first page too).
        if (!cursor && !LEGACY && snapshot.retired.some((s) => s.cutexSessionId === id)) {
          const { thread, page } = mockPage(mockThread(id), limit, null);
          return { contractVersion: 2, cutexSessionId: id, threadId: thread.id, source: "offline", native: { method: "thread/read", result: { thread } }, page, cutexState: { latestPlan: null, latestTokenUsage: null } };
        }
        if (LEGACY || id === "rei") return null;
        // No cursor on a live thread: its newest page (a reference card / jump looking up an agent not opened yet).
        if (!cursor) {
          const { thread, page } = mockPage(mockThread(id), limit, null);
          return { contractVersion: 2, cutexSessionId: id, threadId: thread.id, source: "live", native: { method: "thread/read", result: { thread } }, page };
        }
        // Older pages of a live thread (history-pages); with `?olderFail` each page fails once (then retry works).
        await new Promise((r) => setTimeout(r, 700));
        if (OLDER_FAIL && !failedOnce.has(cursor)) {
          failedOnce.add(cursor);
          throw new Error("mock: history page timed out");
        }
        const { thread, page } = mockPage(mockThread(id), limit, cursor);
        return { contractVersion: 2, cutexSessionId: id, threadId: thread.id, source: "live", native: { method: "thread/read", result: { thread } }, page };
      },
      async subscribe(sessionId) {
        mockViewHosts.delete(sessionId);
        setTimeout(() => emit("sessionStatus", { sessionId, status: "live" }), 50);
        if (sessionId === "eva" && LEGACY)
          setTimeout(
            () =>
              emitCutex("eva", "cutex/agentBus/messageSent", {
                messageId: "m-demo",
                fromCutexSessionId: "eva",
                toCutexSessionId: "mika",
                deliveryMode: "after_turn",
                content: "flush 现在需要带 expectedRevision 了，你那边 queue 面板的「立即发送」也要传当前 revision，否则会被拒绝。改完跑一下 queue 的测试再告诉我。",
              }),
            600,
          );
        // Agent messages v2: a note to Mika (未读 → 已读入 after 5 s), a note to Rei that fails, and
        // Mika's pending note to Eva read into Eva's running turn after 9 s (leaves 待读留言).
        if (sessionId === "eva" && !LEGACY && !evaDemoPlayed) {
          evaDemoPlayed = true;
          const toMika: MockInboxMessage = { messageId: "m-demo", from: "eva", fromName: "Eva", to: "mika", kind: "note", body: "flush 现在需要带 expectedRevision 了，你那边 queue 面板的「立即发送」也要传当前 revision，否则会被拒绝。", queuedAt: new Date().toISOString() };
          const toRei: MockInboxMessage = { messageId: "m-demo-rei", from: "eva", fromName: "Eva", to: "rei", kind: "note", body: "迁移脚本的日志我挪到 logs/archive 了。", queuedAt: new Date().toISOString() };
          setTimeout(() => {
            // Shown in Eva's running turn (the sent row needs an active turn).
            mockSend(toMika, "Mika");
            mockSend(toRei, "Rei");
          }, 600);
          setTimeout(() => emitBus(["eva", "rei"], "cutex/agentBus/messageFailed", { messageId: "m-demo-rei", fromCutexSessionId: "eva", toCutexSessionId: "rei", error: { code: "recipient_quarantined", message: "Rei 的 runtime 已停用，消息被隔离（mock）" }, failedAt: new Date().toISOString() }), 3000);
          setTimeout(() => mockDelivered(toMika, "turn-mika-live"), 5600);
          setTimeout(() => readInbox("eva", "turn-4"), 9000);
        }
        setTimeout(() => {
          // scratch: like a real runtime after reopening, no token report until the next reply
          // (its ring comes from bootstrap cutexState.latestTokenUsage).
          const used = { eva: 331_000, alden: 120_500, mika: 58_000 }[sessionId] ?? 12_000;
          if (sessionId !== "scratch") nativeEvent(sessionId, "thread/tokenUsage/updated", { tokenUsage: { last: { inputTokens: used }, modelContextWindow: 400_000 } });
          const limits = MOCK_LIMITS[profileOf(sessionId)];
          if (limits) nativeEvent(sessionId, "account/rateLimits/updated", { rateLimits: limits });
        }, 80);
      },
      async unsubscribe() {},
      async submit(sessionId, text, strategy, _startIfOffline, options) {
        emptyChats.delete(sessionId);
        // A message that is only queued (busy, strategy queue) releases no stop hold.
        if (!(asksPauses.get(sessionId)?.stopHold && busy.has(sessionId) && strategy === "queue")) setAsksPause(sessionId, false, "ownerMessage");
        quotaCancel(sessionId, "ownerMessage");
        const extra = options?.extra ?? [];
        if (busy.has(sessionId) && strategy === "interrupt") {
          // cutex interrupts and starts this turn under one lock: the queue does not flush in between.
          stopNativeTurn(sessionId);
          busy.add(sessionId);
          void playTurn(sessionId, text, extra, options?.clientUserMessageId);
          return { disposition: "started", turnId: currentTurn.get(sessionId) ?? null };
        }
        if (busy.has(sessionId) && strategy === "auto") {
          const turnId = currentTurn.get(sessionId) ?? null;
          setTimeout(() => {
            if (turnId && currentTurn.get(sessionId) === turnId) nativeEvent(sessionId, "item/completed", { turnId, item: { type: "userMessage", id: `steer-${++seq}`, ...(options?.clientUserMessageId ? { clientId: options.clientUserMessageId } : {}), content: [{ type: "text", text }, ...extra] } });
          }, INSERT_DEMO_MS[sessionId] ?? 3500);
          return { disposition: "steered", turnId };
        }
        if (busy.has(sessionId) && strategy === "queue") {
          const queue = queues.get(sessionId) ?? [];
          const item: QueueItem = {
            queueId: `q${++seq}`, clientUserMessageId: options?.clientUserMessageId ?? `cu${seq}`, origin: { kind: "other", clientId: "mock" },
            input: [{ type: "text", text, text_elements: [] }], position: queue.length, revision: 1, state: "queued",
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          queues.set(sessionId, [...queue, item]);
          emitCutex(sessionId, "cutex/userInput/queued", { queueId: item.queueId });
          return { disposition: "queued", turnId: null, queue: item };
        }
        if (busy.has(sessionId)) return { disposition: "steered", turnId: null };
        busy.add(sessionId);
        // A fresh quick chat is named after the native thread title once the first turn runs.
        const fresh = snapshot.active.find((x) => x.cutexSessionId === sessionId && x.registrationClass === "local_only" && !x.displayNameOverride && /^(新聊天|New chat)$/.test(x.displayName));
        if (fresh && text.trim()) {
          setTimeout(() => {
            const title = text.trim().split("\n")[0]!.slice(0, 24);
            Object.assign(fresh, { displayName: title, threadName: title, revision: fresh.revision + 1 });
            snapshot = { ...snapshot };
            nativeEvent(sessionId, "thread/name/updated", { threadId: `thread-${sessionId}`, threadName: title });
          }, 1200);
        }
        void playTurn(sessionId, text, extra, options?.clientUserMessageId);
        return { disposition: "started", turnId: currentTurn.get(sessionId) ?? null };
      },
      async queueList(sessionId) {
        const pause = pauses.get(sessionId) ?? null;
        const items = (queues.get(sessionId) ?? []).map((q, i) => ({ ...q, position: i }));
        return { revision: seq, items, paused: !!pause, pause, asksPaused: asksPauses.get(sessionId) ?? null, ...(LEGACY ? {} : { admission: admissionOf(sessionId) }) };
      },
      // admission-order: errors as main words cutex's refusals (shared/queueMove).
      async queueMove(sessionId, queueId, expectedRevision, before) {
        const entries = admissionEntries(sessionId);
        if (admissionRevision(entries) !== expectedRevision) throw new Error("queue_move_refused:conflict");
        const from = entries.findIndex((e) => e.kind === "owner" && e.id === queueId);
        const rest = entries.filter((_, i) => i !== from);
        const slot = before ? rest.findIndex((e) => e.kind === before.kind && e.id === before.id) : rest.length;
        if (from < 0 || slot < 0) throw new Error("queue_move_refused:gone");
        const mayPass = (mockSettings as { queue?: { ownerMayPassAsks?: boolean } }).queue?.ownerMayPassAsks ?? true;
        if (!mayPass && slot < from && rest.slice(slot, from).some((e) => e.kind !== "owner")) throw new Error("queue_move_refused:passingNotAllowed");
        const prev = rest[slot - 1]?.key;
        const next = rest[slot]?.key;
        const key = prev === undefined ? (next ?? Date.now()) - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2;
        ownerKeys.set(`${sessionId}|${queueId}`, key);
        const queue = queues.get(sessionId) ?? [];
        queues.set(sessionId, [...queue].sort((a, b) => ownerKey(sessionId, a) - ownerKey(sessionId, b)));
        const admission = admissionOf(sessionId);
        emitCutex(sessionId, "cutex/userInput/queueReordered", { admission: { revision: admission.revision } });
        return { revision: admission.revision, admission };
      },
      async queueYield(sessionId) {
        ownerYields.add(sessionId);
        const admission = admissionOf(sessionId);
        emitCutex(sessionId, "cutex/userInput/queueReordered", { admission: { revision: admission.revision } });
        return { admission };
      },
      async queueUpdate() {},
      async queueRemove(sessionId, queueId) {
        const rest = (queues.get(sessionId) ?? []).filter((q) => q.queueId !== queueId);
        queues.set(sessionId, rest);
        if (rest.length === 0) pauses.delete(sessionId);
        emitCutex(sessionId, "cutex/userInput/queueRemoved", { queueId });
      },
      async stopTurn(sessionId) {
        const items = queues.get(sessionId) ?? [];
        const already = pauses.has(sessionId);
        const turnId = currentTurn.get(sessionId) ?? null;
        if (!already && items.length) {
          pauses.set(sessionId, { pausedAt: new Date().toISOString(), reason: "interrupted", turnId });
          emitCutex(sessionId, "cutex/userInput/queuePaused", { reason: "interrupted", turnId });
        }
        stopHoldOn(sessionId);
        stopNativeTurn(sessionId);
        flushQueue(sessionId); // paused: no-op (and an empty queue has nothing to send)
        const pause = pauses.get(sessionId) ?? null;
        return { revision: ++seq, paused: !!pause, pause, alreadyPaused: already, interruptedTurnId: turnId };
      },
      async queueResume(sessionId) {
        stopHoldOff(sessionId, "resumed");
        const resumed = pauses.delete(sessionId);
        if (resumed) emitCutex(sessionId, "cutex/userInput/queueResumed", { reason: "resumed" });
        const before = (queues.get(sessionId) ?? []).map((q) => q.queueId);
        if (!busy.has(sessionId)) flushQueue(sessionId);
        const after = new Set((queues.get(sessionId) ?? []).map((q) => q.queueId));
        return { revision: ++seq, paused: false as const, pause: null, resumed, affectedQueueIds: before.filter((q) => !after.has(q)) };
      },
      async asksPause(sessionId) {
        return setAsksPause(sessionId, true, "paused");
      },
      async asksResume(sessionId) {
        return setAsksPause(sessionId, false, "resumed");
      },
      async quotaAutoContinue(sessionId) {
        return LEGACY ? null : structuredClone(quotaViewOf(sessionId));
      },
      async setQuotaAutoContinue(sessionId, enabled) {
        const view = quotaViewOf(sessionId);
        if (view.enabled === enabled) return { ok: true as const, view: structuredClone(view) };
        const next: MockQuotaView = enabled ? { ...view, enabled } : { ...view, enabled, pending: null, last: view.pending ? { at: new Date().toISOString(), result: "cancelled", reason: "disabled", resetAt: view.pending.resetAt } : view.last };
        quotaViews.set(sessionId, next);
        emit("hostEvent", envelope("cutex.host", { source: "cutex", correlation: {}, cutex: { method: "cutex/quotaAutoContinue/changed", params: { cutexSessionId: sessionId, reason: enabled ? "enabled" : "disabled", quotaAutoContinue: structuredClone(next), hostId: "mock" } } }));
        return { ok: true as const, view: structuredClone(next) };
      },
      async cancelQuotaAutoContinue(sessionId) {
        return { ok: true as const, view: structuredClone(quotaCancel(sessionId, "owner") ?? quotaViewOf(sessionId)) };
      },
      // `steer` (queue-steer) behaves the same here: the mock has no ask lease or steer-less runtime.
      async queuePromote(sessionId, queueId) {
        const item = (queues.get(sessionId) ?? []).find((q) => q.queueId === queueId);
        if (!item) throw new Error("queue item changed or already sent");
        await this.queueRemove(sessionId, queueId, item.revision);
        const text = (item.input as { type: string; text?: string }[]).map((p) => p.text ?? "").join("\n");
        const result = await this.submit(sessionId, text, "auto", false, { clientUserMessageId: item.clientUserMessageId });
        return { result, clientUserMessageId: item.clientUserMessageId, input: item.input };
      },
      async interrupt(sessionId) {
        if (!stopNativeTurn(sessionId)) return;
        // Like cutex: a raw native interrupt keeps auto-flushing (only cutex/turn/stop pauses).
        flushQueue(sessionId);
      },
      async listModels(sessionId) {
        return MOCK_MODELS[profileOf(sessionId)] ?? [];
      },
      // session-sandbox-extras: network / extra writable roots of a workspace-write agent, pushed to the
      // live thread (thread/settings/updated) like cutex does.
      async sessionSandboxExtras(sessionId) {
        return mockSandboxExtras(sessionId);
      },
      async setSessionSandboxExtras(sessionId, patch) {
        const current = mockSandboxExtras(sessionId);
        if (!current.editable) throw new Error(current.reason === "unsupported_runtime" ? "Claude agents use their own write / command rules" : "network access and extra writable directories apply only to workspace-write");
        const roots = patch.writableRoots?.map((r) => r.replace(/[\\/]+$/, "") || r);
        if (roots?.some((r) => !/^(\/|[A-Za-z]:[\\/])/.test(r))) throw new Error("writableRoots entries must be absolute paths");
        if (roots?.some((r) => /[\\/]\.cutex([\\/]|$)/.test(r))) throw new Error("writable root is inside the cutex home");
        const profile = profileOf(sessionId);
        const policy = (MOCK_SETTINGS[profile]?.sandboxPolicy ?? {}) as Record<string, unknown>;
        const next = { ...policy, networkAccess: patch.networkAccess ?? current.networkAccess, writableRoots: roots ? [...new Set(roots)] : current.writableRoots };
        MOCK_SETTINGS[profile] = { ...MOCK_SETTINGS[profile], sandboxPolicy: next };
        setTimeout(() => nativeEvent(sessionId, "thread/settings/updated", { threadSettings: MOCK_SETTINGS[profile] }), 150);
        return { ...mockSandboxExtras(sessionId), changed: true, live: { status: "applied" as const } };
      },
      async claudePermissionRules(sessionId) {
        return mockClaudeRules(sessionId, snapshot.active.find((s) => s.cutexSessionId === sessionId)?.cwd ?? "");
      },
      async setClaudePermissionRules(sessionId, allow, expectedRevision) {
        return mockSetClaudeRules(sessionId, snapshot.active.find((s) => s.cutexSessionId === sessionId)?.cwd ?? "", allow, expectedRevision);
      },
      async updateThreadSettings(sessionId, _threadId, patch) {
        const profile = profileOf(sessionId);
        MOCK_SETTINGS[profile] = { ...MOCK_SETTINGS[profile], ...patch };
        nativeEvent(sessionId, "thread/settings/updated", { threadSettings: MOCK_SETTINGS[profile] });
      },
      async quotaConfig(profile) {
        const reader = (label: string, over: Record<string, unknown> = {}) => ({
          enabled: true, url: "", auth: "profile_api_key" as const, label, refresh_seconds: 60, mode: "remaining_and_limit" as const,
          value_pointer: "/rate_limits/0/remaining", limit_pointer: "/rate_limits/0/limit", reset_pointer: "/rate_limits/0/reset_at",
          reset_format: "rfc3339" as const, window_label: null, ...over,
        });
        if (LEGACY) {
          const noAuto = mockAutoQuotaError(profile);
          return {
            profile: { id: profile, name: profile },
            preset: profile === "gamma" ? "custom" : "auto",
            primary: reader(profile === "GLM" ? "GLM" : "Q", { enabled: profile !== "gamma", window_label: profile === "GLM" ? "5h" : null }),
            extras: profile === "GLM" ? [reader("GLM", { window_label: "7d", value_pointer: "/rate_limits/1/remaining", limit_pointer: "/rate_limits/1/limit", reset_pointer: "/rate_limits/1/reset_at" })] : [],
            resolvedPrimary: null,
            presetError: profile === "gamma" ? "No automatic quota preset for provider \"openai\"" : noAuto,
          };
        }
        // profile-generic-switches: an explicit reader per profile; "relay" keeps an unresolved legacy `auto`.
        const stored = (mockQuotaConfigs[profile] ??= {
          preset: MOCK_QUOTA_READERS[profile] ?? "custom",
          primary: reader(profile === "GLM" ? "GLM" : "Q", { enabled: profile !== "gamma", window_label: profile === "GLM" ? "5h" : null }),
          extras: profile === "GLM" ? [reader("GLM", { window_label: "7d", value_pointer: "/rate_limits/1/remaining", limit_pointer: "/rate_limits/1/limit", reset_pointer: "/rate_limits/1/reset_at" })] : [],
        });
        return {
          profile: { id: profile, name: profile },
          ...structuredClone(stored),
          presetOptions: ["custom", ...MOCK_READER_NAMES],
          resolvedPrimary: null,
          presetError: stored.preset === "auto" ? "the automatic quota preset was removed: choose a quota reader or a custom endpoint" : null,
        };
      },
      async putQuotaConfig(profile, patch) {
        const current = await this.quotaConfig(profile);
        if (LEGACY) return { ...current, ...patch } as typeof current;
        const preset = patch.preset ?? current.preset;
        if (preset !== "custom" && !MOCK_READER_NAMES.includes(preset)) throw new Error(`invalid_request: preset: expected custom or a quota reader (${preset})`);
        mockQuotaConfigs[profile] = { preset, primary: patch.primary ?? current.primary, extras: patch.extras ?? current.extras };
        return this.quotaConfig(profile);
      },
      async fsFile(_scope, path, maxBytes) {
        const moduleFile = MODULE_MOCKS.map(({ mock }) => mock.files?.read(path, maxBytes) ?? null).find((f) => f !== null);
        if (moduleFile) return moduleFile;
        const image = await mockImageFile(path);
        if (image) return image;
        const md = `# ${path.split("/").pop()}\n\n预览示例。代码引用：[daemon.ts](apps/desktop/src/main/daemon.ts:42)。\n\n| 项 | 说明 |\n|---|---|\n| scope | project / session |\n`;
        const ts = `// ${path}\nexport function hello(name: string): string {\n  return \`hi \${name}\`;\n}\n`;
        const content = path.endsWith(".md") ? md : path.endsWith(".json") ? `{\n  "name": "cutex-desktop",\n  "private": true\n}\n` : ts;
        return { path, size: content.length, modifiedAt: new Date().toISOString(), encoding: "utf8", content, truncated: false, mime: "text/plain" };
      },
      async hostFile(path, maxBytes) {
        // cutex fs-file-read: any absolute path on the active host (owner-only).
        await new Promise((r) => setTimeout(r, 120));
        if (/missing/i.test(path)) throw new Error("path_not_found: the path does not exist");
        const moduleFile = MODULE_MOCKS.map(({ mock }) => mock.files?.read(path, maxBytes) ?? null).find((f) => f !== null);
        if (moduleFile) return moduleFile;
        const owned = MODULE_MOCKS.map(({ mock }) => mock.hostFile?.(path) ?? null).find((text) => text !== null);
        if (owned != null) return { path, size: owned.length, modifiedAt: new Date().toISOString(), encoding: "utf8", content: owned, truncated: false, mime: "text/markdown" };
        const image = await mockImageFile(path);
        if (image) return image;
        const md = /\.md$/i.test(path);
        const observations = Array.from({ length: 30 }, (_, i) => `- 第 ${i + 1} 条观察：并发 flush 偶发重复投递。`).join("\n");
        const content = md
          ? `# Issue 42: queue flush 重复投递\n\n来源：\`${path}\`\n\n## 现象\n\n${observations}\n\n## 复现\n\n1. 两个客户端同时 flush\n2. 观察 revision\n`
          : Array.from({ length: 60 }, (_, i) => `2026-10-08T03:${String(i).padStart(2, "0")}:00Z INFO queue flush revision=${100 + i}`).join("\n") + "\n";
        return { path, size: content.length, modifiedAt: new Date().toISOString(), encoding: "utf8", content, truncated: false, mime: md ? "text/markdown" : "text/plain" };
      },
      async fsSearch(_scope, q) {
        const all = ["AGENTS.md", "PLAN.md", "docs/DESIGN.md", "docs/research/zcode-ui.md", "apps/desktop/src/main/daemon.ts", "apps/desktop/src/main/index.ts"];
        return { query: q, results: all.filter((p) => p.toLowerCase().includes(q.toLowerCase())).map((path) => ({ path, score: 1 })) };
      },
      async gitStatus() {
        broadRootRefusal();
        return {
          isRepo: true, branch: "main", upstream: null, ahead: 0, behind: 0, head: { sha: "6b1d8bd0", subject: "Usage page" },
          files: [
            { path: "apps/desktop/src/main/daemon.ts", origPath: null, status: "modified", staged: false, added: 31, deleted: 2 },
            { path: "docs/DESIGN.md", origPath: null, status: "modified", staged: false, added: 12, deleted: 1 },
            { path: "apps/desktop/src/renderer/src/components/SidePane.tsx", origPath: null, status: "untracked", staged: false, added: 240, deleted: 0 },
          ],
        };
      },
      async gitDiff(_scope, path) {
        return { path: path ?? null, staged: false, truncated: false, diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,4 @@\n import x from "y";\n-const a = 1;\n+const a = 2;\n+const b = 3;\n export { a };\n` };
      },
      async profileAccount(profile) {
        if (mockProfiles[profile]?.cliKind === "claude") return null;
        if (profile === "gamma" && !mockAccounts.has(profile) && !mockLoggedOut.has(profile)) {
          return { account: { loggedIn: true, authMode: "chatgpt", email: "owner@example.com", planType: "pro", lastRefresh: null, authFilePresent: true }, supportedLoginTypes: ["chatgpt", "apiKey"], activeLogin: null };
        }
        return mockAccounts.get(profile) ?? { account: { loggedIn: false, authMode: "none", email: null, planType: null, lastRefresh: null, authFilePresent: false }, supportedLoginTypes: ["chatgpt", "apiKey"], activeLogin: null };
      },
      async profileLogin(profile, request) {
        const login = { loginId: "login-" + Date.now(), profileId: profile, type: request.type, status: request.type === "apiKey" ? "succeeded" : "pending", error: null, warning: null, authUrl: request.type === "chatgpt" ? "https://auth.openai.com/oauth/authorize?mock=1" : null, startedAt: new Date().toISOString() } as import("../../../shared/ipc").ProfileLogin;
        mockLogins.set(login.loginId, { login, polls: 0 });
        if (request.type === "apiKey") mockAccounts.set(profile, { account: { loggedIn: true, authMode: "apiKey", email: null, planType: null, lastRefresh: null, authFilePresent: true }, supportedLoginTypes: ["chatgpt", "apiKey"], activeLogin: null });
        return login;
      },
      async profileLoginStatus(profile, loginId) {
        const entry = mockLogins.get(loginId)!;
        if (entry.login.status === "pending" && ++entry.polls >= 3) {
          entry.login = { ...entry.login, status: "succeeded", authUrl: null, finishedAt: new Date().toISOString() };
          mockAccounts.set(profile, { account: { loggedIn: true, authMode: "chatgpt", email: "owner@example.com", planType: "pro", lastRefresh: null, authFilePresent: true }, supportedLoginTypes: ["chatgpt", "apiKey"], activeLogin: null });
        }
        return entry.login;
      },
      async profileLoginCancel(_profile, loginId) {
        const entry = mockLogins.get(loginId)!;
        entry.login = { ...entry.login, status: "canceled", authUrl: null };
        return entry.login;
      },
      async profileLogout(profile) {
        mockAccounts.delete(profile);
        mockLoggedOut.add(profile);
        return { account: { loggedIn: false, authMode: "none", email: null, planType: null, lastRefresh: null, authFilePresent: false }, supportedLoginTypes: ["chatgpt", "apiKey"], activeLogin: null };
      },
      async notificationLevel(threadId) {
        return mockNotify.get(threadId) ?? "normal";
      },
      async setNotificationLevel(threadId, level) {
        mockNotify.set(threadId, level);
        return level;
      },
      async createHumanSession(request) {
        if (LEGACY) throw new Error("404 not_found: POST /v2/human/sessions");
        // Like cutex: the native starts first (a few seconds), and the name is a placeholder until titled.
        await new Promise((r) => setTimeout(r, 2500));
        const id = `chat-${Date.now().toString(36)}`;
        const chat = quickChat(id, request.displayName ?? `Session ${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`, 0);
        const perms = { ...mockThreadDefaults.quickChat, ...request.launch };
        const sandboxType = perms.sandbox === "read-only" ? "readOnly" : perms.sandbox === "workspace-write" ? "workspaceWrite" : "dangerFullAccess";
        // The draft's profile / model / effort (new-chat page) carry over like cutex does.
        const profile = request.profile ?? chat.profile ?? "omega";
        const base = { ...QUICK_CHAT_SETTINGS, ...(MOCK_SETTINGS[profile] ? { model: MOCK_SETTINGS[profile].model, modelProvider: MOCK_SETTINGS[profile].modelProvider, effort: MOCK_SETTINGS[profile].effort } : {}) };
        const model = request.launch?.model ? { model: request.launch.model } : {};
        const effort = request.launch?.reasoningEffort ? { effort: request.launch.reasoningEffort } : {};
        chat.profile = profile;
        chat.runtime = { ...chat.runtime, status: request.start ? "online" : "offline", threadSettings: { ...base, ...model, ...effort, approvalPolicy: perms.approvalPolicy, approvalsReviewer: perms.approvalsReviewer ?? "user", sandboxPolicy: { type: sandboxType, writableRoots: perms.writableRoots, networkAccess: perms.networkAccess } } };
        chat.displayNameOverride = request.displayName ?? null;
        snapshot = { ...snapshot, active: [...snapshot.active, chat], hostRows: { ...snapshot.hostRows, [id]: { ...hostRow(id, null), kind: "Session" } } };
        emptyChats.add(id);
        console.info("[mock] POST /v2/human/sessions", request);
        return { cutexSessionId: id };
      },
      async patchNewThreadDefaults(patch) {
        if (LEGACY) throw new Error("400 invalid_request: unsupported field newThreadDefaults");
        for (const kind of THREAD_KINDS) {
          if (!(kind in patch)) continue;
          const fields = patch[kind];
          if (!fields) {
            mockThreadDefaults[kind] = clonePerms(MOCK_BUILTIN_THREAD_DEFAULTS[kind]);
            continue;
          }
          const target = mockThreadDefaults[kind] as unknown as Record<string, unknown>;
          for (const f of LAUNCH_FIELDS) {
            if (!(f in fields)) continue;
            const v = fields[f];
            target[f] = v === null ? structuredClone(MOCK_BUILTIN_THREAD_DEFAULTS[kind][f]) : v;
          }
        }
        return { ...settingsView(), restartRequired: [] };
      },
      async createAgent(request) {
        if (request.launch) console.info("[mock] POST /v2/human/agents launch", request.launch);
        // cutex before human-agent-claude (?legacy) refuses Claude profiles here.
        const requested = request.profile ?? mockSettings.defaultProfile;
        if (LEGACY && requested && mockProfiles[requested]?.cliKind === "claude") throw new Error("unsupported_profile: Claude subscription profiles are not supported by this creator");
        const id = request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const base = snapshot.active[0]!;
        snapshot = { ...snapshot, active: [...snapshot.active, { ...base, cutexSessionId: id, displayName: request.name, avatar: null, runtime: { ...base.runtime, status: request.start ? "online" : "offline", activeTurnId: null } }], hostRows: { ...snapshot.hostRows, [id]: { ...snapshot.hostRows[base.cutexSessionId]!, projectId: request.projectId ?? null } } };
        return { cutexSessionId: id };
      },
      async listProfiles() {
        return { defaultProfile: mockSettings.defaultProfile, profiles: Object.values(mockProfiles).map((p) => mockProfileItem(p.name)) };
      },
      async getProfile(name) {
        return mockProfileDetail(name);
      },
      async profileImage(profileId, kind) {
        if (LEGACY) return null;
        const image = kind === "avatar" ? mockLooks[profileId]?.avatar : mockLooks[profileId]?.intro;
        return image ? { dataUrl: image.dataUrl, etag: image.etag } : null;
      },
      async putProfileImage(profileId, kind, dataUrl) {
        if (LEGACY || !mockProfiles[profileId]) throw new Error("profile_not_found: no such profile");
        const looks = (mockLooks[profileId] ??= {});
        const image = dataUrl ? { dataUrl, etag: mockEtag(dataUrl) } : undefined;
        if (kind === "avatar") looks.avatar = image;
        else looks.intro = image;
        console.info(`[mock] ${dataUrl ? "PUT" : "DELETE"} /v2/profiles/${profileId}/${kind}`);
        return { etag: image?.etag ?? null };
      },
      async patchProfile(name, rawPatch) {
        const p = mockProfiles[name]!;
        const { avatarThemes, introGreeting, ...patch } = rawPatch;
        if (avatarThemes !== undefined || introGreeting !== undefined) {
          if (LEGACY) throw new Error("invalid_request: unsupported field avatarThemes");
          const looks = (mockLooks[name] ??= {});
          if (avatarThemes !== undefined) {
            if (avatarThemes !== null && (!avatarThemes.length || new Set(avatarThemes).size !== avatarThemes.length || avatarThemes.some((t) => !MOCK_AVATAR_THEMES.includes(t)))) throw new Error("invalid_request: avatarThemes: must list unique known themes");
            looks.avatarThemes = avatarThemes ? MOCK_AVATAR_THEMES.filter((t) => avatarThemes.includes(t)) : undefined;
          }
          if (introGreeting !== undefined) looks.introGreeting = introGreeting?.trim() || undefined;
        }
        const { apiKey, color, allowSessionSwitch, nativeSubagents, delegationWait, agentUseRequiresApproval, agentTurnQuestions, planLabel, claudeAllowWrite, claudeAllowExec, claudeFileCheckpointing, modelDisplayNames, searchTool, privateChatgptAuthFile, toolSchemaCompat, ...cfg } = moduleProfilePatch(mockProfileRef(name), patch);
        if (modelDisplayNames) {
          if (LEGACY) throw new Error("invalid_request: unknown field modelDisplayNames");
          const names = { ...(p.modelNames ?? {}) };
          for (const [id, value] of Object.entries(modelDisplayNames)) {
            const v = value?.trim().replace(/s+/g, " ") ?? "";
            if ([...v].length > 80) throw new Error(`invalid_request: modelDisplayNames[${id}]: at most 80 characters`);
            if (v && v !== id) names[id] = v;
            else delete names[id];
          }
          p.modelNames = names;
        }
        if (claudeAllowWrite !== undefined) p.claudeWrite = claudeAllowWrite;
        if (claudeAllowExec !== undefined) p.claudeExec = claudeAllowExec;
        if (claudeFileCheckpointing !== undefined) {
          if (p.cliKind !== "claude") throw new Error("invalid_request: claudeFileCheckpointing applies to Claude profiles only");
          p.claudeCheckpoints = claudeFileCheckpointing;
        }
        if (planLabel !== undefined) {
          if (planLabel !== null && (!planLabel.trim() || [...planLabel.trim()].length > 40)) throw new Error("invalid_request: planLabel: must be 1-40 visible characters");
          p.planLabel = planLabel?.trim() ?? null;
        }
        if (nativeSubagents !== undefined) {
          if (p.cliKind === "claude") throw new Error("invalid_request: nativeSubagents is not supported on Claude profiles");
          p.nativeSubagents = nativeSubagents;
        }
        if (agentUseRequiresApproval !== undefined) p.agentApproval = agentUseRequiresApproval;
        if (delegationWait !== undefined) p.delegationWait = delegationWait;
        if (searchTool !== undefined) {
          if (searchTool && (p.cliKind === "claude" || p.authKind !== "apiKey")) throw new Error("invalid_request: searchTool applies to Codex API-key profiles only");
          p.searchTool = searchTool;
        }
        if (toolSchemaCompat !== undefined) {
          if (LEGACY) throw new Error("invalid_request: unknown field toolSchemaCompat");
          if (toolSchemaCompat !== null && toolSchemaCompat !== "off" && toolSchemaCompat !== "strict") throw new Error("invalid_request: toolSchemaCompat must be off, strict or null");
          if (p.cliKind === "claude") throw new Error("invalid_request: toolSchemaCompat applies to Codex profiles only");
          p.toolSchemaCompat = toolSchemaCompat === "strict" ? "strict" : null;
        }
        if (privateChatgptAuthFile !== undefined) {
          if (LEGACY) throw new Error("invalid_request: unknown field privateChatgptAuthFile");
          if (typeof privateChatgptAuthFile !== "boolean") throw new Error("invalid_request: privateChatgptAuthFile must be a boolean");
          if (p.cliKind === "claude") throw new Error("invalid_request: privateChatgptAuthFile applies to Codex profiles only");
          p.privateAuthFile = privateChatgptAuthFile;
        }
        if (agentTurnQuestions !== undefined) p.turnQuestions = agentTurnQuestions;
        if (p.cliKind === "claude" && Object.keys(cfg).length) {
          // claude-profile-default-model: model / modelReasoningEffort only (older cutex: none).
          const other = Object.keys(cfg).filter((k) => LEGACY || (k !== "model" && k !== "modelReasoningEffort"));
          if (other.length) throw new Error("invalid_request: Codex model settings are unavailable for a Claude profile");
          if (cfg.model !== undefined && cfg.model !== null && (!cfg.model.trim() || /\s/.test(cfg.model.trim()))) throw new Error("invalid_request: model: a Claude model id or alias (1-200 characters, no spaces)");
          // null = back to the built-in default (sonnet) / the model's own effort.
          for (const key of ["model", "modelReasoningEffort"] as const) {
            if (cfg[key] !== null) continue;
            delete cfg[key];
            delete p.config[key];
          }
        }
        if (apiKey) p.apiKeyPresent = true;
        if (color !== undefined) p.color = color;
        if (allowSessionSwitch !== undefined) p.allowSwitch = allowSessionSwitch;
        Object.assign(p.config, cfg);
        return mockProfileDetail(name);
      },
      async profileModels(name) {
        return mockModelsView(name);
      },
      async discoverModels(name) {
        return mockModelsView(name);
      },
      async patchModel(name, modelId, patch) {
        const list = mockProfiles[name]!.models;
        const existing = list.find((m) => m.id === modelId);
        if (patch.requestModel && (LEGACY || mockProfiles[name]!.cliKind === "claude")) throw new Error("Model configurations are not supported");
        const source = patch.requestModel ? list.find((m) => m.id === patch.requestModel && !m.requestModel) : null;
        if (patch.requestModel && !source) throw new Error("Base model not found");
        if (existing) Object.assign(existing, patch);
        else list.push({ displayName: null, contextWindow: null, maxContextWindow: null, autoCompactTokenLimit: null, inputModalities: ["text"], supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium", ...structuredClone(source), ...patch, id: modelId });
        return mockModelsView(name);
      },
      async deleteModel(name, modelId) {
        mockProfiles[name]!.models = mockProfiles[name]!.models.filter((m) => m.id !== modelId);
        mockProfiles[name]!.unavailable = mockProfiles[name]!.unavailable?.filter((m) => m.id !== modelId);
        return mockModelsView(name);
      },
      async resetModel(name, modelId) {
        const list = mockProfiles[name]!.models;
        const row = list.find((m) => m.id === modelId);
        const base = row?.requestModel ? list.find((m) => m.id === row.requestModel) : null;
        if (row && base) Object.assign(row, structuredClone(base), { id: row.id, requestModel: row.requestModel, displayName: row.displayName });
        return mockModelsView(name);
      },
      async getSettings() {
        return settingsView();
      },
      async patchAgentSecurity(patch) {
        if (LEGACY) throw new Error("400 invalid_request: unsupported field agentSecurity");
        const keyOf = (l: [string, string]) => [...l].sort().join("|");
        if (patch.links) {
          if (patch.links.some(([a, b]) => a === b)) throw new Error("400 invalid_request: agentSecurity.links: self link");
          if (new Set(patch.links.map(keyOf)).size !== patch.links.length) throw new Error("400 invalid_request: agentSecurity.links: duplicate link");
          mockSecurity.links = patch.links.map(([a, b]) => [a, b]);
        }
        if (patch.externalAgents) mockSecurity.externalAgents = patch.externalAgents.map((g) => ({ ...g }));
        if (patch.crossProjectAccess) mockSecurity.crossProjectAccess = patch.crossProjectAccess;
        console.info("[mock] PATCH /v2/settings agentSecurity", patch);
        return settingsView();
      },
      async patchSettings(patch) {
        const { newThreadDefaults: _current, newThreadDefaultsBuiltin: _builtin, ...rest } = patch;
        const restartRequired: string[] = [];
        if ("managementListen" in rest) {
          const list = rest.managementListen;
          if (list && !list.some((e) => /^(127\.|\[?::1\]?|0\.0\.0\.0|\[?::\]?)/.test(e))) throw new Error("400 invalid_request: managementListen: keep a loopback entry (127.0.0.1 or ::1); the desktop and CLI connect over loopback");
          if (JSON.stringify(list) !== JSON.stringify(mockSettings.managementListen)) restartRequired.push("managementListen");
        }
        Object.assign(mockSettings, rest);
        return { ...settingsView(), restartRequired };
      },
      // Restore after an unclean stop (cutex runtime-restore-candidates): these agents were online
      // before the mock "power loss"; ones online again leave the list (Rei, Ayumi, Beta start; the
      // AUTO_fail-start one refuses like a profile without credentials).
      async restoreCandidates() {
        if (LEGACY) return null;
        const items = restoreDismissed
          ? []
          : RESTORE_IDS.flatMap((id, i) => {
              const s = snapshot.active.find((x) => x.cutexSessionId === id);
              if (!s || s.runtime.status === "online") return [];
              return [{ cutexSessionId: id, displayName: s.displayName ?? id, lastOnlineAt: new Date(RESTORE_AT - (i + 1) * 600_000).toISOString() }];
            });
        return { hostId: "HOST-A", uncleanSince: items.length ? new Date(RESTORE_AT + 90_000).toISOString() : null, reason: items.length ? "host_rebooted" : null, items };
      },
      async dismissRestoreCandidates() {
        restoreDismissed = true;
        return { ok: true };
      },
      async userInstructions() {
        return { path: "C:\\Users\\sam\\.cutex\\codex-home\\AGENTS.md", exists: true, content: mockInstructions, revision: `r${mockInstructions.length}`, maxBytes: 262144, overridePath: "C:\\Users\\sam\\.cutex\\codex-home\\AGENTS.override.md", overrideActive: false };
      },
      async putUserInstructions(content) {
        mockInstructions = content;
        return this.userInstructions();
      },
      async sessionAction(id, method, params) {
        const all = [...snapshot.active, ...snapshot.retired];
        const s = all.find((x) => x.cutexSessionId === id);
        if (!s) throw new Error("unknown session");
        if (method === "cutex/session/metadata/update") {
          if ("displayName" in params) {
            // Agents have a formal name in cutex; mock agents get theirs on the first alias.
            if (!s.formalAgentName && !s.displayNameOverride && s.registrationClass !== "local_only") s.formalAgentName = s.displayName;
            s.displayNameOverride = (params.displayName as string | null) ?? null;
            s.displayName = s.displayNameOverride ?? s.formalAgentName ?? s.threadName ?? s.cutexSessionId;
          }
          if ("note" in params) s.note = params.note as string | null;
          if ("avatar" in params) {
            const avatar = params.avatar as SessionResource["avatar"];
            // ?legacy: a cutex before agent-avatar-color refuses `color` on an avatar.
            if (LEGACY && avatar?.color) throw new Error("avatar accepts only kind, value");
            s.avatar = avatar;
          }
        } else if (method === "cutex/session/retire" && emptyChats.has(id) && mockSettings.archiveDeleteEmpty) {
          // session-delete-empty-on-archive: an empty session is deleted instead.
          snapshot = { ...snapshot, active: snapshot.active.filter((x) => x !== s) };
          return { deleted: true };
        } else if (method === "cutex/session/retire" || method === "cutex/session/restore") {
          const retire = method === "cutex/session/retire";
          s.lifecycle = retire ? "retired" : "active";
          snapshot = { ...snapshot, active: retire ? snapshot.active.filter((x) => x !== s) : [...snapshot.active, s], retired: retire ? [...snapshot.retired, s] : snapshot.retired.filter((x) => x !== s) };
        } else if (method === "cutex/session/defaults/update") {
          s.runtimeDefaults = { ...(s.runtimeDefaults ?? {}), ...(params.patch as Record<string, boolean>) };
        } else if (method === "cutex/runtime/online") {
          // Starting a runtime takes a moment; `…fail…` agents refuse (bulk start shows 失败).
          await new Promise((r) => setTimeout(r, 700 + Math.random() * 1300));
          if (id.includes("fail")) throw new Error("runtime start failed: profile omega has no credentials on this host (mock)");
          // A new runtime occurrence: cutex advances runtimeGeneration on every launch.
          if (s.runtime.status !== "online") s.runtime = { ...s.runtime, status: "online" as typeof s.runtime.status, runtimeGeneration: s.runtime.runtimeGeneration + 1 };
        } else if (method === "cutex/runtime/offline") {
          s.runtime = { ...s.runtime, status: "offline" as typeof s.runtime.status, activeTurnId: null };
        } else if (method === MESSAGES_WAKE_METHOD) {
          // Owner 唤醒: only an idle agent with pending notes starts a turn.
          const pendingNotes = mockInbox.get(id)?.length ?? 0;
          if (busy.has(id) || !pendingNotes) return { pendingNotes, started: false };
          void wakeTurn(id);
          return { pendingNotes, started: true };
        }
        s.revision += 1;
        snapshot = { ...snapshot };
        return {};
      },
      async revertHistory(sessionId, beforeTurnId, _expectedRevision, options) {
        if (profileOf(sessionId) !== "claude" || LEGACY) unsupportedFor(sessionId, "historyRevert");
        revertedFrom.set(sessionId, beforeTurnId);
        console.info("[mock] cutex/session/history/revert", sessionId, beforeTurnId, options ?? {});
        // Claude revert receipt: claude-rewind-files restores files when asked.
        return profileOf(sessionId) === "claude" ? { native: { method: "claude/thread/revert", result: { rewindFilesRequested: !!options?.rewindFiles, filesRewound: !!options?.rewindFiles } } } : {};
      },
      async sessionSkills(sessionId) {
        if (profileOf(sessionId) !== "claude") throw new Error("unsupported_runtime: only Claude agents have a session skill catalog");
        return MOCK_CLAUDE_SKILLS;
      },
      async claudeModelStatus(sessionId) {
        // The selection (alias) and the pinned model that actually answered.
        const model = (MOCK_SETTINGS[profileOf(sessionId)]?.model as string | undefined) ?? "sonnet";
        const answered: Record<string, string> = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
        return { requestedModel: model, observedForRequestedModel: model, observedModels: [answered[model] ?? model], lastObservedModel: answered[model] ?? model };
      },
      async projectMutation(projectId, _expected, op) {
        // project-optional-director. Preview failure paths: a project name containing "fail" is
        // refused; assigning an agent whose id contains "fail" as Director is refused.
        if (op.kind === "create_project") {
          const list = snapshot.projects!.projects;
          if (list.some((x) => x.project_id === projectId) || op.presentation.display_name.includes("fail")) throw new Error(`conflict: project_id_already_used (${projectId})`);
          // project-create-workspace-root: a path containing "missing" doesn't exist (created with the flag).
          if (op.workspace_root?.includes("missing") && !op.create_workspace_root) throw new Error(`invalid_request: workspace_root_not_found`);
          const base = list[0]!;
          const director = op.director_cutex_session_id ?? null;
          list.push({ ...base, project_id: projectId, director_cutex_session_id: director, workspace_root: op.workspace_root ?? null, active_member_count: director ? 1 : 0, project_revision: 1, authority_epoch: director ? 1 : 0, presentation: { ...op.presentation, revision: 1 } });
          const row = director ? snapshot.hostRows[director] : undefined;
          if (row) row.projectId = projectId;
          snapshot = { ...snapshot, projects: { ...snapshot.projects!, projects: [...list] } };
          return {};
        }
        if (op.kind === "rotate_director") {
          // owner-rotation: replace the Director with an existing agent (the former stays a member).
          const p = snapshot.projects?.projects.find((x) => x.project_id === projectId);
          if (!p) throw new Error("project_not_authorized");
          if (!p.director_cutex_session_id) throw new Error("conflict: project_has_no_director");
          if (p.director_cutex_session_id === op.successor_cutex_session_id) throw new Error("conflict: successor_is_current_director");
          const current = snapshot.hostRows[op.successor_cutex_session_id]?.projectId ?? null;
          if (current && current !== projectId) throw new Error(`conflict: director_already_has_active_project: the Agent is a member of Project ${current}; detach it from that Project first or choose an independent Agent`);
          p.director_cutex_session_id = op.successor_cutex_session_id;
          p.authority_epoch += 1;
          p.project_revision = (p.project_revision ?? 0) + 1;
          const row = snapshot.hostRows[op.successor_cutex_session_id];
          if (row) row.projectId = projectId;
          snapshot = { ...snapshot, projects: { ...snapshot.projects!, projects: [...snapshot.projects!.projects] } };
          return {};
        }
        if (op.kind === "assign_director" || op.kind === "clear_director") {
          const p = snapshot.projects?.projects.find((x) => x.project_id === projectId);
          if (!p) throw new Error("project_not_authorized");
          if (op.kind === "assign_director") {
            if (p.director_cutex_session_id) throw new Error(`conflict: project_has_director: Project ${projectId} already has Director ${p.director_cutex_session_id}; clear it first (clear_director) or rotate it`);
            if (op.cutex_session_id.includes("fail")) throw new Error("conflict: director_already_has_active_project: the Agent is a member of another Project; detach it from that Project first, or choose an independent Agent");
            p.director_cutex_session_id = op.cutex_session_id;
            p.authority_epoch += 1;
            const row = snapshot.hostRows[op.cutex_session_id];
            if (row) row.projectId = projectId;
          } else {
            if (!p.director_cutex_session_id) throw new Error("conflict: project_has_no_director");
            if ((p.operator_count ?? 0) > 0) throw new Error(`conflict: project_has_agent_operators: revoke the Project's ${p.operator_count} Agent Operator grant(s) first; Operators act under the Director's authority`);
            p.director_cutex_session_id = null;
          }
          p.project_revision = (p.project_revision ?? 0) + 1;
          snapshot = { ...snapshot, projects: { ...snapshot.projects!, projects: [...snapshot.projects!.projects] } };
          return {};
        }
        if (op.kind === "create") {
          const list = snapshot.projects!.projects;
          if (list.some((x) => x.project_id === projectId)) throw new Error("project_exists");
          const base = list[0]!;
          list.push({ ...base, project_id: projectId, director_cutex_session_id: op.director_cutex_session_id, workspace_root: null, active_member_count: 1, project_revision: 1, authority_epoch: 1, presentation: { ...op.presentation, revision: 1 } });
          const row = snapshot.hostRows[op.director_cutex_session_id];
          if (row) row.projectId = projectId;
          snapshot = { ...snapshot, projects: { ...snapshot.projects!, projects: [...list] } };
          return {};
        }
        // archive / restore move the project between the two lists (archived = hidden from the sidebar).
        if (op.kind === "archive" || op.kind === "restore") {
          const from = op.kind === "archive" ? snapshot.projects!.projects : (snapshot.projects!.archived_projects ?? []);
          const moved = from.find((x) => x.project_id === projectId);
          if (!moved) throw new Error(op.kind === "archive" ? "project_is_archived" : "project_is_active");
          const next = { ...moved, lifecycle: op.kind === "archive" ? "archived" : "active", project_revision: (moved.project_revision ?? 0) + 1 };
          const active = snapshot.projects!.projects.filter((x) => x.project_id !== projectId);
          const archived = (snapshot.projects!.archived_projects ?? []).filter((x) => x.project_id !== projectId);
          snapshot = { ...snapshot, projects: { ...snapshot.projects!, projects: op.kind === "restore" ? [...active, next] : active, archived_projects: op.kind === "archive" ? [...archived, next] : archived } };
          return {};
        }
        const p = snapshot.projects?.projects.find((x) => x.project_id === projectId);
        if (!p) throw new Error("unknown project");
        if (op.kind === "set_workspace_root") {
          // Preview the refusals: a relative path, one containing "missing", one ending in a file name.
          const root = op.workspace_root;
          if (root !== null && !/^([A-Za-z]:[\\/]|\/|~)/.test(root)) throw new Error(`invalid_workspace_root: workspace_root must be absolute: ${root}`);
          if (root?.includes("missing")) throw new Error(`workspace_root_not_found: ${root}`);
          if (root && /\.[a-z0-9]{1,4}$/i.test(root)) throw new Error(`workspace_root_not_directory: ${root}`);
          p.workspace_root = root;
        }
        if (op.kind === "add_member" || op.kind === "detach_member") {
          const row = snapshot.hostRows[op.cutex_session_id];
          // cutex: add_member only takes an agent in no project; the Director cannot be detached.
          if (op.kind === "add_member" && row?.projectId) throw new Error(row.projectId === projectId ? "conflict: agent_already_project_member" : "conflict: agent_already_has_active_project");
          if (op.kind === "detach_member" && p.director_cutex_session_id === op.cutex_session_id) throw new Error("conflict: primary_director_requires_rotation");
          if (op.kind === "add_member" && op.cutex_session_id.includes("fail")) throw new Error("not_found: active_managed_agent");
          if (row) row.projectId = op.kind === "add_member" ? projectId : null;
        }
        p.project_revision = (p.project_revision ?? 0) + 1;
        snapshot = { ...snapshot };
        return {};
      },
      async projectPresentation(projectId, _expected, presentation) {
        const p = snapshot.projects?.projects.find((x) => x.project_id === projectId);
        if (p) p.presentation = { ...p.presentation, ...presentation, revision: (p.presentation.revision ?? 0) + 1 };
        snapshot = { ...snapshot };
        return {};
      },
      async projectMemory(projectId) {
        return projectId === "desktop"
          ? {
              dir: "C:\\Users\\sam\\.cutex\\projects\\desktop\\memory",
              index: "- [Decisions](decisions.md) — architecture choices the team agreed on\n- [Windows ACL](windows-acl.md) — why dev homes live under the user profile\n",
              entries: [
                { file: "decisions.md", name: "decisions", description: "architecture choices the team agreed on", type: "project", bytes: 8100, updatedAt: "2026-10-06T09:40:00Z" },
                { file: "windows-acl.md", name: "windows-acl", description: "why dev homes live under the user profile", type: "reference", bytes: 1300, updatedAt: "2026-10-05T22:03:00Z" },
              ],
            }
          : { dir: "C:\\Users\\sam\\.cutex\\projects\\waveline\\memory", index: null, entries: [] };
      },
      async projectMemoryFile(_projectId, file) {
        const content =
          file === "decisions.md"
            ? "# Decisions\n\n- cutex is the daemon; desktop is a client.\n- One agent = one session = one native thread.\n- Tokens stay in the main process."
            : "# Windows ACL\n\ncutex requires owner-private ACLs, so dev homes must live under `%USERPROFILE%`.";
        return { file, content, bytes: content.length, updatedAt: "2026-10-06T09:40:00Z" };
      },
      async projectMcp(projectId) {
        return { servers: projectId === "desktop" ? { playwright: { command: "npx", args: ["-y", "@playwright/mcp"] } } : {}, revision: 1, updatedAt: null };
      },
      async pickFolder() {
        if (mockRemote()) throw new Error("the active host is remote: use the in-app folder browser");
        // `?pickedFolder=/home/alex`: e.g. a directory that contains the mock home's ~/.cutex (Q11 warning).
        return new URLSearchParams(location.search).get("pickedFolder") ?? "D:\\Projects\\picked-folder";
      },
      async revealPath(path) {
        if (mockRemote()) throw new Error("the active host is remote: its files are not on this machine");
        console.info("[mock] revealPath", path);
      },
      async openExternal(url) {
        window.open(url, "_blank");
      },
      async switchProfile(_sessionId, profile) {
        return { status: "switched", from: "omega", to: profile };
      },
      async managedMcp() {
        return {
          servers: [
            { name: "cutex", approvalMode: "approve", toolsSource: "daemon", tools: [
              { name: "send_message", description: "Send a message to another agent" },
              { name: "list_agents", description: "List agents visible on the bus" },
              { name: "create_agent", description: "Create a project member agent" },
            ] },
            { name: "cutex_job", configured: false, approvalMode: "auto", toolsSource: "external", tools: null },
          ],
        };
      },
      async capabilities() {
        const remoteFeatures = mockRemote() ? (OLD_REMOTE ? ["management-client-tokens"] : ["management-client-tokens", "session-attachments", "fs-dir-browse"]) : ["management-client-tokens", "session-attachments", "fs-dir-browse"];
        return {
          ...(LEGACY ? {} : { cutexBuild: MOCK_CUTEX_BUILD }),
          hostId: (() => { const d = mockDaemonOf(mockHosts.active); return d.kind === "connected" ? d.hostId : "HOST-A"; })(),
          featureList: ((list: string[]) => (mockHosts.active === WORKSTATION ? withoutWorkstationGaps(list) : list))([...remoteFeatures, ...MOCK_BASE_FEATURES, ...(LEGACY ? [] : MOCK_NEW_FEATURES.filter((f) => !(OLD_RIDEALONG && f === "admission-ridealong-detail")))]),
          ...(LEGACY ? {} : { user: mockConnectionUser() }),
        };
      },
      async profileQuota(profile) {
        // ?legacy: cutex without a native ChatGPT source → the composer falls back to readRateLimits.
        if (LEGACY && profile === "gamma") return [];
        // Base URL moved to a host without an automatic reader: cutex answers the primary gauge with that error.
        const shown = MOCK_QUOTA[profile]?.[0];
        const noAuto = shown ? mockAutoQuotaError(profile) : null;
        if (shown && noAuto) return [gauge("primary", shown.label, { kind: shown.kind, observedAt: null, stale: true, error: noAuto })];
        return MOCK_QUOTA[profile] ?? [];
      },
      async readRateLimits(sessionId) {
        return (MOCK_LIMITS[profileOf(sessionId)] as Record<string, unknown> | undefined) ?? null;
      },
      // windows-sandbox-readiness: HOST-A (windows) agents have no sandbox; setup succeeds but the
      // running runtime keeps reporting its start config (like native) until a relaunch.
      async windowsSandboxReadiness() {
        if (LEGACY) return null;
        return "notConfigured";
      },
      async setupWindowsSandbox(sessionId) {
        if (LEGACY) throw new Error("403 native_method_denied: windowsSandbox/setupStart");
        setTimeout(() => nativeEvent(sessionId, "windowsSandbox/setupCompleted", { mode: "unelevated", success: true, error: null }), 700);
        return { started: true };
      },
      async createProfile(request) {
        if (LEGACY) throw new Error("404 not_found: POST /v2/profiles");
        if (mockProfiles[request.name]) throw new Error(`profile_exists: ${request.name}`);
        // Like cutex: a preset gives the provider id and its official URL; `baseUrl` replaces the URL.
        const preset = request.preset ? presetById(request.preset, MOCK_PRESETS) : null;
        if (request.preset && !preset) throw new Error(`invalid_request: preset: unknown preset (${request.preset})`);
        const api = request.kind === "apiKey";
        mockProfiles[request.name] = {
          name: request.name, cliKind: request.kind === "claude" ? "claude" : "codex", authKind: request.kind === "chatgpt" ? "chatgpt" : api ? "apiKey" : "none", apiKeyPresent: false, color: null, allowSwitch: null,
          config: api ? { model: request.model ?? preset?.defaultModel ?? null, modelProvider: preset?.providerId ?? "custom", providerBaseUrl: request.baseUrl ?? preset?.baseUrl ?? null, providerWireApi: "responses" } : request.kind === "chatgpt" ? { model: "gpt-5.5", modelProvider: "openai" } : {},
          models: [],
        };
        // Module-owned fields of the body (claude-accounts: claudeAccount) go to their module mock; a refusal undoes the create.
        const owned: Record<string, unknown> = { ...request };
        for (const key of ["name", "kind", "preset", "baseUrl", "model"]) delete owned[key];
        if (Object.keys(owned).length) {
          try {
            moduleProfilePatch(mockProfileRef(request.name), owned);
          } catch (e) {
            delete mockProfiles[request.name];
            throw e;
          }
        }
        // profile-generic-switches: a preset's reader starts on, only on the preset's own base URL.
        if (!LEGACY && api && preset?.quotaReader && (!request.baseUrl || request.baseUrl === preset.baseUrl)) MOCK_QUOTA_READERS[request.name] = preset.quotaReader;
        if (request.kind === "chatgpt") mockLoggedOut.add(request.name);
        console.info("[mock] POST /v2/profiles", request);
        return mockProfileDetail(request.name);
      },
      async profilePresets() {
        // cutex profile-presets-v2's list (src/profiles/providers.rs presets_json); `?legacy`: no such route
        // (the form then uses FALLBACK_PRESETS, an older cutex's list).
        if (LEGACY) return null;
        return structuredClone(MOCK_PRESETS);
      },
      async ccSwitchImportList() {
        if (LEGACY) return null;
        await new Promise((r) => setTimeout(r, 300));
        return { found: true, source: { path: "C:\\Users\\owner\\.cc-switch\\cc-switch.db", format: "sqlite" as const, schemaVersion: 5 }, error: null, providers: structuredClone(MOCK_CC_SWITCH) };
      },
      async ccSwitchImport(items) {
        if (LEGACY) throw new Error("404 not_found: POST /v2/profile-imports/cc-switch");
        await new Promise((r) => setTimeout(r, 500));
        const reply: import("../../../shared/ccSwitchImport").CcSwitchImportResult = { created: [], failed: [] };
        for (const item of items) {
          const p = MOCK_CC_SWITCH.find((x) => x.app === item.app && x.id === item.id);
          if (!p) reply.failed.push({ id: item.id, app: item.app, code: "provider_not_found", message: "no such CC Switch provider" });
          else if (!p.supported || !p.hasKey) reply.failed.push({ id: p.id, app: p.app, code: "provider_unsupported", message: p.reason ?? "the provider has no API key" });
          else {
            let name = item.name?.trim() || p.name;
            for (let n = 2; mockProfiles[name]; n++) name = `${item.name?.trim() || p.name} ${n}`;
            mockProfiles[name] = {
              name, cliKind: p.app, authKind: "apiKey", apiKeyPresent: true, color: null, allowSwitch: null,
              config: { model: p.model, modelProvider: "custom", providerBaseUrl: p.baseUrl, providerWireApi: "responses" },
              models: [],
            };
            p.existingProfile = name;
            reply.created.push({ id: p.id, app: p.app, profile: mockProfileDetail(name) });
          }
        }
        console.info("[mock] POST /v2/profile-imports/cc-switch", items, reply);
        return reply;
      },
      async duplicateProfile(name, copy) {
        if (mockProfiles[copy]) throw new Error(`profile_exists: ${copy}`);
        const src = mockProfiles[name]!;
        mockProfiles[copy] = { ...structuredClone(src), name: copy, apiKeyPresent: false };
        if (src.authKind === "chatgpt") mockLoggedOut.add(copy);
        return mockProfileDetail(copy);
      },
      async deleteProfile(name, options) {
        if (name === mockSettings.defaultProfile) return { ok: false, error: { code: "profile_is_default", message: "the default profile cannot be deleted" } };
        // Like cutex: active and archived agents, plus hidden ones the desktop never lists.
        const users = [...snapshot.active, ...snapshot.retired].filter((s) => s.profile === name).map((s) => ({ cutexSessionId: s.cutexSessionId, displayName: s.displayName, lifecycle: s.lifecycle as "active" | "retired" }));
        for (const [id, h] of mockHiddenRefs) if (h.profile === name) users.push({ cutexSessionId: id, displayName: h.displayName, lifecycle: "active" });
        // ?archived=detach: only archived ones left → cleared, the delete goes through.
        const detach = options?.archived === "detach" && users.every((u) => u.lifecycle === "retired");
        if (users.length && !detach) return { ok: false, error: { code: "profile_in_use", message: "profile is used by sessions", sessions: users } };
        for (const s of snapshot.retired) if (detach && s.profile === name) s.profile = null;
        delete mockProfiles[name];
        return { ok: true };
      },
      async forkSession(sessionId, request) {
        const src = [...snapshot.active, ...snapshot.retired].find((s) => s.cutexSessionId === sessionId);
        if (!src) throw new Error("session_not_found");
        const id = `${sessionId}-fork-${Date.now().toString(36)}`;
        const name = request.name ?? `${src.displayName} (fork)`;
        const fork: SessionResource = { ...structuredClone(src), cutexSessionId: id, displayName: name, displayNameOverride: name, lifecycle: "active", native: { threadId: `thread-${id}`, schema: null }, runtime: { ...src.runtime, activeTurnId: null } };
        forkedFrom.set(id, { from: sessionId, afterTurnId: request.afterTurnId ?? null });
        snapshot = { ...snapshot, active: [...snapshot.active, fork], hostRows: { ...snapshot.hostRows, [id]: { ...(snapshot.hostRows[sessionId] ?? hostRow(id, null)), id } } };
        console.info("[mock] cutex/session/fork", sessionId, request);
        return { cutexSessionId: id };
      },
      async deleteSession(sessionId) {
        if (mockHiddenRefs.delete(sessionId)) return { ok: true };
        const s = [...snapshot.active, ...snapshot.retired].find((x) => x.cutexSessionId === sessionId);
        if (!s) return { ok: false, error: { code: "session_not_found", message: "unknown session" } };
        if (s.runtime.activeTurnId) return { ok: false, error: { code: "session_busy", message: "session has an active turn" } };
        if (sessionId === "wave") return { ok: false, error: { code: "session_referenced", message: "session is the director of project wave" } };
        snapshot = { ...snapshot, active: snapshot.active.filter((x) => x !== s), retired: snapshot.retired.filter((x) => x !== s) };
        return { ok: true };
      },
      async compactThread(sessionId) {
        nativeEvent(sessionId, "thread/tokenUsage/updated", { tokenUsage: { last: { inputTokens: 21_000 }, modelContextWindow: 400_000 } });
      },
      // Like cutex: the reply lands, then the resolved event arrives (store.respond keeps the
      // answered row; lib/interactionLog). A later bootstrap no longer carries the request.
      async respond(sessionId, _generation, requestId, reply) {
        mockResolved.add(String(requestId));
        // claude-permission-rules: cutex keeps the rules an "always allow in this project" answer chose.
        if (sessionId === "sora" && reply && "result" in reply) mockRememberClaudeRules("D:\\Apps\\cutex-desktop", reply.result);
        const params = (MOCK_PENDING[sessionId] ?? []).find((p) => String(p.message.id) === String(requestId))?.message.params as { threadId?: string } | undefined;
        nativeEvent(sessionId, "serverRequest/resolved", { threadId: params?.threadId ?? `thread-${sessionId}`, requestId });
      },
      async startReview(sessionId, _threadId, target) {
        unsupportedFor(sessionId, "review");
        const turnId = `review-${++seq}`;
        const label = target.type === "custom" ? target.instructions : "当前未提交的改动";
        busy.add(sessionId);
        currentTurn.set(sessionId, turnId);
        nativeEvent(sessionId, "turn/started", { turn: { id: turnId, status: "inProgress", startedAt: Date.now() / 1000 } });
        nativeEvent(sessionId, "item/completed", { turnId, item: { type: "enteredReviewMode", id: `er-${seq}`, review: label } });
        setTimeout(() => nativeEvent(sessionId, "item/completed", { turnId, item: { type: "commandExecution", id: `rc-${seq}`, command: "git diff", status: "completed", exitCode: 0 } }), 600);
        setTimeout(() => {
          nativeEvent(sessionId, "item/completed", { turnId, item: { type: "exitedReviewMode", id: `xr-${seq}`, review: REVIEW_TEXT } });
          nativeEvent(sessionId, "turn/completed", { turn: { id: turnId, status: "completed", completedAt: Date.now() / 1000 } });
          busy.delete(sessionId);
          currentTurn.delete(sessionId);
        }, 1800);
        return { turnId };
      },
      async collaborationModes() {
        return [
          { name: "Default", mode: "default", model: null, reasoning_effort: null },
          { name: "Plan", mode: "plan", model: null, reasoning_effort: null },
        ];
      },
      async setMemoryMode(sessionId) {
        unsupportedFor(sessionId, "memoryMode");
      },
      async resetMemory() {
        throw new Error("cutex does not forward `memory/reset` yet (native request allowlist)");
      },
      async saveMarkdown(defaultName, content) {
        console.info("[mock] export", defaultName, content);
        return `C:\\Users\\sam\\Documents\\${defaultName}`;
      },
      async pickImages() {
        return [{ path: "C:\\Users\\sam\\Pictures\\screenshot.png", name: "screenshot.png", size: 182_000, preview: PNG_1PX }];
      },
    }),
  };
  // A remote host shown: its own approvals / owner notes (`remoteApi`); HOST-A keeps the module mocks.
  const shared = bridge.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of Object.keys(remoteApi(WORKSTATION))) {
    const local = shared[name]!;
    shared[name] = (...args: unknown[]) => (mockRemote() ? (remoteApi(mockHosts.active) as Record<string, (...a: unknown[]) => unknown>)[name]! : local)(...args);
  }
  slowMock(bridge.api as unknown as Record<string, unknown>);
  bridge.apiFor = (hostId) => mockApiFor(bridge.api, hostId);
  // Agent pages: the preview server stands in for main's frame documents (dev/mockFrames.ts).
  bridge.frames = mockFrames((hostId, id, version) => bridge.apiFor!(hostId).artifactStoreContent(id, version, { maxBytes: 4 * 1024 * 1024 }));
  // Signed module packs: the preview plays main's store; the pilot pack is really built + imported (dev/mockModulePacks.ts).
  bridge.modulePacks = mockModulePacks();
  window.cutex = bridge;
  if (MULTI_HOST !== null) mockConnect(WORKSTATION);
  mockConnect(ALPHA);
}

/**
 * Dev: a slow remote host (SSH tunnel) for the optimistic-send UI (lib/outbox). localStorage
 * "cutex-mock-latency" = ms added to every send / queue / stop / reply call; "cutex-mock-fail" =
 * comma-separated api methods that reject after the delay (e.g. "submit").
 */
function slowMock(api: Record<string, unknown>): void {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  };
  for (const name of ["submit", "queueList", "queueRemove", "queuePromote", "queueMove", "stopTurn", "queueResume", "asksPause", "asksResume", "interrupt", "respond"]) {
    const fn = api[name];
    if (typeof fn !== "function") continue;
    api[name] = async (...args: unknown[]) => {
      const ms = Number(read("cutex-mock-latency")) || 0;
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      if (read("cutex-mock-fail").split(",").includes(name)) throw new Error(`mock: ${name} failed (ssh tunnel closed)`);
      return (fn as (...a: unknown[]) => unknown).apply(api, args);
    };
  }
}
