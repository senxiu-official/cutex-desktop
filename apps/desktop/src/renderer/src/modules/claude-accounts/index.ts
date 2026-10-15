// Claude 账户 (cutex claude-accounts, r219): a section of Settings → 智能体 → Profile, after the
// profile list (owner 2026-10-10: no page of its own) — the host's Claude accounts (shared default
// home, subscription logins, API accounts) with status, bound profiles, agents and quota; add / rename
// / remove, and a terminal guide for logging in or storing an API key (the desktop never handles a
// credential). Beside the 账户 select of the profile editor and the 添加 profile form it adds
// 「+ 添加订阅」 (`profile.fieldAction`, contract 1.6): the same add flow as a dialog, the new account
// lands in the profile's draft. Hidden without the capability.
// The profile → account selector is core (components/settings/ProfileClaudeAccount.tsx); both read
// the account state from lib/claudeAccounts.ts.
import { CLAUDE_ACCOUNTS_FEATURE } from "../../../../shared/claudeAccounts";
import { CLAUDE_ACCOUNTS_SECTION } from "../../lib/claudeAccounts";
import { defineModule } from "../slots";
import { AddSubscriptionAction } from "./AccountFlow";
import { ClaudeAccountsSection } from "./ClaudeAccountsSection";

export default defineModule({
  id: "claude-accounts",
  titleKey: "claude-accounts.title",
  descriptionKey: "claude-accounts.description",
  requires: { capabilities: [CLAUDE_ACCOUNTS_FEATURE] },
  contributes: {
    "settings.section": [
      {
        id: CLAUDE_ACCOUNTS_SECTION,
        page: "profiles",
        order: 100,
        titleKey: "claude-accounts.section",
        keywords: [
          "claude-accounts.default",
          "claude-accounts.kind.subscription",
          "claude-accounts.kind.api",
          "claude-accounts.addSubscription",
          "claude-accounts.login",
          "claude-accounts.setKey",
          "claude-accounts.usage",
        ],
        Section: ClaudeAccountsSection,
      },
    ],
    "profile.fieldAction": [{ id: "claude-accounts.addSubscription", field: "claudeAccount", Action: AddSubscriptionAction }],
  },
});
