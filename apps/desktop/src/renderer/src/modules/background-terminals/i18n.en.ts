// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "background-terminals.title": "Background terminals",
  "background-terminals.description": "The {{agent}}'s background terminals (CPU / memory, terminate) as a status category; /ps",
  "background-terminals.statusTitle": "Background terminals",
  "background-terminals.count": "{n} terminals",
  "background-terminals.output": "Output",
  "background-terminals.terminate": "Terminate",
  "background-terminals.terminateAgain": "Click Terminate again to confirm",
};
