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
  "plan.checklist": "任务清单 {done}/{total}",
  "plan.updated": "更新了进程 {done}/{total}",

  "plan.moduleTitle": "计划",
  "plan.moduleDescription": "模型的进程列表（update_plan）在状态行和胶囊里的一类",
  "plan.statusTitle": "计划",
  "plan.count": "进程 {done}/{total}",
  "plan.fold.completed": "已完成 {n} 项",
  "plan.fold.earlier": "前面 {n} 项",
  "plan.fold.pending": "待处理 {n} 项",
  "plan.fold.later": "后面 {n} 项",
  "plan.cleared": "已清空",
  "plan.clearedEntry": "清空了进程",
  "plan.clearedHint": "{{agent}}已清空进程列表，这里保留的是之前的列表",
  "plan.dismiss": "隐藏进程",
  "plan.dismissHint": "隐藏，直到{{agent}}给出新的进程列表",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "plan.title": "Plan",
  "plan.question": "Implement this plan?",
  "plan.implement": "Implement",
  "plan.implementHint": "Switch to Default mode and start coding",
  "plan.stay": "Keep planning",
  "plan.stayHint": "Stay in Plan mode and refine it",
  "plan.defaultUnavailable": "Default mode unavailable",
  "plan.checklist": "Plan {done}/{total}",
  "plan.updated": "Updated progress {done}/{total}",

  "plan.moduleTitle": "Plan",
  "plan.moduleDescription": "The model's progress list (update_plan) as a status category",
  "plan.statusTitle": "Plan",
  "plan.count": "Progress {done}/{total}",
  "plan.fold.completed": "{n} completed",
  "plan.fold.earlier": "{n} earlier",
  "plan.fold.pending": "{n} pending",
  "plan.fold.later": "{n} more",
  "plan.cleared": "Cleared",
  "plan.clearedEntry": "Cleared the progress list",
  "plan.clearedHint": "The {{agent}} cleared its progress list; this is the previous one",
  "plan.dismiss": "Hide progress",
  "plan.dismissHint": "Hide until the {{agent}} posts a new progress list",
};
