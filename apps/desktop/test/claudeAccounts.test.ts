// Claude accounts (cutex claude-accounts): the request bodies main sends (never a key), the quota
// adapter, and the pure view helpers of Settings → Profile → Claude 账户 and its add flow.
import { describe, expect, it } from "vitest";
import { claudeAccountCreateBody, claudeAccountId, claudeAccountLabel, claudeAccountQuota, claudeAccountRenameBody, type ClaudeAccount } from "../src/shared/claudeAccounts";
import { accountCreateRequest, accountsNeedingAttention, accountState, accountSummary, apiKeyCommand, baseUrlLabel, checkedAtSeconds, formatCost, guessKeyShell, needsTerminal, parseEnvLines, planLabel, quotaNote, refusalKey } from "../src/renderer/src/modules/claude-accounts/accountView";

function account(over: Partial<ClaudeAccount>): ClaudeAccount {
  return { id: "ca-a1", label: "Work", kind: "subscription", isDefault: false, home: null, createdAt: null, api: null, status: null, loginCommand: null, profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true, ...over };
}

describe("request bodies (main validates renderer input)", () => {
  it("account ids: default or ca-…, nothing that could leave the route", () => {
    expect(claudeAccountId("default")).toBe("default");
    expect(claudeAccountId("ca-0abc9z")).toBe("ca-0abc9z");
    for (const bad of ["", "CA-X", "ca-", "ca-a/status", "../x", "ca-a?deleteHome=true", 7, null]) expect(() => claudeAccountId(bad)).toThrow("bad Claude account id");
  });

  it("labels: trimmed, 1–64 visible characters, not `default`", () => {
    expect(claudeAccountLabel("  Work ")).toBe("Work");
    expect(claudeAccountLabel("工作账户")).toBe("工作账户");
    expect(claudeAccountLabel("x".repeat(64))).toHaveLength(64);
    for (const bad of ["", "   ", "x".repeat(65), "a\nb", "default", "Default", 3]) expect(claudeAccountLabel(bad)).toBeNull();
    expect(claudeAccountRenameBody(" Personal ")).toEqual({ label: "Personal" });
    expect(() => claudeAccountRenameBody("default")).toThrow("bad Claude account label");
  });

  it("subscription accounts send a label only", () => {
    expect(claudeAccountCreateBody({ label: " Work " })).toEqual({ label: "Work", kind: "subscription" });
    expect(claudeAccountCreateBody({ label: "Work", kind: "subscription" })).toEqual({ label: "Work", kind: "subscription" });
    expect(() => claudeAccountCreateBody({ label: "Work", baseUrl: "https://a.example" })).toThrow("API settings");
    expect(() => claudeAccountCreateBody({ label: "Work", kind: "team" })).toThrow("bad Claude account kind");
    expect(() => claudeAccountCreateBody({ label: "" })).toThrow("bad Claude account label");
    expect(() => claudeAccountCreateBody(null)).toThrow();
  });

  it("API accounts: base URL, key header and non-secret settings; empty fields dropped", () => {
    expect(
      claudeAccountCreateBody({ label: "DeepSeek", kind: "api", baseUrl: " https://api.deepseek.com/anthropic ", keyEnv: "ANTHROPIC_AUTH_TOKEN", env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro", MAX_THINKING_TOKENS: "8000", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000" } }),
    ).toEqual({ label: "DeepSeek", kind: "api", baseUrl: "https://api.deepseek.com/anthropic", keyEnv: "ANTHROPIC_AUTH_TOKEN", env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro", MAX_THINKING_TOKENS: "8000", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000" } });
    expect(claudeAccountCreateBody({ label: "Anthropic", kind: "api", baseUrl: "", env: {} })).toEqual({ label: "Anthropic", kind: "api" });
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", keyEnv: "OPENAI_API_KEY" })).toThrow("bad key env");
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", env: { lower: "v" } })).toThrow("not allowed");
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", env: { K: "" } })).toThrow("bad value");
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", env: ["A=b"] })).toThrow("bad env");
  });

  it("never carries a credential: apiKey and secret-named settings are refused", () => {
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", apiKey: "sk-test-only" })).toThrow("never sends a Claude API key");
    expect(() => claudeAccountCreateBody({ label: "x", kind: "api", apiKey: undefined })).toThrow("never sends");
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "MY_SECRET", "DB_PASSWORD", "GITHUB_ACCESS_TOKEN"]) {
      expect(() => claudeAccountCreateBody({ label: "x", kind: "api", env: { [key]: "v" } }), key).toThrow("not allowed");
    }
  });
});

