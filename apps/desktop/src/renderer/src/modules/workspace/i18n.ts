export const zhCN = {
  "workspace.title": "工作区",
  "workspace.description": "右栏里的文件、改动与文件预览，本机与远程主机一样",
  "workspace.files": "文件",
  "workspace.changes": "改动",
  "workspace.changesCount": "改动 {n}",
  "workspace.preview": "预览",
  "workspace.searchFiles": "搜索文件…",
  "workspace.notRepo": "不是 git 仓库",
  "workspace.clean": "没有未提交的变更",
  "workspace.staged": "已暂存",
  "workspace.tooBroad": "这个{{agent}}的工作目录太大（主目录 / 根目录），不对其他用户开放",
  "workspace.open": "打开",
  "workspace.copyPath": "复制绝对路径",
  "workspace.copied": "已复制",
  "workspace.binary": "二进制文件（{mime}，{size} 字节）",
  "workspace.truncated": "文件过大，只显示了开头部分。",
  "workspace.noScope": "这个{{agent}}没有工作目录。",
  "workspace.hostFile": "工作区外",
  "workspace.hostFileHint": "不在该{{agent}}的工作区内，按主机上的绝对路径读取",
  "workspace.hostReadMissing": "这台主机的 cutex 不能按路径读文件（需要 fs-file-read），请升级 cutex",
  "workspace.showSource": "源码",
  "workspace.showRendered": "渲染",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "workspace.title": "Workspace",
  "workspace.description": "Files, changes and file previews in the right column, for local and remote hosts alike",
  "workspace.files": "Files",
  "workspace.changes": "Changes",
  "workspace.changesCount": "Changes {n}",
  "workspace.preview": "Preview",
  "workspace.searchFiles": "Search files…",
  "workspace.notRepo": "Not a git repository",
  "workspace.clean": "No uncommitted changes",
  "workspace.staged": "staged",
  "workspace.tooBroad": "This {{agent}}'s working folder is too broad (a home or root folder), so it is not shared with other users",
  "workspace.open": "Open",
  "workspace.copyPath": "Copy absolute path",
  "workspace.copied": "Copied",
  "workspace.binary": "Binary file ({mime}, {size} bytes)",
  "workspace.truncated": "File is large; only the beginning is shown.",
  "workspace.noScope": "This {{agent}} has no working directory.",
  "workspace.hostFile": "Outside workspace",
  "workspace.hostFileHint": "Outside this {{agent}}'s workspace; read by its absolute path on the host",
  "workspace.hostReadMissing": "This host's cutex cannot read files by path (needs fs-file-read); upgrade cutex",
  "workspace.showSource": "Source",
  "workspace.showRendered": "Rendered",
};
