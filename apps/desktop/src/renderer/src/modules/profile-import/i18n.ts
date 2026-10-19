export const zhCN = {
  "profile-import.title": "从 CC Switch 导入",
  "profile-import.description": "设置 → Profile → 从 CC Switch 导入：把主机上 CC Switch 配置的 Claude Code / Codex 供应商导入为 Profile；CC Switch 只读不改",
  "profile-import.section": "从 CC Switch 导入",
  "profile-import.sectionHint": "把这台主机上 CC Switch 里配置好的 Claude Code 和 Codex 供应商导入为 Profile。",
  "profile-import.notFound": "没有在这台主机上找到 CC Switch",
  "profile-import.error": "读取 CC Switch 失败：{message}",
  "profile-import.empty": "CC Switch 里还没有可以导入的供应商",
  "profile-import.reload": "重新读取",
  "profile-import.app.claude": "Claude Code",
  "profile-import.app.codex": "Codex",
  "profile-import.current": "当前",
  "profile-import.existing": "已有 Profile：{name}",
  "profile-import.noKey": "没有 API key，无法导入",
  "profile-import.unsupported": "暂不支持导入",
  "profile-import.note": "导入会把 API key 复制到 cutex 的 Profile 里；CC Switch 只会被读取，不会被修改。",
  "profile-import.import": "导入 {n} 个",
  "profile-import.importing": "正在导入…",
  "profile-import.created": "已导入 {n} 个 Profile：{names}",
  "profile-import.created.one": "已导入 {n} 个 Profile：{names}",
  "profile-import.failed": "{n} 个没有导入：",
  "profile-import.failedRow": "{name}：{message}",
};

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "profile-import.title": "Import from CC Switch",
  "profile-import.description": "Settings → Profiles → Import from CC Switch: turn the Claude Code / Codex providers set up in CC Switch on the host into profiles; CC Switch is only read",
  "profile-import.section": "Import from CC Switch",
  "profile-import.sectionHint": "Turn the Claude Code and Codex providers set up in CC Switch on this host into profiles.",
  "profile-import.notFound": "CC Switch was not found on this host",
  "profile-import.error": "Could not read CC Switch: {message}",
  "profile-import.empty": "CC Switch has no provider to import yet",
  "profile-import.reload": "Read again",
  "profile-import.app.claude": "Claude Code",
  "profile-import.app.codex": "Codex",
  "profile-import.current": "Current",
  "profile-import.existing": "Existing profile: {name}",
  "profile-import.noKey": "No API key, cannot be imported",
  "profile-import.unsupported": "Not supported yet",
  "profile-import.note": "Importing copies the API keys into cutex profiles; CC Switch is only read, never changed.",
  "profile-import.import": "Import {n}",
  "profile-import.importing": "Importing…",
  "profile-import.created": "Imported {n} profiles: {names}",
  "profile-import.created.one": "Imported {n} profile: {names}",
  "profile-import.failed": "{n} not imported:",
  "profile-import.failedRow": "{name}: {message}",
};
