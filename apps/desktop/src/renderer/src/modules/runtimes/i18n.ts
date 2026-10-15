export const zhCN = {
  "runtimes.title": "已安装的运行时",
  "runtimes.description": "各运行时版本和用着它们的{{agent}}",
  "runtimes.installed": "已安装的运行时",
  "runtimes.hint": "没有{{agent}}用的旧版本可以在主机上清理",
  "runtimes.native": "Codex 运行时",
  "runtimes.claude": "Claude 运行时",
  "runtimes.none": "没有",
  "runtimes.selected": "当前",
  "runtimes.selectedHint": "新启动的{{agent}}用这个版本",
  "runtimes.missing": "文件已删除",
  "runtimes.missingHint": "有{{agent}}固定在这个版本上，但它的文件已经不在了；在「升级{{agent}}」里修复",
  "runtimes.agents": "{n} 个{{agent}}",
  "runtimes.noAgents": "没有{{agent}}",
  "runtimes.moreAgents": "还有 {n} 个",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "runtimes.title": "Installed runtimes",
  "runtimes.description": "Runtime versions and the {{agents}} using each",
  "runtimes.installed": "Installed runtimes",
  "runtimes.hint": "Old versions no {{agent}} uses can be cleaned up on the host",
  "runtimes.native": "Codex runtimes",
  "runtimes.claude": "Claude runtimes",
  "runtimes.none": "None",
  "runtimes.selected": "current",
  "runtimes.selectedHint": "New {{agents}} start on this version",
  "runtimes.missing": "files deleted",
  "runtimes.missingHint": "{{Agents}} are pinned to this version but its files are gone; repair them under Upgrade {{agents}}",
  "runtimes.agents": "{n} {{agents}}",
  "runtimes.noAgents": "no {{agents}}",
  "runtimes.moreAgents": "{n} more",
};
