export const zhCN = {
  "connection.title": "连接",
  "connection.description": "主机列表、切换主机、启动时连接和诊断（设置 → 设备）",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "诊断",
  "connection.page": "主机列表",
  "connection.endpoint": "地址",
  "connection.version": "cutex 版本",
  "connection.noCaps": "旧版 cutex（无 /v2/capabilities）",
  "connection.features": "能力",
  // ---- 设备管理 (连接 restructure 2026-10-19) ----
  "connection.pageHint": "本机连接的所有主机，以及适用于所有主机的桌面设置。",
  "connection.openHost": "查看 {host} 的连接和访问",
  "connection.mine": "我的主机",
  "connection.mineHint": "{{owner}}是你本人的主机。",
  "connection.others": "可访问的主机",
  "connection.othersHint": "{{owner}}是其他人的主机，包括你经 SSH 拥有完全控制的主机。",
  "connection.othersNone": "暂无",
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

export const en: Record<keyof typeof zhCN, string> = {
  "connection.title": "Connection",
  "connection.description": "Host list, host switching, startup host and diagnostics (Settings → Devices)",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "Diagnostics",
  "connection.page": "Hosts",
  "connection.endpoint": "Endpoint",
  "connection.version": "cutex version",
  "connection.noCaps": "Older cutex (no /v2/capabilities)",
  "connection.features": "Capabilities",
  // ---- Device management (connection restructure 2026-10-19) ----
  "connection.pageHint": "Every host this computer connects to, and desktop settings for all hosts.",
  "connection.openHost": "See the connection and access of {host}",
  "connection.mine": "My hosts",
  "connection.mineHint": "Hosts whose {{owner}} is you.",
  "connection.others": "Hosts I can access",
  "connection.othersHint": "Hosts whose {{owner}} is someone else, including those where SSH gives you full control.",
  "connection.othersNone": "None",
  "connection.thisDevice": "This machine",
  "connection.member": "You are a member",
  "connection.add": "Add a host",
  "connection.addHint": "Connect to a cutex host over SSH. Tokens stay on this computer (system encrypted storage).",
};
