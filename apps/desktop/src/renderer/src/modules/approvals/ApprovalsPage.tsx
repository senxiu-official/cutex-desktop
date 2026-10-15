// Owner approvals inbox (cutex `owner-approvals`): agent actions waiting for the owner — a managed
// service (runs unsandboxed as the owner) or an agent launched on a profile marked "needs approval".
// Pending requests are cards with the request facts and 拒绝 / 批准; the approve button names the
// authority it grants. 已处理 lists recent decisions. Live from `cutex/approvals/changed`.
// Multi-host (RFC §9.2): the scope's connected hosts, merged by time; each card / row carries its host
// (HostMark when the scope shows host marks) and decisions go to that host.
import { useEffect, useMemo, useState } from "react";
import { Boxes, Globe, Server, ShieldAlert, ShieldCheck, Workflow } from "lucide-react";
import type { ApprovalDecision, ApprovalRecord, ServiceView, SidebarSnapshot } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { approvalFacts, approvalPeer, APPROVALS_FEATURE, grantKind, sortApprovals } from "../../lib/approvals";
import { peerPartyText } from "../../lib/delegations";
import { ClaimedCaps, PeerParty } from "../../components/PeerParty";
import { hostApi, openHostAgent, useListHosts, usePerHost } from "../../lib/hostLists";
import { mergeHostLists, type HostItem, type HostLook } from "../../lib/hostScope";
import { refusalText } from "../../lib/profileCreate";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { useApp } from "../../store";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { Avatar } from "../../components/Avatar";
import { HostMark } from "../../components/HostMark";
import { MissingHosts, RowHost } from "../../components/HostListParts";
import { PageBody, PageToolbar } from "../../components/Page";
import { Button, Segmented } from "../../components/settings/Form";
import { bridge } from "../../bridge";
import { ApprovalDifferences } from "./ApprovalDifferences";
import { BrowserClaimPanel } from "./BrowserClaimPanel";
import { browserOwnerErrorKey as browserErrorKey } from "../../../../shared/browser";

type Scope = "pending" | "decided";

function When({ iso }: { iso: string | null | undefined }) {
  const { locale } = useI18n();
  const now = useClock();
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  return (
    <span className="shrink-0 text-[11px] text-subtle tabular-nums" title={formatAbsolute(ms / 1000)}>
      {formatWhen(ms / 1000, now, locale)}
    </span>
  );
}

function KindChip({ kind }: { kind: ApprovalRecord["kind"] }) {
  const { t } = useI18n();
  const Icon = kind === "managed_service" ? Server : kind === "agent_profile" ? Boxes : kind === "browser_claim" || kind === "browser_open" ? Globe : kind === "workflow_run" ? Workflow : ShieldAlert;
  const key = `approvals.kind.${kind}` as MessageKey;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
      <Icon size={12} strokeWidth={1.75} />
      {t(key) === key ? kind : t(key)}
    </span>
  );
}

/** "Requested by <agent> · <project>" with a link to the agent. */
function Requester({ record, hostId, sidebar }: { record: ApprovalRecord; hostId: string; sidebar: SidebarSnapshot | null }) {
  const { t } = useI18n();
  const peer = approvalPeer(record);
  if (peer) {
    // A delegation from an agent on a paired host: 「name @ label」, never a local link, never the owner.
    return (
      <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{t("approvals.requestedBy")}</span>
          <PeerParty text={peerPartyText(peer.name, null, peer.label || "?")} label={peer.label || "?"} size={16} />
        </div>
        <ClaimedCaps caps={peer.claimedCaps} />
      </div>
    );
  }
  const session = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === record.requesterCutexSessionId);
  const name = session?.displayName ?? record.requesterName ?? record.requesterCutexSessionId;
  const project = record.projectId ? (sidebar?.projects?.projects.find((p) => p.project_id === record.projectId)?.presentation.display_name ?? record.projectId) : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span className="shrink-0">{t("approvals.requestedBy")}</span>
      <button disabled={!session} onClick={() => openHostAgent(hostId, record.requesterCutexSessionId)} className="flex min-w-0 items-center gap-1 rounded px-0.5 font-medium text-foreground enabled:hover:text-accent enabled:hover:underline" title={record.requesterCutexSessionId}>
        <Avatar name={name} avatar={session?.avatar} seed={record.requesterCutexSessionId} size={16} />
        <span className="truncate">{name}</span>
      </button>
      {project && <span className="shrink-0 text-subtle">· {t("approvals.inProject", { project })}</span>}
    </div>
  );
}

