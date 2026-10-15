// Profile editor → 账户 → Claude 账户 (cutex claude-accounts): when the select shows, its options and
// their text, and what the save sends (`PATCH /v2/profiles/{p} {claudeAccount}`).
import { describe, expect, it } from "vitest";
import { CLAUDE_ACCOUNTS_FEATURE, type ClaudeAccount } from "../src/shared/claudeAccounts";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { MessageKey } from "../src/renderer/src/i18n";
import {
  chosenClaudeAccount,
  claudeAccountOptionText,
  claudeAccountOptions,
  claudeAccountPatch,
  claudeAccountRowShown,
  isUnknownClaudeAccountError,
  sortClaudeAccounts,
  storedClaudeAccount,
} from "../src/renderer/src/lib/claudeAccounts";

function account(over: Partial<ClaudeAccount>): ClaudeAccount {
  return { id: "ca-a1", label: "Work", kind: "subscription", isDefault: false, home: null, createdAt: null, api: null, status: null, loginCommand: null, profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true, ...over };
}

const LIST: ClaudeAccount[] = [
  account({ id: "default", label: null, isDefault: true, status: { loggedIn: true, email: "owner@example.com" } }),
  account({ id: "ca-work1", label: "Work", status: { loggedIn: false } }),
  account({ id: "ca-pers1", label: "Personal", status: { loggedIn: false, error: "timed out" } }),
  account({ id: "ca-new1", label: "New", status: null }),
  account({ id: "ca-deep1", label: "DeepSeek", kind: "api", api: { baseUrl: "https://api.deepseek.com/anthropic", keyEnv: "ANTHROPIC_API_KEY", env: {}, apiKeyPresent: true } }),
  account({ id: "ca-kimi1", label: "Kimi", kind: "api", api: { baseUrl: null, keyEnv: "ANTHROPIC_AUTH_TOKEN", env: {}, apiKeyPresent: false } }),
];

const tOf = (dict: Record<string, string>) => (key: MessageKey) => dict[key] ?? key;

describe("capability gating", () => {
  const withAccounts = new Set(["profile-create", CLAUDE_ACCOUNTS_FEATURE]);
  const older = new Set(["profile-create"]);

  it("Claude profiles on a cutex with claude-accounts only", () => {
    expect(claudeAccountRowShown(withAccounts, "claude")).toBe(true);
    expect(claudeAccountRowShown(older, "claude")).toBe(false);
    expect(claudeAccountRowShown(withAccounts, "chatgpt")).toBe(false);
    expect(claudeAccountRowShown(withAccounts, "apiKey")).toBe(false);
    expect(claudeAccountRowShown(new Set(), "claude")).toBe(false);
  });
});

describe("binding and draft", () => {
  it("stored: cutex's value, `default` when it reports none", () => {
    expect(storedClaudeAccount({ claudeAccount: "ca-work1" })).toBe("ca-work1");
    expect(storedClaudeAccount({ claudeAccount: "default" })).toBe("default");
    expect(storedClaudeAccount({ claudeAccount: null })).toBe("default");
    expect(storedClaudeAccount({})).toBe("default");
  });

  it("shown: the unsaved choice first (null = back to default), else the stored one", () => {
    expect(chosenClaudeAccount({}, { claudeAccount: "ca-work1" })).toBe("ca-work1");
    expect(chosenClaudeAccount({ claudeAccount: "ca-deep1" }, { claudeAccount: "ca-work1" })).toBe("ca-deep1");
    expect(chosenClaudeAccount({ claudeAccount: null }, { claudeAccount: "ca-work1" })).toBe("default");
  });

  it("save payload: nothing when unchanged, null for the default account, else the id", () => {
    expect(claudeAccountPatch("default", "default")).toBeUndefined();
    expect(claudeAccountPatch("ca-work1", "ca-work1")).toBeUndefined();
    expect(claudeAccountPatch("ca-work1", "default")).toBe("ca-work1");
    expect(claudeAccountPatch("default", "ca-work1")).toBeNull();
    expect(claudeAccountPatch("ca-deep1", "ca-work1")).toBe("ca-deep1");
  });

  it("cutex's 400 for an id it does not know is recognised (other errors are not)", () => {
    expect(isUnknownClaudeAccountError("invalid_request: claudeAccount: no Claude account ca-gone1 on this host")).toBe(true);
    expect(isUnknownClaudeAccountError('invalid_request: claudeAccount: must be a Claude account id (ca-…), "default" or null')).toBe(false);
    expect(isUnknownClaudeAccountError("profile_store_unavailable: disk full")).toBe(false);
  });
});

