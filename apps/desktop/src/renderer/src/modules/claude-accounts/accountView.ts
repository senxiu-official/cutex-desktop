// Pure helpers for the Claude 账户 section (Settings → Profile) and its add flow: what state an
// account is in, its one-line summary, the add request, the terminal command that stores an API
// account's key, and the refusals the section explains. The commands only reference the account id;
// the desktop never sees or sends a key.
import { CLAUDE_ACCOUNT_ID, claudeAccountLabel, type ClaudeAccount, type ClaudeAccountCreate, type ClaudeAccountKind, type ClaudeAccountQuota, type ClaudeKeyEnv } from "../../../../shared/claudeAccounts";
import type { MessageKey } from "../../i18n";
import { accountState, type AccountState } from "../../lib/claudeAccounts";

// The account state is shared with the profile editor's 账户 select (core), so it lives in lib/.
export { accountState, STATE_TONE, type AccountState, type StateTone } from "../../lib/claudeAccounts";

/** The account still needs the owner's terminal: a login (subscription) or a key (api). */
export function needsTerminal(state: AccountState): boolean {
  return state === "needsLogin" || state === "error" || state === "unchecked" || state === "keyMissing";
}

/** Accounts the collapsed section flags: a login or key is missing, or the last check failed (not merely unchecked). */
export function accountsNeedingAttention(list: readonly Pick<ClaudeAccount, "kind" | "status" | "api">[]): number {
  return list.filter((a) => {
    const s = accountState(a);
    return s === "needsLogin" || s === "error" || s === "keyMissing";
  }).length;
}

/** "max" → "Max" (cutex sends `subscriptionType` lowercase). */
export function planLabel(plan: string | null | undefined): string | null {
  const p = plan?.trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : null;
}

/** API base URL as shown: the host (+ path) without the scheme; null = Anthropic itself. */
export function baseUrlLabel(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;
  return u.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Grey detail line: email · org · plan (subscription), base URL · key header (api). */
export function accountSummary(a: Pick<ClaudeAccount, "kind" | "status" | "api">): string[] {
  if (a.kind === "api") {
    const parts = [baseUrlLabel(a.api?.baseUrl) ?? "api.anthropic.com"];
    if (a.api?.keyEnv) parts.push(a.api.keyEnv);
    return parts;
  }
  const s = a.status;
  if (!s?.loggedIn) return [];
  return [s.email, s.orgName, planLabel(s.subscriptionType)].filter((x): x is string => !!x);
}

/** `status.checkedAt` as unix seconds, or null. */
export function checkedAtSeconds(a: Pick<ClaudeAccount, "status">): number | null {
  const ms = a.status?.checkedAt ? Date.parse(a.status.checkedAt) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export type KeyShell = "powershell" | "posix";

/** The shell a key guide starts on: PowerShell when the account home is a Windows path. */
export function guessKeyShell(home: string | null | undefined): KeyShell {
  return home && (/^[A-Za-z]:[\\/]/.test(home) || home.startsWith("\\\\")) ? "powershell" : "posix";
}

/**
 * The command that stores an API account's key, typed hidden into the terminal (never an argument,
 * never in shell history): PowerShell 5.1 / 7, and any POSIX shell (bash, zsh, sh). Null for a
 * malformed id or `default` (which has no key).
 */
export function apiKeyCommand(id: string, shell: KeyShell): string | null {
  if (!CLAUDE_ACCOUNT_ID.test(id) || id === "default") return null;
  const set = `cutex human claude account set ${id} --api-key-stdin`;
  return shell === "powershell"
    ? `[Net.NetworkCredential]::new('', (Read-Host 'API key' -AsSecureString)).Password | ${set}`
    : `printf 'API key: '; stty -echo; read -r k; stty echo; echo; printf '%s' "$k" | ${set}; unset k`;
}

/** Extra Claude Code settings typed one per line (`KEY=VALUE`, blank lines and `#` comments ignored). */
export function parseEnvLines(text: string): { env: Record<string, string>; bad: string[] } {
  const env: Record<string, string> = {};
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const key = eq > 0 ? line.slice(0, eq).trim() : "";
    const value = eq > 0 ? line.slice(eq + 1).trim() : "";
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !value) bad.push(line);
    else env[key] = value;
  }
  return { env, bad };
}

/** The add form's fields; `baseUrl` / `keyEnv` / `envText` are read for API accounts only. */
export interface AccountForm {
  label: string;
  baseUrl: string;
  keyEnv: ClaudeKeyEnv;
  envText: string;
}

/**
 * `POST /v2/claude/accounts` body of the add form (the kind comes from the button: 添加 Claude 订阅 /
 * API 账户). Subscription: label + kind only. API: base URL (empty = Anthropic), key header and the
 * extra settings; never a key.
 */
export function accountCreateRequest(kind: ClaudeAccountKind, form: AccountForm): { request: ClaudeAccountCreate } | { error: "badLabel" } | { error: "envBad"; lines: string[] } {
  const label = claudeAccountLabel(form.label);
  if (!label) return { error: "badLabel" };
  if (kind === "subscription") return { request: { label, kind } };
  const { env, bad } = parseEnvLines(form.envText);
  if (bad.length) return { error: "envBad", lines: bad };
  const baseUrl = form.baseUrl.trim();
  return { request: { label, kind, keyEnv: form.keyEnv, ...(baseUrl ? { baseUrl } : {}), ...(Object.keys(env).length ? { env } : {}) } };
}

/** Refusals the section explains in its own words (others show cutex's message). */
const REFUSALS: Record<string, MessageKey> = {
  claude_account_label_taken: "claude-accounts.refusal.labelTaken",
  claude_account_in_use: "claude-accounts.refusal.inUse",
  claude_account_not_found: "claude-accounts.refusal.notFound",
  claude_account_is_default: "claude-accounts.refusal.isDefault",
};

export function refusalKey(code: string): MessageKey | null {
  return REFUSALS[code] ?? null;
}

const SYMBOL: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥", AUD: "A$" };

/** 0.002948 → "<$0.01", 1.234 → "$1.23", 512 → "$512" (currency from cutex; unknown codes as a prefix). */
export function formatCost(n: number, currency: string | null): string {
  const sym = currency ? SYMBOL[currency] : "$";
  const fmt = (v: string) => (sym ? `${sym}${v}` : `${currency} ${v}`);
  if (n > 0 && n < 0.01) return `<${fmt("0.01")}`;
  return fmt(n >= 100 ? n.toFixed(0) : n.toFixed(2));
}

/**
 * The status note beside (or instead of) a subscription account's windows: a read error (warn), an
 * expired login token cutex skipped the read for (muted: Claude Code refreshes it the next time a
 * session on the account runs), a stale reading (warn), or, without windows, reading / none (muted).
 * null = nothing to say.
 */
export function quotaNote(
  quota: Pick<ClaudeAccountQuota, "gauges" | "lastError" | "stale" | "refreshing" | "credentialsExpired">,
): { key: MessageKey; error?: string; tone: "warn" | "muted" } | null {
  if (quota.lastError) return { key: "claude-accounts.quotaError", error: quota.lastError, tone: "warn" };
  if (quota.credentialsExpired) return { key: "claude-accounts.quotaTokenExpired", tone: "muted" };
  if (quota.gauges.length) return quota.stale ? { key: "claude-accounts.quotaStale", tone: "warn" } : null;
  return { key: quota.refreshing ? "claude-accounts.quotaReading" : "claude-accounts.quotaNone", tone: "muted" };
}
