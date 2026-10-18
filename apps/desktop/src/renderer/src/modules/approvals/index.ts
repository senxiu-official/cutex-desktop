// 审批 (cutex owner-approvals): the owner's approval inbox — page + sidebar entry with the pending
// count (step 3). The 需要你 strip links here too (services.ui.openPage("approvals.page")). The
// requesting agent's conversation shows its pending approvals as a dock card and marks the tool call.
import { ShieldCheck } from "lucide-react";
import { APPROVALS_FEATURE, approvalOfTool } from "../../lib/approvals";
import { pageTitle } from "../react";
import { defineModule } from "../slots";
import { ApprovalsPage } from "./ApprovalsPage";
import { ApprovalToolRow } from "./ApprovalToolRow";
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
    // This agent's pending approvals (browser claims / opens first), decided where the agent works:
    // a card in the dock above the composer.
    "conversation.overlay": [{ id: "approvals.browserClaim", order: 200, Overlay: BrowserClaimOverlay }],
    // A cutex tool call that answered approval_required / approval_denied: a line under its row.
    "timeline.tool": [{ id: "approvals.tool", order: 350, match: (item) => approvalOfTool(item) !== null, Row: ApprovalToolRow }],
  },
});
