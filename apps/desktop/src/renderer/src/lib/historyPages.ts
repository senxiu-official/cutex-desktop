// History pages (cutex `history-pages`; offline sessions via `offline-history`): a long thread
// opens with only its newest turns (bootstrap `?turnLimit=`, `historyPage`); older turns are read a
// page at a time (`GET /v2/sessions/{id}/history?cursor=`) when the user scrolls to the top, and
// prepended to the live timeline. Without the capability cutex sends every turn (no paging). Pure.
import type { HistoryPage } from "@cutex-desktop/protocol";
import { timelineFromThreadRead, type TimelineState } from "./timeline";

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
  return { ...state, turns: state.turns.map((t) => ({ ...t, entryIds: [...t.entryIds] })), entries: new Map(state.entries), pending: new Map(state.pending), answering: new Set(state.answering) };
}
