import { useState } from "react";
import type { AskSummary } from "../../../shared/ipc";
import type { UpgradeApprovalRead } from "../../../shared/delegationUpgradePreview";
import { useI18n, type MessageKey } from "../i18n";
import { featuresOf, useApp } from "../store";
import { useHostAccess } from "../lib/hostAccess";
import { canDecideApprovals } from "../lib/approvals";
import { canCreateReviewerGrant, checkReviewerGrantOutcome, createReviewerGrant, reviewerGrantState, useReviewerGrant } from "../modules/delegationReviewerGrant";
import { refreshRoutingReviews, useRoutingOperation } from "../lib/routingReviews";
import { ArmedButton } from "./ArmedButton";

type Props = { d: AskSummary; host: string; record: UpgradeApprovalRead; dense?: boolean };

export function DelegationReviewerGrant({ d, host, record, dense = false }: Props) {
  const access = useHostAccess(host);
  const features = useApp(s => featuresOf(s, host));
  const active = !d.closed && !d.remote && d.execution === "pendingReview"
    && record.state === "approved" && record.delegationRef.id === d.askId;
  const allowed = access.isOwner && canDecideApprovals(features, access) && features.has("delegation-review-refs")
    && features.has("delegation-routing-v1") && features.has("delegation-tree-stop-v1");
  // A separate mounted body keeps hook order stable while gated/legacy rows do no grant work.
  if (!active || !allowed) return null;
  return <ReviewerGrantActions d={d} host={host} record={record} dense={dense} />;
}

function ReviewerGrantActions({ host, record, dense = false }: Props) {
  const { t } = useI18n();
  const allowed = canCreateReviewerGrant(host);
  const read = useReviewerGrant(host, record, allowed);
  const operation = useRoutingOperation(host, record.projectId);
  const identity = JSON.stringify([host, record.projectId, record.id, record.revision, record.requestDigest]);
  const [operationState, setOperationState] = useState<{ identity: string; busy: boolean; error: "failed" | "changed" | "unknown" | null } | null>(null);
  const busy = operationState?.identity === identity && operationState.busy;
  const error = operationState?.identity === identity ? operationState.error : null;
  // Parent adds these keys to the catalogs in its integration commit.
  const text = (key: string, params?: Record<string, string | number>) => t(`delegation.routing.grant.${key}` as MessageKey, params);
  if (!allowed) return null;
  const selection = read.snapshot ? reviewerGrantState(read.snapshot, record) : null;
  const scope = selection && (selection.kind === "needed" || selection.kind === "available") ? selection.scope : null;
  const params = scope ? { requester: scope.requester.name || scope.requester.id,
    target: scope.target.name || scope.target.id, root: scope.root.title || scope.root.id } : undefined;
  const run = async (check: boolean) => {
    setOperationState({ identity, busy: true, error: null });
    try {
      if (check) await checkReviewerGrantOutcome(host, record);
      else if (scope) await createReviewerGrant(host, record, scope);
      setOperationState({ identity, busy: false, error: null });
    } catch (value) {
      const message = value instanceof Error ? value.message : "";
      setOperationState({ identity, busy: false, error: message === "outcome_unknown" ? "unknown"
        : ["context_changed", "grant_scope_changed"].includes(message) ? "changed" : "failed" });
    }
  };
  return <div className={`flex min-w-0 ${dense ? "flex-wrap items-center" : "flex-col items-start"} gap-1 text-xs`} data-testid="delegation-reviewer-grant"
    title={params ? text("scope", params) : undefined}
    data-grant-requester={scope ? JSON.stringify(scope.intent.requesterRef) : undefined}
    data-grant-targets={scope ? JSON.stringify(scope.intent.targetRefs) : undefined}
    data-grant-root={scope ? JSON.stringify(scope.intent.rootDelegationRef) : undefined} data-grant-max-uses={scope ? 1 : undefined}>
    {operation?.kind === "grant" ? <>
      <span className="text-warn" role="status">{text("unknown")}</span>
      <button type="button" disabled={busy} className="text-accent hover:underline disabled:opacity-50" onClick={event => { event.stopPropagation(); void run(true); }}>{text("check")}</button>
    </> : operation ? <span className="text-warn">{t("delegation.routing.waitingGrant")}</span>
      : read.committed ? <span className="text-warn" role="status">{text("done")}</span>
      : selection?.kind === "available" ? <span className="text-warn">{text("available")}</span>
      : selection?.kind === "waiting" ? <span className="text-warn">{t("delegation.routing.waitingGrant")}</span>
      : selection?.kind === "needed" && params ? <>
        <span className={dense ? "sr-only" : "text-warn"}>{text("pending")}</span>
        {!dense && <span className="max-w-full break-words text-subtle" data-testid="delegation-reviewer-grant-scope">{text("scope", params)}</span>}
        <ArmedButton testId="delegation-reviewer-grant-allow" shape="rounded px-2 py-0.5 text-xs" idle="border border-border text-accent hover:bg-surface-2"
          title={text("scope", params)} hint={text("confirm", params)} resetKey={`${identity}:${scope!.key}`} disabled={busy} onConfirm={() => void run(false)}>{text("allow")}</ArmedButton>
      </> : read.error || selection?.kind === "unavailable" ? <>
        <span className="text-warn">{text("unavailable")}</span>
        <button type="button" disabled={busy} className="text-accent hover:underline" onClick={event => { event.stopPropagation(); refreshRoutingReviews(); }}>{text("refresh")}</button>
      </> : <span className="text-subtle">{text("loading")}</span>}
    {error && !operation && <span role="alert" className="text-danger">{text(error)}</span>}
  </div>;
}
