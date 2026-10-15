// Price table 「按另一个模型计价」 (cutex `usage-model-map`, docs/usage-pricing.md §2a in cutex): rows
// `from → to` price model `from` as model `to`, with whatever price `to` has (manual entry, price
// library, built-in card). cutex validates again; these checks only give the owner the reason early.
import type { UsagePrices, UsageReport } from "../../../../shared/ipc";

export const MODEL_MAP_FEATURE = "usage-model-map";
/** cutex's limit (prices.rs MAX_MODEL_MAP_ENTRIES). */
export const MAX_MODEL_MAP = 256;

export interface MapDraft {
  from: string;
  to: string;
}

export type MapProblem = "self" | "duplicate" | "chain" | "priced" | "empty" | "tooMany";

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** First problem of each row (index → problem); rows with both names empty are ignored. */
export function mapProblems(rows: readonly MapDraft[], manualNames: Iterable<string>): Map<number, MapProblem> {
  const manual = new Set([...manualNames].map(lower));
  const used = rows.map((r, i) => ({ ...r, i })).filter((r) => r.from.trim() || r.to.trim());
  const froms = new Map<string, number>();
  for (const r of used) if (r.from.trim() && !froms.has(lower(r.from))) froms.set(lower(r.from), r.i);
  const out = new Map<number, MapProblem>();
  if (used.length > MAX_MODEL_MAP) for (const r of used.slice(MAX_MODEL_MAP)) out.set(r.i, "tooMany");
  for (const r of used) {
    if (out.has(r.i)) continue;
    const from = lower(r.from);
    const to = lower(r.to);
    const problem: MapProblem | null = !from || !to ? "empty" : from === to ? "self" : froms.get(from) !== r.i ? "duplicate" : manual.has(from) ? "priced" : froms.has(to) ? "chain" : null;
    if (problem) out.set(r.i, problem);
  }
  return out;
}

/** The `modelMap` to PUT (trimmed, empty rows dropped). */
export function buildModelMap(rows: readonly MapDraft[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) if (r.from.trim() && r.to.trim()) map[r.from.trim()] = r.to.trim();
  return map;
}

export function mapDrafts(prices: UsagePrices): MapDraft[] {
  return Object.entries(prices.modelMap ?? {}).map(([from, to]) => ({ from, to }));
}

/**
 * Suggestions: `from` = the range's unpriced models first, then the other used models; `to` = the
 * manual table's models and the used models that have a price. Names already mapped are skipped.
 */
export function mapSuggestions(unpriced: readonly string[], used: readonly string[], prices: UsagePrices, rows: readonly MapDraft[]): { from: string[]; to: string[] } {
  const mapped = new Set(rows.map((r) => lower(r.from)).filter(Boolean));
  const unpricedSet = new Set(unpriced.map(lower));
  const uniq = (list: string[]) => [...new Map(list.filter((m) => lower(m)).map((m) => [lower(m), m])).values()];
  const priced = manualNames(prices.models);
  const from = uniq([...unpriced, ...used]).filter((m) => !mapped.has(lower(m)) && !priced.has(lower(m)));
  const to = uniq([...Object.keys(prices.models), ...used.filter((m) => !unpricedSet.has(lower(m)) && !mapped.has(lower(m)))]);
  return { from, to };
}

/** Lowercased manual keys and aliases (a mapped name must not be one: cutex refuses it). */
export function manualNames(models: UsagePrices["models"]): Set<string> {
  const out = new Set<string>();
  for (const [key, price] of Object.entries(models)) {
    out.add(lower(key));
    for (const alias of price.aliases ?? []) out.add(lower(alias));
  }
  return out;
}

/** Shown series name → the models its rows were priced as (`pricedAs`, rows of one name merged). */
export function pricedAsByName(rows: UsageReport["rows"], nameOf: (row: UsageReport["rows"][number]) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.pricedAs?.length) continue;
    const name = nameOf(row);
    const list = out.get(name) ?? [];
    for (const to of row.pricedAs) if (!list.includes(to)) list.push(to);
    out.set(name, list);
  }
  return out;
}
