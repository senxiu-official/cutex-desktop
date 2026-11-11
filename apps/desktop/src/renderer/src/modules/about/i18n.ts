// Strings of the `about` module (Settings → 关于: 已知问题, 更新记录, 项目). The known-issue texts live in
// docs/known-issues.json (per-locale strings; ./knownIssues.ts), the changelog in CHANGELOG.md (./changelog.ts).
export const zhCN = {
  "about.title": "关于与已知问题",
  "about.description": "查看已知问题、更新记录、项目链接和许可证",
  "about.links.section": "项目",
  "about.source": "源代码",
  "about.sourceHint": "觉得有用的话，欢迎在 GitHub 上左键点击 Star",
  "about.star": "⭐ 去 GitHub 左键点击 Star",
  "about.installHint": "安装、更新和各模块的说明",
  "about.open": "打开",
  "about.license": "许可证",
  "about.licenseHint": "Cutex 桌面应用以 Apache License 2.0 开源",
  "about.onGithub": "在 GitHub 上查看",
  "about.link.github": "GitHub",
  "about.link.changelog": "更新日志",
  "about.link.install": "安装指南",
  "about.link.knownIssues": "已知问题文档",
  "about.knownIssues": "已知问题",
  "about.knownIssuesHint": "当前版本的已知问题；修好后会从这里移除",
  "about.sourceGithub": "{time} 从 GitHub 更新",
  "about.sourceGithubStale": "{time} 从 GitHub 更新（之后的刷新失败，显示的是上次的列表）",
  "about.sourceBuiltin": "内置列表（还没能从 GitHub 获取最新列表）",
  "about.noIssues": "这个版本没有已知问题",
  "about.fixedIn": "计划 {version} 修复",
  "about.workaround": "临时办法：{text}",
  "about.changelog": "更新记录",
  "about.changelogHint": "这个桌面应用每个版本带来了什么（随应用附带，不用联网）",
  "about.changelog.keywords": "更新日志 版本历史 新功能",
  "about.changelog.installed": "当前版本",
  "about.changelog.new": "新",
  "about.changelog.empty": "这份构建没有附带更新记录",
  "about.thirdParty": "第三方许可",
  "about.thirdPartyHint": "部分界面代码改编自 ZCode（Apache-2.0），另含 OpenAI Codex（Apache-2.0）、Lobe Icons（MIT）等；完整列表见程序目录里的 NOTICE 和 THIRD_PARTY_NOTICES.md",
};

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
