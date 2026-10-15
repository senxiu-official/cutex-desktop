// Claude accounts (cutex capability `claude-accounts`, r219): the wire shapes of
// `/v2/claude/accounts` (cutex `src/management/v2/claude_accounts_api.rs`, schema export
// `claude-accounts.json`) and the request bodies the main process sends.
//
// The desktop never handles a Claude credential (docs/research/claude-multi-account.md decision 2):
// there is no login over HTTP (the owner runs the account's `loginCommand` in a terminal on the host,
// then the desktop asks cutex for the status), and the write-only `apiKey` field is never sent (an
// API account's key is set with `cutex human claude account set <id> --api-key-stdin`). The
// sanitizers below refuse a body that carries one, so a renderer bug cannot leak a key to cutex
// through this bridge either.
import type { CutexRefusal, QuotaGauge } from "./ipc";

/** cutex capability of `/v2/claude/accounts`. */
export const CLAUDE_ACCOUNTS_FEATURE = "claude-accounts";
/** The implicit shared account (the deployment's `claude_home`): not stored, not removable, no settings. */
export const DEFAULT_CLAUDE_ACCOUNT = "default";
/** cutex `accountId`: `default` or `ca-` + lowercase base32. */
export const CLAUDE_ACCOUNT_ID = /^(default|ca-[a-z0-9]{1,32})$/;
/** cutex `MAX_LABEL_CHARS`. */
export const MAX_CLAUDE_ACCOUNT_LABEL = 64;
/** How an API account's key reaches Claude Code: `x-api-key` or `Authorization: Bearer`. */
export const CLAUDE_KEY_ENVS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
export type ClaudeKeyEnv = (typeof CLAUDE_KEY_ENVS)[number];
export type ClaudeAccountKind = "subscription" | "api";

// ---------- wire ----------

/** Non-secret fields of `claude auth status` (subscription) or of the stored key (api). */
export interface ClaudeAccountStatus {
  loggedIn: boolean;
  /** `claude.ai` | `api_key` | `none` | … */
  authMethod?: string | null;
  /** `firstParty` | `anthropicCompatible` | … */
  apiProvider?: string | null;
  apiKeySource?: string | null;
  email?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  /** `pro` | `max` | `team` | `enterprise` | … */
  subscriptionType?: string | null;
  /** RFC 3339. */
  checkedAt?: string | null;
  /** The check itself failed (status unknown). */
  error?: string | null;
}

/** Terminal commands that log a subscription account in (shown; the desktop never runs them). */
export interface ClaudeLoginCommand {
  cutex: string;
  powershell: string;
  posix: string;
  claudeConfigDir: string;
}

export interface ClaudeApiSettings {
  /** `ANTHROPIC_BASE_URL`; null = Anthropic. */
  baseUrl: string | null;
  keyEnv: ClaudeKeyEnv;
  /** Extra non-secret Claude Code settings (model aliases, …). */
  env: Record<string, string>;
  apiKeyPresent: boolean;
}

/** One account of `GET /v2/claude/accounts` (no secret). */
export interface ClaudeAccount {
  id: string;
  /** null for `default`. */
  label: string | null;
  kind: ClaudeAccountKind;
  isDefault: boolean;
  /** The account's `CLAUDE_CONFIG_DIR` on the host. */
  home: string | null;
  createdAt: string | null;
  api: ClaudeApiSettings | null;
  /** subscription: the last status check (null = never checked); api: computed (key present). */
  status: ClaudeAccountStatus | null;
  /** Subscription accounts only. */
  loginCommand: ClaudeLoginCommand | null;
  /** Claude profiles bound to the account (`default`: Claude profiles without an account). */
  profiles: { id: string; name: string }[];
  sessions: { active: number; online: number; retired: number };
  /** No bound profile and no active session (default: never). */
  removable: boolean;
}

export interface ClaudeAccountList {
  contractVersion: number;
  /** `default` first. */
  accounts: ClaudeAccount[];
}

/** `DELETE /v2/claude/accounts/{id}` (the home is always kept: the desktop never sends `deleteHome`). */
export interface ClaudeAccountRemoved {
  id: string;
  removed: true;
  homeDeleted: boolean;
  /** The home kept for archived sessions (login, native history). */
  keptHome: string | null;
}

/** `POST /v2/claude/accounts` as the desktop sends it: never `apiKey`. */
export interface ClaudeAccountCreate {
  label: string;
  kind: ClaudeAccountKind;
  /** api only. */
  baseUrl?: string;
  keyEnv?: ClaudeKeyEnv;
  env?: Record<string, string>;
}

export type ClaudeAccountResult = { ok: true; account: ClaudeAccount } | { ok: false; error: CutexRefusal };
export type ClaudeAccountRemoveResult = { ok: true; removed: ClaudeAccountRemoved } | { ok: false; error: CutexRefusal };

/** `GET /v2/profiles/{p}/quota` with cutex's `source` and `nativeQuota` (profileQuota keeps only the gauges). */
export interface ProfileQuotaDetail {
  /** `native` | `claude` | `claudeApi` | `quotaConfig` | null. */
  source: string | null;
  gauges: QuotaGauge[];
  nativeQuota: Record<string, unknown> | null;
}

// ---------- request bodies (main validates what the renderer sends) ----------

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || [...v].length > max || /[\u0000-\u001f\u007f]/.test(v)) return undefined;
  return v;
}

/** A well-formed account id, or an Error. */
export function claudeAccountId(id: unknown): string {
  if (typeof id !== "string" || !CLAUDE_ACCOUNT_ID.test(id)) throw new Error("bad Claude account id");
  return id;
}

