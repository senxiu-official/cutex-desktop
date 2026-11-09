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
import { lazyPage } from "../../lib/lazyPage";
import { APPROVAL_AUTO_RULES_FEATURE } from "../../lib/approvals";

const ApprovalRulesSettings = lazyPage(() => import("./ApprovalRules").then((m) => m.ApprovalRulesSettings));
const ApprovalRuleAuditAll = lazyPage(() => import("./ApprovalRules").then((m) => m.ApprovalRuleAuditAll));

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
    "settings.section": [{
      id: "approvals.rules.settings",
      page: "collab",
      order: 250,
      requires: { capabilities: [APPROVAL_AUTO_RULES_FEATURE] },
      titleKey: "approvals.rules.settings",
      keywords: ["approvals.rules.settings.hint", "approvals.rules.audit"],
      Section: ApprovalRulesSettings,
    }, {
      // 规则审计's full list: on the 协作 page's sub-page, not on the page (components/settings/SecuritySettings).
      id: "approvals.rules.auditAll",
      page: "collab",
      order: 251,
      requires: { capabilities: [APPROVAL_AUTO_RULES_FEATURE] },
      titleKey: "approvals.rules.audit",
      keywords: ["approvals.rules.audit.hint"],
      Section: ApprovalRuleAuditAll,
    }],
  },
});
