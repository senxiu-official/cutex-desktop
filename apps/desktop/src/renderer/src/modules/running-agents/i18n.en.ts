// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "running-agents.title": "Running {{agents}}",
  "running-agents.description": "Lists the {{agents}} working right now on the desktop: what they are doing and for how long; click to open one",
  "running-agents.widget": "Running {{agents}}",
  "running-agents.widgetHint": "The {{agents}} with a turn in progress, what they are doing and for how long",
  "running-agents.maxRows": "Most rows shown",
  "running-agents.scope": "Scope",
  "running-agents.scopeAll": "All hosts",
  "running-agents.scopeFocus": "Current host only",
  "running-agents.none": "No {{agent}} is working right now",
  "running-agents.justNow": "just now",
  "running-agents.more": "{n} more",
};
