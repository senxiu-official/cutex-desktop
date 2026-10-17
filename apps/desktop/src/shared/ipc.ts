// IPC contract between Electron main and the renderer. The renderer never sees the cutex token
// and never talks to the daemon directly; everything goes through these calls.
import type { InboundMailInput, InboundMailStatus, MarkExternalInput, NciHelper, NciVerificationInput, NciVerificationStatus } from "./remoteJobs";
import type { AppLocale } from "./locales";
import type {
  AdmissionRef,
  EventEnvelope,
  HostSessionRow,
  ProjectsResponse,
  QueueItem,
  QueueListResult,
  QueueMoveResult,
  QueueYieldResult,
  QueueResumeResult,
  AsksPauseResult,
  TurnStopResult,
  SessionBootstrap,
  SessionHistory,
  SessionResource,
  SubmitStrategy,
  UserInputSubmitResult,
  OwnerNotification,
  OwnerNotifyFilter,
  OwnerNotifySettings,
  OwnerNotifySettingsPatch,
} from "@cutex-desktop/protocol";
import type { CutexBuild } from "@cutex-desktop/cutex-client";
import type { ThreadMemoryMode } from "@cutex-desktop/protocol/codex";
import type { CollaborationModeMask, ReviewTarget, ThreadGoal, ThreadGoalStatus } from "@cutex-desktop/protocol/codex/v2";
import type { AddSshHostRequest, DirBrowse, HostAppearancePatch, HostGroupDraft, HostResult, HostsState, HostStartOn, HostTestResult, SshHostPatch, ViewScope } from "./hosts";
import type { LaunchOverrides, NewThreadDefaults, NewThreadDefaultsPatch } from "./launch";
import type { DeviceOff, NotificationDecision, NotificationEvaluateRequest, NotificationLevelsPatch, NotificationLevelsView } from "./notificationLevels";
import type { RuntimesWire } from "./runtimes";
import type { UpdateUnsupportedCode } from "./update";
import type { Note, NoteCreate, NotesQuery, NotesResult, NoteUpdate } from "./notes";
import type { SideChat, SideMessageInput, SideOpenInput, SideOpenResult, SideReply } from "./sideChat";
import type { ClaudeAccountCreate, ClaudeAccountList, ClaudeAccountRemoveResult, ClaudeAccountResult, ProfileQuotaDetail } from "./claudeAccounts";
import type { AlarmCancelResult, AlarmList } from "./alarms";
import type { SkillArchiveList, SkillArchiveResult } from "./skillsArchive";
import type { UsageSourceCreate, UsageSourceDeleteResult, UsageSourcePatch, UsageSourceResult, UsageSourcesView } from "./usageSources";
import type { WorkflowRunAction, WorkflowRunList, WorkflowRunView } from "./workflows";
import type { RestoreCandidates } from "./runtimeRestore";
import type { HostServiceInfo, UpgradeApplyRequest, UpgradeResult, UpgradeRollbackRequest, UpgradeRollbackResult, UpgradeRun, UpgradeSettings, UpgradeSettingsPatch, UpgradeStaging, UpgradeStatus } from "./backendUpgrade";
import type { ComponentAction, ComponentResult, ComponentsList } from "./components";
import type { QuotaContinueResult, QuotaContinueView } from "./quotaContinue";
import type { CapabilitiesUser, PeerBindingResult, SelfProfile, SelfProfilePatch, TokenBindingResult, UserCreate, UserPatch, UsersList, UsersResult, UsersSettings, UserWriteResult } from "./users";
import type { PeerAgents, PeerAuditEntry, PeerCaps, PeerInvite, PeerList, PeerPatch, PeerResult, PeersSettings, PeersSettingsPatch, PeerView } from "./peers";
import type { ArtifactContent, ArtifactDeleteResult, ArtifactDetail, ArtifactDiff, ArtifactList, ArtifactListQuery, ArtifactPatch, ArtifactPatchResult, ArtifactPublishRequest, ArtifactPublishResult, ArtifactResolveItem, ArtifactUsage } from "./artifactStore";

export type { AddSshHostRequest, DirBrowse, HostAppearancePatch, HostConnView, HostGroup, HostGroupDraft, HostPlatform, HostResult, HostsState, HostStartOn, HostTestResult, HostView, SshErrorView, SshHostPatch, TunnelView, ViewScope } from "./hosts";

export type { ApprovalPolicy, LaunchOverrides, LaunchPermissions, NewThreadDefaults, NewThreadDefaultsPatch, SandboxMode, ThreadKind } from "./launch";

export type LocalDaemonSetup = "notInstalled" | "notRunning";
export type DaemonState =
  | { kind: "connecting"; baseUrl: string }
  /** `platform`: cutex `/v2/host.platform` (absent in older fixtures). */
  | { kind: "connected"; baseUrl: string; hostId: string; platform?: string }
  /** `setup` (this machine only): no cutex config / token here = cutex is not installed yet (first
   *  run), else installed but its management service is not running. Absent for remote hosts. */
  | { kind: "unreachable"; baseUrl: string; message: string; setup?: LocalDaemonSetup }
  | { kind: "error"; baseUrl: string; message: string; /** HTTP status of the failing cutex reply (401 = token rejected). */ status?: number };

export interface SidebarSnapshot {
  active: SessionResource[];
  retired: SessionResource[];
  /** null when the projects route is unavailable (e.g. non-root token). */
  projects: ProjectsResponse | null;
  /** cutexSessionId → host-session row (project membership + appearance), from /v2/host/sessions. */
  hostRows: Record<string, HostSessionRow>;
}


/** One quota gauge (cutex `GET /v2/profiles/{profile}/quota`, or derived from codex rate limits). */
export interface QuotaGauge {
  id: string;
  label: string;
  kind: "window" | "balance";
  remainingPercent: number | null;
  balance: string | null;
  /** Unix seconds. */
  resetAt: number | null;
  windowLabel: string | null;
  observedAt: number | null;
  stale: boolean;
  /** Set when cutex could not resolve the reader config. */
  error?: string | null;
}

/** cutex quota reader config (stored snake_case; mirrors `src/profiles/quota.rs` Config). */
export interface QuotaReaderConfig {
  enabled: boolean;
  url: string;
  auth: "profile_api_key" | "none";
  label: string;
  refresh_seconds: number;
  /** `used_ratio`: used share 0..1 (cutex `kimi-code-plan`; e.g. the Kimi Code monthly total). */
  mode: "remaining_and_limit" | "used_and_limit" | "remaining_percent" | "used_percent" | "used_ratio" | "balance";
  value_pointer: string;
  limit_pointer: string;
  reset_pointer: string;
  reset_format: "rfc3339" | "unix_seconds" | "unix_millis";
  window_label?: string | null;
  /** cutex `kimi-code-plan`: a window the response may leave out; never read → no gauge. Absent = false. */
  optional?: boolean;
}

/**
 * cutex `profile-generic-switches`: explicit quota readers (`quota-config` `preset`). `usage_endpoint`,
 * `zhipu_coding_plan` and `kimi_code_plan` follow the profile's Base URL; the balance readers use their fixed
 * endpoint.
 */
export type QuotaReaderName = "usage_endpoint" | "deepseek_balance" | "moonshot_balance" | "moonshot_cn_balance" | "zhipu_coding_plan" | "openrouter_key" | "kimi_code_plan";

export interface QuotaConfigView {
  profile: { id: string; name: string };
  /**
   * `custom`, a reader (cutex profile-generic-switches) or `auto`: older cutex's host-based choice; on a
   * cutex with readers only a legacy, read-only leftover (PUT refuses it). A newer cutex may name a
   * reader this build doesn't know (shown by its raw name).
   */
  preset: "custom" | "auto" | QuotaReaderName | (string & {});
  /** profile-generic-switches: the values PUT accepts for `preset` (`custom` + readers). Absent on older cutex. */
  presetOptions?: string[];
  primary: QuotaReaderConfig;
  extras: QuotaReaderConfig[];
  resolvedPrimary: QuotaReaderConfig | null;
  presetError: string | null;
}

export interface CapabilitiesView {
  /** Build identity (cutex r224+; absent on older cutex). */
  cutexBuild?: CutexBuild;
  hostId: string;
  featureList: string[];
  /** cutex `users`: who this connection is (absent on older cutex = the owner; shared/users.ts userAccessOf). */
  user?: CapabilitiesUser | null;
}

/** `source` (cutex usage-external-sources): cutex itself or an extra usage source (shared/usageSources.ts). */
export type UsageDimension = "day" | "profile" | "model" | "agent" | "project" | "source";
/** `?source=` of GET /v2/usage (usage-external-sources): cutex rows only, every extra source, or one source id. */
export type UsageSourceFilter = "cutex" | "external" | (string & {});

export interface UsageAmounts {
  turns: number;
  requests: number;
  input: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
  reasoningOutput: number;
  total: number;
  estimatedCost?: number;
  unpricedTokens?: number;
  /** cutex `usage-model-map`: the models this row's samples were priced as (price table 「按另一个模型计价」). */
  pricedAs?: string[];
  apiEquivalentUsd?: number;
}

/** `GET /v2/usage` (cutex usage ledger; local calendar days, inclusive). */
export interface UsageReport {
  from: string;
  to: string;
  groupBy: UsageDimension[];
  totals: UsageAmounts;
  /** cutex r218 (id-based ledger): rows with a profile carry `profileId` / `profileState`; `profile` is
   *  the current name, or the last known one for a deleted profile. */
  rows: ({
    key: { day?: string; profile?: string | null; profileId?: string | null; profileState?: "current" | "deleted"; model?: string | null; agent?: string; agentName?: string; project?: string | null; projectName?: string | null; source?: string; sourceLabel?: string | null; sourceKind?: string; sourceBilling?: string | null };
    profileState?: "current" | "deleted";
  } & UsageAmounts)[];
  currency?: string;
  recordingSince: string | null;
  warnings: string[];
  /** cutex `usage-price-catalog`: models used in the range that no source could price. */
  unpricedModels?: { provider: string | null; /** null: rows that recorded no model. */ model: string | null; requests: number; tokens: number; /** `usage-model-map`: mapped to this model, which has no price either. */ pricedAs?: string }[];
  /** cutex `usage-price-catalog` / `usage-currency`: where prices came from (docs/usage-pricing.md in cutex). */
  pricing?: {
    priceSource: string;
    displayCurrency: string;
    exchangeRates: Record<string, number>;
    catalog: { source: string; url: string; fetchedAt: string | null; checkedAt: string | null; lastError: string | null; modelCount: number } | null;
  };
}

export interface UsagePrices {
  currency: string;
  /** Per 1M tokens. `cacheWriteInput` / `currency` / `aliases`: cutex `usage-price-catalog` / `usage-currency`
   *  (not edited here; kept as they are when a row is saved). */
  models: Record<string, { input: number; cachedInput?: number; cacheWriteInput?: number; output: number; currency?: string; aliases?: string[] }>;
  /** cutex `usage-model-map`: price model `from` as model `to` (`{from: to}`; one hop, keys ignore case).
   *  Omitted in a PUT = cutex keeps its stored map. */
  modelMap?: Record<string, string>;
}

/** Workspace root: a project's `workspace_root`, or a session's cwd. */
export interface WorkspaceScope {
  kind: "project" | "session";
  id: string;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink";
  targetKind: "file" | "dir" | null;
  size: number | null;
  modifiedAt: string;
  ignored: boolean;
}

export interface FsDir {
  root: string;
  path: string;
  entries: FsEntry[];
}

export interface FsFile {
  path: string;
  size: number;
  modifiedAt: string;
  encoding: "utf8" | "base64";
  content: string;
  truncated: boolean;
  mime: string;
}

export interface GitFileStatus {
  path: string;
  origPath: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "copied" | "typechange" | "conflicted" | "untracked";
  staged: boolean;
  added: number | null;
  deleted: number | null;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  head: { sha: string; subject: string } | null;
  files: GitFileStatus[];
}

/** `GET /v2/profiles` item. */
export interface ProfileItem {
  id: string;
  name: string;
  cliKind: string;
  source: string | null;
  provider: string | null;
  model: string | null;
  modelProvider: string | null;
  baseUrl: string | null;
  modelReasoningEffort: string | null;
  modelContextWindow: number | null;
  modelAutoCompactTokenLimit: number | null;
  authPresent: boolean;
  authKind: "chatgpt" | "apiKey" | "claude" | "none";
  /** cutex `profile-plan-label`: ChatGPT profiles show the signed-in account's plan, else the stored label. */
  planLabel: string | null;
  /** Where `planLabel` came from ("account" = the ChatGPT login). Absent on older cutex. */
  planLabelSource?: "account" | "manual" | null;
  isDefault: boolean;
  /** `providerCategory` = set by hand (null = inferred); `effectiveProviderCategory` = what counts
   *  (cutex profile-provider-category-v2: kimi / glm / zai / claude / deepseek / codex / other). */
  appearance: { color: string | null; effectiveColor: string | null; providerCategory: string | null; effectiveProviderCategory?: string | null };
  quotaEnabled: boolean;
  allowSessionSwitch: boolean;
  lastUsedAt: string | null;
  /**
   * cutex `profile-switch-family`: profiles of one family can replace each other mid-session
   * (cutex refuses others with `provider_family_mismatch`). Absent on older cutex.
   */
  providerFamily?: string | null;
  providerFamilyLabel?: string | null;
  /** cutex `profile-native-subagents`: effective (null for Claude profiles). Absent on older cutex. */
  nativeSubagents?: boolean | null;
  /** cutex `profile-agent-approval`: agents launching agents on this profile wait for an owner approval. */
  agentUseRequiresApproval?: boolean;
  /**
   * cutex `profile-generic-switches` (Codex profiles; `detail.editable.privateChatgptAuthFile`): explicit
   * agent launches use the host's private native ChatGPT `auth.json` with the profile's own model /
   * effort. null on Claude profiles; absent on older cutex.
   */
  privateChatgptAuthFile?: boolean | null;
  /**
   * cutex `profile-tool-schema-compat` (Codex profiles; `detail.editable.toolSchemaCompat`): `strict` lowers
   * tool-parameter schemas for providers with strict function declarations (single-typed enums, no
   * nullable enums). null / absent = off.
   */
  toolSchemaCompat?: "off" | "strict" | null;
  /** cutex `delegation-tools`: effective — agents may wait for delegation results inside the turn
   *  (`delegation_wait`). Absent on older cutex. */
  delegationWait?: boolean;
  /**
   * cutex `profile-search-tool` (Codex API-key profiles; `detail.editable.searchTool`): agents get the
   * cutex `web_search` tool — a separate search-only request to this profile's provider / model. Owner
   * switch, default off. Absent on older cutex.
   */
  searchTool?: boolean;
  /**
   * cutex `claude-accounts`: the Claude account (`GET /v2/claude/accounts`) new agents of a Claude
   * profile run on — `default` (the shared login) or `ca-…`; null for Codex profiles. Existing agents
   * keep the account they were created on. Absent on older cutex.
   */
  claudeAccount?: string | null;
  /**
   * claude-tools-settings (Claude profiles): the effective rules — sessions get Write/Edit (write)
   * and Bash (exec). With `claude-tool-defaults` unset = on, and sessions whose rule was not set
   * for them follow the profile at their next start. null / absent for Codex profiles.
   */
  claudeAllowWrite?: boolean | null;
  claudeAllowExec?: boolean | null;
  /** Claude profiles: effective file checkpoints (null for Codex profiles); absent on older cutex. */
  claudeFileCheckpointing?: boolean | null;
  /**
   * cutex `profile-model-display-names`: this profile's own display name per model entry
   * (model id → name). Display only; absent on older cutex.
   */
  modelDisplayNames?: Record<string, string>;
}

/** Kinds `POST /v2/profiles` creates (cutex `profile-create`). */
export type ProfileCreateKind = "chatgpt" | "claude" | "apiKey";

