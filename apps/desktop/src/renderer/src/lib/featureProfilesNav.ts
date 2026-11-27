// Where 功能 Profile lives in Settings (owner 2026-11-26: 「功能Profile的设置页面和Profile不在一起」): a card of
// 智能体 → Profile, after the agent Profiles' own cards, and its 全部 N 个 sub-page there. It was a page of its own
// (工具 → 功能 Profile, page id `feature-profiles`); old links land here (lib/settingsNav MOVED_PAGES).
// No imports: the pure settings helpers, the Profile page and the module all read these names.

/** The card on the Profile page (`settings.section` id; also its anchor). */
export const FEATURE_PROFILES_SECTION = "feature-profiles.list";
/** The card of the sub-page: every row, with a filter. */
export const FEATURE_PROFILES_ALL_SECTION = "feature-profiles.all";
/** The Profile page's sub-page key (`openSettings("profiles", { sub })`). */
export const FEATURE_PROFILES_SUB = "features";
/** The old page id (Settings → 工具 → 功能 Profile) and its old sub-page key. */
export const FEATURE_PROFILES_OLD_PAGE = "feature-profiles";
export const FEATURE_PROFILES_OLD_SUB = "all";
