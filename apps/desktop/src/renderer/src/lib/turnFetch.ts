// Finding one turn for the reference card and for jumps (docs/desktop-modules.md §19.4; RFC §7.4, §7.8).
// Order: the agent's loaded timeline → the reference cache → (C-T1 single-turn read, not in cutex
// yet) → history pages back from the loaded timeline's cursor, at most `maxPages` pages of 200. Pages
// read here go to the reference cache (per agent, in memory, the last 3), never into the main
// timeline, so reading turn 36 while at turn 250 moves nothing; a later jump reuses them.
// Pure (the page reader and the clock are injected); app wiring is lib/turnRefs.ts.
import type { SessionHistory } from "@cutex-desktop/protocol";
import { timelineFromThreadRead, type TimelineState, type TurnView } from "./timeline";

/** ★ 5 pages of 200 = 1000 turns (§13). */
export const LOOKUP_PAGES = 5;
export const LOOKUP_PAGE_TURNS = 200;
/** Pages kept per agent. */
export const CACHE_PAGES = 3;
/** A cached page older than this is read again (turns may have been reverted). */
export const CACHE_TTL_MS = 10 * 60_000;

/** Reads one history page; `cursor` null = the newest page. null = no stored history. */
export type PageReader = (cursor: string | null) => Promise<SessionHistory | null>;

/** The reference cache: the last few pages read per agent, keyed by the cursor they were read at. */
export class PageCache {
  private readonly agents = new Map<string, { cursor: string | null; page: SessionHistory; at: number }[]>();
  constructor(
    private readonly limit = CACHE_PAGES,
    private readonly now: () => number = Date.now,
  ) {}
  get(agent: string, cursor: string | null): SessionHistory | null {
    const list = this.agents.get(agent);
    const hit = list?.find((e) => e.cursor === cursor);
    if (!hit) return null;
    if (this.now() - hit.at > CACHE_TTL_MS) {
      this.agents.set(agent, list!.filter((e) => e !== hit));
      return null;
    }
    return hit.page;
  }
  put(agent: string, cursor: string | null, page: SessionHistory): void {
    const list = (this.agents.get(agent) ?? []).filter((e) => e.cursor !== cursor);
    list.push({ cursor, page, at: this.now() });
    this.agents.set(agent, list.slice(-this.limit));
  }
  clear(agent?: string): void {
    if (agent === undefined) this.agents.clear();
    else this.agents.delete(agent);
  }
}

/** A timeline holding only `turnId` (entries shared with `source`); null when it is not there. */
export function singleTurn(source: TimelineState, turnId: string): { timeline: TimelineState; turn: TurnView; index: number } | null {
  const index = source.turns.findIndex((t) => t.id === turnId);
  if (index < 0) return null;
  const turn = source.turns[index]!;
  const entries = new Map(turn.entryIds.flatMap((id) => (source.entries.has(id) ? [[id, source.entries.get(id)!] as const] : [])));
  const timeline: TimelineState = {
    ...source,
    turns: [turn],
    entries,
    pending: new Map(),
    answering: new Set(),
    activeTurnId: source.activeTurnId === turnId ? turnId : null,
  };
  return { timeline, turn, index };
}

export interface FoundTurn {
  timeline: TimelineState;
  turn: TurnView;
  /** 1-based, when known (the whole history up to it was seen), else the ref's ordinal param, else null. */
  ordinal: number | null;
  from: "loaded" | "cache" | "pages";
}

export type TurnLookup = { status: "found"; found: FoundTurn } | { status: "not-found"; reason: "reverted" | "too-old" | "unknown" };

export interface LookupInput {
  agent: string; // cache key (host + session)
  turnId: string;
  /** From the ref: the native thread the turn belonged to; another thread now = the turn is gone. */
  threadId?: string | null;
  /** From the ref (C-T2 later): shown when the lookup cannot tell. */
  ordinal?: number | null;
  /** The agent's loaded view; null = not loaded (start from the newest page). */
  loaded: { timeline: TimelineState; olderCursor: string | null; complete: boolean } | null;
  cache: PageCache;
  read: PageReader;
  maxPages?: number;
}

export async function findTurn(i: LookupInput): Promise<TurnLookup> {
  const hint = i.ordinal ?? null;
  const otherThread = (threadId: string | null | undefined) => !!i.threadId && !!threadId && threadId !== i.threadId;
  if (i.loaded) {
    const hit = singleTurn(i.loaded.timeline, i.turnId);
    if (hit) return { status: "found", found: { timeline: hit.timeline, turn: hit.turn, ordinal: i.loaded.complete ? hit.index + 1 : hint, from: "loaded" } };
    if (otherThread(i.loaded.timeline.threadId)) return { status: "not-found", reason: "reverted" };
    if (i.loaded.complete) return { status: "not-found", reason: "reverted" };
  }
  let cursor: string | null = i.loaded ? i.loaded.olderCursor : null;
  const max = i.maxPages ?? LOOKUP_PAGES;
  for (let n = 0; n < max; n++) {
    const cached = i.cache.get(i.agent, cursor);
    const page = cached ?? (await i.read(cursor));
    if (!page) return { status: "not-found", reason: "unknown" };
    if (!cached) i.cache.put(i.agent, cursor, page);
    const timeline = timelineFromThreadRead(page.native.result);
    if (otherThread(timeline.threadId ?? page.threadId)) return { status: "not-found", reason: "reverted" };
    const first = !page.page.hasMore || !page.page.nextCursor;
    const hit = singleTurn(timeline, i.turnId);
    if (hit) return { status: "found", found: { timeline: hit.timeline, turn: hit.turn, ordinal: first ? hit.index + 1 : hint, from: cached ? "cache" : "pages" } };
    if (first) return { status: "not-found", reason: "reverted" };
    if (page.page.nextCursor === cursor) return { status: "not-found", reason: "unknown" };
    cursor = page.page.nextCursor;
  }
  return { status: "not-found", reason: "too-old" };
}