function Facts({ record }: { record: ApprovalRecord }) {
  const { t } = useI18n();
  const facts = approvalFacts(record.details, record.kind);
  if (facts.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-lg bg-surface-2/60 px-3 py-2 text-xs">
      {facts.map((f) => {
        const key = `approvals.field.${f.key}` as MessageKey;
        return (
          <div key={f.key} className="contents">
            <dt className="text-subtle">{t(key) === key ? f.key : t(key)}</dt>
            <dd className={`min-w-0 break-words ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}


/** Where a card / row belongs: its host, that host's sidebar (requester names), its look and state. */
interface Origin {
  hostId: string;
  sidebar: SidebarSnapshot | null;
  /** The host's cutex services (a claim without urlHint matches its agent's own service). */
  services?: ServiceView[] | null;
  look: HostLook | null;
  /** Show the host mark (scope.showHostMarks). */
  mark: boolean;
  /** The host's daemon is gone (RFC §8.5): an older snapshot, no actions. */
  stale: boolean;
}

function PendingCard({ record, origin }: { record: ApprovalRecord; origin: Origin }) {
  const { t } = useI18n();
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  const decideFocus = useApp((s) => s.decideApproval);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grant = grantKind(record);
  const reasonKey = `approvals.reason.${record.reason}` as MessageKey;
  // The focus host's decision also updates the store's list at once; another host's list follows its
  // `cutex/approvals/changed` event.
  const decide = (decision: ApprovalDecision) => {
    if (record.kind === "browser_claim" || record.kind === "browser_open") {
      // These new approvals never use the focus-host fallback of an older preload.
      if (!bridge.apiFor) throw new Error("browser_unavailable");
      return bridge.apiFor(origin.hostId).decideApproval(record.approvalId, decision, note);
    }
    return origin.hostId === focus ? decideFocus(record.approvalId, decision, note) : hostApi(origin.hostId).decideApproval(record.approvalId, decision, note);
  };
  const run = async (decision: ApprovalDecision) => {
    if (record.kind === "browser_claim" && decision === "approve") return; // Only exact owner-tab selection can grant a claim.
    setBusy(decision);
    setError(null);
    try {
      const r = await decide(decision);
      if (!r.ok) setError(r.error.code === "approval_not_pending" ? t("approvals.alreadyDecided") : (record.kind === "browser_claim" || record.kind === "browser_open") ? t(browserErrorKey(r.error.code)) : refusalText(r.error, t));
    } catch (e) {
      setError((record.kind === "browser_claim" || record.kind === "browser_open") ? t(browserErrorKey(e)) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={`mb-3 rounded-xl border border-border bg-surface px-4 py-3 ${origin.stale ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        {origin.mark && origin.look && <HostMark host={origin.look} className="mt-0.5 shrink-0" />}
        <KindChip kind={record.kind} />
        <h3 className="min-w-0 flex-1 text-sm font-medium break-words">{record.summary}</h3>
        <When iso={record.createdAt} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Requester record={record} hostId={origin.hostId} sidebar={origin.sidebar} />
        <span className="text-xs text-subtle">· {t(reasonKey) === reasonKey ? record.reason : t(reasonKey)}</span>
      </div>
      <Facts record={record} />
      {record.kind !== "browser_claim" && record.kind !== "browser_open" && <ApprovalDifferences value={record.details?.differences} />}
      {grant !== "other" && grant !== "claimBrowser" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <ShieldAlert size={13} className="mt-px shrink-0" />
          {t(grant === "runAsOwner" ? "approvals.warn.runAsOwner" : grant === "openBrowser" ? "approvals.browser.agentLogin" : grant === "runWorkflow" ? "approvals.warn.runWorkflow" : "approvals.warn.useProfile")}
        </p>
      )}
      {/* 允许 here is the exact owner-tab selection (a generic approve cannot grant a claim). */}
      {grant === "claimBrowser" && <BrowserClaimPanel variant="page" hostId={origin.hostId} approval={record} services={origin.services} disabled={origin.stale || !!busy} onBusy={setClaimBusy} />}
      <div className="mt-2.5 flex items-center gap-2">
        <input
          value={note}
          disabled={origin.stale}
          onChange={(e) => setNote(e.target.value.slice(0, 1000))}
          placeholder={t(grant === "claimBrowser" ? "approvals.browser.denyNote" : "approvals.notePlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <Button disabled={!!busy || claimBusy || origin.stale} onClick={() => void run("deny")}>{t("approvals.deny")}</Button>
        {grant !== "claimBrowser" && <Button primary disabled={!!busy || origin.stale} onClick={() => void run("approve")} title={t(grant === "openBrowser" ? "approvals.browser.retryHint" : grant === "runWorkflow" ? "approvals.runWorkflowHint" : "approvals.retryHint")}>
          {t(grant === "runAsOwner" ? "approvals.approve.runAsOwner" : grant === "useProfile" ? "approvals.approve.useProfile" : grant === "openBrowser" ? "approvals.browser.approveOpen" : grant === "runWorkflow" ? "approvals.approve.runWorkflow" : "approvals.approve")}
        </Button>}
      </div>
      {/* One reserved line: an error appearing never moves the next card. */}
      <p className="mt-1 h-4 truncate text-xs text-danger" title={error ?? undefined}>{error}</p>
    </section>
  );
}

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
