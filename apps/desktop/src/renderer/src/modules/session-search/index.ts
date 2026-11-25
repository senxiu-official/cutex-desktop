// 查找旧任务 as a page (owner 2026-11-26): the sidebar's 在页面中查找 opens it with the current text; filters, results
// newest first (flat or by agent), the selected result's turn previewed, 打开对话 at that turn. Hosts with cutex
// session-search-v1 (the preview also needs history-turn-read; without it the search's excerpt shows).
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { SESSION_SEARCH_FEATURE } from "../../../../shared/sessionSearch";
import { SESSION_SEARCH_PAGE } from "../../lib/sessionSearchPage";
import { lazyPage } from "../../lib/lazyPage";

const SessionSearchPage = lazyPage(() => import("./SessionSearchPage").then((m) => m.SessionSearchPage));

export default defineModule({
  id: "session-search",
  titleKey: "session-search.title",
  descriptionKey: "session-search.description",
  requires: { capabilities: [SESSION_SEARCH_FEATURE] },
  contributes: {
    "main.page": [{ id: SESSION_SEARCH_PAGE, Page: SessionSearchPage, useTitle: pageTitle("session-search.title") }],
  },
});
