// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "alarms.title": "Alarms",
  "alarms.description": "View and cancel reminders set by {{agents}}",
  "alarms.statusTitle": "Alarms",
  "alarms.pending": "{n} pending",
  "alarms.next": "next {t}",
  "alarms.chip": "{n} · {t}",
  "alarms.recentOnly": "{n} went off",
  "alarms.recent": "Sent / cancelled · {n}",
  "alarms.rel.now.future": "any moment",
  "alarms.rel.now.past": "just now",
  "alarms.rel.min.future": "in {n} min",
  "alarms.rel.min.past": "{n} min ago",
  "alarms.rel.hour.future": "in {n} h",
  "alarms.rel.hour.past": "{n} h ago",
  "alarms.rel.day.future": "in {n} d",
  "alarms.rel.day.past": "{n} d ago",
  "alarms.self": "to itself",
  "alarms.owner": "{{Owner}}",
  "alarms.state.queued": "sent",
  "alarms.state.cancelled": "cancelled",
  "alarms.cancel": "Cancel",
  "alarms.cancelConfirm": "Click again to cancel this alarm",
  "alarms.alreadySent": "The alarm was already sent and can no longer be cancelled",
  "alarms.cancelFailed": "Couldn't cancel the alarm: {error}",
  "alarms.retrying": "Sending failed, retrying in 30 s: {error}",
  "alarms.unavailable": "Couldn't read alarms",
};
