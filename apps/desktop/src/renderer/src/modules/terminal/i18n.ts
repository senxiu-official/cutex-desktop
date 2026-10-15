export const zhCN = {
  "terminal.moduleTitle": "终端",
  "terminal.description": "右栏的终端卡片：在{{agent}}的工作区里开 cutex 终端（终端在 cutex 里运行）",
  "terminal.title": "终端",
  "terminal.tab": "终端 {n}",
  "terminal.tabEnded": "{title}（已结束）",
  "terminal.new": "新终端",
  "terminal.closeTab": "关闭",
  "terminal.creating": "正在开终端…",
  "terminal.adopting": "正在接入这个工作区的终端…",
  "terminal.exited": "终端已结束",
  "terminal.exitedCode": "终端已结束（退出码 {code}）",
  "terminal.gone": "这个终端已经不在了（cutex 重启过，或在别处被结束）",
  "terminal.noWorkspace": "这个{{agent}}没有工作目录，开不了终端",
  "terminal.willEnd": "终端将被结束",
  "terminal.willEndN": "终端 {n} 将被结束",
  "terminal.runTip": "在终端里运行",
  "terminal.runArmed": "再点一次，在终端里运行这 {n} 行",
  "terminal.runFailed": "没能在终端里运行：{error}",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "terminal.moduleTitle": "Terminal",
  "terminal.description": "The right column's terminal card: cutex terminals in the {{agent}}'s workspace (they run in cutex)",
  "terminal.title": "Terminal",
  "terminal.tab": "Terminal {n}",
  "terminal.tabEnded": "{title} (ended)",
  "terminal.new": "New terminal",
  "terminal.closeTab": "Close",
  "terminal.creating": "Opening a terminal…",
  "terminal.adopting": "Connecting this workspace's terminals…",
  "terminal.exited": "The terminal has ended",
  "terminal.exitedCode": "The terminal has ended (exit code {code})",
  "terminal.gone": "This terminal no longer exists (cutex restarted, or it was ended elsewhere)",
  "terminal.noWorkspace": "This {{agent}} has no working directory; no terminal",
  "terminal.willEnd": "A terminal will be ended",
  "terminal.willEndN": "Terminal {n} will be ended",
  "terminal.runTip": "Run in the terminal",
  "terminal.runArmed": "Click again to run these {n} lines in the terminal",
  "terminal.runFailed": "Couldn't run it in the terminal: {error}",
};
