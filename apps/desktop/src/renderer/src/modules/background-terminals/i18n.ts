export const zhCN = {
  "background-terminals.title": "后台终端",
  "background-terminals.description": "{{agent}}的后台终端（CPU / 内存、终止）在状态行和胶囊里的一类；/ps",
  "background-terminals.statusTitle": "后台终端",
  "background-terminals.count": "{n} 后台终端",
  "background-terminals.output": "输出",
  "background-terminals.terminate": "终止",
  "background-terminals.terminateAgain": "再次点击终止以确认",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "background-terminals.title": "Background terminals",
  "background-terminals.description": "The {{agent}}'s background terminals (CPU / memory, terminate) as a status category; /ps",
  "background-terminals.statusTitle": "Background terminals",
  "background-terminals.count": "{n} terminals",
  "background-terminals.output": "Output",
  "background-terminals.terminate": "Terminate",
  "background-terminals.terminateAgain": "Click Terminate again to confirm",
};
