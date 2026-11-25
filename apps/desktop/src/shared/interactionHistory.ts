// Answered questions and approvals cutex keeps (session-interaction-history-v1, owner TODO 2026-10-06): after a reload
// the timeline still has each one, once, in its own 回合. Main reads a page only on a host that has the feature; the
// renderer (store hydrateInteractions) reads the 回合 it shows, 50 at a time, following each cursor.

export const INTERACTION_HISTORY_FEATURE = "session-interaction-history-v1";
/** cutex's limits: at most 50 rows a page and 50 turn ids a filter. */
export const INTERACTION_PAGE_LIMIT = 50;
export const INTERACTION_TURN_CHUNK = 50;
/** A runaway cursor chain stops here (a chunk of 50 turns rarely has more than a page or two). */
export const INTERACTION_MAX_PAGES = 40;

export interface InteractionHistoryRequest {
  /** 1-50 native turn ids; omitted: the whole session. */
  turnIds?: readonly string[];
  cursor?: string | null;
  limit?: number;
}

/**
 * The one identity of a handled request in a host/session view, live or saved: its runtime generation and native
 * request id, the id's string / number type kept (`7` and `"7"` are different requests; so is `7` after a restart).
 */
export function interactionKey(runtimeGeneration: number, nativeId: string | number): string {
  return JSON.stringify([runtimeGeneration, nativeId]);
}

/** The capability as cutex says it: the feature list, or `features.sessionInteractionHistoryV1`. */
export function hasInteractionHistory(caps: { featureList?: readonly string[] | null; features?: Record<string, unknown> | null } | null | undefined): boolean {
  return !!caps && (caps.featureList?.includes(INTERACTION_HISTORY_FEATURE) === true || caps.features?.sessionInteractionHistoryV1 === true);
}
