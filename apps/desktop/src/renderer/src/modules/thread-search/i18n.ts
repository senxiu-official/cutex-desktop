export const zhCN = {
  "thread-search.title": "搜索",
  "thread-search.description": "搜索当前{{agent}}会话中你和它的消息，左键点击结果跳转",
  "thread-search.placeholder": "搜索这段对话",
  "thread-search.hint": "搜索你发的消息和{{agent}}的回复（不含工具输出和思考）；按 {key} 打开",
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
