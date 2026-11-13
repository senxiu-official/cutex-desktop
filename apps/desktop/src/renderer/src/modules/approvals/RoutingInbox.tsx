import { useEffect, useState } from "react";
import type { AskDetail } from "../../../../shared/ipc";
import type { UpgradeApprovalRead } from "../../../../shared/delegationUpgradePreview";
import { useI18n } from "../../i18n";
import { hostApi } from "../../lib/hostLists";
import type { HostData } from "../../lib/hostScope";
import { captureHostAction } from "../../lib/hostSwitch";
import { ROUTING_REVIEW_FEATURE, refreshRoutingReviews, useRoutingRevision } from "../../lib/routingReviews";
import { RoutingDecision } from "../../components/RoutingReview";
import { isUpgradeApprovalRead } from "../../lib/delegationApprovalRead";
import { ProjectRef, Who } from "../../components/Parties";

interface Row { host: string; project: string; projectId: string; record: UpgradeApprovalRead; ask: AskDetail | null }
export function RoutingInbox({ hosts, onCount }: { hosts: readonly HostData[]; onCount(count: number): void }) {
  const { t } = useI18n();
  const version = useRoutingRevision();
  const [notice, setNotice] = useState<string | null>(null);
  const projects = hosts.filter(host => host.features.has(ROUTING_REVIEW_FEATURE)).flatMap(host =>
    (host.sidebar?.projects?.projects ?? []).map(project => ({ host: host.hostId, id: project.project_id, name: project.presentation.display_name })));
  const key = JSON.stringify([projects, version]);
  const [state, setState] = useState<{ key: string; rows: Row[]; error: boolean }>({ key: "", rows: [], error: false });
  useEffect(() => {
    let live = true;
    const current = new Map(projects.map(project => [project.host, captureHostAction(project.host)]));
    void (async () => {
      const rows: Row[] = []; let error = false;
      // Bound the inbox fan-out: the daemon has no host-wide routing list.
      for (const project of projects) {
        if (!live || !current.get(project.host)!()) return;
        try {
          const api = hostApi(project.host);
          const records = await api.delegationRoutingApprovals(project.id);
          if (!live || !current.get(project.host)!()) return;
          for (const record of records) {
            if (!isUpgradeApprovalRead(record) || record.projectId !== project.id || record.state !== "pending") continue;
            const ask = await api.ask(record.delegationRef.id).catch(() => null);
            if (!live || !current.get(project.host)!()) return;
            rows.push({ host: project.host, project: project.name, projectId: project.id, record, ask: ask?.askId === record.delegationRef.id ? ask : null });
          }
        } catch { error = true; }
      }
      if (live) { setState({ key, rows, error }); onCount(rows.length); }
    })();
    return () => { live = false; };
  }, [key, onCount]);
  const shown = state.key === key ? state : { rows: [], error: false };
  return <section className="mb-4" data-testid="routing-approvals-inbox">
    <h2 className="mb-2 text-sm font-medium">{t("delegation.routing.inbox")}</h2>
    {notice && <p role="status" className="mb-2 text-xs text-warn">{notice}</p>}
    {state.key !== key && <p className="text-xs text-subtle">{t("delegation.routing.loading")}</p>}
    {shown.error && <p className="mb-2 text-xs text-danger">{t("delegation.routing.unavailable")} <button onClick={refreshRoutingReviews} className="text-accent">{t("image.retry")}</button></p>}
    {shown.rows.map(row => <div key={`${row.host}:${row.record.id}`} className="mb-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="mb-1 font-medium">{row.ask?.title ?? row.record.delegationRef.id}</div>
      {/* The project and the target as the app's references (icon / avatar, click opens them on that host). */}
      <p className="mb-2 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-subtle">
        <span>{t("delegation.routing.project", { project: "" }).trim()}</span>
        <ProjectRef hostId={row.host} projectId={row.projectId} name={row.project} quiet />
        <span>· {row.host}</span>
        {row.ask && <>· <Who id={row.ask.targetCutexSessionId} name={row.ask.targetName ?? null} hostId={row.host} quiet /></>}
      </p>
      <RoutingDecision host={row.host} record={row.record} onDecision={decision => setNotice(decision === "approve" ? `${t("delegation.routing.approved")} · ${t("delegation.routing.grantHint")}` : t("delegation.routing.denied"))} />
      <p className="mt-1 text-xs text-subtle">{t("delegation.routing.grantHint")}</p>
    </div>)}
    {state.key === key && !shown.error && !shown.rows.length && <p className="text-xs text-subtle">{t("delegation.routing.empty")}</p>}
  </section>;
}
