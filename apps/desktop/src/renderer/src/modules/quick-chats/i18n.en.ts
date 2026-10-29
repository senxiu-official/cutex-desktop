// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "quick-chats.title": "Quick launch",
  "quick-chats.description": "The Quick launch entry and its draft page",
  "quick-chats.nav": "Quick launch",
  "quick-chats.navWith": "Quick launch with another profile",
  "quick-chats.defaultProfile": "default",
  "quick-chats.navCreating": "Creating chat…",
  "quick-chats.menuHint": "Right-click: quick launch with another profile",
};
