// One pending owner approval as a card (cutex owner-approvals): the 审批 page's cards and the card in the
// requesting agent's conversation (BrowserClaimOverlay → dock) share it, so both decide the same way.
import { useState } from "react";
import { ArrowUpRight, Boxes, FolderOpen, Globe, Hourglass, Server, ShieldAlert, Workflow } from "lucide-react";
import type { ApprovalDecision, ApprovalDecisionOrigin, ApprovalRecord, ServiceView, SidebarSnapshot } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { approvalDecisionTrace, approvalFacts, approvalPeer, APPROVAL_DECIDED_BY_FEATURE, APPROVAL_NOTICE_FEATURE, decisionInput, formatHold, grantKind, holdLeftMs, RETRYING_KINDS } from "../../lib/approvals";
import { peerPartyText } from "../../lib/delegations";
import { ClaimedCaps, PeerParty } from "../../components/PeerParty";
import { openHostAgent } from "../../lib/hostLists";
import { sendApprovalDecision } from "../../lib/approvalDecision";
import type { HostLook } from "../../lib/hostScope";
import { refusalText } from "../../lib/profileCreate";
import { formatAbsolute, formatWhen, useClock, useNow } from "../../lib/time";
import { featuresOf, useApp } from "../../store";
import { Avatar } from "../../components/Avatar";
import { HostMark } from "../../components/HostMark";
import { ApprovalSource } from "../../components/ApprovalSource";
import { Button } from "../../components/settings/Form";
import { bridge } from "../../bridge";
import { ApprovalDifferences } from "./ApprovalDifferences";
import { BrowserClaimPanel } from "./BrowserClaimPanel";
import { browserOwnerErrorKey as browserErrorKey } from "../../../../shared/browser";

export function When({ iso }: { iso: string | null | undefined }) {
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

export function KindChip({ kind }: { kind: ApprovalRecord["kind"] }) {
  const { t } = useI18n();
  const Icon = kind === "managed_service" || kind === "service_lifetime" ? Server : kind === "static_root" ? FolderOpen : kind === "agent_profile" ? Boxes : kind === "browser_claim" || kind === "browser_open" ? Globe : kind === "workflow_run" ? Workflow : ShieldAlert;
  const key = `approvals.kind.${kind}` as MessageKey;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
      <Icon size={12} strokeWidth={1.75} />
      {t(key) === key ? kind : t(key)}
    </span>
  );
}

