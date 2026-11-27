// 「@ 列表顺序」 (owner 2026-11-28; lib/prefs atMentionOrder, settings 输入区 → @ 提及). New keys fall back to English in other locales.
export const zhCN = {
  "settings.atMention": "@ 提及",
  "settings.atMentionOrder": "@ 列表顺序",
  "settings.atMentionOrder.agents": "{{agent}}在前",
  "settings.atMentionOrder.profiles": "Profile 在前",
  "settings.atMentionOrderHint": "只输入 @ 时先列哪一组，文件路径总在最后；p@、m@ 不变",
};

export const en: Record<keyof typeof zhCN, string> = {
  "settings.atMention": "@ mentions",
  "settings.atMentionOrder": "@ list order",
  "settings.atMentionOrder.agents": "{{agents}} first",
  "settings.atMentionOrder.profiles": "Profiles first",
  "settings.atMentionOrderHint": "Which group a plain @ lists first; file paths stay last; p@ and m@ are unchanged",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "settings.atMention": "@ 提及",
  "settings.atMentionOrder": "@ 列表順序",
  "settings.atMentionOrder.agents": "{{agent}}在前",
  "settings.atMentionOrder.profiles": "Profile 在前",
  "settings.atMentionOrderHint": "只輸入 @ 時先列哪一組，文件路徑總在最後；p@、m@ 不變",
};
