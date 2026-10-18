export const zhCN = {
  "notes.title": "批注", "notes.description": "独立保存批注，在来源轮旁查阅，不进入主对话", "notes.list": "全部批注", "notes.note": "批注",
  "notes.conversation": "本会话批注", "notes.browseAll": "查看全部", "notes.backToConversation": "返回本会话批注", "notes.closeList": "收起批注列表", "notes.projectSelected": "项目批注（属于或标记到此项目）",
  "notes.new": "新建批注", "notes.addToTurn": "给这一轮加批注", "notes.addAnother": "这一轮已有批注 · 再加一条", "notes.edit": "编辑批注", "notes.delete": "删除批注", "notes.deleteConfirm": "确认删除？",
  "notes.floating": "批注浮窗", "notes.closeFloat": "关闭批注浮窗", "notes.viewFloat": "在浮窗查看 {n} 条批注", "notes.floatHint": "不占用对话空间 · 关闭浮窗保留草稿 · Esc 关闭",
  "notes.titleField": "标题", "notes.bodyField": "正文（Markdown）", "notes.save": "保存", "notes.saving": "正在保存…", "notes.cancel": "取消", "notes.untitled": "未命名批注",
  "notes.pins": "也显示在", "notes.pinHint": "只是多一个入口，批注仍属于原来的范围", "notes.pinSession": "此{{agent}}的批注", "notes.pinHost": "主机批注",
  "notes.chooseProject": "选择项目", "notes.pin": "标记", "notes.unpin": "取消标记", "notes.pinned": "已标记", "notes.all": "全部", "notes.pinnedOnly": "仅已标记",
  "notes.scope.session": "{{agent}}", "notes.scope.project": "项目", "notes.scope.host": "主机", "notes.chooseSession": "选择{{agent}}",
  "notes.conflict": "批注已在其他地方更新；你的草稿仍保留。", "notes.latestVersion": "查看最新保存的版本", "notes.useLatestRevision": "已核对：用我的草稿覆盖最新版本", "notes.conflictHint": "可重试；如有版本冲突，请先核对最新版本",
  "notes.source": "跳到来源", "notes.peekSource": "看一眼来源", "notes.sourceSession": "来源{{agent}}", "notes.reverted": "来源轮已撤销，批注仍保留。", "notes.sessionDeleted": "来源{{agent}}已删除，批注仍保留。", "notes.sourceUnknown": "来源历史尚未加载；可以看一眼或跳到来源。",
  "notes.quote": "引用到输入框", "notes.quoteHint": "只追加到当前{{agent}}的输入草稿，不发送", "notes.quoteUnavailable": "请在批注所属主机选择一个{{agent}}后引用。",
  "notes.savedAt": "更新于 {time}", "notes.openRight": "在右侧打开", "notes.expand": "展开 {n} 条批注", "notes.collapse": "收起批注", "notes.empty": "这里还没有批注。", "notes.emptyHint": "在一轮回复下方的操作栏点「给这一轮加批注」，或用上方「新建批注」", "notes.search": "搜索批注", "notes.refresh": "刷新", "notes.more": "加载更多", "notes.loading": "正在加载…", "notes.noContext": "批注默认不进入主对话上下文。", "notes.missing": "此批注不存在或已删除。", "notes.unsupportedHost": "这台主机的 cutex 版本还不支持批注（需要 r226 或更新）。",
  "notes.settings": "批注", "notes.showTimeline": "在时间线里显示批注", "notes.showTimelineHint": "仅显示紧凑入口，点击在浮窗查看；关闭此项不删除批注",
} as const;
declare module "../i18nCatalog" { interface ModuleMessages extends Messages {} }
type Messages = typeof zhCN;
export const en: Record<keyof typeof zhCN, string> = {
  "notes.title": "Notes", "notes.description": "Keep independent notes beside their source turns, outside the main chat.", "notes.list": "All notes", "notes.note": "Note",
  "notes.conversation": "Conversation notes", "notes.browseAll": "View all", "notes.backToConversation": "Back to conversation notes", "notes.closeList": "Close notes list", "notes.projectSelected": "Project notes (in or pinned to this project)",
  "notes.new": "New note", "notes.addToTurn": "Add a note to this turn", "notes.addAnother": "This turn has notes · add another", "notes.edit": "Edit note", "notes.delete": "Delete note", "notes.deleteConfirm": "Delete this note?",
  "notes.floating": "Note window", "notes.closeFloat": "Close note window", "notes.viewFloat": "View {n} notes in a floating window", "notes.floatHint": "No conversation space used · Closing keeps drafts · Esc to close",
  "notes.titleField": "Title", "notes.bodyField": "Body (Markdown)", "notes.save": "Save", "notes.saving": "Saving…", "notes.cancel": "Cancel", "notes.untitled": "Untitled note",
  "notes.pins": "Also show in", "notes.pinHint": "Only adds a shortcut; the note stays in its own scope", "notes.pinSession": "This {{agent}}’s notes", "notes.pinHost": "Host notes",
  "notes.chooseProject": "Choose project", "notes.pin": "Pin", "notes.unpin": "Unpin", "notes.pinned": "Pinned", "notes.all": "All", "notes.pinnedOnly": "Pinned only",
  "notes.scope.session": "{{agent}}", "notes.scope.project": "Project", "notes.scope.host": "Host", "notes.chooseSession": "Choose {{agent}}",
  "notes.conflict": "This note changed elsewhere. Your draft is preserved.", "notes.latestVersion": "View latest saved version", "notes.useLatestRevision": "Reviewed: overwrite the latest version with my draft", "notes.conflictHint": "You can retry. Review the latest version first if there is a conflict.",
  "notes.source": "Jump to source", "notes.peekSource": "Peek at source", "notes.sourceSession": "Source {{agent}}", "notes.reverted": "The source turn was reverted. This note is kept.", "notes.sessionDeleted": "The source {{agent}} was deleted. This note is kept.", "notes.sourceUnknown": "Source history is not loaded yet. Peek or jump to find it.",
  "notes.quote": "Quote in input", "notes.quoteHint": "Append to the current {{agent}}’s draft only; do not send.", "notes.quoteUnavailable": "Select an {{agent}} on this note’s host to quote it.",
  "notes.savedAt": "Updated {time}", "notes.openRight": "Open on the right", "notes.expand": "Expand {n} notes", "notes.collapse": "Collapse notes", "notes.empty": "No notes here yet.", "notes.emptyHint": "Use “Add a note to this turn” in a reply's action bar, or “New note” above.", "notes.search": "Search notes", "notes.refresh": "Refresh", "notes.more": "Load more", "notes.loading": "Loading…", "notes.noContext": "Notes stay outside the main chat context by default.", "notes.missing": "This note does not exist or was deleted.", "notes.unsupportedHost": "This host's cutex does not support notes yet (needs r226 or newer).",
  "notes.settings": "Notes", "notes.showTimeline": "Show notes in the timeline", "notes.showTimelineHint": "Show a compact entry that opens a floating window. Turning this off does not delete notes.",
};
