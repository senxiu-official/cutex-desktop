// Long histories render only their latest turns: a 1000-turn agent otherwise puts 80k+ nodes in the
// page and every update re-reconciles all of it (measured on a Linux host, 2026-10-07).
import type { TimelineEntry, TurnView } from "./timeline";

/** Entries of the last `limit` turns (and anything after them), plus how many turns are left out. */
export function recentEntries(entries: TimelineEntry[], turns: TurnView[], limit: number): { entries: TimelineEntry[]; hiddenTurns: number } {
  if (limit <= 0 || turns.length <= limit) return { entries, hiddenTurns: 0 };
  const kept = new Set(turns.slice(turns.length - limit).map((t) => t.id));
  const start = entries.findIndex((e) => e.turnId != null && kept.has(e.turnId));
  if (start <= 0) return { entries, hiddenTurns: 0 };
  return { entries: entries.slice(start), hiddenTurns: turns.length - limit };
}
