import { startProjectContext } from "./context";
// Project 视图 (owner 2026-10-20; prototype .claude/preview-design-v1.html §4): a pane kind for projects
// with a dozen and more agents — the Director and the managed agents (needs-you / running / recently
// active, the long idle ones folded), their delegations, jobs, background terminals and sub-agents, and
// the project's recent activity. Opens in a Shelf (＋ launcher), from ⌘K (the 「Project 视图」 entry under
// the sidebar's 更多) and from the project menu (打开项目页面 › Project 视图, a `project.tab` that shows the
// same view with 「在 Shelf 中打开」). Data from the stores the app already keeps (data.ts); no backend.
// 钉到托盘 (pin.tsx): a home pin of kind `page` (`project-view:<projectId>`) on hosts with cutex
// `user-home-page-pins`, from the pane header, the 项目 page tab and the sidebar project menu.
import { LayoutDashboard } from "lucide-react";
import { defineModule } from "../slots";
import type { Json } from "../types";
import { useViewTitle } from "./data";
import { startLive } from "./live";
import { dedupeKey, initState, KIND, parseParams, restoreState, type ViewParams, type ViewState } from "./model";
import { openProjectView } from "./open";
import { ProjectViewActions, startPins } from "./pin";
import { lazyPage } from "../../lib/lazyPage";

// The view (and its Director panel) loads when first shown (lib/lazyPage; 0.2.0 beta perf audit).
const ProjectViewBody = lazyPage(() => import("./ProjectView").then((m) => m.ProjectViewBody));
const ProjectViewTab = lazyPage(() => import("./ProjectView").then((m) => m.ProjectViewTab));

export default defineModule({
  id: "project-view",
  titleKey: "project-view.title",
  descriptionKey: "project-view.description",
  contributes: {
    "pane.kind": [
      {
        id: KIND,
        titleKey: "project-view.title",
        icon: LayoutDashboard,
        instances: "multi",
        binding: "none",
        parseParams: (raw: Json): ViewParams | null => parseParams(raw),
        dedupeKey,
        init: (p: ViewParams, previous: ViewState | null): ViewState => initState(p, previous),
        restore: (raw: Json): ViewState | null => restoreState(raw),
        useTitle: useViewTitle,
        Body: ProjectViewBody,
        // The header's 钉到托盘 (pin.tsx; only where the pin list can keep a page pin).
        Actions: ProjectViewActions,
        minSize: { w: 320, h: 360 },
        // ＋ opens the context-following view; project menu entries can still open an explicit project.
        launcher: { order: 450, params: () => ({}) },
      },
    ],
    // ⌘K lists the sidebar's pages (`nav.primary`): this entry sits under 更多 until pinned.
    "nav.primary": [{ id: "project-view.nav", order: 310, icon: LayoutDashboard, titleKey: "project-view.title", target: { run: () => openProjectView() } }],
    // The project menu's 打开项目页面 › Project 视图 (no project-menu slot exists; the page tab is the entry).
    "project.tab": [{ id: "project-view.projectTab", tab: "project-view", order: 150, titleKey: "project-view.title", Body: ProjectViewTab }],
  },
  activate: (ctx) => {
    startLive(ctx);
    const stopContext = startProjectContext();
    ctx.signal.addEventListener("abort", stopContext, { once: true });
    // 钉到托盘: the pinned page's look / opener and the project menu row (pin.tsx).
    const stop = startPins();
    ctx.signal.addEventListener("abort", stop, { once: true });
  },
});
