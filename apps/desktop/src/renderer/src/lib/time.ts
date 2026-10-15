// Turn / message time labels: relative while recent, clock time after (DESIGN §4.15).
import { useEffect, useState } from "react";
import type { AppLocale } from "../../../shared/locales";

type Locale = AppLocale;

const LABELS: Record<Locale, { justNow: string; minAgo: (m: number) => string; yesterday: string }> = {
  "zh-CN": { justNow: "刚刚", minAgo: (m) => `${m} 分钟前`, yesterday: "昨天" },
  "zh-Hant-CN": { justNow: "剛剛", minAgo: (m) => `${m} 分鐘前`, yesterday: "昨天" },
  en: { justNow: "just now", minAgo: (m) => `${m} min ago`, yesterday: "Yesterday" },
  "en-AU": { justNow: "just now", minAgo: (m) => `${m} min ago`, yesterday: "Yesterday" },
  "ru-RU": { justNow: "только что", minAgo: (m) => `${m} мин. назад`, yesterday: "Вчера" },
  "fr-FR": { justNow: "à l’instant", minAgo: (m) => `il y a ${m} min`, yesterday: "Hier" },
  "es-ES": { justNow: "ahora mismo", minAgo: (m) => `hace ${m} min`, yesterday: "Ayer" },
  "pt-BR": { justNow: "agora mesmo", minAgo: (m) => `há ${m} min`, yesterday: "Ontem" },
  "it-IT": { justNow: "proprio ora", minAgo: (m) => `${m} min fa`, yesterday: "Ieri" },
  "de-DE": { justNow: "gerade eben", minAgo: (m) => `vor ${m} Min.`, yesterday: "Gestern" },
  "ja-JP": { justNow: "たった今", minAgo: (m) => `${m} 分前`, yesterday: "昨日" },
  "ko-KR": { justNow: "방금", minAgo: (m) => `${m}분 전`, yesterday: "어제" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "刚刚" / "12 分钟前" under an hour, then "11:02", "昨天 18:40", "10-03 18:40", "2025-10-03". */
export function formatWhen(unixSeconds: number, now: number, locale: Locale): string {
  const ms = unixSeconds * 1000;
  const diff = Math.max(0, now - ms);
  const l = LABELS[locale];
  if (diff < 60_000) return l.justNow;
  if (diff < 3_600_000) return l.minAgo(Math.floor(diff / 60_000));
  const d = new Date(ms);
  const today = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= dayStart) return clock;
  if (ms >= dayStart - 86_400_000) return `${l.yesterday} ${clock}`;
  if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Full local timestamp for tooltips: "2026-10-06 11:02:15". */
export function formatAbsolute(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Now (ms), re-rendering every second while `active` (live durations). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Shared clock for relative labels; ticks every 30 s. */
let clockNow = Date.now();
const subscribers = new Set<(n: number) => void>();
setInterval(() => {
  clockNow = Date.now();
  for (const s of subscribers) s(clockNow);
}, 30_000);

export function useClock(): number {
  const [now, setNow] = useState(clockNow);
  useEffect(() => {
    subscribers.add(setNow);
    return () => {
      subscribers.delete(setNow);
    };
  }, []);
  return now;
}
