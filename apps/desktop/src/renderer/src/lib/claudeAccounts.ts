// Claude accounts (cutex `claude-accounts`, r219) as core code sees them. Shared by the profile
// editor's 账户 select (agent-config, core) and the Claude 账户 section of Settings → Profile (the
// claude-accounts module): modules never import each other and core never imports a module, so both
// read the account state from here (docs/desktop-modules.md §8: shared code lives in lib/).
//
// The profile → account binding is a profile field: `GET /v2/profiles` reports `claudeAccount`
// (`default` or `ca-…`, null for Codex profiles) and `PATCH /v2/profiles/{p} {claudeAccount}` changes
// it (`null` / `default` = back to the shared account; an id cutex does not know → 400). It only
// affects agents created afterwards: cutex freezes the Claude home into each session.
import { CLAUDE_ACCOUNTS_FEATURE, DEFAULT_CLAUDE_ACCOUNT, type ClaudeAccount, type ClaudeAccountKind } from "../../../shared/claudeAccounts";
import type { ProfileItem, ProfilePatch } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import type { ProfileKind } from "./profileKind";

/**
 * The claude-accounts module's `settings.section` item on page `profiles` (owner 2026-10-10: a section
 * of Settings → Profile, not a page of its own). Its id is also the section's settings anchor:
 * `openSettings("profiles", { anchor: CLAUDE_ACCOUNTS_SECTION })` scrolls to it.
 */
export const CLAUDE_ACCOUNTS_SECTION = "claude-accounts.accounts";

/** subscription: loggedIn / needsLogin / error (the check failed) / unchecked; api: key stored or not. */
export type AccountState = "loggedIn" | "needsLogin" | "error" | "unchecked" | "keyReady" | "keyMissing";
export type StateTone = "ok" | "warn" | "danger" | "muted";

export function accountState(a: Pick<ClaudeAccount, "kind" | "status" | "api">): AccountState {
  if (a.kind === "api") return (a.api?.apiKeyPresent ?? a.status?.loggedIn) ? "keyReady" : "keyMissing";
  const s = a.status;
  if (!s) return "unchecked";
  if (s.loggedIn) return "loggedIn";
  return s.error ? "error" : "needsLogin";
}

export const STATE_TONE: Record<AccountState, StateTone> = {
  loggedIn: "ok",
  keyReady: "ok",
  needsLogin: "warn",
  keyMissing: "warn",
  error: "danger",
  unchecked: "muted",
};

// ---------- profile editor: 账户 ----------

/** The 账户 select is shown for Claude profiles on a cutex with `claude-accounts` (older cutex: absent). */
export function claudeAccountRowShown(features: ReadonlySet<string>, kind: ProfileKind): boolean {
  return kind === "claude" && features.has(CLAUDE_ACCOUNTS_FEATURE);
}

/** The stored binding; a Claude profile cutex reports without one runs on the shared default. */
export function storedClaudeAccount(p: Pick<ProfileItem, "claudeAccount">): string {
  return p.claudeAccount || DEFAULT_CLAUDE_ACCOUNT;
}

/** What the select shows: the unsaved choice when there is one, else the stored binding. */
export function chosenClaudeAccount(patch: Pick<ProfilePatch, "claudeAccount">, p: Pick<ProfileItem, "claudeAccount">): string {
  return patch.claudeAccount !== undefined ? (patch.claudeAccount ?? DEFAULT_CLAUDE_ACCOUNT) : storedClaudeAccount(p);
}

/**
 * The draft value of `claudeAccount` for a choice: undefined = same as stored (nothing to save),
 * null = back to the shared default account, else the account id.
 */
export function claudeAccountPatch(choice: string, stored: string): string | null | undefined {
  if (choice === stored) return undefined;
  return choice === DEFAULT_CLAUDE_ACCOUNT ? null : choice;
}

export interface ClaudeAccountOption {
  id: string;
  /** null for `default` (shown as the shared account) and for a binding the host no longer lists. */
  label: string | null;
  isDefault: boolean;
  kind: ClaudeAccountKind | null;
  /** null while the list is not loaded (or for a missing account). */
  state: AccountState | null;
  /** The current binding is not in the host's list (removed meanwhile, or the list failed to load). */
  missing: boolean;
}

const KIND_ORDER: Record<ClaudeAccountKind, number> = { subscription: 0, api: 1 };

/** Display order (Claude 账户 section, profile selects): the shared default, subscriptions, API accounts; each by name. */
export function sortClaudeAccounts<A extends Pick<ClaudeAccount, "id" | "label" | "kind" | "isDefault">>(list: readonly A[]): A[] {
  const name = (a: A) => a.label ?? a.id;
  return [...list].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Select options: `default` first, then the host's accounts in `sortClaudeAccounts` order. The current binding
 * always stays selectable: kept as a `missing` entry when the list lacks it, so the select never
 * silently shows another account than the one stored.
 */
export function claudeAccountOptions(list: readonly ClaudeAccount[] | null, current: string): ClaudeAccountOption[] {
  const listed = list ?? [];
  const def = listed.find((a) => a.id === DEFAULT_CLAUDE_ACCOUNT);
  const options: ClaudeAccountOption[] = [
    { id: DEFAULT_CLAUDE_ACCOUNT, label: null, isDefault: true, kind: def?.kind ?? null, state: def ? accountState(def) : null, missing: false },
  ];
  for (const a of sortClaudeAccounts(listed)) {
    if (a.id === DEFAULT_CLAUDE_ACCOUNT) continue;
    options.push({ id: a.id, label: a.label, isDefault: false, kind: a.kind, state: accountState(a), missing: false });
  }
  if (!options.some((o) => o.id === current)) options.push({ id: current, label: null, isDefault: false, kind: null, state: null, missing: list !== null });
  return options;
}

const STATE_KEY: Record<AccountState, MessageKey> = {
  loggedIn: "agent-config.profile.claudeAccount.state.loggedIn",
  needsLogin: "agent-config.profile.claudeAccount.state.needsLogin",
  error: "agent-config.profile.claudeAccount.state.error",
  unchecked: "agent-config.profile.claudeAccount.state.unchecked",
  keyReady: "agent-config.profile.claudeAccount.state.keyReady",
  keyMissing: "agent-config.profile.claudeAccount.state.keyMissing",
};

/** One option as text: name · status ("共享账户（默认） · 已登录", "DeepSeek · 已设置 key", "ca-x · 不在这台主机上"). */
export function claudeAccountOptionText(o: ClaudeAccountOption, t: (key: MessageKey) => string): string {
  const name = o.isDefault ? t("agent-config.profile.claudeAccount.default") : (o.label ?? o.id);
  if (o.missing) return `${name} · ${t("agent-config.profile.claudeAccount.missing")}`;
  return o.state ? `${name} · ${t(STATE_KEY[o.state])}` : name;
}

/** cutex's 400 for an account id it does not know (removed since the list was read). */
export function isUnknownClaudeAccountError(message: string): boolean {
  return /claudeAccount: no Claude account/.test(message);
}
