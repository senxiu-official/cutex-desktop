export const zhCN = {
  "connection.title": "连接",
  "connection.description": "主机列表、切换主机、启动时连接和诊断（设置 → 主机）",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "诊断",
  "connection.page": "主机",
  "connection.endpoint": "地址",
  "connection.version": "cutex 版本",
  "connection.noCaps": "旧版 cutex（无 /v2/capabilities）",
  "connection.features": "能力",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "connection.title": "Connection",
  "connection.description": "Host list, host switching, startup host and diagnostics (Settings → Hosts)",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "Diagnostics",
  "connection.page": "Hosts",
  "connection.endpoint": "Endpoint",
  "connection.version": "cutex version",
  "connection.noCaps": "Older cutex (no /v2/capabilities)",
  "connection.features": "Capabilities",
};