/**
 * `GET /v2/profile-presets` item (cutex `profile-create`): an API-key provider cutex knows. Official
 * providers carry their own `baseUrl`; `custom` has none (`baseUrlRequired`).
 */
export interface ProfilePreset {
  id: string;
  /** Other ids `POST /v2/profiles {preset}` accepts (e.g. moonshot: kimi). */
  aliases: string[];
  label: string;
  providerId: string;
  /** The provider's official base URL; null = the caller supplies one (custom). */
  baseUrl: string | null;
  baseUrlRequired: boolean;
  defaultModel: string | null;
  providerFamily: string | null;
  providerFamilyLabel: string | null;
  /** cutex r222+: a profile on this preset's official URL gets an automatic quota reader. Absent on older cutex. */
  autoQuota?: boolean;
  /** cutex profile-generic-switches: the reader a profile created on this preset's official URL starts with (null = none). Absent on older cutex. */
  quotaReader?: string | null;
  /** cutex profile-presets-v2: the preset writes its own model catalog (context, image input, efforts). Absent on older cutex. */
  modelCatalog?: boolean;
  /** cutex profile-presets-v2: the root `web_search` mode the preset writes (e.g. "disabled"); null = native default. Absent on older cutex. */
  webSearch?: string | null;
}

/**
 * `POST /v2/profiles` body. API key: a `preset` (its official base URL), optionally with a `baseUrl`
 * that replaces it, or only a `baseUrl` (custom provider).
 */
export interface ProfileCreateRequest {
  name: string;
  kind: ProfileCreateKind;
  preset?: string;
  baseUrl?: string;
  model?: string;
  /**
   * cutex `claude-accounts`, Claude profiles only: the Claude account (`ca-…`) new agents of the
   * profile run on; absent = the shared default. cutex answers 400 for an unknown id or another kind.
   */
  claudeAccount?: string;
}

/**
 * A cutex refusal the UI explains (code + details survive the IPC hop, unlike thrown errors).
 * `sessions`: agents that block it (`profile_in_use`: active and archived ones, `lifecycle` from cutex).
 */
export interface CutexRefusal {
  code: string;
  message: string;
  sessions?: { cutexSessionId: string; displayName: string; lifecycle?: "active" | "retired" }[];
  /** session_referenced: forks still read this agent's history (native refuses thread/delete). */
  forkReferences?: boolean;
}

export type MutationResult = { ok: true } | { ok: false; error: CutexRefusal };

/**
 * owner-notify session methods (`cutex/ownerNotify/ack|reply|dismiss|delete`): the updated record (delete: the removed
 * one), or a refusal (notification_not_found / notification_closed / notification_not_replyable).
 */
export type OwnerNotifyResult = { ok: true; notification: OwnerNotification } | { ok: false; error: CutexRefusal };
export type OwnerNotifyAction = "ack" | "reply" | "dismiss" | "delete";
/**
 * claude-safety-grants: `cutex/safetyCheck/grant|dismiss {blockId}` on the agent's session (owner only). `ok`: the
 * updated notice; a grant whose follow-up message to the agent failed still stands (`submitError`).
 */
export type SafetyCheckDecision = "grant" | "dismiss";
export type SafetyCheckResult = { ok: true; notification: OwnerNotification; submitError: CutexRefusal | null } | { ok: false; error: CutexRefusal; notification?: OwnerNotification };
/** Longest owner reply cutex accepts (`cutex/ownerNotify/reply` text 1–20000). */
export const OWNER_REPLY_MAX = 20000;

export type ReasoningSummaryMode = "auto" | "detailed" | "concise" | "none";
/** Codex `web_search` (its WebSearchMode). */
export type WebSearchMode = "disabled" | "cached" | "indexed" | "live";

export interface ProfileConfig {
  model: string | null;
  modelProvider: string | null;
  forcedLoginMethod: string | null;
  modelReasoningEffort: string | null;
  /** Reasoning summaries (Codex `model_reasoning_summary`); null = the model's default (GPT models:
   *  none). Absent from cutex builds that don't expose it (profile-reasoning-summary). */
  modelReasoningSummary?: ReasoningSummaryMode | null;
  /** Codex `tools.update_plan.enabled`: registers the `update_plan` tool (the capsule's 进程); null =
   *  Codex default (off). Absent from cutex builds that don't expose it (profile-update-plan). */
  updatePlanEnabled?: boolean | null;
  /** Codex `web_search`: the built-in web search tool; null = Codex default (cached). Gemini relays
   *  need "disabled" (they refuse built-in tools next to function calls). Absent from cutex builds
   *  that don't expose it (profile-web-search). */
  webSearch?: WebSearchMode | null;
  modelCatalogJson: string | null;
  modelContextWindow: number | null;
  modelAutoCompactTokenLimit: number | null;
  providerName: string | null;
  providerBaseUrl: string | null;
  providerEnvKey: string | null;
  providerWireApi: string | null;
  requestMaxRetries: number | null;
  streamMaxRetries: number | null;
  streamIdleTimeoutMs: number | null;
  websocketConnectTimeoutMs: number | null;
  requiresOpenaiAuth: boolean | null;
  supportsWebsockets: boolean | null;
}

export interface ProfileDetail extends ProfileItem {
  detail: {
    config: ProfileConfig;
    apiKeyPresent: boolean;
    allowSessionSwitchExplicit: boolean | null;
    allowSessionSwitchDefault: boolean;
    catalogEditable: boolean;
    editable: Record<string, unknown>;
    /** profile-native-subagents: the stored value (null = default) and the default (null for Claude). */
    nativeSubagentsExplicit?: boolean | null;
    nativeSubagentsDefault?: boolean | null;
    /** delegation-tools: the stored value (null = default) and the default (Codex on, Claude off). */
    delegationWaitExplicit?: boolean | null;
    delegationWaitDefault?: boolean;
    /** Claude profiles: AskUserQuestion in agent-started turns (see `AgentTurnQuestions`). */
    agentTurnQuestions?: AgentTurnQuestions | null;
    /** profile-plan-label: the stored (manual) label; ChatGPT profiles use it only while signed out. */
    planLabelManual?: string | null;
    /** claude-tool-defaults (Claude profiles): stored rule (null = unset) and what unset means (on). */
    claudeAllowWriteExplicit?: boolean | null;
    claudeAllowWriteDefault?: boolean | null;
    claudeAllowExecExplicit?: boolean | null;
    claudeAllowExecDefault?: boolean | null;
    /** Claude profiles: file checkpoints (Claude Code snapshots files before edits) — stored value
     *  (null = unset) and the default (false; null for Codex). Absent on older cutex. */
    claudeFileCheckpointingExplicit?: boolean | null;
    claudeFileCheckpointingDefault?: boolean | null;
    /** claude-profile-default-model (Claude profiles): the item's `model` is the effective default of
     *  new sessions; these are its sources — the profile's own default, the per-profile
     *  `newSessionDefaults` override (wins; a PATCH `model` drops it) and the built-in default. */
    claudeProfileModel?: string | null;
    claudeNewSessionModel?: string | null;
    claudeBuiltinDefaultModel?: string | null;
  };
  /** Same as `detail.agentTurnQuestions` (cutex may put it at either level). */
  agentTurnQuestions?: AgentTurnQuestions | null;
}

/**
 * Claude profiles: what AskUserQuestion does in a turn another agent / the bus started — "decide"
 * (answer "no human available, decide yourself"; the default) or "wait" (wait for the owner).
 * Owner-started turns always wait.
 */
export type AgentTurnQuestions = "decide" | "wait";

/** PATCH body: omitted = keep, null = clear. `apiKey` is write-only. */
export type ProfilePatch = Partial<{ [K in Exclude<keyof ProfileConfig, "modelCatalogJson">]: ProfileConfig[K] }> & {
  color?: string | null;
  /** profile-provider-category-v2: kimi / glm / zai / claude / deepseek / codex / other; null = infer again. */
  providerCategory?: string | null;
  allowSessionSwitch?: boolean | null;
  apiKey?: string;
  /** Rename — only sent when cutex reports `detail.editable.name === true`. */
  name?: string;
  /** profile-native-subagents (Codex only): null = back to the default. */
  nativeSubagents?: boolean | null;
  /** profile-agent-approval. */
  agentUseRequiresApproval?: boolean;
  /** profile-generic-switches (Codex profiles, `detail.editable.privateChatgptAuthFile`). */
  privateChatgptAuthFile?: boolean;
  /** profile-tool-schema-compat (Codex profiles): null = back to the default (off). */
  toolSchemaCompat?: "off" | "strict" | null;
  /** delegation-tools: `delegation_wait` on this profile; null = back to the default. */
  delegationWait?: boolean | null;
  /** profile-search-tool (Codex API-key profiles, `detail.editable.searchTool`): the `web_search` cutex tool. */
  searchTool?: boolean;
  /** Claude profiles (`detail.editable.agentTurnQuestions`). */
  agentTurnQuestions?: AgentTurnQuestions;
  /** claude-tools-settings (Claude profiles, `detail.editable.claudeTools`); null = unset (claude-tool-defaults: on). */
  claudeAllowWrite?: boolean | null;
  claudeAllowExec?: boolean | null;
  /** Claude profiles (`detail.editable.claudeFileCheckpointing`): null = clear (off); applies at the next runtime launch. */
  claudeFileCheckpointing?: boolean | null;
  /** profile-plan-label (Codex profiles, ≤ 40 chars): null clears the stored label. */
  planLabel?: string | null;
  /** claude-accounts (Claude profiles): `ca-…`, or null / `default` = the shared account; an unknown id → 400. */
  claudeAccount?: string | null;
  /** profile-model-display-names: merge; a string sets that entry's name, null removes it. */
  modelDisplayNames?: Record<string, string | null>;
};

export type ContextSource = "profile" | "catalog" | "default90Percent" | "unknown";

export interface CatalogModel {
  id: string;
  /** Actual upstream model for a named configuration; absent/null for ordinary model rows. */
  requestModel?: string | null;
  /** cutex `profile-model-display-names`: this profile's name for the entry (null = none). */
  entryDisplayName?: string | null;
  displayName: string | null;
  contextWindow: number | null;
  maxContextWindow: number | null;
  autoCompactTokenLimit: number | null;
  effectiveContextWindowPercent: number | null;
  inputModalities: string[];
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  discovered: boolean;
  effective: { contextWindow: number | null; contextWindowSource: ContextSource; autoCompactTokenLimit: number | null; autoCompactTokenLimitSource: ContextSource };
}

/**
 * Where a profile's model list came from (cutex `/models` → `modelsSource`):
 * `catalog` (editable model catalog), `nativeCache` (cute-codex models_cache.json), `nativeBundled`
 * (the list compiled into cute-codex), `claudeAliases`. Newer cutex adds `native` (the installed
 * cute-codex) and `notInBundled` (cached slugs missing from the compiled list).
 */
export interface ModelsSource {
  kind: "catalog" | "nativeCache" | "nativeBundled" | "claudeAliases" | "overlay" | (string & {});
  clientVersion?: string | null;
  fetchedAt?: string | null;
  cliSha256?: string | null;
  native?: { version?: string | null; cliSha256?: string | null } | null;
  notInBundled?: string[] | null;
  /** `overlay` (cutex `profile-catalog-overlay`): the live upstream list the profile's edits apply to; null when unavailable. */
  upstream?: ModelsSource | null;
}

/** cutex `profile-catalog-overlay`: an edited entry whose model (or a configuration's base model) left upstream. */
export interface UnavailableModel {
  id: string;
  requestModel: string | null;
  displayName: string | null;
  entryDisplayName?: string | null;
  reason: "baseModelMissing" | "modelMissing" | (string & {});
}

export interface ProfileModelsView {
  profile: { id: string; name: string };
  catalogSupported: boolean;
  /** Requires both profile-model-variants and a compatible native runtime. */
  modelVariantsSupported?: boolean;
  /** Older daemons only expose editable catalogs for API-key discovery. */
  discoverySupported?: boolean;
  /** Absent on older cutex. */
  modelsSource?: ModelsSource | null;
  /** Why `models` is empty (e.g. no native cache yet); absent on older cutex. */
  modelsUnavailableReason?: string | null;
  catalogPresent: boolean;
  /** cutex `profile-catalog-overlay`: the list follows upstream (official profiles); edits are kept as this profile's overlay. */
  followsUpstream?: boolean;
  catalogOverlay?: { entries: number; migratedFrom: string | null } | null;
  unavailableModels?: UnavailableModel[];
  selectedModel: string | null;
  profileOverrides: { modelContextWindow: number | null; modelAutoCompactTokenLimit: number | null };
  discovery: { sourceUrl: string; fetchedAt: string; models: string[] } | null;
  models: CatalogModel[];
  unsupportedModelFields: string[];
  precedence: unknown;
}

export type CatalogModelPatch = Partial<Pick<CatalogModel, "requestModel" | "displayName" | "contextWindow" | "maxContextWindow" | "autoCompactTokenLimit" | "effectiveContextWindowPercent" | "inputModalities" | "supportedReasoningEfforts" | "defaultReasoningEffort">>;

export interface UserInstructions {
  path: string;
  exists: boolean;
  content: string;
  revision: string;
  maxBytes: number;
  overridePath: string;
  overrideActive: boolean;
}

export interface GlobalSettings {
  defaultProfile: string | null;
  defaultProfileDirectLaunch: boolean;
  newSessionDefaults: Record<string, { model: string | null; reasoning: string | null }>;
  newSessionNotification: "important" | "normal" | "off";
  agentBusEnabled: boolean;
  agentBusPort: number | null;
  agentBusEffectivePort: number | null;
  /** Templates around relayed agent messages; gone since cutex `agent-harness` (r218 rejects them). */
  agentMessagePrefixTemplate?: string | null;
  agentMessageSuffixTemplate?: string | null;
  claudeUsageRefreshMinutes: number | null;
  secretsPresent: Record<string, boolean>;
  restartRequiredFields: string[];
  newRuntimesOnlyFields: string[];
  /** Effective per-kind launch defaults (feature new-thread-defaults; absent on older cutex). */
  newThreadDefaults?: NewThreadDefaults;
  newThreadDefaultsBuiltin?: NewThreadDefaults;
  /** cutex `session-delete-empty-on-archive`: archiving a session with no turns deletes it. */
  /** cutex session-delete-empty-on-archive (default true). */
  archiveDeleteEmpty?: boolean;
  /** cutex `quick-chat-default-profile`: profile for new quick chats (null = the global default). */
  /** cutex quick-chat-default-profile: used by quick chats created without a profile. */
  quickChatDefaultProfile?: string | null;
  /** cutex `auto-thread-titles`: name unnamed chats after their first message (default on). */
  autoThreadTitles?: boolean;
  /** Model for those titles; null = gpt-5.6-luna on a ChatGPT login, else the chat's own model. */
  threadTitleModel?: string | null;
  /** cutex `codex-plugins`: Codex agents launch with the shared home's [plugins] (default on). */
  codexConfigFollowShared?: boolean;
  /** cutex `agent-project-boundary` (absent on older cutex). Changed through `patchAgentSecurity`. */
  agentSecurity?: AgentSecurity;
  // ---------- cutex `listen-settings` (absent on older cutex) ----------
  /** Configured Management listen entries; null = default (loopback only). Applies at the next daemon start. */
  managementListen?: string[] | null;
  managementListenDefault?: string[];
  /** Parsed rows of the effective list, or `{error}` when the stored list is invalid. */
  managementListenEntries?: ListenEntry[] | { error: string };
  /** Remote listeners bound right now ("ip:port"). */
  managementListenActiveRemote?: string[];
  /** Exact Origin allow-list for browser / Capacitor clients; null = default. Applied at once. */
  managementCorsOrigins?: string[] | null;
  managementCorsOriginsDefault?: string[];
  /** Issued client / device tokens (null = token store unreadable). */
  remoteAccess?: { clientTokens: number | null; devices: number | null };
  /** cutex `owner-notify` (absent on older cutex). Changed through `patchOwnerNotify`. */
  ownerNotify?: OwnerNotifySettings;
  /** cutex `agent-harness`: the `# Cutex` launch section (new runtimes only; absent on older cutex). */
  agentHarness?: { enabled: boolean };
  agentHarnessDefault?: { enabled: boolean };
  /** cutex `wake-busy-wait` (r220; absent on older cutex): a wake / delegation results for a busy Codex
   *  agent wait this long for the turn to end, then are read at its next step. 0 = next step at once;
   *  null = never early (wait for the turn end). Read per delivery (no restart). PATCH `{agentBus:
   *  {wakeBusyWaitSecs}}`; a negative value is stored as null. */
  agentBus?: { wakeBusyWaitSecs: number | null };
  agentBusDefault?: { wakeBusyWaitSecs: number | null };
  agentBusRange?: { wakeBusyWaitSecs: [number, number] };
  /** cutex `peers-v2`: global cross-host settings. Changed through `patchPeersSettings`. */
  peers?: PeersSettings;
  /** cutex `admission-order` (absent on older cutex): `ownerMayPassAsks` (default true) lets the owner
   *  move a queued message ahead of delegations / deliveries; false refuses such a move
   *  (`passing_not_allowed`). PATCH `{queue: {ownerMayPassAsks}}`. */
  queue?: { ownerMayPassAsks: boolean };
  queueDefault?: { ownerMayPassAsks: boolean };
}

