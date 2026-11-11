// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "background-terminals.title": "Background terminals",
  "background-terminals.description": "View {{agents}}’ background terminals, check CPU and memory use, and terminate terminals",
  "background-terminals.statusTitle": "Background terminals",
  "background-terminals.count": "{n} terminals",
  "background-terminals.running": "Running",
  "background-terminals.started": "Started {time}",
  "background-terminals.startedUnknown": "Start time unavailable",
  "background-terminals.agentOutputOnly": "Output is only available in the agent.",
  "background-terminals.output": "Output",
  "background-terminals.terminate": "Terminate",
  "background-terminals.terminateAgain": "Click Terminate again to confirm",
};
