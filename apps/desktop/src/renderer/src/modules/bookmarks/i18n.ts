export const zhCN = {
  "bookmarks.home": "本会话书签", "bookmarks.homeEmpty": "本会话还没有 · 共 {n} 条", "bookmarks.browseAll": "查看全部","bookmarks.back": "返回本会话", "bookmarks.close": "收起书签列表",
  "bookmarks.projectPin": "在本项目的会话首页显示", "bookmarks.projectHint": "自动关联项目不会让其他会话看见；只有勾选后才加入项目导航",
  "bookmarks.title": "书签", "bookmarks.description": "收藏引用，临时查看内容或聚焦已有工具；保存在此设备", "bookmarks.list": "全部书签", "bookmarks.add": "加书签", "bookmarks.active": "已收藏（点击取消）",
  "bookmarks.saved": "已加书签", "bookmarks.existing": "这条引用已经收藏", "bookmarks.empty": "还没有书签。", "bookmarks.emptyHint": "在一轮回复下方的操作栏点书签图标，或用上方「收藏当前…」", "bookmarks.noMatch": "没有匹配的书签。", "bookmarks.removeArmed": "再点一次删除", "bookmarks.ribbon": "书签：{title} · 在左侧预览", "bookmarks.current": "当前{{agent}}", "bookmarks.other": "其他引用", "bookmarks.here": "收藏当前…", "bookmarks.hereEmpty": "当前没有可收藏的引用",
  "bookmarks.search": "搜索书签", "bookmarks.allHosts": "所有主机", "bookmarks.thisHost": "此主机", "bookmarks.localHint": "书签仅保存在此设备；只保存引用和简短片段，不保存对话副本",
  "bookmarks.jump": "跳过去", "bookmarks.peek": "在左侧预览", "bookmarks.page": "在右侧打开", "bookmarks.rename": "编辑书签", "bookmarks.remove": "删除书签", "bookmarks.save": "保存", "bookmarks.cancel": "取消",
  "bookmarks.clear": "清空所有主机的书签", "bookmarks.clearConfirm": "确认清空全部书签？", "bookmarks.invalidRef": "引用格式无效，未保存。", "bookmarks.invalidStorage": "书签存储损坏或来自更新版本，未覆盖原数据。", "bookmarks.storageFull": "书签超过 500 条或存储大小上限。", "bookmarks.storageFailed": "书签无法写入此设备，未报告保存成功。", "bookmarks.moduleOff": "书签模块未启用。",
  "bookmarks.migrated": "书签格式已升级；旧书签不会自动加入项目导航。已移除 {n} 个旧对话副本。",
  "bookmarks.migratedPlain": "书签格式已升级；旧书签不会自动加入项目导航。",
  "bookmarks.unavailable.gone": "目标已不在", "bookmarks.unavailable.reverted": "来源轮已撤销", "bookmarks.unavailable.module-off": "目标模块未启用", "bookmarks.unavailable.capability": "主机缺少该能力", "bookmarks.unavailable.host-offline": "主机离线", "bookmarks.unavailable.host-changed": "目标在另一台主机", "bookmarks.unavailable.bad-ref": "引用无效", "bookmarks.unavailable.stale": "连接已变化，请重试",
  "bookmarks.settings": "书签条", "bookmarks.showRibbon": "被收藏的轮旁显示书签条", "bookmarks.showRibbonHint": "左侧留白够宽时显示小书签，不在轮下额外占行",
} as const;
declare module "../i18nCatalog" { interface ModuleMessages extends Messages {} }
type Messages = typeof zhCN;
export const en: Record<keyof typeof zhCN, string> = {
  "bookmarks.home": "Conversation bookmarks", "bookmarks.homeEmpty": "None in this conversation · {n} in all","bookmarks.browseAll": "View all", "bookmarks.back": "Back to conversation", "bookmarks.close": "Close bookmark list",
  "bookmarks.projectPin": "Show on this project's conversation home", "bookmarks.projectHint": "Automatic project association does not expose this bookmark in other conversations. Only an explicit selection adds it to project navigation.",
  "bookmarks.title": "Bookmarks", "bookmarks.description": "Save references to peek at content or focus existing tools; stored on this device.", "bookmarks.list": "All bookmarks", "bookmarks.add": "Bookmark", "bookmarks.active": "Bookmarked (click to remove)",
  "bookmarks.saved": "Bookmark saved", "bookmarks.existing": "This reference is already bookmarked", "bookmarks.empty": "No bookmarks yet.", "bookmarks.emptyHint": "Use the bookmark icon in a reply's action bar, or “Bookmark current…” above.", "bookmarks.noMatch": "No matching bookmarks.", "bookmarks.removeArmed": "Click again to remove", "bookmarks.ribbon": "Bookmark: {title} · preview on the left", "bookmarks.current": "Current {{agent}}", "bookmarks.other": "Other references", "bookmarks.here": "Bookmark current…", "bookmarks.hereEmpty": "Nothing referable is currently open",
  "bookmarks.search": "Search bookmarks", "bookmarks.allHosts": "All hosts", "bookmarks.thisHost": "This host", "bookmarks.localHint": "Bookmarks stay on this device. They hold references and short snippets, not copies of conversations.",
  "bookmarks.jump": "Jump to source", "bookmarks.peek": "Preview on the left", "bookmarks.page": "Open on the right", "bookmarks.rename": "Edit bookmark", "bookmarks.remove": "Remove bookmark", "bookmarks.save": "Save", "bookmarks.cancel": "Cancel",
  "bookmarks.clear": "Clear bookmarks on all hosts", "bookmarks.clearConfirm": "Clear every bookmark?", "bookmarks.invalidRef": "Invalid reference; nothing was saved.", "bookmarks.invalidStorage": "Bookmark storage is malformed or newer. The original data was not overwritten.", "bookmarks.storageFull": "Bookmarks exceed 500 records or the storage size limit.", "bookmarks.storageFailed": "Could not persist bookmarks on this device. Nothing was reported as saved.", "bookmarks.moduleOff": "The bookmarks module is off.",
  "bookmarks.migrated": "Bookmark format upgraded; existing bookmarks are not automatically added to project navigation. Removed {n} old conversation copies.",
  "bookmarks.migratedPlain": "Bookmark format upgraded; existing bookmarks are not automatically added to project navigation.",
  "bookmarks.unavailable.gone": "Target no longer exists", "bookmarks.unavailable.reverted": "Source turn was reverted", "bookmarks.unavailable.module-off": "Target module is off", "bookmarks.unavailable.capability": "Host lacks this capability", "bookmarks.unavailable.host-offline": "Host offline", "bookmarks.unavailable.host-changed": "Target is on another host", "bookmarks.unavailable.bad-ref": "Invalid reference", "bookmarks.unavailable.stale": "Connection changed; try again",
  "bookmarks.settings": "Bookmark ribbons", "bookmarks.showRibbon": "Show a ribbon beside bookmarked turns", "bookmarks.showRibbonHint": "Show a small bookmark when the left margin is wide enough, without adding a row below the turn.",
};