/** Section ids of `GET /v2/sessions/{id}/harness`, in launch order. */
export type AgentHarnessSectionId = "cutex" | "agentsMdUser" | "agentsMdProject" | "fileReferences" | "memory";

/** `GET /v2/sessions/{id}/harness` (cutex `agent-harness`, root): the launch text cutex adds, rendered now. */
export interface AgentHarnessPreview {
  cutexSessionId: string;
  runtime: "codex" | "claude";
  enabled: boolean;
  /** The `# Cutex` section (rendered also when disabled). */
  harness: string;
  harnessBytes: number;
  /** Codex: developer instructions (the profile / role instructions between `cutex` and
   *  `fileReferences` are not included); Claude: appended to the Claude Code preset prompt. */
  placement: "developerInstructions" | "claudePresetAppend";
  sections: { id: AgentHarnessSectionId | (string & {}); text: string; bytes: number }[];
  text: string;
  bytes: number;
}

/** One `/v2/settings` `managementListenEntries` row. */
export interface ListenEntry {
  entry: string;
  kind: "loopback" | "tailscale" | "address" | "wildcard" | string;
  port: number;
  warning: string | null;
}

/** `POST /v2/pairing-codes` (cutex device-pairing). `code` is the one secret the UI shows; never logged. */
export interface PairingCodeView {
  code: string;
  expiresAt: string;
  label?: string | null;
  hostId: string;
  instanceId?: string;
  urls: string[];
  qr: string;
  /** cutex `users`: the user the paired device will be bound to (echoed). */
  userId?: string | null;
}

/** `GET /v2/client-tokens` row: metadata only, the token itself never leaves cutex. */
export interface ClientTokenView {
  tokenId: string;
  label: string;
  kind: "client" | "device" | string;
  deviceName?: string | null;
  platform?: string | null;
  /** cutex `client-token-rename`: the owner-given display name (null: none). */
  ownerName?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  lastAddress?: string | null;
}

/** A boundary domain: `project:<projectId>` or `agent:<cutexSessionId of a creator-tree root>`. */
export type DomainKey = string;

/** One `agentSecurity.externalAgents` grant (cutex `agent-external-grants`). */
export interface ExternalAgentGrant {
  /** Agents in this project may see and message `agent`; it may message them back but does not see the project. */
  project: string;
  agent: string;
}

/** `/v2/settings` → `agentSecurity` (cutex docs/agent-tool-security.md §4). */
export interface AgentSecurity {
  crossProjectAccess: "isolated" | "host";
  crossProjectAccessOptions?: ("isolated" | "host")[];
  crossProjectAccessDefault?: "isolated" | "host";
  links: [DomainKey, DomainKey][];
  maxLinks?: number;
  /** cutex `agent-external-grants`; absent on older cutex. */
  externalAgents?: ExternalAgentGrant[];
  maxExternalAgents?: number;
}

/** `PATCH /v2/settings {agentSecurity}`: omitted fields keep their value; lists replace the stored list. */
export interface AgentSecurityPatch {
  crossProjectAccess?: "isolated" | "host";
  links?: [DomainKey, DomainKey][];
  externalAgents?: ExternalAgentGrant[];
}

/** cutex owner approval (`GET /v2/approvals`, feature `owner-approvals`). */
export interface ApprovalRecord {
  approvalId: string;
  kind: "managed_service" | "agent_profile" | "browser_claim" | "browser_open" | "workflow_run" | (string & {});
  /** `outside_caller_envelope`, `profile_requires_approval`, … */
  reason: string;
  requesterCutexSessionId: string;
  requesterName?: string | null;
  projectId?: string | null;
  /** One line for the owner, e.g. `register managed service web: npm run dev`. */
  summary: string;
  /** Structured request facts (no secret values). */
  details: Record<string, unknown> | null;
  requestSha256: string;
  state: "pending" | "approved" | "denied" | "consumed" | "expired";
  createdAt: string;
  decidedAt?: string | null;
  note?: string | null;
  consumedAt?: string | null;
}

export type ApprovalDecision = "approve" | "deny";
export type ApprovalDecisionResult = { ok: true; approval: ApprovalRecord } | { ok: false; error: CutexRefusal };

/** Browser approval facts from cutex; identity is checked again by main/daemon, never model input. */
export interface BrowserApprovalDetails {
  version: 1;
  cutexSessionId: string;
  agentName: string;
  requestId: string;
  deviceId: string;
  hostId: string;
  connectionGeneration: string;
  threadId: string;
  runtimeGeneration: number;
  intentDigest: string;
}
export interface BrowserClaimApprovalDetails extends BrowserApprovalDetails {
  reason: string;
  urlHint?: string;
  sharesOwnerLogin: true;
}
export interface BrowserOpenApprovalDetails extends BrowserApprovalDetails {
  url: string;
  title: string;
}

// ---- runtime package upgrade (cutex `runtime-package-upgrade`, root) ----

/** A runtime bundle (native app-server + cutex-mcp facade) as cutex summarises it. */
export interface RuntimePackageSummary {
  manifest: string | null;
  nativePath: string | null;
  /** e.g. "0.160.0-r50". */
  nativeVersion: string | null;
  /** Short label, e.g. "r50". */
  nativeRelease: string | null;
  facadePath: string | null;
  /** Short label, e.g. "r209". */
  facadeRelease: string | null;
  /** False when the manifest is missing / unreadable (other fields may be null). */
  readable: boolean;
  /** Pinned files that no longer exist (an old release directory was deleted); cutex feat/runtime-packages-repair. */
  missing?: string[];
}

/** An explicit-launch agent whose pinned bundle differs from the selected one. */
export interface OutdatedRuntimeAgent {
  cutexSessionId: string;
  name: string;
  contractVersion: number;
  current: RuntimePackageSummary;
  runtimeStatus: string;
  online: boolean;
  busy: boolean;
  busyReason: "activeTurn" | "threadActive" | null;
  activeTurnId: string | null;
  threadStatus: string | null;
  /** Its pinned package files were deleted: the upgrade is a repair (cutex feat/runtime-packages-repair). */
  repair?: boolean;
}

export type RuntimePackageItemState = "pending" | "running" | "moved" | "skipped" | "failed";
export type RuntimePackageStep = "offline" | "reconcile" | "review" | "apply" | "revert" | "online";

export interface RuntimePackageRunItem {
  cutexSessionId: string;
  name: string;
  state: RuntimePackageItemState;
  step: RuntimePackageStep | null;
  /** skipped: busy | alreadyCurrent | notFound | contractChanged | notEligible; failed: offlineFailed | reviewRefused |
   *  targetMismatch | selectedChanged | applyFailed | revertFailed | interrupted; moved but not back online: onlineFailed. */
  code: string | null;
  reason: string | null;
  wasOnline: boolean | null;
  backOnline: boolean | null;
  previousRuntimeVersion: string | null;
  targetRuntimeVersion: string | null;
  previousFacadeRelease: string | null;
  targetFacadeRelease: string | null;
  actionId: string | null;
  committedAt: string | null;
  previousContract: Record<string, unknown> | null;
  targetContract: Record<string, unknown> | null;
  /** The pinned package was gone: moved as a repair, never reverted. */
  repair?: boolean;
}

export interface RuntimePackageRun {
  runId: string;
  kind: "upgrade" | "revert";
  revertOf: string | null;
  revertedBy: string[];
  state: "running" | "completed" | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  selected: RuntimePackageSummary;
  counts: { total: number; pending: number; moved: number; skipped: number; failed: number };
  currentAgentId: string | null;
  items: RuntimePackageRunItem[];
}

/** `GET /v2/runtime-packages`. */
export interface RuntimePackagesView {
  hostId: string;
  selected: RuntimePackageSummary | null;
  selectedError: string | null;
  agents: OutdatedRuntimeAgent[];
  activeRun: RuntimePackageRun | null;
  lastRun: RuntimePackageRun | null;
  /** The newest finished upgrade run while it has agents no revert has moved back yet (cutex 3b1b8c8+;
   *  absent from older daemons). A revert of it takes only those agents. */
  revertable?: { runId: string; agentIds: string[] } | null;
}

/**
 * `cutex/runtimePackages/runUpdated` host event params: the run header plus at most the one item
 * that changed (no `items` / `selected` / `revertedBy`; `status` = the run's `state`). Clients
 * fetch the full run (`GET /v2/runtime-packages/runs/{id}`) for a run they have not seen.
 */
export interface RuntimePackageRunEvent {
  runId: string;
  kind: RuntimePackageRun["kind"];
  status: RuntimePackageRun["state"];
  revertOf: string | null;
  startedAt: string;
  finishedAt: string | null;
  currentAgentId: string | null;
  counts: RuntimePackageRun["counts"];
  item?: RuntimePackageRunItem;
}

export type RuntimePackageRunResult = { ok: true; run: RuntimePackageRun } | { ok: false; error: CutexRefusal };

// ---------- owner-initiated Director rotation (cutex `owner-rotation`, schema owner-rotation.json) ----------

export type DirectorRotationState =
  | "requested"
  | "handoff_requested"
  | "handoff_written"
  | "timeout"
  | "successor_created"
  | "authority_rebound"
  | "predecessor_disposed"
  | "done"
  | "cancelled"
  | "failed";
/** What the old Director becomes once the successor holds the seat. */
export type PredecessorDisposition = "archive" | "member" | "operator";

/** `POST /v2/director-rotations` (the desktop's `requestId` makes a retry idempotent). Omitted
 *  successor fields follow the Director (model / effort only while the profile stays the same). */
export interface DirectorRotationStart {
  requestId: string;
  projectId: string;
  expectedDirectorCutexSessionId: string;
  expectedAuthorityEpoch: number;
  predecessor: PredecessorDisposition;
  /** 60–86400; cutex default 600. */
  handoffTimeoutSecs?: number;
  successor: { name?: string; profile?: string; model?: string; reasoningEffort?: string; cwd?: string };
}

export interface DirectorRotation {
  rotationId: string;
  requestId: string;
  projectId: string;
  projectName: string;
  state: DirectorRotationState;
  predecessor: { cutexSessionId: string; name: string };
  expectedAuthorityEpoch: number;
  disposition: PredecessorDisposition;
  successorSpec: { name: string; profile: string | null; model: string | null; reasoningEffort: string | null; cwd: string; sandbox: string | null; approvalPolicy: string | null };
  handoff: { path: string; timeoutSecs: number; requestedAt: string | null; deadline: string | null; writtenAt: string | null; skipped: boolean };
  successorCutexSessionId: string | null;
  successorCreateStartedAt: string | null;
  authorityEpoch: number | null;
  /** Open delegations of the old Director: they stay with it (archive cancels / fails them). */
  predecessorDelegations: { requested: number; handling: number };
  attempts: number;
  error: { code: string; message: string } | null;
  warnings: string[];
  history: { state: DirectorRotationState; at: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  revision: number;
}

export type DirectorRotationResult = { ok: true; rotation: DirectorRotation } | { ok: false; error: CutexRefusal };

// ---------- stuck Agent Bus messages (cutex `agent-bus-stuck-messages`, root; shared/agentBusStuck.ts adapts the wire) ----------

/** A session named on a stuck message (`name` null for an id cutex cannot resolve). */
export interface StuckBusParty {
  id: string;
  name: string | null;
}

/** One undelivered message: a durable `pending` / `stale_held` record, or an entry only the bus's in-memory queue still holds (`durable` false, state `live_only`). */
export interface StuckBusMessage {
  messageId: string;
  state: string;
  durable: boolean;
  to: StuckBusParty | null;
  from: StuckBusParty | null;
  ageSecs: number | null;
  createdAtEpochSecs: number | null;
  /** The sender's label (`agent`, `owner`, `job_service`, …); null when cutex does not say. */
  senderKind: string | null;
  /** Task / Job / control message: discarding needs an explicit allow, and the list says so. */
  protectedControl: boolean;
  /** The native runtime may already hold a copy: a discard quarantines instead of dropping. */
  nativeSubmissionPresent: boolean;
  /** Makes a discard apply only to this exact message. */
  semanticSha256: string | null;
  /** Code / text of the last delivery error, if any. */
  errorCode: string | null;
  errorMessage: string | null;
  /** Why cutex thinks it is stuck, one line each (English, cutex's words). */
  reasons: string[];
  /** First 200 characters of the content. */
  contentPreview: string;
}

export interface StuckBusView {
  messages: StuckBusMessage[];
  /** Messages cutex found; more than `messages.length` when its list limit cut the list. */
  total: number;
  /** False when the live bus could not be read: messages held only in memory are then missing. */
  liveQueueAvailable: boolean;
  liveQueueError: string | null;
  minAgeSecs: number;
}

export interface StuckBusDiscardRequest {
  messageId: string;
  /** Digest from the list: the discard is refused (message_digest_mismatch) if the message changed. */
  expectedSemanticSha256?: string | null;
  /** Needed for a Task / Job / control message (`protectedControl`). */
  allowProtected?: boolean;
}

export interface StuckBusDiscarded {
  messageId: string;
  /** False when it was already discarded (or already gone from every queue). */
  changed: boolean;
  /** The record is terminal, but the live bus could not be told to drop it (the runtime ACKs it on its next poll). */
  liveWithdrawError: string | null;
}

export type StuckBusDiscardResult = { ok: true; discarded: StuckBusDiscarded } | { ok: false; error: CutexRefusal };

export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  efforts: string[];
  defaultEffort: string;
  isDefault: boolean;
  /** cute-codex InputModality tags ("text", "image", …). */
  inputModalities: string[];
  /** The model's Fast service tier id (`priority`) from `serviceTiers`; null / absent = no Fast mode (shared/fastMode). */
  fastTier?: string | null;
}

export type ServerRequestReply = { result: unknown } | { error: { code: number; message: string } };

