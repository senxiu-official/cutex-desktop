export const zhCN = {
  "intro.moduleTitle": "开场",
  "intro.moduleDescription": "会话从头可见时，第一个回合之上显示所用 Profile 的立绘与开场白；新建{{agent}}和快速开始页的立绘也随它开关",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
