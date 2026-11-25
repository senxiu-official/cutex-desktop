// r296 continuation approvals (cutex docs/continuation-approval.md): a delegation whose auto-continue expired waits for
// the owner or the project's Director. The owner's list on the approvals page, beside the routing approvals: per
// project, plus the host's project-less ones. Decisions go through lib/continuationResume (the approval's CAS; deny
// needs a reason). approval_changed re-reads the list and says so; an unknown outcome keeps its fence until 核对结果.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AskDetail } from "../../../../shared/ipc";
import type { ContinuationApprovalRead } from "../../../../shared/delegationUpgradePreview";
import { useI18n, type MessageKey } from "../../i18n";
import { hostApi } from "../../lib/hostLists";
import type { HostData } from "../../lib/hostScope";
import { captureHostAction } from "../../lib/hostSwitch";
import { useRoutingRevision } from "../../lib/routingReviews";
import { refreshDelegation } from "../../lib/delegationStore";
import { checkContinuationResume, decideContinuationApproval, pendingResume, subscribePendingResume, type ResumeOutcome } from "../../lib/continuationResume";
import { ProjectRef, Who } from "../../components/Parties";
import { CONTINUATION_APPROVAL_FEATURE } from "./continuationApprovalFeature";

interface Row { host: string; projectId: string | null; project: string | null; approval: ContinuationApprovalRead; ask: AskDetail | null }
const OUTCOME: Record<ResumeOutcome, MessageKey> = {
  allowed: "delegation.cont.allowed", denied: "delegation.cont.denied", confirmed: "delegation.cont.confirmed", notApplied: "delegation.cont.notApplied",
  changed: "delegation.cont.approvalChanged", unknown: "delegation.cont.allowUnknown",
};
const BUTTON = "rounded-md px-2 py-0.5 text-xs disabled:opacity-50";

export function ContinuationInbox({ hosts, onCount }: { hosts: readonly HostData[]; onCount(count: number): void }) {
  const { t } = useI18n();
  const version = useRoutingRevision(); // cutex/delegation/routingApprovalChanged also covers continuation approvals
  const [again, setAgain] = useState(0);
  const sources = hosts.filter((host) => host.features.has(CONTINUATION_APPROVAL_FEATURE)).flatMap((host) => [
    ...(host.sidebar?.projects?.projects ?? []).map((project) => ({ host: host.hostId, id: project.project_id as string | null, name: project.presentation.display_name as string | null })),
    { host: host.hostId, id: null, name: null }, // the host's project-less delegations
  ]);
  const key = JSON.stringify([sources, version, again]);
  const [state, setState] = useState<{ key: string; rows: Row[]; error: boolean }>({ key: "", rows: [], error: false });
  useEffect(() => {
    let live = true;
    const current = new Map(sources.map((s) => [s.host, captureHostAction(s.host)]));
    void (async () => {
      const rows: Row[] = []; let error = false;
      for (const source of sources) {
        if (!live || !current.get(source.host)!()) return;
        try {
          const api = hostApi(source.host);
          const approvals = await api.delegationContinuationApprovals(source.id);
          for (const approval of approvals) {
            if (approval.projectId !== source.id) continue;
            const ask = await api.ask(approval.delegationId).catch(() => null);
            if (!live || !current.get(source.host)!()) return;
            rows.push({ host: source.host, projectId: source.id, project: source.name, approval, ask: ask?.askId === approval.delegationId ? ask : null });
          }
        } catch { error = true; }
      }
      if (live) { setState({ key, rows, error }); onCount(rows.length); }
    })();
    return () => { live = false; };
  }, [key, onCount]);
  const shown = state.key === key ? state : { rows: [], error: false };
  if (!sources.length || (state.key === key && !shown.rows.length && !shown.error)) return null;
  return <section className="mb-4" data-testid="continuation-approvals-inbox">
    <h2 className="mb-1 text-sm font-medium">{t("delegation.cont.inbox")}</h2>
    <p className="mb-2 text-xs text-subtle">{t("delegation.cont.inboxHint")}</p>
    {shown.error && <p className="mb-2 text-xs text-danger">{t("delegation.routing.unavailable")} <button type="button" onClick={() => setAgain((n) => n + 1)} className="text-accent">{t("image.retry")}</button></p>}
    {shown.rows.map((row) => <ContinuationApprovalCard key={`${row.host}:${row.approval.id}:${row.approval.revision}`} row={row} reread={() => setAgain((n) => n + 1)} />)}
  </section>;
}

