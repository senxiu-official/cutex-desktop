// Browser-preview data for Settings → Profile → Claude 账户 (`/v2/claude/accounts`, shapes in
// shared/claudeAccounts.ts). Every state: the shared default logged in (Max, 5h / 7d windows),
// "Work" needing a login (完成 then finds it logged in), "Personal" whose status check failed, the
// "DeepSeek" API account with a key and ledger usage, "Kimi" without a key (完成 then finds one).
// A new subscription account shows 需要登录 (its fresh home has no login yet; 完成 then finds one).
// The accounts' `profiles` are the profile → account binding: profiles report it as
// `claudeAccount`, the profile editor's 账户 select rebinds them (PATCH) and the 添加 profile form
// sets it (POST `{kind:"claude", claudeAccount}`); an unknown id is a 400 like cutex.
// Not under `?legacy` (the section and the selects are hidden without claude-accounts).
import { CLAUDE_ACCOUNT_ID, CLAUDE_ACCOUNTS_FEATURE, DEFAULT_CLAUDE_ACCOUNT, type ClaudeAccount, type ClaudeAccountCreate, type ProfileQuotaDetail } from "../../../../shared/claudeAccounts";
import type { CutexRefusal, QuotaGauge } from "../../../../shared/ipc";
import type { MockProfileRef, ModuleMock } from "../../dev/mockTypes";

const ROOT = "C:\\Users\\owner\\.cutex\\claude-accounts";
const CLI = "C:\\Users\\owner\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function loginCommand(id: string, home: string): ClaudeAccount["loginCommand"] {
  return {
    cutex: `cutex human claude account login ${id}`,
    powershell: `$env:CLAUDE_CONFIG_DIR = '${home}'; & '${CLI}' auth login --claudeai`,
    posix: `CLAUDE_CONFIG_DIR='${home}' '${CLI}' auth login --claudeai`,
    claudeConfigDir: home,
  };
}

function subscription(id: string, label: string | null, home: string, rest: Partial<ClaudeAccount>): ClaudeAccount {
  return { id, label, kind: "subscription", isDefault: id === "default", home, createdAt: id === "default" ? null : ago(60 * 24 * 3), api: null, status: null, loginCommand: loginCommand(id, home), profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: id !== "default", ...rest };
}

function apiAccount(id: string, label: string, baseUrl: string | null, keyEnv: "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN", env: Record<string, string>, keyPresent: boolean, rest: Partial<ClaudeAccount>): ClaudeAccount {
  return {
    id,
    label,
    kind: "api",
    isDefault: false,
    home: `${ROOT}\\${id}`,
    createdAt: ago(60 * 24),
    api: { baseUrl, keyEnv, env, apiKeyPresent: keyPresent },
    status: apiStatus(baseUrl, keyEnv, keyPresent),
    loginCommand: null,
    profiles: [],
    sessions: { active: 0, online: 0, retired: 0 },
    removable: true,
    ...rest,
  };
}

function apiStatus(baseUrl: string | null, keyEnv: string, present: boolean): ClaudeAccount["status"] {
  return { loggedIn: present, authMethod: "api_key", apiProvider: baseUrl ? "anthropicCompatible" : "firstParty", apiKeySource: present ? keyEnv : null, checkedAt: new Date().toISOString(), error: present ? null : "no API key stored" };
}

const accounts: ClaudeAccount[] = [
  subscription("default", null, "C:\\Users\\owner\\.cutex-claude-compatible\\.claude", {
    status: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@example.com", orgName: "Personal", subscriptionType: "max", checkedAt: ago(42) },
    profiles: [{ id: "claude", name: "claude" }],
    sessions: { active: 3, online: 1, retired: 2 },
    removable: false,
  }),
  subscription("ca-work7k2m9q", "Work", `${ROOT}\\ca-work7k2m9q`, {
    status: { loggedIn: false, authMethod: "none", checkedAt: ago(5) },
    profiles: [{ id: "claude-work", name: "claude-work" }],
    removable: false,
  }),
  subscription("ca-pers3x8h1v", "Personal", `${ROOT}\\ca-pers3x8h1v`, {
    status: { loggedIn: false, checkedAt: ago(90), error: "claude auth status timed out after 30 s" },
  }),
  apiAccount("ca-deep5s2k4p", "DeepSeek", "https://api.deepseek.com/anthropic", "ANTHROPIC_API_KEY", { ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro", ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro", ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-flash" }, true, {
    profiles: [{ id: "deepseek-claude", name: "deepseek-claude" }],
    sessions: { active: 1, online: 1, retired: 0 },
    removable: false,
  }),
  apiAccount("ca-kimi8n3r2t", "Kimi", "https://api.moonshot.ai/anthropic", "ANTHROPIC_AUTH_TOKEN", {}, false, {}),
];

