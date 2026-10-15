// Goal token budget as typed in the goal editor: "200k", "1.5M", "50000", or empty for no budget (∞).
// Pure helpers (unit-tested); native `thread/goal/set` takes `tokenBudget: number` to set it and
// `null` to clear it.

/** Budget → editor text ("" = none). */
export function budgetText(budget: number | null | undefined): string {
  if (!budget) return "";
  if (budget >= 1_000_000 && budget % 100_000 === 0) return `${budget / 1_000_000}M`;
  if (budget >= 1000 && budget % 100 === 0) return `${budget / 1000}k`;
  return String(budget);
}

/** Editor text → budget: a positive integer, `null` for empty (no budget), `undefined` if invalid. */
export function parseBudget(text: string): number | null | undefined {
  const s = text.trim().replace(/[,_\s]/g, "").toLowerCase();
  if (!s || s === "∞") return null;
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(s);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * (m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1000 : 1));
  return n > 0 ? n : undefined;
}

export function formatGoalTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Goal time used: "13s", "4m", "1h 47m". */
export function formatGoalSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m` : `${Math.round(s)}s`;
}