/** Host list / SSH tunnel calls (main `HostManager`; shared/hosts.ts). Tokens never cross IPC. */
export interface HostApi {
  hosts(): Promise<HostsState>;
  /** Host aliases from ~/.ssh/config (names only), offered by 添加 SSH 主机. */
  sshConfigHosts(): Promise<string[]>;
  /** Pair (ssh → `cutex management client-token issue`) and store the host; failures as a result. */
  addSshHost(request: AddSshHostRequest): Promise<HostResult>;
  /** Issue a fresh client token for a stored host (token revoked / lost). */
  pairSshHost(hostId: string): Promise<HostResult>;
  updateSshHost(hostId: string, patch: SshHostPatch): Promise<HostResult>;
  /** Forget the host and its token; best-effort revoke on the remote. */
  removeSshHost(hostId: string): Promise<{ revoked: boolean }>;
  /**
   * Scope = this one host (connected on the way; the switcher). Already the scope: reconnect it.
   * Other connected hosts stay connected when they auto-connect (multi-host RFC §3).
   */
  switchHost(hostId: string): Promise<void>;
  /** Set the view scope (connects its hosts; persisted in hosts.json). Renderer: lib/hostScope `setViewScope`. */
  setScope(scope: ViewScope): Promise<void>;
  /** Retry a host's connection now (default: the focus host). */
  reconnectHost(hostId?: string): Promise<void>;
  /** Connect / disconnect one host (does not change the scope; the scope's hosts stay connected). */
  connectHost(hostId: string, on: boolean): Promise<void>;
  /** Connect this host at launch and keep it connected outside the scope (★ default on). */
  setHostAutoConnect(hostId: string, on: boolean): Promise<HostsState>;
  /** Desktop-local look of a host (color; hosts.json). */
  setHostAppearance(hostId: string, patch: HostAppearancePatch): Promise<HostsState>;
  /**
   * Replace the host groups (Settings → 主机 → 分组; whole list, order = switcher order). Validated by
   * shared `normalizeHostGroups` (throws `bad groups: <HostGroupError>`); new drafts get ids. A group
   * scope whose group is gone or left without members falls back (★ RFC Q20).
   */
  saveHostGroups(groups: HostGroupDraft[]): Promise<HostsState>;
  testHost(hostId: string): Promise<HostTestResult>;
  setHostStartOn(value: HostStartOn): Promise<HostsState>;
  /** SSH questions waiting for the user (key passphrase, password, unknown host key …; event `sshPrompts`). */
  sshPrompts(): Promise<import("./sshPrompt").SshPromptView[]>;
  /** Answer one (null = cancel). The answer goes only to the ssh process that asked; main keeps no copy beyond that operation. */
  answerSshPrompt(id: string, answer: import("./sshPrompt").SshPromptAnswer): Promise<boolean>;
  // P2 person identity (main/personIdentity.ts; the private key never crosses IPC).
  /** This desktop's public key / fingerprint and each connected host's claim state. */
  identityState(): Promise<import("./personIdentity").PersonIdentityView>;
  /** 导出身份: main's save dialog writes the identity file. */
  exportIdentity(title: string): Promise<import("./personIdentity").IdentityFileResult>;
  /** 导入身份: main's open dialog, then a confirm dialog (these texts), then every host is claimed again. */
  importIdentity(texts: import("./personIdentity").IdentityImportTexts): Promise<import("./personIdentity").IdentityFileResult>;
  /** 复制身份密钥: main writes the identity key string to the clipboard (it never reaches the renderer) and clears it after a minute if unchanged. */
  copyIdentityKey(): Promise<import("./personIdentity").IdentityKeyCopyResult>;
  /** 粘贴身份密钥: the pasted string is checked by main; a different identity replaces this one after the same confirm dialog as importIdentity. */
  importIdentityKey(text: string, texts: import("./personIdentity").IdentityImportTexts): Promise<import("./personIdentity").IdentityFileResult>;
  /** 「你」's name, sent with identity claims (null: none set); pending devices are claimed again with it. */
  setIdentityName(name: string | null): Promise<void>;
  /**
   * 复制到其他主机 (cutex `profile-transfer` on both hosts): main exports the profile on the source host
   * and imports it on the target; the bundle (maybe with an API key) never reaches the renderer. Failures
   * are a result, not a throw.
   */
  copyProfileToHost(request: import("./profileTransfer").ProfileTransferRequest): Promise<import("./profileTransfer").ProfileTransferResult>;
}

/** HostApi method names: served by main `HostManager`, never routed to a daemon (main + preload). */
export const HOST_METHOD_NAMES = ["hosts", "sshConfigHosts", "addSshHost", "pairSshHost", "updateSshHost", "removeSshHost", "switchHost", "setScope", "reconnectHost", "connectHost", "setHostAutoConnect", "setHostAppearance", "saveHostGroups", "testHost", "setHostStartOn", "sshPrompts", "answerSshPrompt", "identityState", "exportIdentity", "importIdentity", "copyIdentityKey", "importIdentityKey", "setIdentityName", "copyProfileToHost"] as const satisfies readonly (keyof HostApi)[];

/** Request/response calls (renderer → main). */
/** Native Windows sandbox readiness (`windowsSandbox/readiness`; cutex windows-sandbox-readiness). */
export type WindowsSandboxReadiness = "ready" | "notConfigured" | "updateRequired";

export interface DesktopApi extends DaemonApi, HostApi {}

