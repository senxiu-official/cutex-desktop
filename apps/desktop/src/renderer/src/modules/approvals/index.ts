// 审批 (cutex owner-approvals): the owner's approval inbox — page + sidebar entry with the pending
// count (step 3). The 需要你 strip links here too (services.ui.openPage("approvals.page")).
import { ShieldCheck } from "lucide-react";
import { APPROVALS_FEATURE } from "../../lib/approvals";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { ApprovalsPage } from "./ApprovalsPage";
import { BrowserClaimOverlay } from "./BrowserClaimOverlay";
import { useApprovalsBadge } from "./useApprovalsBadge";

export default defineModule({
  id: "approvals",
  titleKey: "approvals.title",
  descriptionKey: "approvals.description",
  requires: { capabilities: [APPROVALS_FEATURE] },
  contributes: {
    "nav.primary": [{ id: "approvals.nav", order: 700, icon: ShieldCheck, titleKey: "approvals.nav", target: { page: "approvals.page" }, useBadge: useApprovalsBadge }],
    "main.page": [{ id: "approvals.page", Page: ApprovalsPage, useTitle: pageTitle("approvals.nav") }],
    // A browser_claim of this agent, decided where the agent works (beside its browser lane).
    "conversation.overlay": [{ id: "approvals.browserClaim", order: 200, Overlay: BrowserClaimOverlay }],
  },
});
