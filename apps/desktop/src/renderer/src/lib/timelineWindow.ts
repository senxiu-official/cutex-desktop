// Long histories render only their latest turns: a 1000-turn agent otherwise puts 80k+ nodes in the
// page and every update re-reconciles all of it (measured on a Linux host, 2026-10-07).
import type { TimelineEntry, TimelineState, TurnView } from "./timeline";
import { TimelineEntries } from "./timelineEntries";

export interface TimelineWindow {
  entries: TimelineEntry[];
  turns: TurnView[];
  hiddenTurns: number;
}

/** One cache per mounted view. Weak turn keys do not extend the loaded turns' lifetime. Native turns
 * mutate in place, so cache validity uses the entry Map's per-turn revision, not turn identity.
 * Plain Maps still validate the visible entries by identity for public/helper callers. */
export function createTimelineWindow(): (state: TimelineState, limit: number) => TimelineWindow {
  const cache = new WeakMap<TurnView, { map: TimelineState["entries"]; revision: number | undefined; ids: string[]; length: number; entries: TimelineEntry[] }>();
  return (state: TimelineState, limit: number): TimelineWindow => {
    const start = limit > 0 ? Math.max(0, state.turns.length - limit) : 0;
    const turns = state.turns.slice(start);
    const entries: TimelineEntry[] = [];
    for (const turn of turns) {
      const revision = state.entries instanceof TimelineEntries ? state.entries.revision(turn.id) : undefined;
      const previous = cache.get(turn);
      let page: TimelineEntry[];
      if (revision !== undefined && previous?.map === state.entries && previous.revision === revision && previous.ids === turn.entryIds && previous.length === turn.entryIds.length) page = previous.entries;
      else {
        page = [];
        for (const id of turn.entryIds) {
          const entry = state.entries.get(id);
          if (entry) page.push(entry);
        }
        if (previous?.entries.length === page.length && page.every((entry, index) => entry === previous.entries[index])) page = previous.entries;
        cache.set(turn, { map: state.entries, revision, ids: turn.entryIds, length: turn.entryIds.length, entries: page });
      }
      for (const entry of page) entries.push(entry);
    }
    // Empty kept turns used to make recentEntries return the complete history. Keep that rare
    // fallback (and hiddenTurns=0) without touching hidden pages on the normal nonempty path.
    if (start > 0 && entries.length === 0) return createTimelineWindow()(state, 0);
    return { entries, turns, hiddenTurns: start };
  };
}

/** Entries of the last `limit` turns (and anything after them), plus how many turns are left out. */
export function recentEntries(entries: TimelineEntry[], turns: TurnView[], limit: number): { entries: TimelineEntry[]; hiddenTurns: number } {
  if (limit <= 0 || turns.length <= limit) return { entries, hiddenTurns: 0 };
  const kept = new Set(turns.slice(turns.length - limit).map((t) => t.id));
  const start = entries.findIndex((e) => e.turnId != null && kept.has(e.turnId));
  if (start <= 0) return { entries, hiddenTurns: 0 };
  return { entries: entries.slice(start), hiddenTurns: turns.length - limit };
}
