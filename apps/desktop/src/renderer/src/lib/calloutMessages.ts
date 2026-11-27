// Markdown alert cards' default titles (components/MarkdownCallout, when a `> [!KIND]` line has no title of its own).
export const zhCN = {
  "markdown.callout.explain": "讲解",
  "markdown.callout.note": "说明",
  "markdown.callout.tip": "提示",
  "markdown.callout.important": "重要",
  "markdown.callout.warning": "注意",
  "markdown.callout.caution": "警告",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "markdown.callout.explain": "Explanation",
  "markdown.callout.note": "Note",
  "markdown.callout.tip": "Tip",
  "markdown.callout.important": "Important",
  "markdown.callout.warning": "Warning",
  "markdown.callout.caution": "Caution",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "markdown.callout.explain": "講解",
  "markdown.callout.note": "說明",
  "markdown.callout.tip": "提示",
  "markdown.callout.important": "重要",
  "markdown.callout.warning": "注意",
  "markdown.callout.caution": "警告",
};