const now = () => Math.floor(Date.now() / 1000);
function gauge(index: number, label: string, usedPercent: number, resetInMin: number, stale = false): QuotaGauge {
  return { id: `claude-${index}`, label: "Claude", kind: "window", remainingPercent: 100 - usedPercent, balance: null, resetAt: now() + resetInMin * 60, windowLabel: label, observedAt: now() - 120, stale };
}
const totals = (turns: number, total: number, estimatedCost: number) => ({ turns, requests: turns, input: Math.round(total * 0.8), cachedInput: Math.round(total * 0.5), output: Math.round(total * 0.2), total, estimatedCost });

function quotaFor(account: ClaudeAccount): ProfileQuotaDetail {
  const claudeAccount = { id: account.id, label: account.label, kind: account.kind };
  if (account.kind === "api") {
    return { source: "claudeApi", gauges: [], nativeQuota: { source: "usageLedger", claudeAccount, apiUsage: { today: totals(4, 61_200, 0.002948), last7Days: totals(37, 1_480_000, 0.41), last30Days: totals(121, 6_920_000, 1.83), currency: "USD" } } };
  }
  if (!account.status?.loggedIn) {
    return { source: "claude", gauges: [], nativeQuota: { claudeAccount, fetchedAt: null, stale: true, refreshing: false, consecutiveFailures: 3, lastError: "read failed: no credentials file in the account home (os error 2)", source: "read" } };
  }
  const gauges = account.isDefault ? [gauge(0, "5h", 38, 138), gauge(1, "7d", 12, 60 * 52)] : [gauge(0, "5h", 4, 290), gauge(1, "7d", 61, 60 * 20)];
  // A second subscription shows the expired-token state (cutex claude-quota-stale-credentials).
  if (!account.isDefault) return { source: "claude", gauges, nativeQuota: { claudeAccount, fetchedAt: now() - 120, stale: false, refreshing: false, consecutiveFailures: 0, lastError: null, credentialsExpired: true, credentialsExpiredAt: now() - 600, source: "read" } };
  return { source: "claude", gauges, nativeQuota: { claudeAccount, fetchedAt: now() - 120, stale: false, refreshing: false, consecutiveFailures: 0, lastError: null, source: "read" } };
}

/** The account a Claude profile is bound to (accounts' `profiles`; unbound = `default`, like cutex). */
function boundAccount(profile: MockProfileRef): string {
  return accounts.find((a) => !a.isDefault && a.profiles.some((p) => p.id === profile.id))?.id ?? DEFAULT_CLAUDE_ACCOUNT;
}

