// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "thread-search.title": "Search",
  "thread-search.description": "Search your and the {{agent}}'s messages in the open conversation and jump to a hit",
  "thread-search.placeholder": "Search this conversation",
  "thread-search.hint": "Searches your messages and the {{agent}}'s replies (not tool output or reasoning); {key} opens it",
  "thread-search.searching": "Searching…",
  "thread-search.none": "No matches",
  "thread-search.more": "Load more",
  "thread-search.close": "Close search",
  "thread-search.count": "{n} matches",
  "thread-search.countMore": "{n}+ matches",
  "thread-search.unsupported": "This {{agent}}'s runtime can't search its conversation yet (Codex needs native 0.160 or newer)",
  "thread-search.offline": "The {{agent}} is offline: start its runtime to search",
  "thread-search.failed": "Search failed: {error}",
  "thread-search.noThread": "This {{agent}} has no conversation yet",
};