describe("claudeAccountQuota (GET /v2/profiles/{p}/quota of a bound profile)", () => {
  const gauge = { id: "claude-0", label: "Claude", kind: "window" as const, remainingPercent: 62, balance: null, resetAt: 1, windowLabel: "5h", observedAt: 1, stale: false };

  it("subscription: the windows, last error, staleness and an in-flight read", () => {
    expect(claudeAccountQuota({ source: "claude", gauges: [gauge], nativeQuota: { stale: false, refreshing: false, lastError: null } })).toEqual({ kind: "windows", gauges: [gauge], lastError: null, stale: false, refreshing: false, credentialsExpired: false, apiUsage: null });
    expect(claudeAccountQuota({ source: "claude", gauges: [], nativeQuota: { stale: true, refreshing: true, lastError: "read failed: os error 2" } })).toMatchObject({ kind: "windows", gauges: [], lastError: "read failed: os error 2", stale: true, refreshing: true });
  });

  it("expired login token: credentialsExpired (cutex claude-quota-stale-credentials), absent = false", () => {
    expect(claudeAccountQuota({ source: "claude", gauges: [gauge], nativeQuota: { stale: false, lastError: null, credentialsExpired: true, credentialsExpiredAt: 5 } })).toMatchObject({ credentialsExpired: true, lastError: null });
    expect(claudeAccountQuota({ source: "claude", gauges: [gauge], nativeQuota: { lastError: "x" } })?.credentialsExpired).toBe(false);
  });

  it("quotaNote: an expired token is a muted hint, not the red error; a real error stays warn", () => {
    const q = { gauges: [gauge], lastError: null, stale: false, refreshing: false, credentialsExpired: false };
    expect(quotaNote(q)).toBeNull();
    expect(quotaNote({ ...q, credentialsExpired: true })).toEqual({ key: "claude-accounts.quotaTokenExpired", tone: "muted" });
    expect(quotaNote({ ...q, credentialsExpired: true, stale: true })).toEqual({ key: "claude-accounts.quotaTokenExpired", tone: "muted" });
    expect(quotaNote({ ...q, gauges: [], credentialsExpired: true })).toEqual({ key: "claude-accounts.quotaTokenExpired", tone: "muted" });
    const rejected = "read failed for Claude account ca-a1: official usage endpoint returned HTTP 401: the Claude login was rejected; log in again: cutex human claude account login ca-a1";
    expect(quotaNote({ ...q, lastError: rejected })).toEqual({ key: "claude-accounts.quotaError", error: rejected, tone: "warn" });
    expect(quotaNote({ ...q, stale: true })).toEqual({ key: "claude-accounts.quotaStale", tone: "warn" });
    expect(quotaNote({ ...q, gauges: [], refreshing: true })).toEqual({ key: "claude-accounts.quotaReading", tone: "muted" });
    expect(quotaNote({ ...q, gauges: [] })).toEqual({ key: "claude-accounts.quotaNone", tone: "muted" });
  });

  it("API account: today / 7 / 30 days from the usage ledger (cost null when unpriced)", () => {
    const q = claudeAccountQuota({ source: "claudeApi", gauges: [], nativeQuota: { source: "usageLedger", apiUsage: { today: { turns: 2, total: 900, estimatedCost: 0.0029 }, last7Days: { turns: 9, total: 12_000 }, last30Days: {}, currency: "USD" } } });
    expect(q).toEqual({
      kind: "apiUsage",
      gauges: [],
      lastError: null,
      stale: false,
      refreshing: false,
      credentialsExpired: false,
      apiUsage: { today: { turns: 2, total: 900, estimatedCost: 0.0029 }, last7Days: { turns: 9, total: 12_000, estimatedCost: null }, last30Days: { turns: 0, total: 0, estimatedCost: null }, currency: "USD" },
    });
  });

  it("anything else is not an account reading", () => {
    expect(claudeAccountQuota(null)).toBeNull();
    expect(claudeAccountQuota({ source: "quotaConfig", gauges: [gauge], nativeQuota: null })).toBeNull();
    expect(claudeAccountQuota({ source: null, gauges: [], nativeQuota: null })).toBeNull();
  });
});

