export const zhCN = {
  "runtimes.current": "新{{agent}}使用",
  "runtimes.noCurrent": "未安装或未设置默认版本",
  "runtimes.unused": "{n} 个旧版本未使用，可清理",
  "runtimes.nativeDependency": "独立可执行文件，无需 Python 或 Node",
  "runtimes.bundledPython": "内置 Python（claude-r28 起随运行时提供）",
  "runtimes.pythonUnknown": "Python 由主机管理；此版本未报告内置依赖",
  "runtimes.cli": "Claude CLI：{source} · {version}",
  "runtimes.cliUnknown": "主机未报告 Claude CLI 来源与版本",
  "runtimes.bundled": "内置",
  "runtimes.system": "系统",
  "runtimes.dshUsage": "给 DSH Profile（DeepSeek）的{{agent}}使用",
  "runtimes.dshProfile": "设置 → Profile → 新建 → 类型选 DSH",
  "runtimes.kimiUsage": "给 Kimi / Moonshot Profile 的 Kimi 变体（以及 Kimi 账户登录的 Profile）使用",
  "runtimes.kimiProfile": "设置 → Profile → 新建 → 服务商选 Kimi Code 或 Moonshot，勾选 Kimi",
  "runtimes.kimiDependency": "Kimi Code 是随组件提供的固定版本，不会自动升级；它要用主机上的 Node",
  "runtimes.node": "Node ≥ {minimum} · 当前 {version}",
  "runtimes.nodeUnknown": "Node 版本要求与检测结果由主机组件提供",
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
