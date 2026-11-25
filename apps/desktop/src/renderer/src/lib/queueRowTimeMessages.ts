// When a 接下来 row's input was sent (owner report 2026-11-19: a 待读留言 row did not say how old it is). The row shows a
// compact age (「3 小时前」) for a confirmed message time; the full-text tip / view and the age's own tip give the exact
// time (lib/queueRowTime). A ledger record's own creation time is only 「记录于」: backfill and repair create records
// too, so it may be much later than the message. Display only: not a Next Up state, label or action.
export const zhCN = {
  "queue.row.justNow": "刚刚",
  "queue.row.minutesAgo": "{n} 分钟前",
  "queue.row.hoursAgo": "{n} 小时前",
  "queue.row.daysAgo": "{n} 天前",
  "queue.row.sentAt": "{time} 发送",
  "queue.row.queuedAt": "{time} 加入队列",
  "queue.row.recordedAt": "记录于 {time}（消息本身的时间未知）",
  "queue.row.fullText": "完整内容",
} as const;

export const en: Record<keyof typeof zhCN, string> = {
  "queue.row.justNow": "just now",
  "queue.row.minutesAgo": "{n} min ago",
  "queue.row.hoursAgo": "{n} h ago",
  "queue.row.daysAgo": "{n} d ago",
  "queue.row.sentAt": "Sent {time}",
  "queue.row.queuedAt": "Queued {time}",
  "queue.row.recordedAt": "Recorded {time} (the message's own time is unknown)",
  "queue.row.fullText": "Full text",
};

// zh-Hant-CN: OpenCC s2t of zhCN (mainland terms kept).
export const zhHant: Record<keyof typeof zhCN, string> = {
  "queue.row.justNow": "剛剛",
  "queue.row.minutesAgo": "{n} 分鐘前",
  "queue.row.hoursAgo": "{n} 小時前",
  "queue.row.daysAgo": "{n} 天前",
  "queue.row.sentAt": "{time} 發送",
  "queue.row.queuedAt": "{time} 加入隊列",
  "queue.row.recordedAt": "記錄於 {time}（消息本身的時間未知）",
  "queue.row.fullText": "完整內容",
};