function ContinuationApprovalCard({ row, reread }: { row: Row; reread(): void }) {
  const { t } = useI18n();
  const { host, approval, ask } = row;
  const fence = useSyncExternalStore(subscribePendingResume, () => pendingResume(host, row.projectId, approval.delegationId)?.action.actionId ?? "");
  const tracked = fence ? pendingResume(host, row.projectId, approval.delegationId) : null;
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<MessageKey | null>(null);
  const settle = (outcome: ResumeOutcome) => {
    setNote(OUTCOME[outcome]);
    if (outcome !== "unknown") { setDenying(false); reread(); void refreshDelegation(host, approval.delegationId); }
  };
  const decide = async (decision: "approve" | "deny") => {
    setBusy(true); setNote(null);
    try { settle(await decideContinuationApproval(host, approval, decision, decision === "deny" ? reason.trim() : null)); } finally { setBusy(false); }
  };
  const check = async () => {
    if (!tracked) return;
    setBusy(true);
    try { settle(await checkContinuationResume(host, tracked)); } finally { setBusy(false); }
  };
  const blocked = busy || !!tracked;
  const trimmed = reason.trim();
  return <div className="mb-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs" data-continuation-approval={approval.id}>
    <div className="mb-1 text-sm font-medium">{ask?.title ?? approval.delegationId}</div>
    <p className="mb-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-subtle">
      <span className="text-warn-text">{t("delegation.status.continuationLimited")} · {t(approval.reason === "rounds" ? "delegation.cont.reasonRounds" : "delegation.cont.reasonElapsed")}</span>
      <span>·</span>
      {row.projectId ? <ProjectRef hostId={host} projectId={row.projectId} name={row.project} quiet /> : <span>{t("delegation.cont.noProject")}</span>}
      <span>· {host}</span>
      {ask && <>· <Who id={ask.targetCutexSessionId} name={ask.targetName ?? null} hostId={host} quiet /></>}
    </p>
    <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-subtle">{t("delegation.cont.brief")}</dt><dd className="whitespace-pre-wrap break-words">{approval.briefPreview}</dd>
      {approval.progressPreview && <><dt className="text-subtle">{t("delegation.cont.progress")}</dt><dd className="whitespace-pre-wrap break-words">{approval.progressPreview}</dd></>}
    </dl>
    <div className="flex flex-wrap items-center gap-2">
      {approval.allowedActions.approve && <button type="button" data-continuation-decision="approve" disabled={blocked} title={t("delegation.cont.allowHint")}
        onClick={() => void decide("approve")} className={`${BUTTON} bg-accent text-on-accent hover:opacity-90`}>{t("delegation.cont.allow")}</button>}
      {approval.allowedActions.deny && !denying && <button type="button" data-continuation-decision="deny" disabled={blocked} title={t("delegation.cont.denyHint")}
        onClick={() => setDenying(true)} className={`${BUTTON} border border-border text-muted hover:text-danger`}>{t("delegation.cont.deny")}</button>}
      {tracked && <button type="button" data-continuation-decision="check" disabled={busy} onClick={() => void check()} className={`${BUTTON} border border-border text-foreground`}>{t("delegation.cont.checkResult")}</button>}
      {tracked && !note && <span role="status" className="text-warn-text">{t("delegation.cont.allowUnknown")}</span>}
      {note && <span role="status" className={note === "delegation.cont.allowed" || note === "delegation.cont.denied" || note === "delegation.cont.confirmed" ? "text-ok-text" : "text-warn-text"}>{t(note)}</span>}
    </div>
    {denying && <div className="mt-2 flex flex-col gap-1.5" data-continuation-deny="">
      <label className="text-subtle" htmlFor={`deny-${approval.id}`}>{t("delegation.cont.denyReason")}</label>
      <textarea id={`deny-${approval.id}`} value={reason} maxLength={200} rows={2} onChange={(e) => setReason(e.target.value)}
        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1 text-xs" />
      <div className="flex items-center gap-2">
        <button type="button" data-continuation-decision="denyConfirm" disabled={blocked || !trimmed} onClick={() => void decide("deny")}
          className={`${BUTTON} bg-danger-solid text-on-accent`}>{t("delegation.cont.denyConfirm")}</button>
        <button type="button" onClick={() => { setDenying(false); setReason(""); }} className={`${BUTTON} text-muted`}>{t("delegation.cont.cancel")}</button>
        <span className="ml-auto text-subtle tabular-nums">{trimmed.length}/200</span>
      </div>
    </div>}
  </div>;
}
