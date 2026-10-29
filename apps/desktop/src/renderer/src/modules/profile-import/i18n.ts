export const zhCN = {
  "profile-import.summary.loading": "正在读取…",
  "profile-import.summary.error": "读取失败，展开后可重试",
  "profile-import.summary.count": "{total} 个服务商 · {available} 个可导入",
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
  "profile-import.err.unsupportedVersion": "你的 CC Switch 比这台主机的 cutex 新，升级 cutex 后再导入",
  "profile-import.err.unsupportedFormat": "读不懂这份 CC Switch 数据（格式不对）",
};

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
