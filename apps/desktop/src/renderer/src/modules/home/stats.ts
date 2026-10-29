// 桌面 / 个人页 statistics, computed in the desktop from `/v2/usage` day rows of every host this user has
// (home-page-20261019.md §3: approximate is fine): today, this week (Monday on), current and longest
// run of days with use, the total, and the one-year heatmap levels. Pure; test/homeStats.test.ts.
import type { UsageReport } from "../../../../shared/ipc";

/** `YYYY-MM-DD` of a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const parseDay = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

/** `days` days before `key`'s date (negative: after). */
export function daysBefore(key: string, days: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() - days);
  return dayKey(d);
}

/** Tokens per day, summed over the reports (any grouping that includes `day`; rows without a day are skipped). */
export function dailyTotals(reports: readonly (UsageReport | null | undefined)[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of reports) {
    for (const row of r?.rows ?? []) {
      const day = row.key.day;
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !(row.total > 0)) continue;
      out.set(day, (out.get(day) ?? 0) + row.total);
    }
  }
  return out;
}

export interface HomeStats {
  today: number;
  /** Monday of this week through today. */
  week: number;
  total: number;
  /** Days in a row with use, ending today — or yesterday while today has none yet. */
  currentStreak: number;
  longestStreak: number;
  /** Days with any use. */
  activeDays: number;
}

/** The statistics for `today` (`YYYY-MM-DD`, local). */
export function homeStats(days: ReadonlyMap<string, number>, today: string): HomeStats {
  const used = (k: string) => (days.get(k) ?? 0) > 0;
  const weekday = (parseDay(today).getDay() + 6) % 7; // Monday = 0
  let week = 0;
  for (let i = 0; i <= weekday; i++) week += days.get(daysBefore(today, i)) ?? 0;
  let total = 0;
  let activeDays = 0;
  for (const [k, v] of days) {
    if (k > today) continue;
    total += v;
    if (v > 0) activeDays++;
  }
  let currentStreak = 0;
  let cursor = used(today) ? today : daysBefore(today, 1);
  while (used(cursor)) {
    currentStreak++;
    cursor = daysBefore(cursor, 1);
  }
  let longestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of [...days.keys()].filter((k) => k <= today && used(k)).sort()) {
    run = prev !== null && daysBefore(k, 1) === prev ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = k;
  }
  return { today: days.get(today) ?? 0, week, total, currentStreak, longestStreak, activeDays };
}

export interface HeatCell {
  day: string;
  tokens: number;
  /** 0 = none, 1–4 = quartiles of the active days in view. */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today (the last column's tail): not drawn. */
  future: boolean;
}

/**
 * The heatmap: `weeks` columns of Monday → Sunday ending with this week; levels are the quartiles of
 * the active days shown (one sequential hue, light → dark), so a single huge day does not wash out the rest.
 */
export function heatWeeks(days: ReadonlyMap<string, number>, today: string, weeks = 53): HeatCell[][] {
  const weekday = (parseDay(today).getDay() + 6) % 7;
  const start = daysBefore(today, weekday + (weeks - 1) * 7);
  const cells: HeatCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = daysBefore(start, -i);
    cells.push({ day, tokens: days.get(day) ?? 0, level: 0, future: day > today });
  }
  const active = cells.filter((c) => !c.future && c.tokens > 0).map((c) => c.tokens).sort((a, b) => a - b);
  const q = (p: number) => active[Math.floor(p * (active.length - 1))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  for (const c of cells) {
    if (c.future || c.tokens <= 0) continue;
    c.level = c.tokens <= cuts[0]! ? 1 : c.tokens <= cuts[1]! ? 2 : c.tokens <= cuts[2]! ? 3 : 4;
  }
  const out: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) out.push(cells.slice(w * 7, w * 7 + 7));
  return out;
}

/** A compact token count for the stat tiles: 1,234 / 12.3K / 4.5M / 1.2B (locale digits via Intl). */
export function compactTokens(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}
