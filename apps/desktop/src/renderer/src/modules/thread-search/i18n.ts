export const zhCN = {
  "thread-search.title": "搜索",
  "thread-search.description": "在当前{{agent}}的对话里搜索你和它的消息，点结果跳过去",
  "thread-search.placeholder": "搜索这段对话",
  "thread-search.hint": "搜索你发的消息和{{agent}}的回复（不含工具输出和思考）；按 Ctrl+F 打开",
  "thread-search.searching": "正在搜索…",
  "thread-search.none": "没有找到",
  "thread-search.more": "加载更多",
  "thread-search.close": "关闭搜索",
  "thread-search.count": "{n} 处",
  "thread-search.countMore": "{n}+ 处",
  "thread-search.unsupported": "这个{{agent}}的运行时还不支持对话搜索（Codex 需要 0.160 以上的原生版本）",
  "thread-search.offline": "{{agent}}离线：启动它的运行时后才能搜索",
  "thread-search.failed": "搜索失败：{error}",
  "thread-search.noThread": "这个{{agent}}还没有对话",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "thread-search.title": "Search",
  "thread-search.description": "Search your and the {{agent}}'s messages in the open conversation and jump to a hit",
  "thread-search.placeholder": "Search this conversation",
  "thread-search.hint": "Searches your messages and the {{agent}}'s replies (not tool output or reasoning); Ctrl+F opens it",
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
