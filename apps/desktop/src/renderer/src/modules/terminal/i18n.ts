export const zhCN = {
  "terminal.moduleTitle": "终端",
  "terminal.description": "在{{shelf}}中打开{{agent}}工作区的终端，由 cutex 在主机上运行",
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
  "terminal.runArmed": "再左键点击一次，在终端里运行这 {n} 行",
  "terminal.runFailed": "没能在终端里运行：{error}",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
