export const zhCN = {
  "diff.title": "差异",
  "diff.description": "右栏的 diff 卡片：工作区的 git 改动与某一轮对文件的改动共用一个查看器",
  "diff.view": "差异",
  "diff.turnTab": "本轮 · {name}",
  "diff.turnBadge": "本轮变更",
  "diff.staged": "已暂存",
  "diff.noDiff": "没有差异",
  "diff.noScope": "这个{{agent}}没有工作目录，看不了 git 差异。",
  "diff.noWorkspaceFs": "这台主机的 cutex 不提供工作区接口（需要 workspace-fs），请升级 cutex",
  "diff.turnGone": "这一轮的变更文本只在打开它的那次运行里保留。回到那一轮，点「查看变更」再打开。",
  "diff.textGone": "这份对比只在打开它的那次运行里保留，请从原处再打开一次。",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "diff.title": "Diff",
  "diff.description": "The right column's diff card: a workspace's git changes and one turn's changes to a file share one viewer",
  "diff.view": "Diff",
  "diff.turnTab": "This turn · {name}",
  "diff.turnBadge": "Changes in this turn",
  "diff.staged": "staged",
  "diff.noDiff": "No differences",
  "diff.noScope": "This {{agent}} has no working directory; no git diff.",
  "diff.noWorkspaceFs": "This host's cutex has no workspace routes (needs workspace-fs); upgrade cutex",
  "diff.turnGone": "A turn's change text is kept only for the run that opened it. Go back to that turn and click View changes again.",
  "diff.textGone": "This comparison is kept only for the run that opened it; open it again from where it came from.",
};
