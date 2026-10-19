// The line under a cutex tool call that answered `approval_required` (services, agent profiles, browser
// opens, …): 「等你批准」 while the request is pending (the decision card itself sits in the dock above the
// composer: BrowserClaimOverlay), else what the tool said. Read from the tool result alone, so it works
// with every cutex since owner-approvals; a cutex without approvals-live never streams the Agent Bus's
// requests, so a pending-looking call whose record the list lacks reloads the host's list once.
import { useContext, useEffect } from "react";
import { ArrowUpRight, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useI18n } from "../../i18n";
import { APPROVAL_NOTICE_FEATURE, APPROVALS_LIVE_FEATURE, approvalOfTool, knownApprovalState } from "../../lib/approvals";
import { useConnectedHostData } from "../../lib/hostLists";
import type { RawItem } from "../../lib/timeline";
import { featuresOf, useApp } from "../../store";
import { useConvHost } from "../../lib/conversationScope";
import { TimelineFallbackContext } from "../timelineFallback";

/** Reloads already asked for (approvalId), once per desktop run. */
const reloaded = new Set<string>();

export function ApprovalToolRow({ item }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const fallback = useContext(TimelineFallbackContext);
  const hostId = useConvHost();
  const data = useConnectedHostData().find((d) => d.hostId === hostId);
  const live = useApp((s) => featuresOf(s, hostId).has(APPROVALS_LIVE_FEATURE));
  const notice = useApp((s) => featuresOf(s, hostId).has(APPROVAL_NOTICE_FEATURE));
  const openPage = useApp((s) => s.openPage);
  const refreshOn = useApp((s) => s.refreshApprovalsOn);
  const found = approvalOfTool(item);
  const approvalId = found?.approvalId ?? null;
  const list = data?.approvals ?? null;
  const pending = !!approvalId && !!list?.some((a) => a.approvalId === approvalId);
  // An older cutex: the request may be missing from the list (it never reached the stream).
  const missing = !!approvalId && found?.code === "approval_required" && !!list && !pending && !live;
  useEffect(() => {
    if (!missing || !approvalId || reloaded.has(approvalId)) return;
    reloaded.add(approvalId);
    void refreshOn(hostId);
  }, [missing, approvalId, hostId, refreshOn]);
  if (!found) return <>{fallback}</>;
  // What the owner decided (this run), else what the tool said.
  const seen = pending ? undefined : knownApprovalState(found.approvalId);
  const state = pending ? "pending" : found.code === "approval_denied" || seen === "denied" ? "denied" : seen === "approved" || seen === "consumed" ? "approved" : seen === "expired" ? "expired" : "asked";
  const Icon = state === "denied" ? ShieldX : state === "approved" ? ShieldCheck : ShieldAlert;
  const text = {
    pending: t(notice ? "approvals.tool.pendingNotice" : "approvals.tool.pending"),
    denied: t("approvals.tool.denied"),
    approved: t(seen === "consumed" ? "approvals.tool.used" : notice ? "approvals.tool.approvedNotice" : "approvals.tool.approved"),
    expired: t("approvals.tool.expired"),
    asked: t("approvals.tool.asked"),
  }[state];
  const tone = state === "pending" ? "text-warn-text" : state === "approved" ? "text-ok-text" : "text-subtle";
  return (
    <>
      {fallback}
      <div data-approval-line={state} className={`-mt-0.5 mb-1 ml-6 flex min-w-0 items-center gap-1 text-[11.5px] ${tone}`}>
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate" title={found.summary ?? found.approvalId}>{text}</span>
        <button type="button" onClick={() => openPage("approvals.page")} className="ml-1 flex shrink-0 items-center gap-0.5 rounded px-1 text-accent hover:underline">
          {t("approvals.inline.openPage")}
          <ArrowUpRight size={11} />
        </button>
      </div>
    </>
  );
}
