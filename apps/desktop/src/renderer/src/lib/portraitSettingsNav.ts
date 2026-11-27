// Where the avatar settings live (owner 2026-11-27: 外观 was far too long, with 头像风格 and 完整头像主题 as flat lists and the
// avatar settings scattered across it; layout rule R6): one sub-page of 外观, 「头像」, with 头像与身份标记 (默认头像,
// 头像底色), 头像风格, 完整头像主题 (downloads), 已有智能体的头像 (bulk change) and 主管头饰, in that order. 外观 keeps one
// 「头像」 card with a summary row that opens it. The cards keep their anchors, so old links, the missing-portrait
// hints and settings search land on the sub-page (SettingsPageItem.subPages anchors). Stored pref keys are unchanged.
// 2026-11-28 (owner): the short settings (默认头像, 头像底色, the two headwear switches) moved back onto 外观's 「头像」 card
// (anchor `avatar`); the sub-page holds only the galleries and lists (docs/design/settings-rules.md §8).
// No imports: shell and settings read these.

/** 外观's sub-page key (`openSettings("appearance", { sub })`). */
export const AVATAR_SUB = "avatar";
/** The cards on it, in order. */
export const AVATAR_SUB_ANCHORS = ["portraits", "portrait-library", "portraits-bulk", "headwear"] as const;