/** "Requested by <agent> · <project>" with a link to the agent. */
export function Requester({ record, hostId, sidebar }: { record: ApprovalRecord; hostId: string; sidebar: SidebarSnapshot | null }) {
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

export function Facts({ record }: { record: ApprovalRecord }) {
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
export interface Origin {
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

/**
 * A pending approval with its facts and 拒绝 / 批准. `inline`: the card in the requesting agent's own
 * conversation (BrowserClaimOverlay dock) — no requester line (it is this agent), a link to 审批, and
 * what happens after the decision (cutex approval-decision-notice tells the agent to retry).
 */
export function PendingCard({ record, origin, variant = "page" }: { record: ApprovalRecord; origin: Origin; variant?: "page" | "inline" }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grant = grantKind(record);
  const openApprovalsPage = useApp((s) => s.openPage);
  // The agent retries itself after the decision (services, agent profiles, browser opens); with
  // approval-decision-notice cutex tells it to.
  const retrying = RETRYING_KINDS.has(record.kind);
  const notice = useApp((s) => featuresOf(s, origin.hostId).has(APPROVAL_NOTICE_FEATURE));
  const decidedBy = useApp((s) => featuresOf(s, origin.hostId).has(APPROVAL_DECIDED_BY_FEATURE));
  const reasonKey = `approvals.reason.${record.reason}` as MessageKey;
  // cutex approval-wait: the agent's call is holding for this decision right now (counts down each second).
  const now = useNow(holdLeftMs(record, Date.now()) !== null);
  const holdLeft = holdLeftMs(record, now);
  // The focus host's decision also updates the store's list at once; another host's list follows its
  // `cutex/approvals/changed` event.
  const decide = (decision: ApprovalDecision, how: ApprovalDecisionOrigin) => {
    // approval-decided-by: cutex records where / how (an older cutex refuses the extra field).
    const where = decidedBy ? how : undefined;
    if (record.kind === "browser_claim" || record.kind === "browser_open") {
      // These new approvals never use the focus-host fallback of an older preload.
      if (!bridge.apiFor) throw new Error("browser_unavailable");
      return bridge.apiFor(origin.hostId).decideApproval(record.approvalId, decision, note, where);
    }
    return sendApprovalDecision(origin.hostId, record.approvalId, decision, note, where);
  };
  const run = async (decision: ApprovalDecision, event: { detail: number; nativeEvent?: unknown }) => {
    if (record.kind === "browser_claim" && decision === "approve") return; // Only exact owner-tab selection can grant a claim.
    const how: ApprovalDecisionOrigin = { surface: variant, input: decisionInput(event) };
    // r243 acceptance 7 (a denial nobody remembered): every decision made here leaves one local line.
    bridge.shell?.logError({ kind: "reported", message: approvalDecisionTrace(record, decision, how, origin.hostId) }).catch(() => {});
    setBusy(decision);
    setError(null);
    try {
      const r = await decide(decision, how);
      if (!r.ok) setError(r.error.code === "approval_not_pending" ? t("approvals.alreadyDecided") : (record.kind === "browser_claim" || record.kind === "browser_open") ? t(browserErrorKey(r.error.code)) : refusalText(r.error, t));
    } catch (e) {
      setError((record.kind === "browser_claim" || record.kind === "browser_open") ? t(browserErrorKey(e)) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section data-approval-card={variant} className={variant === "inline" ? `pr-5 ${origin.stale ? "opacity-60" : ""}` : `mb-3 rounded-xl border border-border bg-surface px-4 py-3 ${origin.stale ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        {origin.mark && origin.look && <HostMark host={origin.look} className="mt-0.5 shrink-0" />}
        <KindChip kind={record.kind} />
        <h3 className="min-w-0 flex-1 text-sm font-medium break-words">{record.summary}</h3>
        <ApprovalSource source="cutex" />
        <When iso={record.createdAt} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {variant === "page" ? <Requester record={record} hostId={origin.hostId} sidebar={origin.sidebar} /> : holdLeft === null && <span className="text-xs text-muted">{t("approvals.inline.asks")}</span>}
        {holdLeft !== null && (
          <span data-approval-hold className="flex shrink-0 items-center gap-1 rounded bg-warn/10 px-1.5 py-0.5 text-xs font-medium text-warn-text tabular-nums">
            <Hourglass size={12} aria-hidden />
            {t("approvals.hold.waiting", { time: formatHold(holdLeft) })}
          </span>
        )}
        <span className="text-xs text-subtle">· {t(reasonKey) === reasonKey ? record.reason : t(reasonKey)}</span>
        {variant === "inline" && (
          <button type="button" onClick={() => openApprovalsPage("approvals.page")} className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-accent hover:underline">
            {t("approvals.inline.openPage")}
            <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      <Facts record={record} />
      {record.kind !== "browser_claim" && record.kind !== "browser_open" && <ApprovalDifferences value={record.details?.differences} />}
      {grant !== "other" && grant !== "claimBrowser" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <ShieldAlert size={13} className="mt-px shrink-0" />
          {t(grant === "runAsOwner" ? "approvals.warn.runAsOwner" : grant === "openBrowser" ? "approvals.browser.agentLogin" : grant === "runWorkflow" ? "approvals.warn.runWorkflow" : grant === "serveRoot" ? "approvals.warn.serveRoot" : "approvals.warn.useProfile")}
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
        <Button disabled={!!busy || claimBusy || origin.stale} onClick={(e) => void run("deny", e)}>{t("approvals.deny")}</Button>
        {grant !== "claimBrowser" && <Button primary disabled={!!busy || origin.stale} onClick={(e) => void run("approve", e)} title={t(grant === "openBrowser" ? "approvals.browser.retryHint" : grant === "runWorkflow" ? "approvals.runWorkflowHint" : "approvals.retryHint")}>
          {t(grant === "runAsOwner" ? "approvals.approve.runAsOwner" : grant === "useProfile" ? "approvals.approve.useProfile" : grant === "openBrowser" ? "approvals.browser.approveOpen" : grant === "runWorkflow" ? "approvals.approve.runWorkflow" : grant === "serveRoot" ? "approvals.approve.serveRoot" : "approvals.approve")}
        </Button>}
      </div>
      {holdLeft !== null ? <p className="mt-1 text-[11px] text-subtle">{t("approvals.hold.hint")}</p>
        : variant === "inline" && retrying && <p className="mt-1 text-[11px] text-subtle">{t(notice ? "approvals.inline.noticeHint" : "approvals.inline.retryYourself")}</p>}
      {/* One reserved line: an error appearing never moves the next card. */}
      <p className="mt-1 h-4 truncate text-xs text-danger" title={error ?? undefined}>{error}</p>
    </section>
  );
}

