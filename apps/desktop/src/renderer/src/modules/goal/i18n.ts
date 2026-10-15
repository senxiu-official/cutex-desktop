// `goal.title` / `goal.status.*` etc. predate the module (base catalog, GoalCard / composer), hence
// `moduleTitle` for the 模块 page name.
export const zhCN = {
  "goal.moduleTitle": "目标",
  "goal.moduleDescription": "线程目标（/goal）在状态行和胶囊里的一类：目标、用时、预算、暂停 / 继续",
  "goal.statusTitle": "目标",
  "goal.budgetRing": "目标预算：已用 {used} / {budget} tokens",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "goal.moduleTitle": "Goal",
  "goal.moduleDescription": "The thread goal (/goal) as a status category: objective, time, budget, pause / resume",
  "goal.statusTitle": "Goal",
  "goal.budgetRing": "Goal budget: {used} of {budget} tokens used",
};
