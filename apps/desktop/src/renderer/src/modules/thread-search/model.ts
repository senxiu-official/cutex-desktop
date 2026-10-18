// Pure helpers of the conversation search (native `thread/searchOccurrences`; cutex
// `thread-search-occurrences`). No React, no store: unit-tested.
import type { ThreadSearchHit } from "../../../../shared/ipc";

export const SEARCH_GUTTER_ID = "thread-search.gutter";
export const THREAD_SEARCH_CAPABILITY = "thread-search-occurrences";

/** The snippet split around its match (`snippetMatchRange` is UTF-16, like JS string indices). */
export function splitSnippet(hit: Pick<ThreadSearchHit, "snippet" | "snippetMatchRange">): { before: string; match: string; after: string } {
  const text = hit.snippet ?? "";
  const range = hit.snippetMatchRange;
  const start = Number.isInteger(range?.start) ? Math.min(Math.max(range.start, 0), text.length) : 0;
  const end = Number.isInteger(range?.end) ? Math.min(Math.max(range.end, start), text.length) : start;
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}

/** What a failed search means for the owner. */
export function searchErrorKind(error: unknown): "unsupported" | "offline" | "other" {
  const message = error instanceof Error ? error.message : String(error);
  if (/session_offline|app_server_unavailable|no connected app-server|no bound app-server/i.test(message)) return "offline";
  // Older natives: JSON-RPC method not found / an unknown request variant; older cutex: method denied.
  if (/native_-3260[01]\b|-32601|method not found|unknown variant|native_method_denied|agent_feature_unsupported/i.test(message)) return "unsupported";
  return "other";
}

/** The term to search for, or null when there is nothing to search. */
export function searchTerm(query: string): string | null {
  const term = query.trim();
  return term ? term.slice(0, 2048) : null;
}
