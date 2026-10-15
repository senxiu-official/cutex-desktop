// Pure helpers of the 闹钟 status category: which alarms an agent shows, time labels, who → whom.
import type { AlarmView } from "../../../../shared/alarms";
import type { AppLocale } from "../../../../shared/locales";

/** Sent / cancelled alarms stay in the fold this long after their time. */
export const RECENT_MS = 24 * 3_600_000;
/** A sent alarm keeps the category visible this long (like 作业's finished jobs). */
export const FRESH_MS = 30 * 60_000;

export interface AgentAlarms {
  /** Scheduled, earliest first. */
  pending: AlarmView[];
  /** Sent / cancelled within RECENT_MS (or cancelled before its time), newest first. */
  recent: AlarmView[];
  /** Earliest scheduled time (ms), null when none. */
  nextAt: number | null;
}

export const NO_ALARMS: AgentAlarms = { pending: [], recent: [], nextAt: null };

export const atMs = (alarm: Pick<AlarmView, "at">): number => {
  const ms = Date.parse(alarm.at);
  return Number.isFinite(ms) ? ms : 0;
};

export function agentAlarms(list: readonly AlarmView[], now: number): AgentAlarms {
  const pending = list.filter((a) => a.state === "scheduled").sort((a, b) => atMs(a) - atMs(b));
  const recent = list
    .filter((a) => a.state !== "scheduled" && atMs(a) > now - RECENT_MS)
    .sort((a, b) => atMs(b) - atMs(a));
  return { pending, recent, nextAt: pending.length ? atMs(pending[0]!) : null };
}

/** The category shows while something is scheduled, or an alarm went off less than FRESH_MS ago. */
export function alarmsWorthShowing(data: AgentAlarms, now: number): boolean {
  return data.pending.length > 0 || data.recent.some((a) => a.state === "queued" && atMs(a) <= now && now - atMs(a) < FRESH_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");
type Locale = AppLocale;

const DAY_LABELS: Record<Locale, { tomorrow: string; yesterday: string }> = {
  "zh-CN": { tomorrow: "明天", yesterday: "昨天" },
  "zh-Hant-CN": { tomorrow: "明天", yesterday: "昨天" },
  en: { tomorrow: "Tomorrow", yesterday: "Yesterday" },
  "en-AU": { tomorrow: "Tomorrow", yesterday: "Yesterday" },
  "ru-RU": { tomorrow: "Завтра", yesterday: "Вчера" },
  "fr-FR": { tomorrow: "Demain", yesterday: "Hier" },
  "es-ES": { tomorrow: "Mañana", yesterday: "Ayer" },
  "pt-BR": { tomorrow: "Amanhã", yesterday: "Ontem" },
  "it-IT": { tomorrow: "Domani", yesterday: "Ieri" },
  "de-DE": { tomorrow: "Morgen", yesterday: "Gestern" },
  "ja-JP": { tomorrow: "明日", yesterday: "昨日" },
  "ko-KR": { tomorrow: "내일", yesterday: "어제" },
};

/** "14:30" today, "明天 09:00" / "Tomorrow 09:00", "昨天 18:40", "10-14 09:00", "2027-01-02 09:00". */
export function alarmClock(ms: number, now: number, locale: Locale): string {
  const d = new Date(ms);
  const today = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 86_400_000;
  const dayLabel = DAY_LABELS[locale];
  if (ms >= dayStart && ms < dayStart + day) return clock;
  if (ms >= dayStart + day && ms < dayStart + 2 * day) return `${dayLabel.tomorrow} ${clock}`;
  if (ms >= dayStart - day && ms < dayStart) return `${dayLabel.yesterday} ${clock}`;
  if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

export type RelativeUnit = "now" | "min" | "hour" | "day";

/** How far `ms` is from now, rounded up for the future ("in 23 min") and down for the past. */
export function relativeParts(ms: number, now: number): { past: boolean; unit: RelativeUnit; n: number } {
  const diff = ms - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  if (abs < 60_000) return { past, unit: "now", n: 0 };
  const round = past ? Math.floor : Math.ceil;
  if (abs < 3_600_000) return { past, unit: "min", n: round(abs / 60_000) };
  if (abs < 2 * 86_400_000) return { past, unit: "hour", n: round(abs / 3_600_000) };
  return { past, unit: "day", n: round(abs / 86_400_000) };
}

/** "…a3f9c2d1" for an agent without a known name. */
export const shortAgent = (id: string): string => (id.length > 12 ? `…${id.slice(-8)}` : id);

/** Who set it and whom it wakes, as names; `self` = the agent set it for itself. */
export function alarmParties(alarm: AlarmView): { from: string | null; to: string; self: boolean } {
  const self = alarm.ownerCutexSessionId !== null && alarm.ownerCutexSessionId === alarm.targetCutexSessionId;
  const from = alarm.ownerKind === "human" ? null : (alarm.ownerName ?? shortAgent(alarm.ownerCutexSessionId ?? ""));
  return { from, to: alarm.targetName ?? shortAgent(alarm.targetCutexSessionId), self };
}

/** Replace one alarm in a list (after a cancel), keeping the order. */
export function withAlarm(list: readonly AlarmView[], alarm: AlarmView): AlarmView[] {
  return list.some((a) => a.id === alarm.id) ? list.map((a) => (a.id === alarm.id ? { ...a, ...alarm, relation: a.relation } : a)) : [...list, alarm];
}

/** Cache keys (`hostId|sessionId`) of `hostId` an alarm change touches (its owner or target). */
export function keysTouched(keys: readonly string[], hostId: string, ids: readonly (string | null)[]): string[] {
  return keys.filter((key) => {
    const bar = key.indexOf("|");
    return key.slice(0, bar) === hostId && ids.includes(key.slice(bar + 1));
  });
}
