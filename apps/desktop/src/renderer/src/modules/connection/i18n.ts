export const zhCN = {
  "connection.title": "连接",
  "connection.description": "管理主机连接、启动时连接和连接诊断",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "诊断",
  "connection.page": "主机",
  "connection.endpoint": "地址",
  "connection.version": "cutex 版本",
  "connection.noCaps": "旧版 cutex（无 /v2/capabilities）",
  "connection.features": "能力",
  // ---- 设备管理 (连接 restructure 2026-10-19) ----
  "connection.pageHint": "本机连接的所有主机，以及适用于所有主机的桌面设置。",
  "connection.openHost": "查看 {host} 的连接和访问",
  "connection.thisDevice": "本机",
  "connection.member": "你是成员",
  "connection.add": "添加主机",
  "connection.addHint": "通过 SSH 连上一台 cutex 主机。令牌只保存在本机（系统加密存储）。",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