/** PATCH /v2/profiles/{p} `{claudeAccount}` like cutex: Claude profiles only, `null` / `default` = shared, unknown id → 400. */
function bindProfile(profile: MockProfileRef, value: unknown): void {
  if (profile.cliKind !== "claude") throw new Error("invalid_request: claudeAccount applies to Claude profiles only");
  if (value !== null && (typeof value !== "string" || !CLAUDE_ACCOUNT_ID.test(value.trim()))) throw new Error('invalid_request: claudeAccount: must be a Claude account id (ca-…), "default" or null');
  const id = (value as string | null)?.trim() || DEFAULT_CLAUDE_ACCOUNT;
  const target = find(id);
  if (!target) throw new Error(`invalid_request: claudeAccount: no Claude account ${id} on this host`);
  for (const a of accounts) {
    a.profiles = a.profiles.filter((p) => p.id !== profile.id);
    if (!a.isDefault) a.removable = a.profiles.length === 0 && a.sessions.active === 0;
  }
  target.profiles.push({ id: profile.id, name: profile.name });
  if (!target.isDefault) target.removable = false;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const refusal = (code: string, message: string, sessions?: CutexRefusal["sessions"]): { ok: false; error: CutexRefusal } => ({ ok: false, error: { code, message, ...(sessions ? { sessions } : {}) } });
const find = (id: string) => accounts.find((a) => a.id === id);
const taken = (label: string, except?: string) => accounts.some((a) => a.id !== except && a.label === label);

export const mock: ModuleMock = {
  features: { new: [CLAUDE_ACCOUNTS_FEATURE] },
  // The profile → account binding (profile editor → 账户): `claudeAccount` on profiles, PATCH rebinds.
  profile: {
    fields: (profile, core) => (core.legacy ? {} : { claudeAccount: profile.cliKind === "claude" ? boundAccount(profile) : null }),
    patch(profile, body, core) {
      if (core.legacy || !("claudeAccount" in body)) return [];
      bindProfile(profile, body.claudeAccount);
      return ["claudeAccount"];
    },
  },
  api: (core) => ({
    async claudeAccounts() {
      await wait(200);
      if (core.legacy) return null;
      return { contractVersion: 2, accounts: structuredClone(accounts) };
    },
    async createClaudeAccount(request: ClaudeAccountCreate) {
      await wait(250);
      if (taken(request.label)) return refusal("claude_account_label_taken", `a Claude account labelled ${request.label} already exists`);
      const id = `ca-${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;
      const account =
        request.kind === "api"
          ? apiAccount(id, request.label, request.baseUrl ?? null, request.keyEnv ?? "ANTHROPIC_API_KEY", request.env ?? {}, false, { createdAt: new Date().toISOString() })
          : subscription(id, request.label, `${ROOT}\\${id}`, { createdAt: new Date().toISOString(), status: { loggedIn: false, authMethod: "none", checkedAt: new Date().toISOString() } });
      accounts.push(account);
      return { ok: true as const, account: structuredClone(account) };
    },
    async renameClaudeAccount(id: string, label: string) {
      await wait(200);
      const account = find(id);
      if (!account) return refusal("claude_account_not_found", `no Claude account ${id}`);
      if (account.isDefault) return refusal("claude_account_is_default", "the default Claude account has no editable settings");
      if (taken(label, id)) return refusal("claude_account_label_taken", `a Claude account labelled ${label} already exists`);
      account.label = label;
      return { ok: true as const, account: structuredClone(account) };
    },
    async deleteClaudeAccount(id: string) {
      await wait(250);
      const i = accounts.findIndex((a) => a.id === id);
      const account = accounts[i];
      if (!account) return refusal("claude_account_not_found", `no Claude account ${id}`);
      if (account.isDefault) return refusal("claude_account_is_default", "the default Claude account cannot be removed");
      if (!account.removable) return refusal("claude_account_in_use", "Claude account is in use", account.sessions.active ? [{ cutexSessionId: "cutex.kaworu-7f3a", displayName: "Kaworu" }] : undefined);
      accounts.splice(i, 1);
      return { ok: true as const, removed: { id, removed: true as const, homeDeleted: false, keptHome: account.home } };
    },
    async checkClaudeAccount(id: string) {
      await wait(900);
      const account = find(id);
      if (!account) return refusal("claude_account_not_found", `no Claude account ${id}`);
      if (account.kind === "api") {
        // The owner ran the key command in the meantime.
        account.api!.apiKeyPresent = true;
        account.status = apiStatus(account.api!.baseUrl, account.api!.keyEnv, true);
      } else if (account.id === "ca-pers3x8h1v") {
        account.status = { loggedIn: false, checkedAt: new Date().toISOString(), error: "claude auth status timed out after 30 s" };
      } else if (!account.status?.loggedIn) {
        // The owner logged in from the terminal in the meantime.
        account.status = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@acme.example", orgName: "Acme Labs", subscriptionType: "team", checkedAt: new Date().toISOString() };
      } else account.status = { ...account.status, checkedAt: new Date().toISOString() };
      return { ok: true as const, account: structuredClone(account) };
    },
    async profileQuotaDetail(profile: string) {
      await wait(150);
      const account = accounts.find((a) => a.profiles.some((p) => p.id === profile || p.name === profile));
      return account ? quotaFor(account) : { source: null, gauges: [], nativeQuota: null };
    },
  }),
};
