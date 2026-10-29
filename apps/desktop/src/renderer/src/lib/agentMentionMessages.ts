export const zhCN = {
  "composer.mention.copy": "复制提及",
  "mention.menuTitle": "提及",
  "mention.agents": "{{agents}}",
  "mention.sameProject": "同项目",
  "mention.online": "在线",
  "mention.offline": "离线",
  "mention.unknown": "状态未知",
  "mention.agentOpen": "左键点击打开{{agent}} {name}",
  "mention.agentMention": "提及{{agent}} {name}",
  "mention.footer": "↑ ↓ 选择 · Tab / Enter 插入 · Esc 关闭",
  "mention.inputLabel": "消息输入",
  "mention.empty": "输入名字或文件名以搜索",
} as const;
export const en: Record<keyof typeof zhCN, string> = {
  "composer.mention.copy": "Copy mention",
  "mention.menuTitle": "Mention",
  "mention.agents": "{{Agents}}",
  "mention.sameProject": "Same project",
  "mention.online": "Online",
  "mention.offline": "Offline",
  "mention.unknown": "Status unknown",
  "mention.agentOpen": "Click to open {{agent}} {name}",
  "mention.agentMention": "Mention {{agent}} {name}",
  "mention.footer": "↑ ↓ select · Tab / Enter insert · Esc close",
  "mention.inputLabel": "Message input",
  "mention.empty": "Type a name or file name to search",
};

export const zhHant = { ...zhCN, "composer.mention.copy": "複製提及", "mention.sameProject": "同項目", "mention.online": "在線", "mention.offline": "離線", "mention.unknown": "狀態未知", "mention.agentOpen": "左鍵點擊打開{{agent}} {name}", "mention.footer": "↑ ↓ 選擇 · Tab / Enter 插入 · Esc 關閉", "mention.inputLabel": "消息輸入", "mention.empty": "輸入名字或文件名以搜索" };
