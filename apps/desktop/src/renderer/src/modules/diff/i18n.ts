export const zhCN = {
  "diff.title": "差异",
  "diff.description": "在{{shelf}}中查看工作区的 Git 改动和单个回合的文件改动",
  "diff.view": "差异",
  "diff.turnTab": "本轮 · {name}",
  "diff.turnBadge": "本轮变更",
  "diff.staged": "已暂存",
  "diff.noDiff": "没有差异",
  "diff.noScope": "这个{{agent}}没有工作目录，看不了 git 差异。",
  "diff.noWorkspaceFs": "这台主机的 cutex 不提供工作区接口（需要 workspace-fs），请升级 cutex",
  "diff.turnGone": "这一轮的变更文本只在打开它的那次运行里保留。回到那一轮，左键点击「查看变更」再打开。",
  "diff.textGone": "这份对比只在打开它的那次运行里保留，请从原处再打开一次。",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