/** Daemon calls (main `DaemonService`, against the active host). */
export interface DaemonApi {
  notesList(query?: NotesQuery): Promise<NotesResult>;
  notesGet(id: string): Promise<Note>;
  notesCreate(input: NoteCreate): Promise<Note>;
  notesUpdate(id: string, patch: NoteUpdate): Promise<Note>;
  notesDelete(id: string, expectedRevision: number): Promise<{ deleted: true }>;
  sideOpen(sessionId: string, input?: SideOpenInput): Promise<SideOpenResult>;
  sideList(sessionId: string): Promise<{ chats: SideChat[] }>;
  sideRead(sessionId: string, chatId: string, afterRevision?: number, waitMs?: number): Promise<{ chat: SideChat }>;
  sideSend(sessionId: string, chatId: string, input: SideMessageInput): Promise<{ chat: SideChat; turnId: string }>;
  sideInterrupt(sessionId: string, chatId: string): Promise<{ chat: SideChat }>;
  sideRespond(sessionId: string, chatId: string, requestId: string | number, reply: SideReply): Promise<{ chat: SideChat }>;
  sideClose(sessionId: string, chatId: string): Promise<{ closed: true }>;
  daemonState(): Promise<DaemonState>;
  /** `GET /v2/fs/dirs` (fs-dir-browse): the in-app folder browser on a remote host; null on older cutex. */
  browseDirs(path?: string): Promise<DirBrowse | null>;
  sidebar(): Promise<SidebarSnapshot>;
  /** `turnLimit` (history-pages): newest turns only + `historyPage`; ignored by older cutex. */
  bootstrap(sessionId: string, turnLimit?: number): Promise<SessionBootstrap>;
  /**
   * A page of turns (offline-history; with history-pages also while live): the newest `limit`
   * (default 20) older than `cursor`. Null if unsupported.
   */
  history(sessionId: string, cursor?: string | null, limit?: number): Promise<SessionHistory | null>;
  /** Start streaming events for a session from the bootstrap checkpoint. */
  subscribe(sessionId: string, from: { streamId: string; after: string | null }): Promise<void>;
  unsubscribe(sessionId: string): Promise<void>;
  /**
   * `options.extra`: image / skill / mention input items sent after the text item (cute-codex
   * UserInput). `clientUserMessageId` keys the optimistic "pending steer" bubble.
   */
  submit(sessionId: string, text: string, strategy: SubmitStrategy, startIfOffline?: boolean, options?: SubmitOptions): Promise<UserInputSubmitResult>;
  /**
   * Native image chooser (local host only): picked files as `localImage` paths + small previews.
   * `maxBytes`: the agent's per-image limit (Claude: 5 MB), never above MAX_IMAGE_BYTES.
   */
  pickImages(maxBytes?: number): Promise<PickedImage[]>;
  interrupt(sessionId: string, threadId: string, turnId: string): Promise<void>;
  /** cute-codex `model/list` (forwarded through cutex). */
  listModels(sessionId: string): Promise<ModelOption[]>;
  /** cute-codex `thread/settings/update` (model, effort, approvalPolicy, sandboxPolicy, …). */
  updateThreadSettings(sessionId: string, threadId: string, patch: Record<string, unknown>): Promise<void>;
  /** cute-codex `thread/compact/start`. */
  compactThread(sessionId: string, threadId: string): Promise<void>;
  /** Profile quota gauges from cutex; [] when unconfigured or the daemon predates the route. */
  profileQuota(profile: string, refresh?: boolean): Promise<QuotaGauge[]>;
  /**
   * Stop-gap: native `account/rateLimits/read` on this agent's runtime (the `rateLimits` snapshot),
   * used only while cutex lacks `profile-quota-native`. null on any error.
   */
  readRateLimits(sessionId: string): Promise<Record<string, unknown> | null>;
  /**
   * cutex windows-sandbox-readiness: native `windowsSandbox/readiness` on this agent's runtime (its
   * native home's config as the runtime started with it). null on any error (older cutex, Claude
   * runtime, offline).
   */
  windowsSandboxReadiness(sessionId: string): Promise<WindowsSandboxReadiness | null>;
  /**
   * Native `windowsSandbox/setupStart {mode: "unelevated"}` on this agent's runtime (owner only; no
   * administrator rights; writes `[windows] sandbox = "unelevated"` to that agent's native home).
   * Answers `{started}`; the outcome arrives as the session's native `windowsSandbox/setupCompleted`.
   * The running thread keeps its sandbox level until the agent is relaunched.
   */
  setupWindowsSandbox(sessionId: string): Promise<{ started: boolean }>;
  quotaConfig(profile: string): Promise<QuotaConfigView>;
  putQuotaConfig(profile: string, patch: { preset?: QuotaConfigView["preset"]; primary?: QuotaReaderConfig; extras?: QuotaReaderConfig[] }): Promise<QuotaConfigView>;
  /** `/v2/capabilities`; null when the daemon predates it. */
  capabilities(): Promise<CapabilitiesView | null>;
  usage(query: { from?: string; to?: string; groupBy: UsageDimension[]; source?: UsageSourceFilter }): Promise<UsageReport | null>;
  /** `GET /v2/usage/sources` (usage-external-sources): extra usage directories with scan status; null on an older cutex. */
  usageSources(): Promise<UsageSourcesView | null>;
  /** `POST /v2/usage/sources`: add one (cutex starts a scan). 409 usage_source_overlaps_cutex when the directory holds runs cutex records itself. */
  addUsageSource(source: UsageSourceCreate): Promise<UsageSourceResult>;
  /** `PATCH /v2/usage/sources/{id}`. */
  patchUsageSource(id: string, patch: UsageSourcePatch): Promise<UsageSourceResult>;
  /** `DELETE /v2/usage/sources/{id}[?purge=true]`: purge also drops its imported rows. */
  deleteUsageSource(id: string, purge: boolean): Promise<UsageSourceDeleteResult>;
  /** `POST /v2/usage/sources/{id}/rescan` (202; the scan runs in the background). */
  rescanUsageSource(id: string): Promise<UsageSourceResult>;
  usagePrices(): Promise<UsagePrices>;
  putUsagePrices(prices: UsagePrices): Promise<UsagePrices>;
  fsDir(scope: WorkspaceScope, path: string): Promise<FsDir>;
  fsFile(scope: WorkspaceScope, path: string, maxBytes?: number): Promise<FsFile>;
  /** `GET /v2/fs/file` (fs-file-read): any absolute path on the active host (owner-only), same body as `fsFile`. */
  hostFile(path: string, maxBytes?: number): Promise<FsFile>;
  fsSearch(scope: WorkspaceScope, q: string, limit?: number): Promise<{ query: string; results: { path: string; score: number }[] }>;
  gitStatus(scope: WorkspaceScope): Promise<GitStatus>;
  gitDiff(scope: WorkspaceScope, path?: string, staged?: boolean): Promise<{ path: string | null; staged: boolean; diff: string; truncated: boolean }>;
  /** Start watching a workspace root; changes arrive as `workspaceChanged`. Returns a watch id. */
  watchWorkspace(scope: WorkspaceScope): Promise<string>;
  unwatchWorkspace(watchId: string): Promise<void>;
  terminalList(scope: WorkspaceScope): Promise<TerminalSummary[]>;
  terminalCreate(scope: WorkspaceScope, cols: number, rows: number): Promise<TerminalSummary>;
  /** Stream output as `terminalOutput` events, replaying the scrollback first. */
  terminalAttach(terminalId: string): Promise<void>;
  terminalDetach(terminalId: string): Promise<void>;
  terminalInput(terminalId: string, data: string): Promise<void>;
  terminalResize(terminalId: string, cols: number, rows: number): Promise<void>;
  terminalKill(terminalId: string): Promise<void>;
  /** cutex `POST /v2/codex/requests`: allowlisted global codex config / MCP / skills / hooks methods on the shared CODEX_HOME. Throws on native errors. */
  codexRequest(method: string, params?: unknown): Promise<unknown>;
  /** `GET /v2/codex/skills/archive` (skills-archive): archived user skills, newest first; null on an older cutex. */
  skillArchives(): Promise<SkillArchiveList | null>;
  /** `POST /v2/codex/skills/archive`: move a user skill (its `path` from skills/list) into the archive. Refusals (409 skill_not_archivable …) come back as `ok: false`. */
  archiveSkill(path: string): Promise<SkillArchiveResult>;
  /** `POST /v2/codex/skills/archive/{id}/restore`: move it back (409 skill_name_taken when its place is taken). */
  restoreSkill(archiveId: string): Promise<SkillArchiveResult>;
  /** `GET /v2/codex/managed-mcp`: MCP servers cutex injects at launch, with tool lists. null on older cutex. */
  managedMcp(): Promise<{ servers: { name: string; configured?: boolean; approvalMode: string; toolsSource: string; tools: { name: string; description: string }[] | null }[] } | null>;
  /** `POST /v2/human/agents` (human-create-agent): new agent, optionally in a project and started. */
  createAgent(request: { name: string; projectId?: string; cwd?: string; profile?: string; start: boolean; launch?: LaunchOverrides }): Promise<{ cutexSessionId: string }>;
  /** `POST /v2/human/sessions` (human-create-session): quick chat; without cwd cutex makes a scratch dir. */
  createHumanSession(request: { cwd?: string; profile?: string; displayName?: string; start: boolean; launch?: LaunchOverrides }): Promise<{ cutexSessionId: string }>;
  /** Per-native-thread attention level (cutex /v2/notifications/session; the TUI's Alt+N). */
  notificationLevel(threadId: string): Promise<NotificationLevel>;
  setNotificationLevel(threadId: string, level: NotificationLevel): Promise<NotificationLevel>;
  /** cutex `services`: registry of web services agents started. */
  services(): Promise<ServicesList>;
  registerService(request: ServiceRegisterRequest): Promise<ServiceView>;
  patchService(slug: string, patch: { displayName?: string; port?: number; path?: string | null; ownerCutexSessionId?: string | null }): Promise<ServiceView>;
  deleteService(slug: string): Promise<void>;
  serviceAction(slug: string, action: "start" | "stop" | "restart"): Promise<ServiceView>;
  /** Starts an on-demand service if needed; returns the URL to open. */
  openService(slug: string): Promise<{ url: string; localUrl: string }>;
  serviceLogs(slug: string, tail?: number): Promise<{ text: string }>;
  /** `PATCH /v2/services` (root): registry settings (shared/servicesSettings.ts); returns the resulting settings. */
  patchServicesSettings(patch: ServicesSettingsPatch): Promise<ServicesSettings>;
  /** profile-login: account state of a Codex profile; null when unsupported (Claude, older cutex). */
  profileAccount(profile: string): Promise<ProfileAccountView | null>;
  /** ChatGPT: returns a pending login with authUrl (open it in the browser). API key: final status. */
  profileLogin(profile: string, request: { type: "chatgpt" } | { type: "apiKey"; apiKey: string }): Promise<ProfileLogin>;
  profileLoginStatus(profile: string, loginId: string): Promise<ProfileLogin>;
  profileLoginCancel(profile: string, loginId: string): Promise<ProfileLogin>;
  profileLogout(profile: string): Promise<ProfileAccountView>;
  listProfiles(): Promise<{ defaultProfile: string | null; profiles: ProfileItem[] } | null>;
  getProfile(profile: string): Promise<ProfileDetail>;
  patchProfile(profile: string, patch: ProfilePatch): Promise<ProfileDetail>;
  /**
   * Profile lifecycle. The UI only calls these when cutex advertises `profile-create` /
   * `profile-duplicate` / `profile-delete`. A duplicate carries no credentials.
   */
  createProfile(request: ProfileCreateRequest): Promise<ProfileDetail>;
  /** `GET /v2/profile-presets` (feature profile-create): API-key providers; null when the host has no such route. */
  profilePresets(): Promise<ProfilePreset[] | null>;
  duplicateProfile(profile: string, name: string): Promise<ProfileDetail>;
  /**
   * Refusals (`profile_in_use` with the agents, `profile_is_default`) come back as a result.
   * `archived: "detach"` (cutex profile-delete-detach-archived): archived agents no longer refuse;
   * cutex clears their profile (a restore uses the default profile). Active ones still refuse.
   */
  deleteProfile(profile: string, options?: { archived?: "detach" }): Promise<MutationResult>;
  profileModels(profile: string): Promise<ProfileModelsView>;
  discoverModels(profile: string): Promise<ProfileModelsView>;
  patchModel(profile: string, modelId: string, patch: CatalogModelPatch): Promise<ProfileModelsView>;
  deleteModel(profile: string, modelId: string): Promise<ProfileModelsView>;
  resetModel(profile: string, modelId: string): Promise<ProfileModelsView>;
  getSettings(): Promise<GlobalSettings>;
  /** `PATCH /v2/settings {agentSecurity}` (features agent-project-boundary / agent-external-grants). */
  patchAgentSecurity(patch: AgentSecurityPatch): Promise<GlobalSettings>;
  /** `GET /v2/approvals?state=` (feature owner-approvals); null when the daemon predates it. */
  approvals(state: "pending" | "all"): Promise<ApprovalRecord[] | null>;
  /** `POST /v2/approvals/{id}/approve|deny`; `approval_not_found` / `approval_not_pending` come back as a refusal. */
  decideApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<ApprovalDecisionResult>;
  /** `GET /v2/runtime-packages` (feature runtime-package-upgrade, root); null when the daemon predates it. */
  runtimePackages(): Promise<RuntimePackagesView | null>;
  /** `GET /v2/runtime-packages/runs/{runId}`; null when unknown or the daemon predates it. */
  runtimePackageRun(runId: string): Promise<RuntimePackageRun | null>;
  /** `POST /v2/runtime-packages/runs {all: true}` (busy agents are skipped by cutex); 4xx (run_in_progress, …) come back as a refusal. */
  startRuntimePackageRun(): Promise<RuntimePackageRunResult>;
  /** `POST /v2/runtime-packages/runs/{runId}/revert {}` (all moved items); 4xx come back as a refusal. */
  revertRuntimePackageRun(runId: string): Promise<RuntimePackageRunResult>;
  /** `GET /v2/director-rotations?projectId=` newest first (feature owner-rotation, root); null when the daemon predates it. */
  directorRotations(projectId: string): Promise<DirectorRotation[] | null>;
  /** `GET /v2/director-rotations/{id}`; null when unknown or the daemon predates it. */
  directorRotation(rotationId: string): Promise<DirectorRotation | null>;
  /** `POST /v2/director-rotations`; 4xx (rotation_in_progress, stale_project_authority, …) come back as a refusal. */
  startDirectorRotation(request: DirectorRotationStart): Promise<DirectorRotationResult>;
  /** `POST /v2/director-rotations/{id}/cancel` (only before the successor is created). */
  cancelDirectorRotation(rotationId: string): Promise<DirectorRotationResult>;
  /** `POST /v2/director-rotations/{id}/continue`: stop waiting for the handoff note. */
  continueDirectorRotation(rotationId: string): Promise<DirectorRotationResult>;
  /** `GET /v2/agent-bus/stuck-messages?minAgeSecs=` (feature agent-bus-stuck-messages, root), oldest first; null when the daemon predates it. */
  stuckBusMessages(minAgeSecs: number): Promise<StuckBusView | null>;
  /** `POST /v2/agent-bus/stuck-messages/discard` (the reason is fixed in main); 4xx (message_not_found, message_protected, message_not_discardable, …) come back as a refusal. */
  discardStuckBusMessage(request: StuckBusDiscardRequest): Promise<StuckBusDiscardResult>;
  /** `GET /v2/runtimes` (feature runtimes-view) as cutex sends it (shared/runtimes.ts adapts it); null when the daemon predates it. */
  runtimes(): Promise<RuntimesWire | null>;
  /** `GET /v2/claude/accounts` (feature claude-accounts); null when the daemon predates it. */
  claudeAccounts(): Promise<ClaudeAccountList | null>;
  /** `POST /v2/claude/accounts` (validated in main; never carries an API key); 4xx come back as a refusal. */
  createClaudeAccount(request: ClaudeAccountCreate): Promise<ClaudeAccountResult>;
  /** `PATCH /v2/claude/accounts/{id} {label}`; 4xx (label taken, default, not found) come back as a refusal. */
  renameClaudeAccount(id: string, label: string): Promise<ClaudeAccountResult>;
  /** `DELETE /v2/claude/accounts/{id}` (home kept); 409 claude_account_in_use etc. come back as a refusal. */
  deleteClaudeAccount(id: string): Promise<ClaudeAccountRemoveResult>;
  /** `POST /v2/claude/accounts/{id}/status`: cutex runs `claude auth status` (subscription) or checks the stored key (api). */
  checkClaudeAccount(id: string): Promise<ClaudeAccountResult>;
  /** `GET /v2/profiles/{p}/quota` with `source` + `nativeQuota` (Claude account windows / API usage); null when the route is missing. */
  profileQuotaDetail(profile: string): Promise<ProfileQuotaDetail | null>;
  patchSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings & { restartRequired: string[] }>;
  /** `PATCH /v2/settings {newThreadDefaults}` (feature new-thread-defaults); a null field = back to built-in. */
  patchNewThreadDefaults(patch: NewThreadDefaultsPatch): Promise<GlobalSettings & { restartRequired: string[] }>;
  /** `POST /v2/pairing-codes` (feature device-pairing; loopback, which includes the SSH tunnel). */
  createPairingCode(label?: string, userId?: string): Promise<PairingCodeView>;
  /** `GET /v2/client-tokens` (client + device tokens, metadata only). */
  clientTokens(): Promise<ClientTokenView[]>;
  /** `DELETE /v2/client-tokens/{id}`. */
  revokeClientToken(tokenId: string): Promise<void>;
  /** `PATCH /v2/client-tokens/{id}` `{name}` (cutex `client-token-rename`, owner): null / blank clears the name. */
  renameClientToken(tokenId: string, name: string | null): Promise<{ tokenId: string; ownerName: string | null }>;
  userInstructions(): Promise<UserInstructions>;
  /** `GET /v2/sessions/{id}/harness` (feature agent-harness, root token). */
  agentHarness(sessionId: string): Promise<AgentHarnessPreview>;
  putUserInstructions(content: string, expectedRevision: string): Promise<UserInstructions>;
  /** Allowlisted cutex session mutations for menus: metadata/update, retire, restore, visibility/*, runtime/offline|online. */
  sessionAction(sessionId: string, method: SessionActionMethod, params: Record<string, unknown>): Promise<unknown>;
  /**
   * `cutex/session/fork` (feature session-fork): a new agent (same project / profile) whose thread
   * is this one up to `afterTurnId` (null = the latest turn).
   */
  forkSession(sessionId: string, request: { afterTurnId?: string | null; name?: string }): Promise<{ cutexSessionId: string }>;
  /**
   * `cutex/session/delete` (feature session-delete); refusals (`session_referenced`, `session_busy`) as a result.
   * Without `expectedRevision` it applies to the current revision (agents the desktop doesn't list).
   */
  deleteSession(sessionId: string, expectedRevision?: number): Promise<MutationResult>;
  /** `cutex/session/history/revert`: drop turns from `beforeTurnId` on, on the live runtime (no restart). */
  revertHistory(sessionId: string, beforeTurnId: string, expectedRevision: number): Promise<unknown>;
  /** cute-codex `thread/backgroundTerminals/list` (long-running commands of this thread). */
  backgroundTerminals(sessionId: string, threadId: string): Promise<BackgroundTerminal[]>;
  /** cute-codex `thread/backgroundTerminals/terminate` (needs the cutex allowlist entry). */
  terminateBackgroundTerminal(sessionId: string, threadId: string, processId: string): Promise<void>;
  /** cute-codex `thread/read` of a sub-agent thread spawned by this agent (cutex `subagent-threads`). Raw native result.
   *  `includeTurns: false` = the thread only (nickname / role / status), no history. */
  subAgentThread(sessionId: string, threadId: string, opts?: { includeTurns?: boolean }): Promise<unknown>;
  /** cutex project mutation (add_member / detach_member / set_workspace_root / archive / restore). */
  projectMutation(projectId: string, expected: { authorityEpoch: number; projectRevision: number }, operation: ProjectMutationOperation): Promise<unknown>;
  /** cutex project presentation update (name / badge / color). */
  projectPresentation(projectId: string, expected: { authorityEpoch: number; presentationRevision: number }, presentation: { display_name: string; badge_label: string; color: string }): Promise<unknown>;
  /** `GET /v2/projects/{id}/memory`; null on older cutex. */
  projectMemory(projectId: string): Promise<ProjectMemoryView | null>;
  projectMemoryFile(projectId: string, file: string): Promise<{ file: string; content: string; bytes: number; updatedAt: string | null }>;
  /** `GET /v2/projects/{id}/mcp` (project layer of scoped MCP); null on older cutex. */
  projectMcp(projectId: string): Promise<{ servers: Record<string, unknown>; revision: number; updatedAt: string | null } | null>;
  /** Delegations (`GET /v2/asks`, feature agent-asks), newest first; null when the daemon predates it. */
  asks(filter: AskFilter): Promise<AskSummary[] | null>;
  /** One delegation (`GET /v2/asks/{id}`); null when unknown (purged after 30 days). */
  ask(askId: string): Promise<AskDetail | null>;
  /** A page of a delegation's answer (`GET /v2/asks/{id}/answer?cursor=`); null when there is none. */
  askAnswer(askId: string, cursor?: number): Promise<AskAnswerPage | null>;
  /** `GET /v2/artifacts/{id}` (a delegation's full brief, …); null when unknown. */
  artifact(artifactId: string): Promise<ArtifactView | null>;
  // Artifact store (成果, capability `artifacts`, docs/research/artifacts-api-v1.md). Reads: null on a
  // 404 (unknown artifact / version, or a daemon without the route); mutations return refusals.
  /** `GET /v2/artifact-store` (one page, newest `updatedAt` first). */
  artifactStoreList(query: ArtifactListQuery): Promise<ArtifactList | null>;
  /** `GET /v2/artifact-store/{id}` (summary + versions, newest first). */
  artifactStoreGet(artifactId: string): Promise<ArtifactDetail | null>;
  /** `GET /v2/artifact-store/{id}/versions/{n|latest}/content`. */
  artifactStoreContent(artifactId: string, version: number | "latest", opts?: { offset?: number; maxBytes?: number }): Promise<ArtifactContent | null>;
  /** `GET /v2/artifact-store/{id}/diff?from&to`. */
  artifactStoreDiff(artifactId: string, from: number, to: number): Promise<ArtifactDiff | null>;
  /** `POST /v2/artifact-store/resolve` (≤ 200 refs). */
  artifactStoreResolve(refs: string[]): Promise<ArtifactResolveItem[] | null>;
  /** `GET /v2/artifact-store/usage`. */
  artifactStoreUsage(): Promise<ArtifactUsage | null>;
  /** `POST /v2/artifact-store` (owner publish). */
  artifactStorePublish(request: ArtifactPublishRequest): Promise<ArtifactPublishResult>;
  /** `PATCH /v2/artifact-store/{id}` (CAS on `expectedRevision`). */
  artifactStorePatch(artifactId: string, patch: ArtifactPatch): Promise<ArtifactPatchResult>;
  /** `DELETE /v2/artifact-store/{id}` (all versions). */
  artifactStoreDelete(artifactId: string): Promise<ArtifactDeleteResult>;
  /** Agent alarms (`GET /v2/alarms?sessionId=&state=`, cutex alarms-api): set by or waking that agent; null on an older cutex. */
  alarms(query: { sessionId?: string; state?: "pending" | "all"; limit?: number }): Promise<AlarmList | null>;
  /** `DELETE /v2/alarms/{id}`: the owner cancels a scheduled alarm (409 alarm_already_queued once sent). */
  cancelAlarm(alarmId: string): Promise<AlarmCancelResult>;
  /** `GET /v2/workflows/runs` (cutex workflows): runs, newest first; null on an older cutex. */
  workflowRuns(query: { state?: "open" | "closed" | "all"; sessionId?: string; projectId?: string; limit?: number }): Promise<WorkflowRunList | null>;
  /** `GET /v2/workflows/runs/{id}?include=`: phases, steps, log tail (more with include). */
  workflowRun(runId: string, include: ("steps" | "log" | "result" | "script")[]): Promise<WorkflowRunView>;
  /** Owner stop / resume (a new run reusing finished steps) / delete (finished runs). */
  workflowRunAction(runId: string, action: WorkflowRunAction): Promise<{ ok: true } | { ok: false; error: CutexRefusal }>;
  /** Agents online before an unclean stop (`GET /v2/runtimes/restore-candidates`, cutex runtime-restore-candidates); null on an older cutex. */
  restoreCandidates(): Promise<RestoreCandidates | null>;
  /** `DELETE /v2/runtimes/restore-candidates`: the owner dismisses the restore prompt. */
  dismissRestoreCandidates(): Promise<MutationResult>;
  /** Claude quota auto-continue of an agent (`GET /v2/quota-auto-continue?sessionId=`); null on an older cutex. */
  quotaAutoContinue(sessionId: string): Promise<QuotaContinueView | null>;
  /** `PATCH /v2/quota-auto-continue/{sessionId} {enabled}` (per agent, default on). */
  setQuotaAutoContinue(sessionId: string, enabled: boolean): Promise<QuotaContinueResult>;
  /** `DELETE /v2/quota-auto-continue/{sessionId}/pending`: cancel the pending continuation. */
  cancelQuotaAutoContinue(sessionId: string): Promise<QuotaContinueResult>;
  // Cross-host peers (cutex peers-v2, shared/peers.ts). Root only; writes refuse with loopback_only off loopback.
  /** `GET /v2/peers`; null on a cutex without the route. */
  peers(): Promise<PeerList | null>;
  /** `POST /v2/peers/invites`: a one-time code (10 min) + this host's peer URLs. */
  createPeerInvite(request: { label?: string }): Promise<PeerResult<PeerInvite>>;
  /** `POST /v2/peers {url, code, label?}`: pair with the host that issued the code. */
  addPeer(request: { url: string; code: string; label?: string }): Promise<PeerResult<PeerView>>;
  /** `PATCH /v2/peers/{id}` (label, urls, enabled, policy: merged per field, exports replaced whole). */
  patchPeer(peerId: string, patch: PeerPatch): Promise<PeerResult<PeerView>>;
  /** `DELETE /v2/peers/{id}` (best-effort remote unpair; open asks are interrupted / stopped). */
  deletePeer(peerId: string): Promise<PeerResult<{ removed: boolean }>>;
  /** `GET /v2/peers/{id}/inflight`: open outgoing / incoming asks (owner views) that a delete would end. */
  peerInflight(peerId: string): Promise<AskDetail[]>;
  /** `GET /v2/peers/{id}/agents`: the remote directory (or the last cached one). */
  peerAgents(peerId: string): Promise<PeerAgents>;
  /** `GET /v2/peers/{id}/audit?limit=`: newest first, no bodies / tokens. */
  peerAudit(peerId: string, limit?: number): Promise<PeerAuditEntry[]>;
  /** `PATCH /v2/settings {peers}` (loopback-only on the daemon side). */
  patchPeersSettings(patch: PeersSettingsPatch): Promise<PeerResult<GlobalSettings>>;
  // Users and grants (cutex `users`, shared/users.ts). Owner only (403 owner_required otherwise).
  /** `GET /v2/users`; null on a cutex without the route. */
  users(): Promise<UsersList | null>;
  /** `POST /v2/users`. */
  createUser(request: UserCreate): Promise<UsersResult<UserWriteResult>>;
  /** `PATCH /v2/users/{id}`. */
  patchUser(userId: string, patch: UserPatch): Promise<UsersResult<UserWriteResult>>;
  /** `DELETE /v2/users/{id}`; `user_in_use` lists the bound tokens / peers. */
  deleteUser(userId: string): Promise<UsersResult<{ userId: string; deleted: boolean }>>;
  /** `PUT /v2/users/token-bindings/{tokenId}` (null = pending). */
  bindUserToken(tokenId: string, userId: string | null): Promise<UsersResult<TokenBindingResult>>;
  /** `PUT /v2/users/peer-bindings/{peerId}`. */
  bindUserPeer(peerId: string, userId: string): Promise<UsersResult<PeerBindingResult>>;
  /** `PATCH /v2/users/settings`. */
  patchUsersSettings(patch: UsersSettings): Promise<UsersResult<{ settings: UsersSettings }>>;
  // Self-service profile (cutex `users-self-profile`): any assigned connection, its own user only.
  /** `GET /v2/users/me`; null on a cutex without the route. */
  usersMe(): Promise<SelfProfile | null>;
  /** `PATCH /v2/users/me` (null = clear); refusals (invalid_avatar, avatar_too_large, access_pending) as values. */
  patchUsersMe(patch: SelfProfilePatch): Promise<UsersResult<SelfProfile>>;
  /** cutex `user-own-devices`: the caller's own devices (null: older cutex); `user_pending` / `access_pending` as values. */
  usersMeDevices(): Promise<UsersResult<import("./users").OwnDevices | null>>;
  /** cutex `user-own-devices`: remove one of the caller's own devices (`client_token_not_found` for anyone else's). */
  usersMeRemoveDevice(tokenId: string): Promise<UsersResult<import("./users").OwnDeviceRevoked>>;
  /** `GET /v2/users/{id}/avatar` as a data: URL (null: none / not visible / older cutex). */
  userAvatar(userId: string): Promise<{ dataUrl: string; etag: string | null } | null>;
  /** person-identity: `PUT /v2/users/{id}/person-keys` (owner only; the whole list). */
  putUserPersonKeys(userId: string, personKeys: import("./users").PersonKeyInput[]): Promise<UsersResult<import("./users").PersonKeysResult>>;
  /** person-identity-ack, owner only: acknowledge a device's key change (clears `person.previousPublicKey`). */
  ackTokenPersonChange(tokenId: string): Promise<UsersResult<import("./users").TokenPersonAckResult>>;
  // Backend upgrade (cutex `backend-upgrade`, shared/backendUpgrade.ts). Owner only; refusals as values.
  /** `GET /v2/upgrade`; null on a cutex without the route. */
  upgradeStatus(): Promise<UpgradeStatus | null>;
  /** `POST /v2/upgrade/check`. */
  upgradeCheck(): Promise<UpgradeResult<UpgradeStatus>>;
  /** `POST /v2/upgrade/stage` (default: the available release). */
  upgradeStage(release?: string | null): Promise<UpgradeResult<UpgradeStaging>>;
  /** `POST /v2/upgrade/apply`. */
  upgradeApply(request: UpgradeApplyRequest): Promise<UpgradeResult<UpgradeRun>>;
  /** `POST /v2/upgrade/cancel`. */
  upgradeCancel(): Promise<UpgradeResult<UpgradeRun>>;
  /** `POST /v2/upgrade/rollback` (`dryRun`: the preview only). */
  upgradeRollback(request: UpgradeRollbackRequest): Promise<UpgradeResult<UpgradeRollbackResult>>;
  /** `GET /v2/upgrade/runs?limit=`. */
  upgradeRuns(limit?: number): Promise<UpgradeResult<UpgradeRun[]>>;
  /** `GET /v2/upgrade/runs/{runId}`. */
  upgradeRun(runId: string): Promise<UpgradeResult<UpgradeRun>>;
  /** `PATCH /v2/upgrade/settings` (never `source`). */
  patchUpgradeSettings(patch: UpgradeSettingsPatch): Promise<UpgradeResult<UpgradeSettings>>;
  /** `GET /v2/host` `serviceManager` / `runtimes`. */
  hostServiceInfo(): Promise<HostServiceInfo>;
  // Optional components (cutex `components`, shared/components.ts). Owner only; refusals as values.
  /** `GET /v2/components`; null on a cutex without the route. */
  components(): Promise<ComponentsList | null>;
  /** `POST /v2/components/{name}/install|remove` (empty body) → 202 `{operation}`; progress via `cutex/components/updated`. */
  componentAction(name: string, action: ComponentAction): Promise<ComponentResult>;
  /**
   * Owner command on a delegation (`cutex/ask/stop|close|retry`), sent on the target agent's
   * session. Not via sessionAction: cutex rejects extra fields like expectedRevision.
   */
  askCommand(sessionId: string, method: AskCommandMethod, params: { askId: string; outcome?: "accepted" | "abandoned" }): Promise<MutationResult>;
  /**
   * Job Service jobs (`POST /v2/job-service/management-query`, root; feature job-service): one page,
   * newest first. `query` matches job id, action id or session id (substring).
   */
  jobs(params: { query?: string; cursor?: string | null; limit?: number }): Promise<JobResult<JobListPage>>;
  /** `GET /v2/job-service/capabilities`: what the running Job Service offers humans (`humanOperations`). */
  jobServiceCapabilities(): Promise<JobResult<JobServiceCapabilities>>;
  /** `POST /v2/job-service/cancel` (revision-guarded). */
  cancelJob(jobId: string, expectedRevision: number): Promise<JobResult<unknown>>;
  /** `POST /v2/job-service/output`: one page (<= 8 KiB) of a job's stdout / stderr. */
  jobOutput(jobId: string, stream: JobStream, offset: number): Promise<JobResult<JobOutputPage>>;
  /** `POST /v2/job-service/mark-external` (feature job-external): the owner settles an external job. */
  markExternalJob(input: MarkExternalInput): Promise<JobResult<unknown>>;
  /** `GET /v2/inbound-mail` (feature inbound-mail): the owner mailbox for PBS mail; never a password. */
  inboundMail(): Promise<JobResult<InboundMailStatus>>;
  /** `PUT /v2/inbound-mail/config`. The password is write-only (sent once, never read back). */
  putInboundMail(input: InboundMailInput): Promise<JobResult<InboundMailStatus>>;
  /** `POST /v2/inbound-mail/test`: null = the saved configuration, else a draft (not saved). */
  testInboundMail(input: InboundMailInput | null): Promise<JobResult<{ ok: boolean }>>;
  /** `DELETE /v2/inbound-mail/config`: removes the mailbox configuration and its password. */
  deleteInboundMail(): Promise<JobResult<InboundMailStatus>>;
  /** `GET /v2/nci-verification` (feature nci-verification): public parts only. */
  nciVerification(): Promise<JobResult<NciVerificationStatus>>;
  /**
   * `PUT /v2/nci-verification/config`. With `pickPrivateKey` main asks for the key file on this machine
   * and sends it; the renderer never sees it. A cancelled chooser answers `{ ok: false, code: "cancelled" }`.
   */
  putNciVerification(input: NciVerificationInput): Promise<JobResult<NciVerificationStatus>>;
  /** `DELETE /v2/nci-verification/config`: removes the configuration, the stored key and a pending generated key. */
  deleteNciVerification(): Promise<JobResult<NciVerificationStatus>>;
  /**
   * `POST /v2/nci-verification/key` (feature nci-host-keygen): cutex generates the dedicated Gadi key on
   * the host (the private half never leaves cutex). `replace` swaps an existing key (409
   * `qstat_key_exists` without it). Answers the full status.
   */
  generateNciKey(replace: boolean): Promise<JobResult<NciVerificationStatus>>;
  /** `GET /v2/nci-verification/helper` (feature nci-host-keygen): the qstat-only helper script for Gadi. */
  nciHelper(): Promise<JobResult<NciHelper>>;
  /** Fetches the helper in main and writes it where the owner picks (save dialog); `cancelled` when dismissed. */
  saveNciHelper(): Promise<JobResult<{ path: string }>>;
  /** Open an http(s) URL in the OS browser. */
  openExternal(url: string): Promise<void>;
  /** Native folder chooser (local host only); null when cancelled. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Show a file in the OS file manager (local host only; never opens or runs it). */
  revealPath(path: string): Promise<void>;
  /** `cutex/session/profile/switch` (gated per profile; same native thread). */
  switchProfile(sessionId: string, profile: string, when: "now" | "afterTurn", expectedRevision: number): Promise<{ status: "switched" | "scheduled"; from: string; to: string }>;
  queueList(sessionId: string): Promise<QueueListResult>;
  /** queue-pause: resume a paused queue (cutex sends the next item when the thread is idle). */
  queueResume(sessionId: string): Promise<QueueResumeResult>;
  /** asks-pause-v2: pause / resume delegation (å§æ) for this session. */
  asksPause(sessionId: string): Promise<AsksPauseResult>;
  asksResume(sessionId: string): Promise<AsksPauseResult>;
  /** queue-pause "停止": cutex pauses the queue (if non-empty), then interrupts the active turn. */
  stopTurn(sessionId: string): Promise<TurnStopResult>;
  queueUpdate(sessionId: string, queueId: string, expectedRevision: number, text: string): Promise<void>;
  queueRemove(sessionId: string, queueId: string, expectedRevision: number): Promise<void>;
  /**
   * Queue item → steer into the running turn (idle: start it). `steer` (the host has queue-steer):
   * atomic `cutex/userInput/queue/steer`, a refusal keeps the item queued; otherwise CAS remove +
   * submit `auto` with the item's own id.
   */
  queuePromote(sessionId: string, queueId: string, expectedRevision: number, steer?: boolean): Promise<QueuePromoteResult>;
  /**
   * admission-order: move an owner queued item in front of `before` (any kind; null = to the end),
   * CAS on the admission revision. Refusals arrive as `queue_move_refused:<kind>` (shared/queueMove).
   */
  queueMove(sessionId: string, queueId: string, expectedRevision: number, before: AdmissionRef | null): Promise<QueueMoveResult>;
  /** admission-owner-yield: waiting ride-alongs go before the owner's queued input once. */
  queueYield(sessionId: string): Promise<QueueYieldResult>;
  respond(sessionId: string, runtimeGeneration: number, requestId: string | number, reply: ServerRequestReply): Promise<void>;
  // ---------- composer slash commands (cute-codex native, forwarded by cutex) ----------
  /** `thread/goal/get`; null when the thread has no goal. */
  threadGoal(sessionId: string, threadId: string): Promise<ThreadGoal | null>;
  /** `thread/goal/set` (objective / status / token budget; omitted fields unchanged). */
  setThreadGoal(sessionId: string, threadId: string, patch: { objective?: string; status?: ThreadGoalStatus; tokenBudget?: number | null }): Promise<ThreadGoal>;
  /** `thread/goal/clear`. */
  clearThreadGoal(sessionId: string, threadId: string): Promise<boolean>;
  /** `review/start` inline on the agent's own thread; the review streams in as a normal turn. */
  startReview(sessionId: string, threadId: string, target: ReviewTarget): Promise<{ turnId: string }>;
  /** `collaborationMode/list` (presets: default, plan, …). */
  collaborationModes(sessionId: string): Promise<CollaborationModeMask[]>;
  /** `thread/memoryMode/set`. */
  setMemoryMode(sessionId: string, threadId: string, mode: ThreadMemoryMode): Promise<void>;
  /** `memory/reset` (wipes the native memory store). Not forwarded by cutex yet → throws a gap error. */
  resetMemory(sessionId: string): Promise<void>;
  /** `experimentalFeature/list`; falls back to the `[features]` table of the shared config.toml when cutex does not forward it. */
  experimentalFeatures(sessionId: string, threadId: string | null): Promise<ExperimentalFeaturesView>;
  /** Writes `features.<name>` in the shared config.toml (`config/value/write`); agents pick it up on next launch. */
  setExperimentalFeature(name: string, enabled: boolean): Promise<void>;
  /** Native save dialog + write (local host only); returns the path or null when cancelled. */
  saveMarkdown(defaultName: string, content: string): Promise<string | null>;
  // ---------- owner notify (capability owner-notify) ----------
  /** `GET /v2/owner-notifications` (newest first); [] on a cutex without the route. */
  ownerNotifications(query: { filter?: OwnerNotifyFilter; agentId?: string; limit?: number }): Promise<OwnerNotification[]>;
  /** `cutex/ownerNotify/ack|reply|dismiss|delete` on the sender's session (`text` only for reply; delete needs owner-notify-delete). */
  ownerNotifyAction(agentId: string, action: OwnerNotifyAction, notificationId: string, text?: string): Promise<OwnerNotifyResult>;
  /** `PATCH /v2/settings {ownerNotify}` (only the writable fields are forwarded). */
  patchOwnerNotify(patch: OwnerNotifySettingsPatch): Promise<GlobalSettings>;
  /** claude-safety-grants: 批准一次 / 不批准 on a safety block of that agent (`cutex/safetyCheck/grant|dismiss`). */
  safetyCheckDecide(agentId: string, blockId: string, decision: SafetyCheckDecision): Promise<SafetyCheckResult>;
  // ---------- notification levels (capability notification-levels; shared/notificationLevels.ts) ----------
  /** `GET /v2/notification-levels`: registry, stored settings, effective tables; null on a cutex without the route. */
  notificationLevels(): Promise<NotificationLevelsView | null>;
  /** `PATCH /v2/notification-levels` (only the writable fields are forwarded); the new view. */
  patchNotificationLevels(patch: NotificationLevelsPatch): Promise<NotificationLevelsView>;
  /** `POST /v2/notification-levels/evaluate`: the level + methods cutex decides for these events. */
  evaluateNotification(request: NotificationEvaluateRequest): Promise<NotificationDecision>;
}

