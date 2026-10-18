// Owner approvals inbox (cutex `owner-approvals`): agent actions waiting for the owner — a managed
// service (runs unsandboxed as the owner) or an agent launched on a profile marked "needs approval".
// Pending requests are cards with the request facts and 拒绝 / 批准; the approve button names the
// authority it grants. 已处理 lists recent decisions. Live from `cutex/approvals/changed`.
// Multi-host (RFC §9.2): the scope's connected hosts, merged by time; each card / row carries its host
// (HostMark when the scope shows host marks) and decisions go to that host.
import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ApprovalRecord } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { APPROVALS_FEATURE, sortApprovals } from "../../lib/approvals";
import { hostApi, useListHosts, usePerHost } from "../../lib/hostLists";
import { mergeHostLists, type HostItem, type HostLook } from "../../lib/hostScope";
import { useApp } from "../../store";
import { MissingHosts, RowHost } from "../../components/HostListParts";
import { PageBody, PageToolbar } from "../../components/Page";
import { Segmented } from "../../components/settings/Form";
import { PendingCard, Requester, When, type Origin } from "./PendingApprovalCard";

type Scope = "pending" | "decided";

const STATE_TONE: Record<ApprovalRecord["state"], string> = { pending: "text-warn", approved: "text-ok-text", consumed: "text-ok-text", denied: "text-danger", expired: "text-subtle" };

function DecidedRow({ record, origin }: { record: ApprovalRecord; origin: Origin }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-3 border-b border-border py-2 last:border-b-0">
      <span className={`flex w-14 shrink-0 items-center gap-1.5 pt-px text-xs ${STATE_TONE[record.state]}`}>
        <RowHost host={origin.look} show={origin.mark} />
        {t(`approvals.state.${record.state}` as MessageKey)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-sm" title={record.summary}>{record.summary}</span>
          <When iso={record.decidedAt ?? record.createdAt} />
        </div>
        <Requester record={record} hostId={origin.hostId} sidebar={origin.sidebar} />
        {record.note && <p className="mt-0.5 text-xs text-subtle">“{record.note}”</p>}
      </div>
    </div>
  );
}

const newestFirst = (at: (a: ApprovalRecord) => string | null | undefined) => (a: HostItem<ApprovalRecord>, b: HostItem<ApprovalRecord>) =>
  (Date.parse(at(b.item) ?? "") || 0) - (Date.parse(at(a.item) ?? "") || 0) || b.item.approvalId.localeCompare(a.item.approvalId);

export function ApprovalsPage() {
  const { t } = useI18n();
  const hosts = useListHosts();
  const refresh = useApp((s) => s.refreshApprovals);
  const [scope, setScope] = useState<Scope>("pending");

  // Hosts whose cutex has owner approvals (RFC §9.1: the page shows when any host of the scope has it).
  const supported = useMemo(() => hosts.data.filter((d) => d.features.has(APPROVALS_FEATURE)), [hosts.data]);
  const unsupported = hosts.multi ? hosts.data.filter((d) => !d.features.has(APPROVALS_FEATURE)).map((d) => hosts.look(d.hostId)).filter((h): h is HostLook => !!h) : [];
  const origin = useMemo(() => {
    const byHost = new Map(hosts.data.map((d) => [d.hostId, { hostId: d.hostId, sidebar: d.sidebar, services: d.services, look: hosts.look(d.hostId), mark: hosts.marks, stale: hosts.stale.has(d.hostId) } satisfies Origin]));
    return (hostId: string): Origin => byHost.get(hostId) ?? { hostId, sidebar: null, look: hosts.look(hostId), mark: hosts.marks, stale: true };
  }, [hosts]);

  // The focus host's pending list is (re)read here; the other hosts' are followed by the store (byHost).
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pending = useMemo(() => mergeHostLists(supported.map((d) => ({ hostId: d.hostId, items: d.approvals })), (a) => a.approvalId, newestFirst((a) => a.createdAt)), [supported]);
  const pendingLoaded = supported.some((d) => d.approvals !== null);

  // History, per host: re-read whenever a pending list changes (a decision moves a record there).
  const historyIds = scope === "decided" ? supported.map((d) => d.hostId).join("\n") : "";
  const historyHosts = useMemo(() => (historyIds ? historyIds.split("\n") : []), [historyIds]);
  const history = usePerHost(historyHosts, (hostId) => hostApi(hostId).approvals("all"), pending.map((p) => p.key).join());
  const decided = useMemo(
    () => mergeHostLists(historyHosts.map((hostId) => ({ hostId, items: sortApprovals((history[hostId]?.value ?? []).filter((a) => a.state !== "pending")) })), (a) => a.approvalId, newestFirst((a) => a.decidedAt ?? a.createdAt)),
    [history, historyHosts],
  );
  const decidedLoaded = historyHosts.some((id) => history[id]?.value != null);
  const error = historyHosts.map((id) => history[id]?.error).find((e) => !!e) ?? null;

  if (supported.length === 0 && hosts.missing.length === 0) {
    return (
      <PageBody>
        <p className="py-8 text-center text-sm text-subtle">{t("approvals.unsupported")}</p>
      </PageBody>
    );
  }
  return (
    <PageBody>
      <PageToolbar>
        <span className="mr-auto text-xs text-subtle">{t("approvals.hint")}</span>
        <Segmented<Scope>
          value={scope}
          options={[
            { value: "pending", label: t("approvals.scope.pending", { n: pending.length }) },
            { value: "decided", label: t("approvals.scope.decided") },
          ]}
          onChange={setScope}
        />
      </PageToolbar>
      {hosts.multi && <MissingHosts hosts={hosts.missing} unsupported={unsupported} />}
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      {scope === "pending" ? (
        !pendingLoaded ? (
          <p className="py-8 text-center text-sm text-subtle">…</p>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-subtle">
            <ShieldCheck size={22} strokeWidth={1.5} />
            {t("approvals.empty")}
          </div>
        ) : (
          pending.map((a) => <PendingCard key={a.key} record={a.item} origin={origin(a.hostId)} />)
        )
      ) : !decidedLoaded ? (
        <p className="py-8 text-center text-sm text-subtle">…</p>
      ) : decided.length === 0 ? (
        <p className="py-8 text-center text-sm text-subtle">{t("approvals.noHistory")}</p>
      ) : (
        <div className="rounded-xl border border-border bg-surface px-4 py-1">
          {decided.map((a) => (
            <DecidedRow key={a.key} record={a.item} origin={origin(a.hostId)} />
          ))}
        </div>
      )}
    </PageBody>
  );
}
