// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "safety-grants.title": "Safety check grants",
  "safety-grants.description": "Commands a Claude Code safety check stopped under full access: marked in the conversation; the {{owner}} may approve one exact retry",
  "safety-grants.line.blocked": "Stopped, waiting for the {{owner}}",
  "safety-grants.line.granted": "The {{owner}} approved it once",
  "safety-grants.line.dismissed": "The {{owner}} did not approve it",
  "safety-grants.line.open": "Show",
};
