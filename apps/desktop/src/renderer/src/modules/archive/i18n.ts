export const zhCN = {
  "archive.title": "归档",
  "archive.description": "查看和恢复已归档的{{agent}}，设置归档方式",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "archive.list": "已归档的{{agent}}",
  "archive.all": "全部 {n} 个",
  "archive.page": "归档",
  "archive.archiveEmpty": "没有已归档的{{agent}}",
  "archive.archiveHint": "已归档的{{agent}}一定离线；可以查看历史（只读）或恢复",
  "archive.deleteEmpty": "归档时直接删除空的{{agent}} / 工作",
  "archive.deleteEmptyHint": "还没有任何对话的不进归档，直接删除",
  "archive.archiveHintDelete": "已归档的{{agent}}一定离线；可以查看历史（只读）、恢复或永久删除",
  // ---- archived agent: list rows, banner, read-only history (2026-10-09) ----
  "archive.row.view": "查看历史",
  "archive.row.restore": "恢复",
  "archive.row.delete": "永久删除",
  "archive.row.deleteArmed": "再左键点击一次永久删除",
  "archive.row.archivedAt": "归档于 {when}",
  "archive.row.projectArchived": "{project}（项目已归档）",
  "archive.banner.title": "已归档",
  "archive.banner.body": "以下是只读历史。恢复后才能发送消息或启动。",
  "archive.banner.projectArchived": "所属项目「{project}」也已归档，恢复时会先恢复项目。",
  "archive.banner.restore": "恢复",
  "archive.banner.restoreWithProject": "恢复项目和{{agent}}",
  "archive.banner.restoreOnly": "只恢复{{agent}}",
  "archive.banner.restoring": "恢复中…",
  "archive.restoreProjectConfirm": "恢复 {name} 会先恢复它所属的项目「{project}」。",
  "archive.restoreDirector": "同时恢复{{director}} {name}",
  "archive.history.note": "已归档 · 以下为保存的历史（只读）",
  "archive.history.empty": "没有保存的对话记录。",
  "archive.history.unsupported": "当前 cutex 不能读取已归档{{agent}}的历史；恢复后可以查看。",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