/** Extra cute-codex UserInput items the composer can attach (images, palette skills). */
export type ExtraInput =
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export interface QueuePromoteResult {
  result: UserInputSubmitResult;
  clientUserMessageId: string;
  input: unknown[];
}

export interface SubmitOptions {
  extra?: ExtraInput[];
  clientUserMessageId?: string;
}

/** Largest image the composer attaches (cute-codex / providers reject much bigger payloads). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Claude agents: Claude rejects images over 5 MB (claude-adapter docs/DESKTOP_PARITY.md). */
export const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Message prefix of the error main throws for a native JSON-RPC `-32601` carrying
 * `data.unsupported` (a Claude agent lacking that Codex feature): `<prefix>: <feature or method>`.
 */
export const UNSUPPORTED_ERROR_PREFIX = "agent_feature_unsupported";

export interface PickedImage {
  path: string;
  name: string;
  size: number;
  /** data: URL for the thumbnail only (the file itself is sent by path). */
  preview: string | null;
  /** Set when the file is rejected (too large / unreadable). */
  error?: string;
}

export interface ExperimentalFeatureView {
  name: string;
  displayName: string | null;
  description: string | null;
  stage: string | null;
  enabled: boolean;
  defaultEnabled: boolean | null;
}

export interface ExperimentalFeaturesView {
  /** "native": app-server catalogue; "config": only flags set in config.toml (cutex gap). */
  source: "native" | "config";
  features: ExperimentalFeatureView[];
}

/** Push channels (main → renderer). */
/** A cutex PTY terminal (`terminal` capability): lives in the daemon, survives window close. */
/** cutex profile-login: an in-flight or finished login for one profile (never carries secrets). */
export interface ProfileLogin {
  loginId: string;
  profileId: string;
  type: "chatgpt" | "apiKey";
  status: "pending" | "succeeded" | "failed" | "canceled";
  error: string | null;
  warning: string | null;
  authUrl?: string | null;
  startedAt: string;
  expiresAt?: string | null;
  finishedAt?: string | null;
}

