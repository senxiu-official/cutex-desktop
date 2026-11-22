// Profile information architecture strings, merged into the shared catalogs by the integration lead.
export const zhCN = {
  "settings.profileIa.modelsContext": "模型与上下文",
  "settings.profileIa.toolsPermissions": "工具与权限",
  "settings.profileIa.inputImages": "上下文 · 输入图片",
  "settings.profileIa.inputImagesHint": "只调整发送给模型的历史图片，随底部保存按钮保存。会话中是否显示图片由本地桌面应用单独设置。",
  "settings.profileIa.imageDisplayLink": "会话中的图片显示 →",
  "settings.profileIa.hostProfile": "保存在所选主机的 Profile「{name}」。",
  "settings.profileIa.hostProfileDraft": "所选主机的 Profile「{name}」；下方草稿随底部保存按钮保存，标明即时保存的项目除外。",
  "settings.profileIa.hostProfileImmediate": "保存在所选主机的 Profile「{name}」，切换后立即保存。",
  "settings.profileIa.localProfileImmediate": "仅保存在这个桌面应用，按所选主机和 Profile「{name}」区分；修改后立即保存。",
  "settings.profileIa.localProfileDraft": "仅保存在这个桌面应用，按所选主机和 Profile「{name}」区分；随底部保存按钮保存。",
  "settings.profileIa.picturesOpening": "头像与开场",
  "settings.profileIa.browserClaim": "这个桌面应用 · 浏览器认领",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "settings.profileIa.modelsContext": "Models and context",
  "settings.profileIa.toolsPermissions": "Tools and permissions",
  "settings.profileIa.inputImages": "Context · input images",
  "settings.profileIa.inputImagesHint": "Only changes historical images sent to the model; use Save below to apply. Image display in conversations is a separate setting in this desktop app.",
  "settings.profileIa.imageDisplayLink": "Image display in conversations →",
  "settings.profileIa.hostProfile": "Stored in Profile “{name}” on the selected host.",
  "settings.profileIa.hostProfileDraft": "Profile “{name}” on the selected host. Use Save below for drafts; items marked as immediate save separately.",
  "settings.profileIa.hostProfileImmediate": "Stored in Profile “{name}” on the selected host; saved immediately when switched.",
  "settings.profileIa.localProfileImmediate": "Stored only in this desktop app, separately for the selected host and Profile “{name}”; changes save immediately.",
  "settings.profileIa.localProfileDraft": "Stored only in this desktop app, separately for the selected host and Profile “{name}”; use Save below to apply.",
  "settings.profileIa.picturesOpening": "Pictures and opening",
  "settings.profileIa.browserClaim": "This desktop app · browser claiming",
};
