// Browser-preview data for the search page (modules/session-search): one result's turn (cutex history-turn-read) from
// the core's scripted threads, reduced like main does (shared/sessionSearch parseTurnPreview). The search itself is the
// core's (dev/mockSessionSearch).
import { parseTurnPreview } from "../../../../shared/sessionSearch";
import type { ModuleMock } from "../../dev/mockTypes";

export const mock: ModuleMock = {
  features: { new: ["history-turn-read"] },
  api: (core) => ({
    async sessionSearchTurn(sessionId, turnId) {
      await new Promise((r) => setTimeout(r, 200));
      const read = core.threadRead(sessionId) as { thread?: { turns?: unknown[] } } | null;
      return parseTurnPreview({ native: { method: "thread/read", result: { thread: { turns: read?.thread?.turns ?? [] } } }, complete: true }, turnId);
    },
  }),
};
