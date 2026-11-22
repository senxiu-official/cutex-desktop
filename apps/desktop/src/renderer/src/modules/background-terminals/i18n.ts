export const zhCN = {
  "background-terminals.title": "后台终端",
  "background-terminals.description": "查看{{agent}}的后台终端、CPU 和内存使用情况，并终止终端",
  "background-terminals.statusTitle": "后台终端",
  "background-terminals.count": "{n} 后台终端",
  "background-terminals.running": "运行中",
  "background-terminals.started": "开始于 {time}",
  "background-terminals.startedUnknown": "开始时间未提供",
  "background-terminals.agentOutputOnly": "输出仅在{{agent}}中查看。",
  "background-terminals.output": "输出",
  "background-terminals.terminate": "终止",
  "background-terminals.terminateAgain": "再次左键点击终止以确认",
  "background-terminals.unconfirmed": "结果未确认",
  "background-terminals.unconfirmedHint": "{{agent}}已断开，读不到这个终端现在的状态：进程可能仍在运行，也可能已经结束。可以结束跟进。",
  "background-terminals.terminateOffline": "{{agent}}已断开，现在不能终止",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
