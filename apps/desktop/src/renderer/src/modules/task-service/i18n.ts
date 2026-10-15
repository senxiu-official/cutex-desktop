// Task Service (removed in cutex r219): old-transcript timeline rows only.
export const zhCN = {
  "task-service.title": "任务服务",
  "task-service.description": "在旧对话记录里显示已移除的任务服务（cutex task-service）的投递和工具调用",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "task-service.title": "Task Service",
  "task-service.description": "Shows deliveries and tool calls of the removed Task Service (cutex task-service) in old transcripts",
};