export interface ProfileAccountView {
  account: { loggedIn: boolean; authMode: "chatgpt" | "apiKey" | "other" | "none"; email: string | null; planType: string | null; lastRefresh: string | null; authFilePresent: boolean };
  supportedLoginTypes: ("chatgpt" | "apiKey")[];
  activeLogin: ProfileLogin | null;
}

/** cutex services registry entry (agent-started web services; Bridgeboard replacement). */
export interface ServiceView {
  slug: string;
  displayName: string;
  host: string;
  port: number;
  path: string | null;
  ownerCutexSessionId: string | null;
  projectId: string | null;
  runtime: "external" | "managed" | "static";
  portAllocated?: boolean;
  createdAt: string;
  updatedAt?: string;
  lastSeenAt: string | null;
  lastProbeAt?: string | null;
  health: "reachable" | "unreachable" | "starting" | "stopped";
  url: string;
  localUrl: string;
  command?: string | string[] | null;
  cwd?: string | null;
  envKeys?: string[];
  lifetime?: "persistent" | "ephemeral";
  proxyHostHeader?: "preserve" | "upstream";
  /** Owner views on a cutex with `services-login-link`. */
  loginLinkCommand?: string | string[] | null;
  stopped?: boolean;
  process?: { pid: number | null; startedAt: string | null; restarts: number; lastExitCode: number | null; lastExitAt: string | null; nextRestartAt: string | null } | null;
}

/** `POST /v2/services` body (owner). */
export type ServiceRegisterRequest = {
  slug: string;
  displayName?: string;
  port?: number;
  path?: string;
  runtime?: ServiceView["runtime"];
  /** A shell line (`sh -c` / `cmd /C`) or an argv; `{port}` is substituted. */
  command?: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  lifetime?: "persistent" | "ephemeral";
  /** `upstream`: the service sees Host `127.0.0.1:<port>` (and, with `services-login-link`, its own Origin). */
  proxyHostHeader?: "preserve" | "upstream";
  /** cutex `services-login-link`, managed only: prints a one-time loopback login URL of the running service. */
  loginLinkCommand?: string | string[];
};

export interface ServicesList {
  hostId: string;
  services: ServiceView[];
  settings: ServicesSettings;
}

/** cutex `services-persistent-approval`: does an agent's persistent-lifetime request need the owner's approval. */
export type AgentPersistentApproval = "ask" | "off";

/** Registry settings (`GET /v2/services` `settings`); fields the desktop reads, the rest passes through. */
export interface ServicesSettings {
  portRangeStart: number;
  portRangeEnd: number;
  /** Absent on a cutex without `services-persistent-approval`. */
  agentPersistentApproval?: AgentPersistentApproval;
}

/** `PATCH /v2/services` body the desktop sends (shared/servicesSettings.ts validates it in main). */
export interface ServicesSettingsPatch {
  agentPersistentApproval?: AgentPersistentApproval;
}

export type NotificationLevel = "important" | "normal" | "off";

export interface TerminalSummary {
  terminalId: string;
  scope: string;
  rootId: string;
  cwd: string;
  shell: string;
  pid: number | null;
  cols: number;
  rows: number;
  createdAt: string;
  exited: boolean;
  exitCode: number | null;
}

/** Events one daemon connection (main `DaemonService`) emits; main tags them with their host (`DesktopEvents`). */
export interface DaemonEvents {
  daemonState: DaemonState;
  /** Host-wide event; renderer uses it to refresh the sidebar. */
  hostEvent: EventEnvelope;
  sessionEvent: { sessionId: string; envelope: EventEnvelope };
  sessionResync: { sessionId: string; reason: string };
  sessionStatus: { sessionId: string; status: "connecting" | "live" | "retrying" };
  workspaceChanged: { watchId: string; paths: string[]; gitChanged: boolean; overflow: boolean };
  /** PTY output (base64). `reset`: the scrollback ring dropped bytes — clear before writing. */
  terminalOutput: { terminalId: string; data: string; replay: boolean; reset: boolean };
  terminalExit: { terminalId: string; exitCode: number | null };
  /** cutex `users`: this connection's user or grant changed (the host feed ended with `cutex/access/changed`). */
  accessChanged: { changedAt: string | null };
}

/** Which host connection an event came from: the desktop host id and that connection's routing epoch. */
export interface HostTag {
  hostId: string;
  epoch: string;
}

export interface DesktopEvents {
  browserEvent: HostTag & import("./browser").BrowserEvent;
  /** One host's connection state (every connected host, not only the focus host). */
  daemonState: HostTag & { state: DaemonState };
  /** Host list / scope / focus host / connections changed (a changed `active` = the focus host changed). */
  hostsState: HostsState;
  /** Host-wide event of one host (its session events, approvals, owner notes …). */
  hostEvent: HostTag & { envelope: EventEnvelope };
  sessionEvent: HostTag & DaemonEvents["sessionEvent"];
  sessionResync: HostTag & DaemonEvents["sessionResync"];
  sessionStatus: HostTag & DaemonEvents["sessionStatus"];
  workspaceChanged: HostTag & DaemonEvents["workspaceChanged"];
  terminalOutput: HostTag & DaemonEvents["terminalOutput"];
  terminalExit: HostTag & DaemonEvents["terminalExit"];
  accessChanged: HostTag & DaemonEvents["accessChanged"];
  /** From the main process (tray menu): "newChat" = the window was shown; start a quick chat. */
  shellCommand: { command: ShellCommand };
  updateStatus: UpdateStatus;
  /** 打开 on a big alert (main/ownerAlert.ts): the window was shown; open this agent (of that host) at that message. */
  ownerNotifyOpen: { hostId: string; agentId: string; notificationId: string };
  /** A desktop notification / event big alert the renderer raised was clicked (the window was shown). */
  notifyClick: { key: string };
  /** P2 person identity: key or per-host claim state changed (main/personIdentity.ts). */
  identityState: import("./personIdentity").PersonIdentityView;
  /** The open SSH questions changed (main/sshAskpass.ts; the whole list, oldest first). */
  sshPrompts: { prompts: import("./sshPrompt").SshPromptView[] };
}

/** `DesktopEvents` keys whose payload carries a `HostTag` (daemon events and main-side per-host events such as the browser's). */
export type HostTaggedEvent = { [K in keyof DesktopEvents]: DesktopEvents[K] extends HostTag ? K : never }[keyof DesktopEvents];

/** Events that carry a `HostTag` (preload drops the ones of a replaced connection). */
export const HOST_TAGGED_EVENTS = ["daemonState", "hostEvent", "sessionEvent", "sessionResync", "sessionStatus", "workspaceChanged", "terminalOutput", "terminalExit", "accessChanged", "browserEvent"] as const satisfies readonly HostTaggedEvent[];

export const INVOKE_CHANNEL = "cutex-desktop:invoke";
export const EVENT_CHANNEL = "cutex-desktop:event";

export type InvokeMethod = keyof DesktopApi;

export interface PreloadBridge {
  browser?: import("./browser").BrowserBridge;
  /** Calls to the focus host (`HostsState.active`); host-list calls go to main. */
  api: DesktopApi;
  /**
   * Daemon calls to one connected host (multi-host RFC §5), bound to its current connection: a
   * call made before that host reconnects is refused (C-011 per host). Unknown / unconnected host:
   * every call rejects.
   */
  apiFor?(hostId: string): DaemonApi;
  /** Local isolated plugin resources. Absent in ordinary browser previews. */
  plugins?: import("./plugins").PluginBridge;
  /** Agent pages: one-use opaque frame documents of HTML artifacts (shared/frames.ts, §10.2). */
  frames?: import("./frames").FramesBridge;
  on<K extends keyof DesktopEvents>(event: K, listener: (payload: DesktopEvents[K]) => void): () => void;
  platform: NodeJS.Platform;
  /** Window chrome (custom title bar). Absent in the browser preview. */
  window?: WindowBridge;
  /** Desktop shell (tray, close behaviour, attention badge). Absent in the browser preview. */
  shell?: ShellBridge;
  /** Self-update (portable installs). Absent in the browser preview unless mocked. */
  update?: UpdateBridge;
  /** Settings → 关于 → 已知问题 from the release branch (shared/knownIssues.ts). Absent in the browser preview. */
  knownIssues?: import("./knownIssues").KnownIssuesBridge;
  /** Settings → 外观 → 启动页立绘: imported launcher art (shared/launchArt.ts). Absent in a plain browser. */
  launchArt?: import("./launchArt").LaunchArtBridge;
}

export const WINDOW_CHANNEL = "cutex-desktop:window";
export const TITLEBAR_HEIGHT = 40;
export type WindowAction = "minimize" | "toggleMaximize" | "close";
export interface WindowBridge {
  control(action: WindowAction): Promise<void>;
  /** Recolor the native Windows caption buttons to match the app theme. */
  setChrome(colors: { color: string; symbolColor: string }): Promise<void>;
  /** Native caption buttons drawn by the OS (Windows overlay / macOS traffic lights) and their side. */
  nativeControls: "right" | "left" | null;
}

export const SHELL_CHANNEL = "cutex-desktop:shell";
export type ShellCommand = "newChat";
/** What the window close button does: hide to the tray (default) or quit the app. */
export type CloseBehavior = "tray" | "quit";
export type ShellLocale = AppLocale;
/** One term's singular / plural (zh: the same word) — the shape of the renderer's lib/terms TermSet entry. */
export interface ShellTermForms {
  one: string;
  many: string;
}
/**
 * The resolved display terms (Settings → 通用 → 称呼) for the current UI locale, mirrored to main so
 * the tray / taskbar text follows them. The renderer's localStorage stays the only store; this is a
 * transport copy the renderer re-pushes on every change (owner 2026-10-13: the tray must not
 * hard-code 「agent」 and must follow a custom word).
 */
export interface ShellTerms {
  agent: ShellTermForms;
  subagent: ShellTermForms;
  director: ShellTermForms;
  owner: ShellTermForms;
}
/**
 * The mirror carries the UI locale the terms were resolved for: main uses them only while
 * `locale` matches the current prefs locale, so a language switch (or a lost / reordered push)
 * can never render a new sentence with the previous language's words (review 2026-10-13).
 */
export interface ShellTermsPref {
  locale: ShellLocale;
  terms: ShellTerms;
}
/** Desktop-local prefs the main process needs (stored by main in userData/desktop-prefs.json). */
export interface DesktopPrefs {
  closeBehavior: CloseBehavior;
  /** True once the owner picked 关闭窗口时 (Settings or the first-close notice). Until then Linux may
   *  fall back to quitting (no StatusNotifier host) or asks once (shared/shell.ts closeAction). */
  closeBehaviorChosen?: boolean;
  /** The one-time Linux first-close notice was shown. */
  trayNoticeShown?: boolean;
  /** Last UI locale reported by the renderer (tray labels before the renderer has loaded). */
  locale: ShellLocale | null;
  /** Mirrored resolved terms with their locale tag (see ShellTermsPref); null until first push. */
  terms?: ShellTermsPref | null;
  /** Minutes between update checks; 0 = never (only for portable installs, see UpdateStatus). */
  updateCheckMinutes: number;
  /** Git URL / path fetched for updates instead of the source checkout's origin (no UI yet; the env
   *  `CUTEX_DESKTOP_UPDATE_REMOTE` wins). Absent = origin. */
  updateRemote?: string;
  /** Per-channel update remotes (no UI; resolveUpdateRemote in shared/update.ts): `main` (开发版) /
   *  `release` (正式版) fetch from these instead of `updateRemote` / origin. The env still wins. */
  updateRemotes?: { main?: string; release?: string };
  /** Device methods this device turned off for itself (Settings → 通知 → 本设备); main skips them too (big alert). */
  notifyOff: DeviceOff;
}
export interface ShellState {
  prefs: DesktopPrefs;
  /** False when the tray couldn't be created (closing then quits regardless of the pref). */
  trayAvailable: boolean;
  /** Linux: no StatusNotifier host on the session bus, so the tray icon is likely invisible (closing
   *  quits until the owner explicitly picks 隐藏到托盘). */
  trayHostMissing?: boolean;
  /** Electron `Notification.isSupported()` (desktop notifications from main). */
  notificationsSupported?: boolean;
  /** The OS account name (`os.userInfo().username`): the default 「你的名字」 of the identity menu. Never sent anywhere. */
  osUserName?: string | null;
  /** Help & docs can open QUICKSTART: a local copy (source checkout, release package, dev repo) or, on a packaged app, the published page. */
  quickstart?: boolean;
}
/** A desktop notification raised through main (Electron `Notification`, works while hidden to the tray). */
export interface ShellNotification {
  /** Click → `notifyClick` with this key; also the replace tag. */
  key: string;
  title: string;
  body: string;
}
/** A big alert for any urgent event (not an owner_notify record): the alert window with 打开 / 知道了. */
export interface ShellEventAlert {
  key: string;
  agentId: string | null;
  agentName: string;
  /** What happened (event title). */
  title: string;
  text: string;
  sound: boolean;
}
/**
 * Take back what no longer needs the owner (handled in the app): event big alerts and desktop
 * notifications by occurrence key (`keys`) or key prefix (`prefixes`, e.g. `req:<agent>:`), and
 * owner_notify big alerts the renderer saw closed (`notes`, in case main missed the host event).
 */
export interface ShellRetract {
  keys?: string[];
  prefixes?: string[];
  notes?: { hostId: string; notificationId: string }[];
}
export type ShellRequest =
  | { op: "state" }
  | { op: "setCloseBehavior"; value: CloseBehavior }
  | { op: "setLocale"; value: ShellLocale }
  | { op: "setTerms"; value: ShellTermsPref | null }
  | { op: "setAttention"; count: number }
  | { op: "setUpdateCheckMinutes"; value: number }
  | { op: "logError"; kind: "error" | "unhandledrejection" | "reported"; message: string; stack?: string }
  | { op: "openLogs" }
  | { op: "openQuickstart" }
  | { op: "quit" }
  | { op: "rendererReady" }
  | { op: "setZoom"; factor: number }
  | { op: "setNotifyOff"; value: DeviceOff }
  | { op: "notify"; notification: ShellNotification }
  | { op: "eventAlert"; alert: ShellEventAlert }
  | { op: "retractAlerts"; retract: ShellRetract };
export interface ShellBridge {
  state(): Promise<ShellState>;
  setCloseBehavior(value: CloseBehavior): Promise<ShellState>;
  setLocale(value: ShellLocale): Promise<void>;
  /** The resolved terms of the current UI locale (Settings → 通用 → 称呼); null = back to defaults. */
  setTerms?(value: ShellTermsPref | null): Promise<void>;
  /** Number of agents waiting for the user (approval / question); sent only on change. */
  setAttention(count: number): Promise<void>;
  setUpdateCheckMinutes(value: number): Promise<ShellState>;
  /** Append to the desktop error log (userData/logs/errors.jsonl). */
  logError(entry: { kind: "error" | "unhandledrejection" | "reported"; message: string; stack?: string }): Promise<void>;
  /** Open the log folder in the file manager. */
  openLogs(): Promise<void>;
  /** Open docs/QUICKSTART.md: the local copy, or the published page on a packaged app (only when `ShellState.quickstart`). */
  openQuickstart?(): Promise<void>;
  /** Quit the app for real (not hide to the tray): the tray menu's 退出. */
  quit?(): Promise<void>;
  /** The UI rendered (confirms a just-installed update; see main/updater.ts). */
  rendererReady(): Promise<void>;
  /** Window zoom factor (Settings → 外观 → 界面缩放), 0.5–2.5. */
  setZoom?(factor: number): Promise<void>;
  /** This device's off switches for device methods (persisted by main). */
  setNotifyOff?(value: DeviceOff): Promise<ShellState>;
  /** Show a desktop notification from main (silent: sound is its own method). */
  notify?(notification: ShellNotification): Promise<void>;
  /** Show an event in the big alert window. */
  eventAlert?(alert: ShellEventAlert): Promise<void>;
  /** Close event big alerts / desktop notifications / owner_notify big alerts that were handled. */
  retractAlerts?(retract: ShellRetract): Promise<void>;
}

