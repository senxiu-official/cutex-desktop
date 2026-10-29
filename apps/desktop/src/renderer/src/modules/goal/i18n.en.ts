// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "goal.moduleTitle": "Goal",
  "goal.moduleDescription": "The thread goal (/goal) as a status category: objective, time, budget, pause / resume",
  "goal.statusTitle": "Goal",
  "goal.budgetRing": "Goal budget: {used} of {budget} tokens used",
};
