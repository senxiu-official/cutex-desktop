// How an old-task result reads (components/SidebarSessionSearch): the host's title and excerpt stay plain text; the
// searched words are marked by splitting the text, never by markup from the host.

/** `text` cut into runs, `hit` where it matches `q` (case-insensitive, literal like cutex). */
export function matchRuns(text: string, q: string): { text: string; hit: boolean }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const runs: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) runs.push({ text: text.slice(from, at), hit: false });
    runs.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) runs.push({ text: text.slice(from), hit: false });
  return runs.length ? runs : [{ text, hit: false }];
}

/** The excerpt adds something the title does not already say (a short message is its own title and excerpt). */
export function snippetAdds(title: string, snippet: string): boolean {
  const s = snippet.replace(/^…|…$/g, "").trim();
  return s !== "" && !title.includes(s);
}

// ---- order, groups and time of old-task results (sidebar and the search page) ----

type HitTimes = { cutexSessionId: string; connectionId: string; updatedAt: string; turnStartedAt?: string; turnCompletedAt?: string };

/** The result's own time: when its turn started (else ended), as the host sent it; null when the host does not say. */
export function hitTurnMs(hit: Pick<HitTimes, "turnStartedAt" | "turnCompletedAt">): number | null {
  for (const at of [hit.turnStartedAt, hit.turnCompletedAt]) {
    const ms = at ? Date.parse(at) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * Newest first, over the results found so far. By the turn's time where the host sends it; otherwise by the agent's
 * last update (session-search-v1 gives no turn time), keeping the host's order within an agent (newest turn first).
 * Stable: equal keys keep their arrival order.
 */
export function newestFirst<T extends HitTimes>(hits: readonly T[]): T[] {
  const keyOf = (h: T) => hitTurnMs(h) ?? (Number.isFinite(Date.parse(h.updatedAt)) ? Date.parse(h.updatedAt) : 0);
  return hits.map((h, i) => ({ h, i, k: keyOf(h) })).sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.h);
}

export interface HitGroup<T> {
  /** JSON [connectionId, cutexSessionId]. */
  key: string;
  connectionId: string;
  cutexSessionId: string;
  hits: T[];
}

/** By agent, each agent where its newest result is (the order of `hits`), its results in that order. */
export function groupByAgent<T extends HitTimes>(hits: readonly T[]): HitGroup<T>[] {
  const groups = new Map<string, HitGroup<T>>();
  for (const h of hits) {
    const key = JSON.stringify([h.connectionId, h.cutexSessionId]);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, connectionId: h.connectionId, cutexSessionId: h.cutexSessionId, hits: [] }));
    g.hits.push(h);
  }
  return [...groups.values()];
}

/**
 * 发送方 (owner 2026-11-26): only what the owner sent, only what agents sent, or all. session-search-v1 cannot filter
 * by sender (it matches a turn's first input and last reply and does not say who sent the input), so the control is
 * shown greyed with why until a host can.
 */
export const SENDER_FILTERS = ["all", "owner", "agents"] as const;
export type SenderFilter = (typeof SENDER_FILTERS)[number];

// ---- session-search-v2 filters (cutex r297): what the controls hold, and the query fields they make ----

export const TIME_PRESETS = ["any", "day", "week", "month", "quarter"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];
const PRESET_DAYS: Record<Exclude<TimePreset, "any">, number> = { day: 1, week: 7, month: 30, quarter: 90 };

/** The filter controls' state (sidebar and page). `custom` (page only): local dates `from` … `to`, both days included. */
export interface SearchFilterChoice {
  sender: SenderFilter;
  kind: "all" | "messages" | "delegations" | "results";
  time: TimePreset | "custom";
  from?: string;
  to?: string;
}
export const NO_FILTERS: SearchFilterChoice = { sender: "all", kind: "all", time: "any" };

/** Local midnight of a `yyyy-mm-dd` day (plus `days`) as RFC 3339 UTC; undefined for anything else. */
export function localDayIso(day: string | undefined, days = 0): string | undefined {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return undefined;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return Number.isFinite(at.valueOf()) ? at.toISOString() : undefined;
}

/** The choice as v2 query filters (times worked out now; a range that ends before it starts is dropped). */
export function filtersOf(choice: SearchFilterChoice, now = Date.now()): import("../../../shared/sessionSearch").SearchV2Filters {
  const out: import("../../../shared/sessionSearch").SearchV2Filters = {};
  if (choice.sender !== "all") out.sender = choice.sender === "owner" ? "owner" : "agent";
  if (choice.kind !== "all") out.kind = choice.kind;
  if (choice.time === "custom") {
    const since = localDayIso(choice.from), until = localDayIso(choice.to, 1);
    if (since && until && Date.parse(since) >= Date.parse(until)) return out;
    if (since) out.since = since;
    if (until) out.until = until;
  } else if (choice.time !== "any") {
    out.since = new Date(now - PRESET_DAYS[choice.time] * 86_400_000).toISOString();
  }
  return out;
}
