import { useEffect, useState } from "react";
import type { ApprovalDecision, AskSummary } from "../../../shared/ipc";
import type { AskReviewReference } from "../../../shared/delegationReviews";
import type { UpgradeApprovalRead } from "../../../shared/delegationUpgradePreview";
import { useI18n } from "../i18n";
import { featuresOf, useApp } from "../store";
import { useHostAccess } from "../lib/hostAccess";
import { canDecideApprovals } from "../lib/approvals";
import { decideRoutingReviewOn } from "../lib/approvalDecision";
import { ROUTING_REVIEW_FEATURE, checkRoutingOutcome, refreshRoutingReviews, useRoutingOperation, useRoutingReview } from "../lib/routingReviews";
import { ArmedButton } from "./ArmedButton";
import { runDelegationCommand } from "../lib/delegationMenu";
import { DelegationReviewerGrant } from "./DelegationReviewerGrant";
import { refreshDelegation } from "../lib/delegationStore";

export function RoutingDecision({ record, host, dense = false, onDecision }: { record: UpgradeApprovalRead; host: string; dense?: boolean; onDecision?(decision: ApprovalDecision): void }) {
  const { t } = useI18n();
  const access = useHostAccess(host);
  const features = useApp(s => featuresOf(s, host));
  const operation = useRoutingOperation(host, record.projectId, `approval:${record.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = access.isOwner && features.has(ROUTING_REVIEW_FEATURE) && canDecideApprovals(features, access);
  const run = async (decision: ApprovalDecision) => {
    setBusy(true); setError(null);
    try { await decideRoutingReviewOn(host, record, decision); onDecision?.(decision); }
    catch (e) { setError(e instanceof Error && e.message === "approval_changed" ? t("delegation.routing.changed") : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className={`flex items-center gap-1.5 ${dense ? "shrink-0 flex-nowrap text-caption/[inherit]" : "flex-wrap text-xs"}`} data-routing-review={record.id}>
    {/* W3: a stale / cancelled review says so (no decision buttons: those are for pending only). */}
    <span className="text-warn" title={record.state === "approved" ? t("delegation.routing.waitingGrant") : record.state === "stale" || record.state === "cancelled" ? t("delegation.routing.closedHint") : undefined}>{t(record.state === "approved" ? "delegation.routing.approved" : record.state === "denied" ? "delegation.routing.denied" : record.state === "stale" ? "delegation.routing.stale" : record.state === "cancelled" ? "delegation.routing.cancelled" : "delegation.routing.title")}</span>
    {record.state === "pending" && allowed && (['approve', 'deny'] as const).map(decision => record.allowedActions[decision] && <button key={decision} type="button" data-routing-decision={decision}
      disabled={busy || !!operation} title={t(decision === "approve" ? "delegation.routing.approveHint" : "delegation.routing.denyHint")}
      onClick={event => { event.stopPropagation(); void run(decision); }}
      className={`rounded px-2 py-0.5 disabled:opacity-50 ${decision === "approve" ? "bg-accent text-on-accent hover:opacity-90" : "border border-border text-muted hover:text-danger"}`}>{t(decision === "approve" ? "delegation.routing.approve" : "delegation.routing.deny")}</button>)}
    {operation && (record.state !== "approved" || operation.kind !== "grant") && <><span className="text-warn">{t("delegation.routing.unknown")}</span><button type="button" className="text-accent hover:underline" disabled={busy || !allowed} onClick={event => {
      event.stopPropagation(); setBusy(true); void checkRoutingOutcome(host, record.projectId, `approval:${record.id}`).catch(() => setError(t("delegation.routing.unknown"))).finally(() => setBusy(false));
    }}>{t("delegation.routing.check")}</button></>}
    {error && <span role="alert" className="text-danger">{error}</span>}
  </div>;
}

export function RoutingDelegationReview({ d, host, refValue, variant }: { d: AskSummary; host: string; refValue: AskReviewReference; variant: "card" | "row" | "side" }) {
  const { t } = useI18n();
  const features = useApp(s => featuresOf(s, host));
  const active = !d.closed && !d.remote && (d.execution === "pendingReview" || d.execution === "queued");
  const supported = features.has(ROUTING_REVIEW_FEATURE);
  const access = useHostAccess(host);
  const review = useRoutingReview(host, refValue, active && supported);
  const mismatched = !!review.record && review.record.delegationRef.id !== d.askId;
  // r295: the host renews a stale approval (new id / revision / digest) and points the ask at it. A card still holding the
  // old reference re-reads the ask once, so the renewed approval (still decidable by the owner) replaces 已失效.
  const staleKey = review.record?.state === "stale" && d.execution === "pendingReview" && !mismatched ? `${review.record.id}:${review.record.revision}` : null;
  useEffect(() => {
    if (staleKey) void refreshDelegation(host, d.askId);
  }, [staleKey, host, d.askId]);
  if (!active) return null;
  const shape = variant === "card" ? "ml-5" : variant === "side" ? "mb-2" : "";
  return <div className={`${shape} flex ${variant === "row" ? "min-w-0 shrink-0 items-center" : "flex-col"} gap-1 text-xs`} data-testid="delegation-routing-review">
    {!supported ? <><span className="text-warn">{t("delegation.routing.upgradeHost")}</span>{access.isOwner && canDecideApprovals(features, access) && <ArmedButton shape="rounded px-2 py-0.5 text-xs" idle="border border-border text-muted" hint={t("delegation.stopConfirm")} resetKey={d.revision} onConfirm={() => void runDelegationCommand(host, d, "cutex/ask/stop", t)}>{t("delegation.stop")}</ArmedButton>}</> : !review.record || mismatched ? <span className="text-subtle">{t(review.error || mismatched ? "delegation.routing.unavailable" : "delegation.routing.loading")}
      {(review.error || mismatched) && <button type="button" onClick={refreshRoutingReviews} className="ml-2 text-accent">{t("image.retry")}</button>}</span> : <>
      <RoutingDecision record={review.record} host={host} dense={variant === "row"} />
      {review.record.state === "approved" && <span className={variant === "row" ? "sr-only" : "text-warn"} title={t("delegation.routing.grantHint")}>{t("delegation.routing.waitingGrant")}</span>}
      {review.record.state === "approved" && <DelegationReviewerGrant d={d} host={host} record={review.record} dense={variant === "row"} />}
    </>}
  </div>;
}