describe("account view", () => {
  it("states: subscription by its last check, API by the stored key", () => {
    expect(accountState(account({ status: null }))).toBe("unchecked");
    expect(accountState(account({ status: { loggedIn: true, email: "a@b" } }))).toBe("loggedIn");
    expect(accountState(account({ status: { loggedIn: false, authMethod: "none" } }))).toBe("needsLogin");
    expect(accountState(account({ status: { loggedIn: false, error: "timed out" } }))).toBe("error");
    const api = { baseUrl: null, keyEnv: "ANTHROPIC_API_KEY" as const, env: {}, apiKeyPresent: true };
    expect(accountState(account({ kind: "api", api }))).toBe("keyReady");
    expect(accountState(account({ kind: "api", api: { ...api, apiKeyPresent: false }, status: { loggedIn: false, error: "no API key stored" } }))).toBe("keyMissing");
    expect(["loggedIn", "keyReady"].map((s) => needsTerminal(s as never))).toEqual([false, false]);
    expect(["needsLogin", "error", "unchecked", "keyMissing"].every((s) => needsTerminal(s as never))).toBe(true);
  });

  it("summary: who is logged in, or where an API account sends requests", () => {
    expect(accountSummary(account({ status: { loggedIn: true, email: "me@x.io", orgName: "Acme", subscriptionType: "team" } }))).toEqual(["me@x.io", "Acme", "Team"]);
    expect(accountSummary(account({ status: { loggedIn: false, email: "stale@x.io" } }))).toEqual([]);
    expect(accountSummary(account({ kind: "api", api: { baseUrl: "https://api.deepseek.com/anthropic/", keyEnv: "ANTHROPIC_API_KEY", env: {}, apiKeyPresent: true } }))).toEqual(["api.deepseek.com/anthropic", "ANTHROPIC_API_KEY"]);
    expect(accountSummary(account({ kind: "api", api: { baseUrl: null, keyEnv: "ANTHROPIC_AUTH_TOKEN", env: {}, apiKeyPresent: false } }))).toEqual(["api.anthropic.com", "ANTHROPIC_AUTH_TOKEN"]);
    expect(planLabel("max")).toBe("Max");
    expect(planLabel(" ")).toBeNull();
    expect(baseUrlLabel(null)).toBeNull();
    expect(checkedAtSeconds(account({ status: { loggedIn: true, checkedAt: "2026-10-10T00:00:00Z" } }))).toBe(Date.parse("2026-10-10T00:00:00Z") / 1000);
    expect(checkedAtSeconds(account({ status: { loggedIn: true, checkedAt: "soon" } }))).toBeNull();
  });

  it("the key command reads the key hidden from the terminal and names only the account id", () => {
    const ps = apiKeyCommand("ca-deep5s2k4p", "powershell")!;
    const sh = apiKeyCommand("ca-deep5s2k4p", "posix")!;
    for (const cmd of [ps, sh]) expect(cmd).toContain("| cutex human claude account set ca-deep5s2k4p --api-key-stdin");
    expect(ps).toContain("Read-Host 'API key' -AsSecureString");
    expect(sh).toContain("stty -echo; read -r k; stty echo");
    expect(sh).toContain("unset k");
    expect(apiKeyCommand("default", "posix")).toBeNull();
    expect(apiKeyCommand("ca-x; rm -rf /", "posix")).toBeNull();
    expect(guessKeyShell("C:\\Users\\me\\.cutex\\claude-accounts\\ca-a")).toBe("powershell");
    expect(guessKeyShell("/home/me/.cutex/claude-accounts/ca-a")).toBe("posix");
    expect(guessKeyShell(null)).toBe("posix");
  });

  it("extra settings: KEY=VALUE per line; comments and blank lines skipped, the rest reported", () => {
    expect(parseEnvLines("ANTHROPIC_DEFAULT_SONNET_MODEL = deepseek-v4-pro\n\n# note\r\nDISABLE_TELEMETRY=1")).toEqual({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro", DISABLE_TELEMETRY: "1" }, bad: [] });
    expect(parseEnvLines("lower=x\nNOVALUE=\n=x\nJUSTTEXT").bad).toEqual(["lower=x", "NOVALUE=", "=x", "JUSTTEXT"]);
  });

  it("add form → create request: the button's kind; API settings only for API accounts, never a key", () => {
    const form = { label: " Work ", baseUrl: " https://api.deepseek.com/anthropic ", keyEnv: "ANTHROPIC_AUTH_TOKEN" as const, envText: "ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro" };
    // 添加 Claude 订阅 (section header, the profile dialog): label + kind; leftover API fields are ignored.
    expect(accountCreateRequest("subscription", form)).toEqual({ request: { label: "Work", kind: "subscription" } });
    expect(accountCreateRequest("api", form)).toEqual({ request: { label: "Work", kind: "api", keyEnv: "ANTHROPIC_AUTH_TOKEN", baseUrl: "https://api.deepseek.com/anthropic", env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro" } } });
    expect(accountCreateRequest("api", { ...form, baseUrl: "  ", envText: "" })).toEqual({ request: { label: "Work", kind: "api", keyEnv: "ANTHROPIC_AUTH_TOKEN" } });
    expect(accountCreateRequest("subscription", { ...form, label: "default" })).toEqual({ error: "badLabel" });
    expect(accountCreateRequest("api", { ...form, label: "  " })).toEqual({ error: "badLabel" });
    expect(accountCreateRequest("api", { ...form, envText: "lower=x" })).toEqual({ error: "envBad", lines: ["lower=x"] });
    // A subscription never fails on the API-only extra settings.
    expect(accountCreateRequest("subscription", { ...form, envText: "lower=x" })).toEqual({ request: { label: "Work", kind: "subscription" } });
  });

  it("refusals and costs", () => {
    expect(refusalKey("claude_account_in_use")).toBe("claude-accounts.refusal.inUse");
    expect(refusalKey("claude_account_label_taken")).toBe("claude-accounts.refusal.labelTaken");
    expect(refusalKey("invalid_request")).toBeNull();
    expect(formatCost(0.002948, "USD")).toBe("<$0.01");
    expect(formatCost(1.234, "USD")).toBe("$1.23");
    expect(formatCost(512, "CNY")).toBe("¥512");
    expect(formatCost(2, "CHF")).toBe("CHF 2.00");
    expect(formatCost(0, null)).toBe("$0.00");
  });
});

describe("accountsNeedingAttention (collapsed Claude 账户 section)", () => {
  it("counts missing logins / keys and failed checks, not unchecked or ready accounts", () => {
    const sub = (status: ClaudeAccount["status"]) => ({ kind: "subscription" as const, status, api: null });
    const api = (apiKeyPresent: boolean) => ({ kind: "api" as const, status: null, api: { apiKeyPresent } as ClaudeAccount["api"] });
    expect(
      accountsNeedingAttention([
        sub({ loggedIn: true } as ClaudeAccount["status"]),
        sub({ loggedIn: false } as ClaudeAccount["status"]),
        sub({ loggedIn: false, error: "timed out" } as ClaudeAccount["status"]),
        sub(null),
        api(true),
        api(false),
      ]),
    ).toBe(3);
    expect(accountsNeedingAttention([])).toBe(0);
  });
});
