export const zhCN = {
  "remote-access.title": "接入",
  "remote-access.description": "管理主机的监听地址、允许的网页来源（CORS）和设备配对",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
