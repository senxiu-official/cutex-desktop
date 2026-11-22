import { cloneLiveDeltas } from "./liveDeltas";
// History pages (cutex `history-pages`; offline sessions via `offline-history`): a long thread
// opens with only its newest turns (bootstrap `?turnLimit=`, `historyPage`); older turns are read a
// page at a time (`GET /v2/sessions/{id}/history?cursor=`) when the user scrolls to the top, and
// prepended to the live timeline. Without the capability cutex sends every turn (no paging). Pure.
import type { HistoryPage } from "@cutex-desktop/protocol";
import { timelineFromThreadRead, type TimelineState } from "./timeline";
import { TimelineEntries } from "./timelineEntries";

/** Paging state of a session view; null when the whole history is loaded (or cannot be paged). */
export interface OlderHistory {
  /** `nextCursor` of the oldest loaded page; null once the thread's first turn is loaded. */
  cursor: string | null;
  loading: boolean;
  error: string | null;
  /** Turns prepended by paging; the render window grows by these so they show up at once. */
  added: number;
}

/** cutex caps `turnLimit` / history `limit` at 200. */
export const MAX_PAGE_TURNS = 200;

/** Turns re-read when checking whether a steer was recorded (it sits in the turn that just ended). */
export const STEER_CHECK_TURNS = 10;
/** Interrupt & send re-checks only the stopped turn's steers: the newest turn (one more for margin). */
export const INTERRUPT_STEER_CHECK_TURNS = 2;

/**
 * Page size from the 长对话 pref (Settings → 通用): the turns rendered first are the turns fetched
 * first. 0 (全部) → undefined: one full bootstrap, no paging.
 */
export function historyPageSize(timelineTurns: number): number | undefined {
  if (!Number.isFinite(timelineTurns) || timelineTurns <= 0) return undefined;
  return Math.min(MAX_PAGE_TURNS, Math.max(1, Math.round(timelineTurns)));
}

/** Paging state after the first page; null when cutex did not page (older cutex: every turn sent). */
export function olderFromPage(page: HistoryPage | null | undefined): OlderHistory | null {
  if (!page) return null;
  return { cursor: page.hasMore && page.nextCursor ? page.nextCursor : null, loading: false, error: null, added: 0 };
}

/**
 * Paging state after the page read at `requested` arrived with `added` new turns. A cursor that
 * comes back unchanged ends paging (never re-requests the same page forever).
 */
export function olderAfterPage(prev: OlderHistory | null, page: HistoryPage, added: number, requested: string): OlderHistory {
  const next = page.hasMore && page.nextCursor && page.nextCursor !== requested ? page.nextCursor : null;
  return { cursor: next, loading: false, error: null, added: (prev?.added ?? 0) + added };
}

/**
 * Prepend an older page (`thread/read` shape, turns oldest first) to `state` in place. Turns and
 * items already present are skipped (a page may overlap after the thread grew). Returns how many
 * turns were added; 0 for another thread's page.
 */
export function prependHistory(state: TimelineState, result: unknown): number {
  const older = timelineFromThreadRead(result);
  if (state.threadId && older.threadId && older.threadId !== state.threadId) return 0;
  const known = new Set(state.turns.map((t) => t.id));
  const fresh = older.turns.filter((t) => !known.has(t.id));
  for (const turn of fresh) {
    turn.entryIds = turn.entryIds.filter((id) => !state.entries.has(id));
    for (const id of turn.entryIds) state.entries.set(id, older.entries.get(id)!);
  }
  if (fresh.length) state.turns = [...fresh, ...state.turns];
  state.threadId ??= older.threadId;
  return fresh.length;
}

/** A copy of `state` (turns / entries; the copy can be extended without touching the view). */
export function cloneTimeline(state: TimelineState): TimelineState {
  return { ...state, ...(state.liveDeltas ? { liveDeltas: cloneLiveDeltas(state.liveDeltas) } : {}), turns: state.turns.map((t) => ({ ...t, entryIds: [...t.entryIds] })), entries: state.entries instanceof TimelineEntries ? new TimelineEntries(state.entries) : new Map(state.entries), pending: new Map(state.pending), answering: new Set(state.answering) };
}

/**
 * A re-read of an open (or cached) agent returns only the newest turns: the older turns it showed —
 * paged in earlier, or simply more than the fresh window — would vanish from the screen once the fresh
 * timeline replaced the cached one (the owner saw them, then they were gone). They are finished
 * history, so they are kept in front of the fresh window, in place, when the fresh window's first turn
 * is one of them (same thread, contiguous). Returns the paging state to keep (the cached one), or null
 * when nothing was kept (another thread, no overlap, a reverted range or a turn still running).
 */
export function keepPagedTurns(fresh: TimelineState, previous: TimelineState | null | undefined, previousOlder: OlderHistory | null | undefined): OlderHistory | null {
  if (!previous || !fresh.threadId || previous.threadId !== fresh.threadId) return null;
  const anchor = fresh.turns[0]?.id;
  const at = anchor ? previous.turns.findIndex((t) => t.id === anchor) : -1;
  if (at <= 0) return null;
  const kept = previous.turns.slice(0, at);
  if (kept.some((t) => t.status === "inProgress")) return null;
  // Turns the fresh window adds after the cached ones: the render window grows by them too, so every turn
  // shown before stays shown (Timeline renders the newest `limit + added`).
  const newAtEnd = Math.max(0, fresh.turns.length - (previous.turns.length - at));
  const known = new Set(fresh.turns.map((t) => t.id));
  const turns = kept.filter((t) => !known.has(t.id)).map((t) => ({ ...t, entryIds: t.entryIds.filter((id) => !fresh.entries.has(id) && previous.entries.has(id)) }));
  for (const turn of turns) for (const id of turn.entryIds) fresh.entries.set(id, previous.entries.get(id)!);
  fresh.turns = [...turns, ...fresh.turns];
  return { cursor: previousOlder?.cursor ?? null, loading: false, error: null, added: (previousOlder?.added ?? 0) + newAtEnd };
}
