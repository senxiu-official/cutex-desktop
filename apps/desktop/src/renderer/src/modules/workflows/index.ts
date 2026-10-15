// 工作流 (cutex workflows, W1; docs/research/workflows-20261013.md): the 工作流 page (run list, run
// detail, the plan approval card) and its sidebar entry with the waiting-for-approval count. Default
// off; on a cutex without workflows the entry is hidden.
import { Workflow } from "lucide-react";
import { WORKFLOWS_FEATURE } from "../../../../shared/workflows";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { startWorkflowSync } from "./store";
import { useWorkflowsBadge } from "./useWorkflowsBadge";
import { WorkflowsPage } from "./WorkflowsPage";

export default defineModule({
  id: "workflows",
  titleKey: "workflows.title",
  descriptionKey: "workflows.description",
  defaultEnabled: false,
  requires: { capabilities: [WORKFLOWS_FEATURE] },
  contributes: {
    "nav.primary": [{ id: "workflows.nav", order: 550, icon: Workflow, titleKey: "workflows.nav", unavailable: "hide", target: { page: "workflows.page" }, useBadge: useWorkflowsBadge }],
    "main.page": [{ id: "workflows.page", Page: WorkflowsPage, useTitle: pageTitle("workflows.nav") }],
  },
  activate: startWorkflowSync,
});
