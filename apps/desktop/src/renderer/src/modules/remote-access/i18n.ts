export const zhCN = {
  "remote-access.title": "接入",
  "remote-access.description": "设置 → 接入：监听地址、CORS 和设备配对",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "remote-access.title": "Access",
  "remote-access.description": "Settings → Access: listen addresses, CORS and device pairing",
};
