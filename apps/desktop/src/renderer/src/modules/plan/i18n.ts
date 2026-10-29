// `plan.title` / `plan.*` (plan mode, checklist) predate the module (base catalog), hence
// `moduleTitle` for the 模块 page name.
export const zhCN = {
  "plan.title": "计划",
  "plan.question": "执行这个计划？",
  "plan.implement": "执行计划",
  "plan.implementHint": "切换到默认模式并开始实现",
  "plan.stay": "继续规划",
  "plan.stayHint": "留在计划模式，继续讨论修改",
  "plan.defaultUnavailable": "默认模式不可用",
  "plan.claude.acceptEdits": "执行，自动接受编辑",
  "plan.claude.acceptEditsHint": "退出计划模式，切到「自动接受编辑」并开始实现",
  "plan.claude.manual": "执行，编辑逐个审批",
  "plan.claude.manualHint": "退出计划模式，切到「每次询问」并开始实现",
  "plan.claude.keep": "执行，保持{mode}",
  "plan.claude.keepHint": "退出计划模式，保持原来的权限模式并开始实现",
  "plan.claude.keepPlanning": "继续规划…",
  "plan.claude.feedbackPlaceholder": "告诉 Claude 要怎么改这个计划（可留空）",
  "plan.claude.feedbackCancel": "取消",
  "plan.claude.feedbackSend": "发送意见",
  "plan.checklist": "任务清单 {done}/{total}",
  "plan.updated": "更新了进度 {done}/{total}",

  "plan.moduleTitle": "计划",
  "plan.moduleDescription": "模型的进度列表（update_plan）在状态行和胶囊里的一类",
  "plan.statusTitle": "计划",
  "plan.count": "进度 {done}/{total}",
  "plan.fold.completed": "已完成 {n} 项",
  "plan.fold.earlier": "前面 {n} 项",
  "plan.fold.pending": "待处理 {n} 项",
  "plan.fold.later": "后面 {n} 项",
  "plan.cleared": "已清空",
  "plan.clearedEntry": "清空了进度",
  "plan.clearedHint": "{{agent}}已清空进度列表，这里保留的是之前的列表",
  "plan.dismiss": "隐藏进度",
  "plan.dismissHint": "隐藏，直到{{agent}}给出新的进度列表",
  "plan.restore": "显示进度",
  "plan.restoreHint": "进度已隐藏（{done}/{total}），左键点击重新显示",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
