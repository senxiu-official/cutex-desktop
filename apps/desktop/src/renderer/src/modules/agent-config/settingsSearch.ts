// Settings search declarations of the agent-config pages (SettingsPageItem.keywords / sections); the
// page components render each card with id={settingsAnchorId(anchor)}.
import { BOUNDARY_FEATURE, EXTERNAL_GRANTS_FEATURE } from "../../lib/agentSecurity";
import { AGENT_HARNESS_FEATURE, PROMPT_CACHE_KEY_FEATURE } from "../../lib/globalSettings";
import { AUTO_TITLES_FEATURE } from "../../lib/profileCreate";
import type { SettingsPageItem } from "../slots";
import type { MessageKey } from "../../i18n";
import { IMAGE_HISTORY_TRIM_FEATURE } from "../../../../shared/imageHistoryTrim";
import { PROFILE_PROXY_FEATURE } from "../../../../shared/proxy";

type Search = Pick<SettingsPageItem, "keywords" | "sections">;

/** Rows of ThreadDefaultRows (新建 agent / 快速启动). */
const THREAD_DEFAULTS = ["launch.approval", "launch.sandbox", "launch.network", "launch.writableRoots"] as const;

/**
 * Profiles = model accounts: 「API key」「密钥」「登录」 / "login" land here first (a keyword that starts
 * with the word beats the identity / NCI key titles' mid-text hits, which still show further down).
 */
export const PROFILES_SEARCH: Search = {
  sections: [
    { anchor: "profile-account", titleKey: "agent-config.profile.account", keywords: ["account.mode.apiKey", "account.chatgpt", "account.logout", "agent-config.profile.privateChatgptAuthFile", "agent-config.profile.planLabel", "agent-config.profile.login"] },
    { anchor: "profile-models", titleKey: "settings.searchIa.models" as MessageKey, keywords: ["settings.searchIa.modelsKeywords" as MessageKey, "agent-config.profile.contextWindow", "agent-config.profile.autoCompact", "agent-config.profile.modelsSection", "agent-config.profile.model", "agent-config.profile.effort", "agent-config.profile.reasoningSummary", "agent-config.profile.vision"] },
    { anchor: "profile-tools", titleKey: "settings.searchIa.tools" as MessageKey, keywords: ["settings.searchIa.toolsKeywords" as MessageKey, "autoPick.setting", "agent-config.profile.behaviour", "agent-config.profile.nativeSubagents", "agent-config.profile.delegationWait", "agent-config.profile.agentApproval", "agent-config.profile.allowSwitch", "agent-config.profile.claudeWrite", "agent-config.profile.claudeExec", "agent-config.profile.claudeFileCheckpointing", "agent-config.profile.agentTurnQuestions", "agent-config.profile.updatePlan", "agent-config.profile.webSearch", "agent-config.profile.searchTool", "agent-config.profile.toolSchemaCompat", "agent-config.profile.claudeSkillsImport", "agent-config.profile.claudeAiConnectors", "browser.profile.tools"] },
    { anchor: "profile-images", titleKey: "settings.searchIa.images" as MessageKey, keywords: ["settings.searchIa.imagesKeywords" as MessageKey], requires: { capabilities: [IMAGE_HISTORY_TRIM_FEATURE] } },
    { anchor: "profile-quota", titleKey: "agent-config.quota.title", keywords: ["agent-config.quota.enabled", "agent-config.quota.label", "agent-config.quota.auth", "agent-config.quota.mode", "agent-config.quota.valuePointer", "agent-config.quota.limitPointer", "agent-config.quota.resetPointer", "agent-config.quota.refresh", "resets.title"] },
    { anchor: "profile-proxy", titleKey: "proxy.settingsSearch.profile" as MessageKey, keywords: ["proxy.settingsSearch.profileKeywords" as MessageKey], requires: { capabilities: [PROFILE_PROXY_FEATURE] } },
    { anchor: "profile-appearance", titleKey: "settings.searchIa.appearance" as MessageKey, keywords: ["settings.profile.picture", "settings.profile.introPortrait", "settings.profile.introGreeting", "avatarStyle.title", "avatarStyle.kind.portrait", "avatarStyle.kind.emoji", "avatarStyle.kind.letter", "settings.profile.provider"] },
    { anchor: "profile-browser", titleKey: "settings.profileIa.browserClaim", keywords: ["browser.claim.mode", "browser.claim.localHint"] },
    { anchor: "profile-advanced", titleKey: "agent-config.profile.advanced", keywords: ["agent-config.profile.wireApi", "agent-config.profile.requestRetries", "agent-config.profile.streamRetries", "agent-config.profile.streamIdle", "agent-config.profile.websocketsHint"] },
  ],
  keywords: [
    "agent-config.profiles.searchKey",
    "agent-config.profiles.searchLogin",
    "account.mode.apiKey",
    "account.chatgpt",
    "account.logout",
    "agent-config.profile.account",
    "agent-config.profile.modelsSection",
    "agent-config.profile.behaviour",
    "agent-config.quota.title",
  ],
};

export const DEFAULTS_SEARCH: Search = {
  sections: [
    { anchor: "newAgent", titleKey: "agent-config.defaults.newAgent", keywords: ["agent-config.defaults.profile", "agent-config.defaults.directLaunch", ...THREAD_DEFAULTS] },
    { anchor: "quickWork", titleKey: "agent-config.quickChats", keywords: ["agent-config.quickChats.profile", ...THREAD_DEFAULTS] },
    { anchor: "titles", titleKey: "agent-config.titles", keywords: ["agent-config.titles.auto", "agent-config.titles.model"], requires: { capabilities: [AUTO_TITLES_FEATURE] } },
    { anchor: "promptCache", titleKey: "agent-config.promptCache.title", keywords: ["agent-config.promptCache.share"], requires: { capabilities: [PROMPT_CACHE_KEY_FEATURE] } },
  ],
};

export const INSTRUCTIONS_SEARCH: Search = {
  sections: [
    { anchor: "user", titleKey: "agent-config.instructions.user" },
    { anchor: "harness", titleKey: "agent-config.harness", keywords: ["agent-config.harness.enabled", "agent-config.harness.preview", "agent-config.harness.previewHint"], requires: { capabilities: [AGENT_HARNESS_FEATURE] } },
  ],
};

export const COLLAB_SEARCH: Search = {
  sections: [
    { anchor: "boundary", titleKey: "security.boundary", keywords: ["security.crossProject"] },
    { anchor: "external", titleKey: "security.external", requires: { capabilities: [BOUNDARY_FEATURE, EXTERNAL_GRANTS_FEATURE] } },
    { anchor: "links", titleKey: "security.links", requires: { capabilities: [BOUNDARY_FEATURE] } },
    { anchor: "templates", titleKey: "agent-config.instructions.templates", keywords: ["agent-config.instructions.prefix", "agent-config.instructions.suffix"], hiddenWith: { capabilities: [AGENT_HARNESS_FEATURE] } },
  ],
};