export const UPDATE_CHANNEL = "cutex-desktop:update";
/** Self-update of a portable install (scripts/package-portable.mjs): git fetch the source checkout,
 *  and on request pull → pnpm install → build → package a new release → switch `current` → relaunch.
 *  A release package (binary install): download → verify (minisign + SHA256SUMS) → unpack → switch. */
export type UpdateStep = "pull" | "install" | "build" | "package" | "download" | "verify" | "unpack" | "switch";
export interface UpdateStatus {
  /** unsupported: this install cannot update itself right now (`code` says why, `reason` has the detail
   *  for the tooltip / update.log). Never shown as an error: no sidebar button, a quiet line in Settings. */
  state: "unsupported" | "idle" | "checking" | "available" | "updating" | "ready" | "error";
  reason?: string;
  code?: UpdateUnsupportedCode;
  /** unsupported only: a later check may succeed (the remote was unreachable); Settings offers a retry. */
  retryable?: boolean;
  /** The branch this install follows (resolveChannel in shared/update.ts); absent for dev runs. */
  channel?: string;
  /** Settings may switch the channel (开发版 main / 正式版 release): a portable install with a source checkout. */
  canSwitchChannel?: boolean;
  /** Where updates come from, credentials stripped (displayRemote): the channel's remote or origin's URL. */
  source?: string;
  /** The page new packages are downloaded from (https; the package's recorded `releasePage`): unsupported
   *  `releasePackage` installs and binary self-updating ones. Settings opens it in the system browser. */
  releasePage?: string;
  /** A release package that updates itself from GitHub releases (download + verify + unpack; no git). */
  binary?: boolean;
  /** `version`: the package version (binary installs). */
  current: { commit: string; committedAt: string | null; version?: string } | null;
  /** Newest commit on the update source's channel branch when it is ahead of the running build.
   *  `offMain`: the running build is not on that branch at all (packaged by hand from another branch,
   *  or a channel switch); `count` is 0. `switchChannel`: the channel was switched and its head is older
   *  than the running build — offered (never installed silently) as the switch to that channel.
   *  Binary installs: `version` of the newest release (commit "", count 0, subject = release name). */
  latest: { commit: string; committedAt: string; subject: string; count: number; offMain?: boolean; switchChannel?: boolean; version?: string } | null;
  step?: UpdateStep;
  /** Last lines of the failing step (state "error"). */
  error?: string;
  checkedAt?: string;
  /** Releases moved out of `<base>/releases` into `dir` (`<base>/old-releases`, shared/releases.ts);
   *  deleted automatically `autoDeleteDays` after the move, or now via deleteOldReleases. Absent until
   *  the first housekeeping run after start (portable installs only). */
  oldReleases?: { count: number; bytes: number; autoDeleteDays: number; dir: string };
}
export type UpdateRequest = { op: "state" } | { op: "check" } | { op: "apply" } | { op: "setChannel"; channel: string } | { op: "deleteOldReleases" };
export interface UpdateBridge {
  state(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  /** Starts the update; progress arrives as updateStatus events; ends with a relaunch. */
  apply(): Promise<UpdateStatus>;
  /** Follow another channel (`main` / `release`): writes `<base>/channel`, then checks again. */
  setChannel?(channel: string): Promise<UpdateStatus>;
  /** Delete everything in `<base>/old-releases` now (Settings → 更新与诊断 → 删除旧版本). */
  deleteOldReleases?(): Promise<UpdateStatus>;
}

/**
 * Owner 唤醒 (agent-messages-v2, docs/research/agent-messaging.md §6.2a): queue an owner input that
 * makes the agent read its pending notes (a turn at once when idle). params {}; result
 * {pendingNotes, started}. Sent on the session-requests route like the other session actions.
 */
export const MESSAGES_WAKE_METHOD = "cutex/agentBus/wake";

export const SESSION_ACTION_METHODS = [
  "cutex/session/metadata/update",
  "cutex/session/retire",
  "cutex/session/restore",
  "cutex/session/fork",
  "cutex/session/delete",
  "cutex/session/visibility/hide",
  "cutex/session/visibility/show",
  "cutex/runtime/offline",
  "cutex/runtime/online",
  // Only the Claude tool switches (`patch` is checked in main: SESSION_DEFAULTS_KEYS).
  "cutex/session/defaults/update",
  MESSAGES_WAKE_METHOD,
] as const;
/** The `cutex/session/defaults/update` patch keys the renderer may send (boolean values). */
export const SESSION_DEFAULTS_KEYS = ["claudeAllowWrite", "claudeAllowExec"] as const;
export type SessionActionMethod = (typeof SESSION_ACTION_METHODS)[number];

/** cute-codex ThreadBackgroundTerminal (rssKb narrowed to number for IPC). */
export interface BackgroundTerminal {
  itemId: string;
  processId: string;
  command: string;
  cwd: string;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: number | null;
}

export type ProjectMutationOperation =
  | { kind: "add_member"; cutex_session_id: string }
  | { kind: "detach_member"; cutex_session_id: string }
  | { kind: "set_workspace_root"; workspace_root: string | null }
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "create"; director_cutex_session_id: string; presentation: { display_name: string; badge_label: string; color: string } }
  // project-optional-director (cutex): the Director is optional and can be assigned / cleared later.
  // project-create-workspace-root: `create_workspace_root` creates a missing directory on the host.
  | { kind: "create_project"; presentation: { display_name: string; badge_label: string; color: string }; workspace_root?: string | null; director_cutex_session_id?: string | null; create_workspace_root?: boolean }
  | { kind: "assign_director"; cutex_session_id: string }
  | { kind: "clear_director" }
  // owner-rotation (cutex): replace the Director with an existing agent in one commit (the former one
  // stays a member, Operator grants are kept); the authority epoch fence is required.
  | { kind: "rotate_director"; successor_cutex_session_id: string };

export interface ProjectMemoryView {
  dir: string;
  /** MEMORY.md (index) content, if present. */
  index?: string | null;
  entries: { file: string; name: string; description?: string | null; type?: string | null; bytes?: number | null; updatedAt?: string | null; [k: string]: unknown }[];
  [k: string]: unknown;
}

// ---------- delegations (委托; cutex "asks", wire names kept) ----------

/** `execution` of a delegation (cutex asks model). */
export type AskExecution = "pendingReview" | "queued" | "admitted" | "running" | "answered" | "failed" | "interrupted" | "cancelled" | "rejected";
/** Why a queued / admitted / running delegation is held (zero or one reason). */
export type AskHold =
  | { reason: "targetBusy"; position?: number | null }
  | { reason: "paused"; by: "owner" | "planMode" }
  | { reason: "heldByRuntime"; native?: string | null }
  | { reason: "blocked"; by: string }
  | { reason: "waitingForApproval" }
  | { reason: "waitingForInput" }
  | { reason: "profileSwitchPending" }
  | { reason: "runtimeUnsupported"; missing?: string }
  // peers-v2: an outgoing mirror whose peer cannot be reached / changed identity / speaks another
  // version; peerUnknown = the destination reported a state this cutex does not know (`raw`, display only).
  | { reason: "peerUnreachable" }
  | { reason: "peerIdentityChanged" }
  | { reason: "peerVersionMismatch" }
  | { reason: "peerUnknown"; raw?: string };
export type AskReview = "awaitingAcceptance" | "accepted" | "changesRequested" | "abandoned";
export type AskClosed = "completed" | "accepted" | "abandoned" | "stopped" | "cancelled" | "superseded";
export type AskInterruptReason = "stopped" | "ownerStopped" | "runtimeRestart" | "outcomeUnknown" | "peerRemoved" | "peerDisabled" | "peersDisabled" | "removedByPeer" | "peerStripped";
/**
 * Who made the delegation. The stored form is `{kind:"agent", cutex_session_id, name}`; cutex
 * `delegation-views` also emits `cutexSessionId` in views (both accepted).
 */
export type AskRequester =
  | { kind: "agent"; cutexSessionId?: string; cutex_session_id?: string; name?: string | null }
  | { kind: "owner" }
  /**
   * peers-v2: an agent of a paired host (`cutexSessionId` is the REMOTE session id, never a local one).
   * `name` / `label` are sanitized single lines; `claimedCaps` is what the remote says about the
   * requester — display only, never the approval baseline (that is the peer policy's assumedCaps).
   */
  | { kind: "peer"; peerId: string; cutexSessionId: string; name?: string | null; label: string; claimedCaps?: Partial<PeerCaps> | null };

/** peers-v2: the destination side of an outgoing mirror (`AskSummary.remote`). */
export interface AskRemote {
  peerId: string;
  label: string;
  targetName: string;
  /** "queued" | "synced" | "remoteStateUnknown" | a local error / reason code (peer_unreachable, outcomeUnknown, peerDisabled, …). */
  syncState: string;
  /** Sanitized single-line diagnostic (≤ 512 bytes). */
  lastError?: string | null;
  interruptReason?: AskInterruptReason | (string & {}) | null;
  /** The destination's last snapshot metadata (no answer text). */
  remoteState?: { execution?: string; hold?: { reason?: string; raw?: string } | null; closed?: string | null; review?: string | null; lastError?: string | null; [key: string]: unknown } | null;
}

/** peers-v2: an answer that arrived after the mirror closed locally (no new delivery; full text in a local artifact). */
export interface AskLateAnswer {
  artifactId?: string | null;
  preview?: string | null;
  lastError?: string | null;
  execution?: string;
  [key: string]: unknown;
}

/** The current attempt as `AskSummary.attempt` carries it (cutex `delegation-views`). */
export interface AskAttemptView {
  n: number;
  state?: string;
  turnId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  profile?: string | null;
  model?: string | null;
  activity?: { toolCalls?: number; line?: string | null } | null;
  interruptReason?: AskInterruptReason | null;
  lastError?: string | null;
  /** Latest progress notes kept by cutex (delegation-views, last 5). */
  progress?: { text: string; at: string }[] | null;
  /**
   * A stop (or the requester's abandon) was accepted and waits for the turn to end. The full record
   * (`GET /v2/asks/{id}`, `cutex/ask/created`) has it; list rows do not yet (cutex r222).
   */
  stopRequested?: boolean;
}

/** `GET /v2/asks` row. Fields after `revision` come with cutex `delegation-views` (absent before). */
export interface AskSummary {
  askId: string;
  title: string;
  requester: AskRequester;
  /** Target agent (cutex session id). */
  target: string;
  targetName?: string | null;
  projectId?: string | null;
  execution: AskExecution;
  hold?: AskHold | null;
  /** Reset on every hold change (incl. queue moves): not a wait time. */
  holdSince?: string | null;
  review?: AskReview | null;
  closed?: AskClosed | null;
  queuePosition?: number | null;
  /** Number of attempts. */
  attempts: number;
  answerId?: string | null;
  openQuestions?: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  attempt?: AskAttemptView | null;
  closedAt?: string | null;
  followUpOf?: string | null;
  /** Open questions routed to the owner. */
  ownerQuestions?: number;
  /** First ≤300 chars of the answer. */
  answerPreview?: string | null;
  // ---------- peers-v2 ----------
  /** Cross-host hops along the delegation chain (0 = local). */
  hops?: number;
  /** An outgoing mirror: the remote target and its sync state. */
  remote?: AskRemote | null;
  lateAnswer?: AskLateAnswer | null;
  /** An incoming ask whose result could not be sent back to the requesting host. */
  resultUndeliverable?: boolean;
}

export interface AskFilter {
  project?: string;
  /** A cutex session id or "owner". */
  requester?: string;
  target?: string;
  /** Requester or target (cutex `delegation-views`). */
  involving?: string;
  /** "open" | "closed" | an execution state. */
  state?: string;
  limit?: number;
}

/** `GET /v2/asks/{id}` → `ask`: the stored record plus queue position, attempts, answer, questions. */
export interface AskDetail {
  askId: string;
  title: string;
  requester: AskRequester;
  targetCutexSessionId: string;
  targetName?: string | null;
  body?: { text?: string; textArtifact?: string | null; textBytes?: number } | null;
  execution: AskExecution;
  hold?: AskHold | null;
  review?: AskReview | null;
  closed?: AskClosed | null;
  attempts?: (AskAttemptView & { attemptId?: string; submittedAt?: string })[];
  answer?: { answerId?: string; status?: string; bytes?: number; metadata?: Record<string, unknown> | null } | null;
  questions?: AskQuestion[];
  queuePosition?: number | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  [key: string]: unknown;
}

/** A question of a running delegation (cutex QuestionRecord). */
export interface AskQuestion {
  questionId: string;
  askId: string;
  attempt?: number;
  questions: unknown;
  route?: "requester" | "owner";
  routedToOwnerAt?: string | null;
  state: "open" | "resolved" | "stale";
  createdAt?: string;
}

/** `GET /v2/asks/{id}/answer?cursor=` page (8 KiB). */
export interface AskAnswerPage {
  askId: string;
  answerId: string;
  revision: number;
  status: string;
  cursor: number;
  nextCursor: number | null;
  bytes: number;
  text: string;
  metadata?: Record<string, unknown> | null;
}

/** `GET /v2/artifacts/{id}`. */
export interface ArtifactView {
  artifact: Record<string, unknown>;
  encoding: "utf8" | "base64";
  content: string;
}

/** Owner commands on a delegation (`POST /v2/sessions/{id}/cutex/requests`). */
export type AskCommandMethod = "cutex/ask/stop" | "cutex/ask/close" | "cutex/ask/retry";
export const ASK_COMMAND_METHODS: readonly AskCommandMethod[] = ["cutex/ask/stop", "cutex/ask/close", "cutex/ask/retry"];

// ---------- jobs (cutex Job Service, wire names kept) ----------

/**
 * Job Service state, passed through as-is: launch_pending, running, exited, failed, cancelled,
 * interrupted, launch_unknown today; a future scheduler may add more (lib/jobs JOB_STATES maps
 * them; unknown ones show their raw name).
 */
export type JobState = string;
export type JobStream = "stdout" | "stderr";

export interface JobStreamSummary {
  retainedBytes?: number;
  observedBytes?: number;
  truncated?: boolean;
}

/** A `cutex/job-list/v1` row (bounded metadata; `command` only from a Job Service that sends it). */
export interface JobRow {
  jobId: string;
  actionId: string;
  /** Submitting agent (cutex session id). */
  sessionId: string;
  agentName?: string | null;
  state: JobState;
  /** Epoch seconds. */
  createdAt: number;
  updatedAt: number;
  exitCode?: number | null;
  cwd?: string | null;
  command?: string | null;
  stdout?: JobStreamSummary | null;
  stderr?: JobStreamSummary | null;
  revision: number;
  outputReference?: string | null;
  delivery?: string | null;
  /** `local` (run by the Job Service) or an external source (`nci`); absent on an older Job Service = local. */
  source?: string | null;
  /** External scheduler id, e.g. the PBS job id `123456.gadi-pbs`. */
  remoteId?: string | null;
  remoteName?: string | null;
  /** Epoch seconds of the last trusted source event (mail-triggered qstat, fallback poll). */
  lastSourceEventAt?: number | null;
  /** External job without a source event for longer than the stale interval (state unchanged). */
  stale?: boolean | null;
}

export interface JobListPage {
  data: JobRow[];
  nextCursor: string | null;
}

export interface JobServiceCapabilities {
  /** Human (root) operations: "list", "cancel", "readOutput". Absent on an older Job Service = list only. */
  humanOperations?: string[];
  [key: string]: unknown;
}

export interface JobOutputPage {
  jobId: string;
  stream: JobStream;
  fromOffset: number;
  nextOffset: number;
  text: string;
  gap?: boolean;
  omittedBytes?: number;
  eof: boolean;
  truncated?: boolean;
}

/**
 * A job call's outcome. `code`: cutex error code (job_service_unavailable, job_not_found,
 * job_conflict, job_service_operation_unsupported, …) or `unsupported` when cutex has no such route.
 */
export type JobResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
