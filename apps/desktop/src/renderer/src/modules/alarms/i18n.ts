export const zhCN = {
  "alarms.title": "闹钟",
  "alarms.description": "查看和取消{{agent}}设置的提醒",
  "alarms.statusTitle": "闹钟",
  "alarms.pending": "{n} 个待响",
  "alarms.next": "下次 {t}",
  "alarms.chip": "{n} · {t}",
  "alarms.recentOnly": "{n} 个已响",
  "alarms.recent": "已响 / 已取消 · {n}",
  "alarms.rel.now.future": "马上",
  "alarms.rel.now.past": "刚刚",
  "alarms.rel.min.future": "{n} 分钟后",
  "alarms.rel.min.past": "{n} 分钟前",
  "alarms.rel.hour.future": "{n} 小时后",
  "alarms.rel.hour.past": "{n} 小时前",
  "alarms.rel.day.future": "{n} 天后",
  "alarms.rel.day.past": "{n} 天前",
  "alarms.self": "给自己",
  "alarms.owner": "{{owner}}",
  "alarms.state.queued": "已发出",
  "alarms.state.cancelled": "已取消",
  "alarms.cancel": "取消",
  "alarms.cancelConfirm": "再左键点击一次取消这个闹钟",
  "alarms.alreadySent": "闹钟已经发出，不能再取消",
  "alarms.cancelFailed": "取消闹钟失败：{error}",
  "alarms.retrying": "发送失败，30 秒后重试：{error}",
  "alarms.unavailable": "读取闹钟失败",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
