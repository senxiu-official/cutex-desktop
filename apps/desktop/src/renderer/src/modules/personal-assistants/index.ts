// 个人助理 (Personal Assistants; cutex r295 `personal-assistants-local-v1`, plan .claude/reports/cute-agent-plan-20261125.md):
// owner-configured assistants that arrange work in chosen projects and hand requests to each project's Director only
// after the owner confirms. The nav entry is the front desk (high in the list, a badge for what waits for the owner);
// the page creates and configures assistants (name, Profile, project set, authority), shows today's agenda, the
// requests with their confirmation card and the history; a project's 助理请求 tab lists the requests for it.
// Everything is gated on the capability; the entry is hidden on hosts without it.
import { ConciergeBell } from "lucide-react";
import { PERSONAL_ASSISTANTS_FEATURE } from "../../../../shared/personalAssistants";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { lazyPage } from "../../lib/lazyPage";
import { useAssistantsBadge } from "./useAssistantsBadge";

// Loaded on first open (lib/lazyPage).
const AssistantsPage = lazyPage(() => import("./AssistantsPage").then((m) => m.AssistantsPage));
const ProjectRequestsTab = lazyPage(() => import("./ProjectRequestsTab").then((m) => m.ProjectRequestsTab));

export default defineModule({
  id: "personal-assistants",
  titleKey: "personal-assistants.title",
  descriptionKey: "personal-assistants.description",
  requires: { capabilities: [PERSONAL_ASSISTANTS_FEATURE] },
  contributes: {
    "nav.primary": [{ id: "personal-assistants.nav", order: 20, icon: ConciergeBell, titleKey: "personal-assistants.nav", unavailable: "hide", target: { page: "personal-assistants.page" }, useBadge: useAssistantsBadge }],
    "main.page": [{ id: "personal-assistants.page", Page: AssistantsPage, useTitle: pageTitle("personal-assistants.nav") }],
    "project.tab": [{ id: "personal-assistants.projectTab", tab: "assistant-requests", order: 320, titleKey: "personal-assistants.projectTab", Body: ProjectRequestsTab }],
  },
});
