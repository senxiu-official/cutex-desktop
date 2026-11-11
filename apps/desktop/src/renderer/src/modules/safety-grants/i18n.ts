export const zhCN = {
  "safety-grants.title": "安全检查放行",
  "safety-grants.description": "在会话中查看完全访问模式下被 Claude Code 拦截的命令，由{{owner}}批准原样重试一次",
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
