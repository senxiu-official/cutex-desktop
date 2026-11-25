// The search page (modules/session-search, owner 2026-11-26): its page id and params, kept out of the module and the
// sidebar components (Fast Refresh; the sidebar's 在页面中查找 opens it).
import type { PageParams } from "../modules/types";

export const SESSION_SEARCH_PAGE = "session-search.page";

export type SearchLayout = "time" | "agent";

export interface SearchPageParams {
  q: string;
  /** A connection id ("" = every capable host of the view). */
  host: string;
  archived: boolean;
}

export function searchPageParams(params: PageParams): SearchPageParams {
  return { q: (params.q ?? "").slice(0, 128), host: params.host ?? "", archived: params.archived === "1" };
}
