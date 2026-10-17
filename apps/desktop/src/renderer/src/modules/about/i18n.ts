// Strings of the `about` module (Settings → 关于: license, links, 已知问题). The known-issue texts
// themselves live in docs/known-issues.json (per-locale strings; ./knownIssues.ts), not here.
export const zhCN = {
  "about.title": "关于与已知问题",
  "about.description": "设置 → 关于：许可证、项目链接和已知问题列表",
  "about.links.section": "项目",
  "about.license": "许可证",
  "about.licenseHint": "Cutex 桌面端以 Apache License 2.0 开源",
  "about.links": "链接",
  "about.linksHint": "在系统浏览器中打开（release 分支）",
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
};

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "about.title": "About & known issues",
  "about.description": "Settings → About: license, project links and the known issues list",
  "about.links.section": "Project",
  "about.license": "License",
  "about.licenseHint": "Cutex desktop is open source under the Apache License 2.0",
  "about.links": "Links",
  "about.linksHint": "Open in your system browser (release branch)",
  "about.link.github": "GitHub",
  "about.link.changelog": "Changelog",
  "about.link.install": "Install guide",
  "about.link.knownIssues": "Known issues doc",
  "about.knownIssues": "Known issues",
  "about.knownIssuesHint": "Known issues of the current versions; fixed ones leave this list",
  "about.sourceGithub": "Updated {time} from GitHub",
  "about.sourceGithubStale": "Updated {time} from GitHub (a later refresh failed; showing that list)",
  "about.sourceBuiltin": "Built-in list (the latest list could not be fetched from GitHub yet)",
  "about.noIssues": "No known issues for this version",
  "about.fixedIn": "Fix planned: {version}",
  "about.workaround": "Workaround: {text}",
};
