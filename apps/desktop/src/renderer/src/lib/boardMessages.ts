// 项目看板 settings row (Settings → 通用 → 窗口): zh-CN and en. Spread into the catalogs. The board window's own
// strings are in board/i18n.ts (that window loads no app catalog).
export const zhCN = {
  "board.setting": "项目看板",
  "board.settingHint": "单独的一个窗口，适合放在副屏：每个项目一张卡片，看进展、谁在忙、哪里出问题；点项目或{{agent}}会在主窗口打开。看板关着或最小化时不读取任何数据",
  "board.open": "打开",
  "board.openOnLaunch": "启动时打开",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "board.setting": "Project board",
  "board.settingHint": "A separate window for a second screen: one card per project showing progress, who is working and what is wrong; clicking a project or {{agent}} opens it in the main window. Nothing is read while the board is closed or minimised",
  "board.open": "Open",
  "board.openOnLaunch": "Open at launch",
};
