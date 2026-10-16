export const zhCN = {
  "safety-grants.title": "安全检查放行",
  "safety-grants.description": "完全访问下被 Claude Code 安全检查拦下的命令：在对话里标出，{{owner}}可以批准原样重试一次",
  "safety-grants.line.blocked": "已拦下，等{{owner}}决定",
  "safety-grants.line.granted": "{{owner}}已批准一次",
  "safety-grants.line.dismissed": "{{owner}}未批准",
  "safety-grants.line.open": "查看",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "safety-grants.title": "Safety check grants",
  "safety-grants.description": "Commands a Claude Code safety check stopped under full access: marked in the conversation; the {{owner}} may approve one exact retry",
  "safety-grants.line.blocked": "Stopped, waiting for the {{owner}}",
  "safety-grants.line.granted": "The {{owner}} approved it once",
  "safety-grants.line.dismissed": "The {{owner}} did not approve it",
  "safety-grants.line.open": "Show",
};
