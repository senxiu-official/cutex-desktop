// Context window / auto-compact presets for the Profiles page (DESIGN §4.5 "Context settings").
export const WINDOW_PRESETS = [128_000, 200_000, 256_000, 400_000, 500_000, 1_000_000] as const;
export const COMPACT_PERCENTS = [70, 80, 90] as const;

/** 256000 → "256K", 1000000 → "1M". */
export function formatWindow(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}K`;
}

/** Parse "256k", "1m", "300000" → tokens; null when empty/invalid. */
export function parseWindow(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1000 : 1);
  return Number.isSafeInteger(Math.round(n)) && Math.round(n) > 0 ? Math.round(n) : null;
}

/** Which compact percent preset a limit corresponds to for a window, if any. */
export function compactPercentOf(limit: number | null, window: number | null): number | null {
  if (!limit || !window) return null;
  const pct = Math.round((limit / window) * 100);
  return (COMPACT_PERCENTS as readonly number[]).includes(pct) && Math.abs(limit - (window * pct) / 100) < 1000 ? pct : null;
}
