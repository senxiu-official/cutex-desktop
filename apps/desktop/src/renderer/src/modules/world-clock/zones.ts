// Time-zone arithmetic for the world clock (pure; test/worldClock.test.ts). Intl only — no tz database of our own.
import { formatDate } from "../../lib/dateText";

/** The zone's wall-clock date as `YYYY-MM-DD` at `at`. */
export function dayIn(tz: string, at: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The zone's offset from UTC at `at`, in minutes (e.g. Australia/Sydney in October: +660). */
export function offsetMinutes(tz: string, at: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/** Days between the zone's date and the local zone's date: -1 (yesterday), 0, 1 (tomorrow). */
export function dayDiff(tz: string, localTz: string, at: number): number {
  const a = Date.parse(dayIn(tz, at));
  const b = Date.parse(dayIn(localTz, at));
  return Math.round((a - b) / 86_400_000);
}

/** Hours the zone is ahead (+) or behind (-) the local zone (half hours kept, e.g. +2.5). */
export function hourDiff(tz: string, localTz: string, at: number): number {
  return (offsetMinutes(tz, at) - offsetMinutes(localTz, at)) / 60;
}

/** The time in the zone, as the locale writes it (24 h unless `hour12`). */
export function timeIn(tz: string, at: number, locale: string, hour12: boolean): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12 }).format(at);
}

/** The date line in the zone: 「10月22日 周四」, "Thu, October 22" (lib/dateText: no stray spaces in CJK dates). */
export function dateIn(tz: string, at: number, locale: string): string {
  return formatDate(at, locale, { timeZone: tz, month: "long", day: "numeric", weekday: "short" });
}

/** The IANA zones this runtime lists (the settings' picker). */
export function knownZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}
