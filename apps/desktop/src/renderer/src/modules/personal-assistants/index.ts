// 个人助理 (Personal Assistants; cutex r295 `personal-assistants-local-v1`, plan .claude/reports/cute-agent-plan-20261125.md):
// owner-configured assistants that arrange work in chosen projects and hand requests to each project's Director only
// after the owner confirms. The nav entry is the front desk (high in the list, a badge for what waits for the owner);
// the page creates and configures assistants (name, Profile, project set, authority), shows today's agenda, the
// requests with their confirmation card and the history; a project's 助理请求 tab lists the requests for it.
// Everything is gated on the capability; the entry is hidden on hosts without it.
// 「今日」 (owner 2026-11-27): the assistant-only right view of an assistant's conversation (pane kind below; a
// context-following project view shows it for an assistant), a band over the conversation in portrait / narrow windows,
// and the title-bar button: click = the default assistant's conversation, right-click = a popover of what waits.
import { CalendarCheck, ConciergeBell } from "lucide-react";
import { PERSONAL_ASSISTANTS_FEATURE } from "../../../../shared/personalAssistants";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { useAssistantsBadge } from "./useAssistantsBadge";
import { TodayBand } from "./TodayBand";
import { parseTodayParams, TODAY_KIND, todayState, useTodayTitle } from "./todayModel";

// The title-bar button's click and right-click load what they open on first use.
const openDefaultAssistant = () => import("./todayOpen").then((m) => m.openDefaultAssistant());
const openTodayMenu = (anchor: HTMLElement) => void import("./todayMenu").then((m) => m.openTodayMenu(anchor));

// Loaded on first open (lib/lazyPage).
const AssistantsPage = lazyPage(() => import("./AssistantsPage").then((m) => m.AssistantsPage));
const ProjectRequestsTab = lazyPage(() => import("./ProjectRequestsTab").then((m) => m.ProjectRequestsTab));
const TodayPaneBody = lazyPage(() => import("./TodayPane").then((m) => m.TodayPaneBody));

export default defineModule({
  id: "personal-assistants",
  titleKey: "personal-assistants.title",
  descriptionKey: "personal-assistants.description",
  requires: { capabilities: [PERSONAL_ASSISTANTS_FEATURE] },
  contributes: {
    "nav.primary": [{ id: "personal-assistants.nav", order: 20, icon: ConciergeBell, titleKey: "personal-assistants.nav", unavailable: "hide", target: { run: openDefaultAssistant }, activePages: ["personal-assistants.page"], menu: { open: openTodayMenu, hintKey: "personal-assistants.menu.hint" }, useBadge: useAssistantsBadge }],
    "main.page": [{ id: "personal-assistants.page", Page: AssistantsPage, useTitle: pageTitle("personal-assistants.nav") }],
    "pane.kind": [
      {
        id: TODAY_KIND,
        titleKey: "personal-assistants.todayView.title",
        icon: CalendarCheck,
        instances: "single",
        binding: "follow",
        parseParams: parseTodayParams,
        init: todayState,
        restore: () => todayState(),
        useTitle: useTodayTitle,
        Body: TodayPaneBody,
        minSize: { w: 300, h: 320 },
        launcher: { order: 455, params: () => ({}) },
      },
    ],
    "conversation.overlay": [{ id: "personal-assistants.todayBand", order: 40, Overlay: TodayBand }],
    "project.tab": [{ id: "personal-assistants.projectTab", tab: "assistant-requests", order: 320, titleKey: "personal-assistants.projectTab", Body: ProjectRequestsTab }],
  },
});
