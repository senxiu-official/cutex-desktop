// 新工作 sidebar entry + draft page (step 3).
export const zhCN = {
  "quick-chats.title": "快速启动",
  "quick-chats.description": "侧栏「快速启动」入口和草稿页",
  "quick-chats.nav": "快速启动",
  "quick-chats.navWith": "用其他 Profile 快速启动",
  "quick-chats.defaultProfile": "默认",
  "quick-chats.navCreating": "正在创建工作…",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "quick-chats.title": "Quick launch",
  "quick-chats.description": "The Quick launch entry and its draft page",
  "quick-chats.nav": "Quick launch",
  "quick-chats.navWith": "Quick launch with another profile",
  "quick-chats.defaultProfile": "default",
  "quick-chats.navCreating": "Creating chat…",
};
