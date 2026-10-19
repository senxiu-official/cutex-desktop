// The owner's review of a delegation (cutex pendingReview: a local delegation to a wider target, or an
// incoming cross-host one its peer policy gates) decided where the delegation shows — 批准 / 拒绝 on
// the requester's card (+ 「到审批页」), on the target's queue row (待处理委托) and in the side detail.
// Same `ask_delivery` record and daemon call as the 审批 page (lib/approvalDecision); the buttons only
// show to a connection that may decide (owner, owner-approvals, full device scope). Otherwise the card
// keeps the old hint line (到「审批」页处理).
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ApprovalDecision, AskSummary } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { decideApprovalOn, useAskReview } from "../lib/approvalDecision";
import { decisionInput } from "../lib/approvals";
import { awaitsOwnerReview } from "../lib/delegations";
import { refusalText } from "../lib/profileCreate";
import { useApp } from "../store";

type Variant = "card" | "row" | "side";

/** `host`: the host whose record `d` is (the approval lives there too). */
export function DelegationReviewActions({ d, host, variant }: { d: AskSummary; host: string; variant: Variant }) {
  const { t } = useI18n();
  const active = awaitsOwnerReview(d);
  const review = useAskReview(host, d.askId, active);
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!active) return null;
  const openPage = () => useApp.getState().openPage("approvals.page");
  const record = review.canDecide ? review.record : null;
  if (!record) {
    // Not decidable here (not the owner, a narrowed device, the record not loaded): say where.
    if (variant === "row") return null;
    const hint = t("delegation.pendingReviewHint");
    return (
      <div className={`${variant === "card" ? "ml-5" : "mb-2"} text-[11px] text-warn`} data-testid="delegation-review-line">
        {review.approvalsPage ? (
          <button onClick={openPage} className="hover:underline">
            {hint}
          </button>
        ) : (
          hint
        )}
      </div>
    );
  }
  const run = async (decision: ApprovalDecision, event: React.MouseEvent) => {
    event.stopPropagation();
    setBusy(decision);
    setError(null);
    try {
      const r = await decideApprovalOn(host, record, decision, { surface: "delegation", input: decisionInput(event) });
      if (!r.ok) setError(r.error.code === "approval_not_pending" ? t("approvals.alreadyDecided") : refusalText(r.error, t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const dense = variant === "row";
  const base = dense ? "rounded px-1.5 text-[11px] leading-5" : "rounded-md px-2 py-0.5 text-xs";
  const buttons = (
    <>
      <button type="button" disabled={!!busy} onClick={(e) => void run("approve", e)} title={t("delegation.review.approveHint")} className={`${base} whitespace-nowrap bg-accent font-medium text-white hover:opacity-90 disabled:opacity-50`} data-review="approve">
        {t("approvals.approve")}
      </button>
      <button type="button" disabled={!!busy} onClick={(e) => void run("deny", e)} title={t("delegation.review.denyHint")} className={`${base} whitespace-nowrap border border-border text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50`} data-review="deny">
        {t("approvals.deny")}
      </button>
    </>
  );
  if (dense)
    return (
      <span className="flex shrink-0 items-center gap-1" data-testid="delegation-review-actions" title={error ?? undefined}>
        {buttons}
        {error && <span className="max-w-[8rem] truncate text-[11px] text-danger">{error}</span>}
      </span>
    );
  return (
    <div className={`${variant === "card" ? "ml-5" : "mb-2"} flex flex-wrap items-center gap-1.5 text-[11px]`} data-testid="delegation-review-actions">
      <span className="text-warn">{t("delegation.review.lead")}</span>
      {buttons}
      {review.approvalsPage && (
        <button type="button" onClick={openPage} className="flex items-center gap-0.5 rounded px-1 text-accent hover:underline">
          {t("delegation.review.openPage")}
          <ArrowUpRight size={11} />
        </button>
      )}
      {error && <span className="min-w-0 truncate text-danger" title={error}>{error}</span>}
    </div>
  );
}