/** A label cutex can store: trimmed, 1–64 visible characters, not `default`. Null when not. */
export function claudeAccountLabel(value: unknown): string | null {
  const label = cleanText(value, MAX_CLAUDE_ACCOUNT_LABEL);
  if (!label || label.toLowerCase() === DEFAULT_CLAUDE_ACCOUNT) return null;
  return label;
}

const ENV_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Names that carry a credential (cutex's allow-list refuses them too; MAX_THINKING_TOKENS etc. stay allowed). */
const SECRET_ENV = /(^|_)(API_KEY|AUTH_TOKEN|OAUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD)(_|$)/;

/**
 * `POST /v2/claude/accounts` from renderer input, or an Error. Only the fields the desktop may send;
 * an `apiKey` (or any secret-looking env entry) is refused outright. cutex validates everything again
 * (base URL form, the env allow-list) and answers 400 with the reason.
 */
export function claudeAccountCreateBody(input: unknown): ClaudeAccountCreate {
  const r = (input ?? {}) as Record<string, unknown>;
  if ("apiKey" in r) throw new Error("the desktop never sends a Claude API key");
  const label = claudeAccountLabel(r.label);
  if (!label) throw new Error("bad Claude account label");
  const kind = r.kind ?? "subscription";
  if (kind !== "subscription" && kind !== "api") throw new Error("bad Claude account kind");
  if (kind === "subscription") {
    if (r.baseUrl !== undefined || r.keyEnv !== undefined || r.env !== undefined) throw new Error("API settings on a subscription account");
    return { label, kind };
  }
  const body: ClaudeAccountCreate = { label, kind };
  if (r.baseUrl !== undefined && r.baseUrl !== "") {
    const url = cleanText(r.baseUrl, 2048);
    if (!url) throw new Error("bad base URL");
    body.baseUrl = url;
  }
  if (r.keyEnv !== undefined) {
    if (!CLAUDE_KEY_ENVS.includes(r.keyEnv as ClaudeKeyEnv)) throw new Error("bad key env");
    body.keyEnv = r.keyEnv as ClaudeKeyEnv;
  }
  if (r.env !== undefined) {
    if (!r.env || typeof r.env !== "object" || Array.isArray(r.env)) throw new Error("bad env");
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(r.env as Record<string, unknown>)) {
      if (!ENV_KEY.test(key) || SECRET_ENV.test(key)) throw new Error(`env ${key} is not allowed`);
      const v = cleanText(value, 256);
      if (!v) throw new Error(`env ${key}: bad value`);
      env[key] = v;
    }
    if (Object.keys(env).length) body.env = env;
  }
  return body;
}

/** `PATCH /v2/claude/accounts/{id}` for 重命名: `{label}` only. */
export function claudeAccountRenameBody(label: unknown): { label: string } {
  const clean = claudeAccountLabel(label);
  if (!clean) throw new Error("bad Claude account label");
  return { label: clean };
}

// ---------- per-account quota (via a profile bound to the account) ----------

/** One usage-ledger window of an API account (`nativeQuota.apiUsage.*`). */
export interface ClaudeApiUsageWindow {
  turns: number;
  total: number;
  /** In `currency`; null when nothing was priced. */
  estimatedCost: number | null;
}

export interface ClaudeAccountQuota {
  /** `windows`: subscription 5h / 7d gauges; `apiUsage`: ledger totals of an API account. */
  kind: "windows" | "apiUsage";
  gauges: QuotaGauge[];
  /** Subscription reads: last error, staleness and whether cutex is reading right now. */
  lastError: string | null;
  stale: boolean;
  refreshing: boolean;
  /** The stored login token expired, so cutex skipped the read (`nativeQuota.credentialsExpired`, cutex
   *  `claude-quota-stale-credentials`): not an error, Claude Code refreshes it when a session on the account runs. */
  credentialsExpired: boolean;
  apiUsage: { today: ClaudeApiUsageWindow; last7Days: ClaudeApiUsageWindow; last30Days: ClaudeApiUsageWindow; currency: string | null } | null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageWindow(value: unknown): ClaudeApiUsageWindow {
  const w = (value ?? {}) as Record<string, unknown>;
  return { turns: num(w.turns), total: num(w.total), estimatedCost: typeof w.estimatedCost === "number" && Number.isFinite(w.estimatedCost) ? w.estimatedCost : null };
}

/** The account's quota from a bound profile's quota reply; null when it is not a Claude account reading. */
export function claudeAccountQuota(detail: ProfileQuotaDetail | null): ClaudeAccountQuota | null {
  if (!detail) return null;
  const meta = detail.nativeQuota ?? {};
  if (detail.source === "claudeApi") {
    const usage = (meta.apiUsage ?? null) as Record<string, unknown> | null;
    return {
      kind: "apiUsage",
      gauges: [],
      lastError: null,
      stale: false,
      refreshing: false,
      credentialsExpired: false,
      apiUsage: usage ? { today: usageWindow(usage.today), last7Days: usageWindow(usage.last7Days), last30Days: usageWindow(usage.last30Days), currency: typeof usage.currency === "string" ? usage.currency : null } : null,
    };
  }
  if (detail.source !== "claude") return null;
  return {
    kind: "windows",
    gauges: detail.gauges ?? [],
    lastError: typeof meta.lastError === "string" && meta.lastError ? meta.lastError : null,
    stale: meta.stale === true,
    refreshing: meta.refreshing === true,
    credentialsExpired: meta.credentialsExpired === true,
    apiUsage: null,
  };
}
