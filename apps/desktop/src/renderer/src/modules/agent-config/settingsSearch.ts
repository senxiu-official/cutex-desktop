// Settings search declarations of the agent-config pages (SettingsPageItem.keywords / sections); the
// page components render each card with id={settingsAnchorId(anchor)}.
import { BOUNDARY_FEATURE, EXTERNAL_GRANTS_FEATURE } from "../../lib/agentSecurity";
import { AGENT_HARNESS_FEATURE } from "../../lib/globalSettings";
import { AUTO_TITLES_FEATURE } from "../../lib/profileCreate";
import type { SettingsPageItem } from "../slots";

type Search = Pick<SettingsPageItem, "keywords" | "sections">;

/** Rows of ThreadDefaultRows (新建 agent / 快速启动). */
const THREAD_DEFAULTS = ["launch.approval", "launch.sandbox", "launch.network", "launch.writableRoots"] as const;

/**
 * Profiles = model accounts: 「API key」「密钥」「登录」 / "login" land here first (a keyword that starts
 * with the word beats the identity / NCI key titles' mid-text hits, which still show further down).
 */
export const PROFILES_SEARCH: Search = {
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
