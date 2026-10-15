// Pure helpers for the usage page: series per bucket, weekly buckets, axis scale, smooth paths.
import type { UsageReport } from "../../../../shared/ipc";
import { seriesName } from "../../lib/usage";

export type Split = "total" | "profile" | "model" | "agent" | "project" | "source" | "host";
export type Metric = "tokens" | "cost";
export type ChartMode = "line" | "stacked";
/** Token types the 「总计」 view stacks: cache reads, fresh (uncached) input, output. */
export const TOKEN_TYPES = ["cached", "fresh", "output"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

// Hues spread far apart so neighbouring series never read as one colour.
const PALETTE = ["#4c8dff", "#f2a33a", "#3cc48a", "#e8618c", "#9b7bff", "#8a8f98", "#22b8cf", "#fd7e14"];
const TOKEN_COLORS: Record<TokenType, string> = { cached: "#22b8cf", fresh: "#4c8dff", output: "#f2a33a" };
export const OTHER = "…";

export function seriesColor(series: readonly string[], name: string): string {
  if (name in TOKEN_COLORS) return TOKEN_COLORS[name as TokenType];
  const i = series.indexOf(name);
  return PALETTE[(i < 0 ? series.length - 1 : i) % PALETTE.length]!;
}

/** Chart buckets: one per day, or calendar weeks (ending today) once the range is long. */
export function buckets(days: string[]): { label: string; days: string[] }[] {
  if (days.length <= 45) return days.map((d) => ({ label: d, days: [d] }));
  const out: { label: string; days: string[] }[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const slice = days.slice(Math.max(0, end - 7), end);
    out.unshift({ label: slice[0]!, days: slice });
  }
  return out;
}

/**
 * Values per (series, bucket). Under 「总计」 the series are the token types (tokens) or one
 * "cost" line; under a split, the top 5 names by the metric plus "…" for the rest.
 */
export function buildSeries(report: UsageReport, split: Split, bks: { days: string[] }[], metric: Metric) {
  const dayIndex = new Map<string, number>();
  bks.forEach((b, i) => b.days.forEach((d) => dayIndex.set(d, i)));
  const cost = (r: UsageReport["rows"][number]) => r.estimatedCost ?? 0;
  if (split === "total") {
    const series: string[] = metric === "cost" ? ["cost"] : [...TOKEN_TYPES];
    const values = series.map(() => bks.map(() => 0));
    for (const r of report.rows) {
      const bi = r.key.day ? dayIndex.get(r.key.day) : undefined;
      if (bi === undefined) continue;
      if (metric === "cost") values[0]![bi]! += cost(r);
      else {
        values[0]![bi]! += r.cachedInput;
        values[1]![bi]! += Math.max(0, r.input - r.cachedInput);
        values[2]![bi]! += r.output;
      }
    }
    return { series, values };
  }
  const value = (r: UsageReport["rows"][number]) => (metric === "cost" ? cost(r) : r.total);
  const totals = new Map<string, number>();
  for (const r of report.rows) totals.set(seriesName(r.key, split), (totals.get(seriesName(r.key, split)) ?? 0) + value(r));
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const series = ranked.length > 6 ? [...ranked.slice(0, 5), OTHER] : ranked;
  const values = series.map(() => bks.map(() => 0));
  for (const r of report.rows) {
    const bi = r.key.day ? dayIndex.get(r.key.day) : undefined;
    if (bi === undefined) continue;
    let si = series.indexOf(seriesName(r.key, split));
    if (si < 0) si = series.length - 1;
    values[si]![bi]! += value(r);
  }
  return { series, values };
}

/** Running sums bottom-up (series 0 at the bottom) for a stacked area chart. */
export function stack(values: number[][]): number[][] {
  const out: number[][] = [];
  values.forEach((row, si) => out.push(row.map((v, i) => v + (si ? out[si - 1]![i]! : 0))));
  return out;
}

/** A "nice" axis maximum and tick step (1/2/2.5/5 × 10^n) with about `ticks` intervals. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}

/** SVG path through points with monotone cubic interpolation (never overshoots, so no dips below 0). */
export function smoothPath(pts: [number, number][], move = true): string {
  if (pts.length === 0) return "";
  const head = `${move ? "M" : "L"}${pts[0]![0]},${pts[0]![1]}`;
  if (pts.length === 1) return head;
  const n = pts.length;
  const slope = (i: number) => (pts[i + 1]![1] - pts[i]![1]) / (pts[i + 1]![0] - pts[i]![0]);
  const m: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) m.push(slope(0));
    else if (i === n - 1) m.push(slope(n - 2));
    else {
      const a = slope(i - 1);
      const b = slope(i);
      m.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
    }
  }
  let d = head;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1]![0] - pts[i]![0]) / 3;
    d += ` C${pts[i]![0] + h},${pts[i]![1] + m[i]! * h} ${pts[i + 1]![0] - h},${pts[i + 1]![1] - m[i + 1]! * h} ${pts[i + 1]![0]},${pts[i + 1]![1]}`;
  }
  return d;
}

/** Currencies the price table offers (owner: AUD / CNY / USD). */
export const CURRENCIES = ["AUD", "CNY", "USD"] as const;
const SYMBOL: Record<string, string> = { USD: "$", AUD: "A$", CNY: "¥" };

/** "$2.35" / "A$3.10" / "¥18.42"; tiny amounts read "<$0.01". */
export function formatMoney(n: number, currency: string | undefined): string {
  const sym = currency ? SYMBOL[currency] : undefined;
  const fmt = (v: string) => (sym ? `${sym}${v}` : `${currency ?? ""} ${v}`.trim());
  if (n > 0 && n < 0.01) return `<${fmt("0.01")}`;
  return fmt(n >= 100 ? n.toFixed(0) : n.toFixed(2));
}

/** Relative change, or null when there is nothing to compare with. */
export function change(now: number, before: number | undefined): number | null {
  return before && before > 0 ? (now - before) / before : null;
}

/** Separator for a list of names in running text ("a、b" in Chinese, "a, b" in English). */
export function listSep(locale: string): string {
  return locale.startsWith("zh") ? "、" : ", ";
}

/** Remaining share 0..1 of a window quota (cutex reports remainingPercent), or null when unknown. */
export function remainingRatio(remainingPercent: number | null): number | null {
  return remainingPercent === null ? null : Math.min(100, Math.max(0, remainingPercent)) / 100;
}

/** Bar colour by what is left: accent, amber under 40 %, red under 15 % (same cut-offs as "used" 60 / 85 %). */
export function remainingColor(ratio: number): string {
  return ratio < 0.15 ? "var(--danger)" : ratio < 0.4 ? "var(--warn)" : "var(--accent)";
}
