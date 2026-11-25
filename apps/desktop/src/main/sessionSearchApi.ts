// `GET /v2/sessions/search` (cutex r295, session-search-v1) through the pinned CutexClient: the query checked here
// (shared/sessionSearch), a background-priority read, and the reply's shape checked before the renderer sees it.
import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { DaemonApi } from "../shared/ipc";
import { CutexApiError } from "@cutex-desktop/cutex-client";
import { parseSessionSearchResponse, parseTurnPreview, SESSION_SEARCH_PATH, sessionSearchParams } from "../shared/sessionSearch";

const ID_MAX = 512;
// eslint-disable-next-line no-control-regex -- refuse control characters and path separators in ids
const okId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX && !/[\u0000-\u001f\u007f/]/.test(v);

export function sessionSearchApi(client: CutexClient): Pick<DaemonApi, "sessionSearch" | "sessionSearchTurn"> {
  return {
    async sessionSearch(query) {
      const params = sessionSearchParams(query);
      return parseSessionSearchResponse(await client.request("GET", SESSION_SEARCH_PATH, { query: params, background: true }));
    },
    // The search page's preview: one result's turn (history-turn-read, compact), reduced to plain text in main.
    async sessionSearchTurn(sessionId, turnId) {
      if (!okId(sessionId) || !okId(turnId)) throw new Error("session search: invalid turn");
      try {
        return parseTurnPreview(await client.historyTurn(sessionId, turnId, { compact: true }), turnId);
      } catch (e) {
        if (e instanceof CutexApiError && (e.status === 404 || e.status === 409)) return null;
        throw e;
      }
    },
  };
}