describe("options", () => {
  it("default first, then subscriptions and API accounts, each by name, with their state", () => {
    const options = claudeAccountOptions(LIST, "default");
    expect(options.map((o) => [o.id, o.state, o.missing])).toEqual([
      ["default", "loggedIn", false],
      ["ca-new1", "unchecked", false],
      ["ca-pers1", "error", false],
      ["ca-work1", "needsLogin", false],
      ["ca-deep1", "keyReady", false],
      ["ca-kimi1", "keyMissing", false],
    ]);
    expect(options[0]).toMatchObject({ isDefault: true, label: null, kind: "subscription" });
    expect(options[4]).toMatchObject({ isDefault: false, label: "DeepSeek", kind: "api" });
  });

  it("sortClaudeAccounts: default, subscriptions, API; names case-insensitive with numbers in order", () => {
    const list = [
      account({ id: "ca-k", label: "kimi", kind: "api" }),
      account({ id: "ca-w10", label: "Work 10" }),
      account({ id: "ca-w2", label: "Work 2" }),
      account({ id: "default", label: null, isDefault: true }),
      account({ id: "ca-d", label: "DeepSeek", kind: "api" }),
    ];
    expect(sortClaudeAccounts(list).map((a) => a.id)).toEqual(["default", "ca-w2", "ca-w10", "ca-d", "ca-k"]);
    expect(list[0]!.id).toBe("ca-k"); // the input is not reordered
  });

  it("default stays first even when cutex lists it elsewhere", () => {
    const options = claudeAccountOptions([LIST[1]!, LIST[0]!], "default");
    expect(options.map((o) => o.id)).toEqual(["default", "ca-work1"]);
  });

  it("list not read (or failed): default + the current binding, no state, not called missing", () => {
    expect(claudeAccountOptions(null, "default")).toEqual([{ id: "default", label: null, isDefault: true, kind: null, state: null, missing: false }]);
    expect(claudeAccountOptions(null, "ca-work1").map((o) => [o.id, o.missing])).toEqual([
      ["default", false],
      ["ca-work1", false],
    ]);
  });

  it("a binding the host no longer lists stays selectable, marked missing", () => {
    const options = claudeAccountOptions(LIST, "ca-gone1");
    expect(options.at(-1)).toEqual({ id: "ca-gone1", label: null, isDefault: false, kind: null, state: null, missing: true });
    expect(options.filter((o) => o.id === "ca-gone1")).toHaveLength(1);
    expect(claudeAccountOptions(LIST, "ca-work1").filter((o) => o.id === "ca-work1")).toHaveLength(1);
  });

  it("labels: name · state in both languages", () => {
    const zh = tOf(zhCN);
    const english = tOf(en);
    const options = claudeAccountOptions(LIST, "ca-gone1");
    expect(options.map((o) => claudeAccountOptionText(o, zh))).toEqual([
      "共享账户（默认） · 已登录",
      "New · 未检查",
      "Personal · 检查失败",
      "Work · 需要登录",
      "DeepSeek · 已设置 key",
      "Kimi · 缺少 key",
      "ca-gone1 · 不在这台主机上",
    ]);
    expect(options.map((o) => claudeAccountOptionText(o, english))).toEqual([
      "Shared account (default) · Logged in",
      "New · Not checked",
      "Personal · Check failed",
      "Work · Needs login",
      "DeepSeek · Key set",
      "Kimi · No key",
      "ca-gone1 · not on this host",
    ]);
    // Not read yet: names only.
    expect(claudeAccountOptions(null, "ca-work1").map((o) => claudeAccountOptionText(o, english))).toEqual(["Shared account (default)", "ca-work1"]);
  });
});
