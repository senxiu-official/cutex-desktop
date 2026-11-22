// 教学模式 (docs/design/teaching-mode.md P1): the switch in 设置 → 对话 → 消息显示 and the callout cards' default titles
// (components/MarkdownCallout, when a `> [!KIND]` line has no title of its own).
export const zhCN = {
  "conversation.teachingMode": "教学模式",
  "conversation.teachingModeHint": "回复里以 [!EXPLAIN]、[!NOTE]、[!TIP] 等开头的引用块显示成卡片；选中回复或笔记里的文字后右键点击，可以「解释这段」（在侧边对话里问，不打断主对话）。只在这台设备上生效。",
  "markdown.callout.explain": "讲解",
  "markdown.callout.note": "说明",
  "markdown.callout.tip": "提示",
  "markdown.callout.important": "重要",
  "markdown.callout.warning": "注意",
  "markdown.callout.caution": "警告",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "conversation.teachingMode": "Teaching mode",
  "conversation.teachingModeHint": "Quotes in replies that start with [!EXPLAIN], [!NOTE], [!TIP] and the like show as cards; right-click selected text in a reply or note to “Explain this” (asked in a side chat, without interrupting the main chat). This device only.",
  "markdown.callout.explain": "Explanation",
  "markdown.callout.note": "Note",
  "markdown.callout.tip": "Tip",
  "markdown.callout.important": "Important",
  "markdown.callout.warning": "Warning",
  "markdown.callout.caution": "Caution",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "conversation.teachingMode": "教學模式",
  "conversation.teachingModeHint": "回覆裡以 [!EXPLAIN]、[!NOTE]、[!TIP] 等開頭的引用塊顯示成卡片；選中回覆或筆記裡的文字後右鍵點擊，可以「解釋這段」（在側邊對話裡問，不打斷主對話）。只在這台裝置上生效。",
  "markdown.callout.explain": "講解",
  "markdown.callout.note": "說明",
  "markdown.callout.tip": "提示",
  "markdown.callout.important": "重要",
  "markdown.callout.warning": "注意",
  "markdown.callout.caution": "警告",
};
