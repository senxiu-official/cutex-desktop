// A delegation whose scheduled continue (定时继续) ran out (`continuationWait.state: "limited"`): it goes on only when
// the owner or the requester allows it (owner 2026-11-25, Hostb #47c47e: the card offered no way to continue). The
// same decision as the delegation tree's 允许继续 (lib/continuationResume: the r296 approval's CAS when the host has
// delegation-continuation-approval-v1, else the legacy continuation revision), offered where the owner reads the
// delegation (card body, side detail). r296: whenever the tree gives this view an approval, 允许继续 / 拒绝并停止 are
// offered even while the handler is busy, offline or paused (the decision commits; the continuation starts when the
// handler can run), and cutex says why it cannot run now (resumeContinuationBlockedReason). Older hosts: yes / no only,
// so the desktop names what it can see itself. Nothing here promises that one step (上线) unblocks it.
import { useEffect, useState, useSyncExternalStore } from "react";
import { CircleAlert } from "lucide-react";
import type { AskSummary } from "../../../shared/ipc";
import type { ContinuationResumeRead } from "../../../shared/delegationUpgradePreview";
import { useI18n, type MessageKey } from "../i18n";
import { sidebarOf, useApp } from "../store";
import { useHostAccess } from "../lib/hostAccess";
import { openContinuationWait } from "../lib/delegations";
import { useAgentNames } from "../lib/delegationsView";
import { delegationApi, onContinuationGate, refreshDelegation } from "../lib/delegationStore";
import { checkContinuationResume, isApprovedWaiting, noteApprovedWaiting, pendingResume, submitContinuationResume, subscribeApprovedWaiting, subscribePendingResume, type ContinuationDecision, type ResumeOutcome } from "../lib/continuationResume";
import { runtimeStartView } from "../lib/runtimeStart";
import { blockedReasonKey } from "../lib/continuationWait";

const BUTTON = "rounded-md px-2 py-0.5 text-xs disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-accent text-on-accent hover:opacity-90`;
const SECONDARY = `${BUTTON} border border-border text-foreground hover:bg-hover`;
const OUTCOME: Record<ResumeOutcome, MessageKey> = {
  allowed: "delegation.cont.allowed", denied: "delegation.cont.denied", confirmed: "delegation.cont.confirmed", notApplied: "delegation.cont.notApplied",
  changed: "delegation.cont.allowChanged", unknown: "delegation.cont.allowUnknown",
};
const GOOD: ReadonlySet<MessageKey> = new Set(["delegation.cont.allowed", "delegation.cont.allowedWaiting", "delegation.cont.denied", "delegation.cont.confirmed"]);
/** r296 `resumeContinuationBlockedReason` → words (cutex docs/continuation-approval.md); an unknown code keeps the fallback. */
const BLOCKED: Record<string, { text: MessageKey; hint?: MessageKey }> = {
  notPending: { text: "delegation.cont.blockedNotPending", hint: "delegation.cont.blockedNotPendingHint" },
  handlerUnavailable: { text: "delegation.cont.blockedUnavailable", hint: "delegation.cont.blockedUnavailableHint" },
  generationMismatch: { text: "delegation.cont.blockedGeneration" },
  handlerOffline: { text: "delegation.cont.needOnline", hint: "delegation.cont.offlineHint" },
  handlerBusy: { text: "delegation.cont.working" },
  leaseHeld: { text: "delegation.cont.blockedLease" },
  projectPaused: { text: "delegation.cont.projectPaused" },
  admissionBlocked: { text: "delegation.cont.blockedAdmission", hint: "delegation.cont.blockedAdmissionHint" },
  noApprovalAuthority: { text: "delegation.cont.blockedNoAuthority" },
};

export function DelegationContinuationAllow({ d, host }: { d: AskSummary; host: string }) {
  // Hook-free gate: only a limited, local delegation reaches the reads below (r296 ddd0f067: a project-less one too,
  // from its owner detail). Right after an approval this window made, a still-open wait says it continues once the
  // handler is free (and why it is held now); a wait the host cancelled because the handler was archived says so.
  if (d.remote) return null;
  const wait = openContinuationWait(d);
  if (!wait) return !d.closed && isApprovedWaiting(host, d.askId) ? <ApprovedArchived d={d} host={host} /> : null;
  if (wait.state !== "limited") return <ApprovedWaiting d={d} host={host} />;
  return <AllowContinue d={d} host={host} projectId={d.projectId ?? null} />;
}

function ApprovedWaiting({ d, host }: { d: AskSummary; host: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const approved = useSyncExternalStore(subscribeApprovedWaiting, () => isApprovedWaiting(host, d.askId));
  if (!approved) return null;
  // r296 ddd0f067: the scheduler's hold after an approval (continuationWait.blockedReason); it changes as the handler frees up.
  const held = blockedReasonKey(d.continuationWait?.blockedReason);
  return <p data-continuation-approved="" className="mb-1.5 text-xs text-ok-text">
    {t("delegation.cont.allowedWaiting", { name: d.targetName ?? nameOf(d.target) })}
    {held && <span data-continuation-waiting-reason="" className="text-warn-text"> · {t("delegation.cont.waitingNow", { reason: t(held) })}</span>}
  </p>;
}

/** After an approval the host cancels the continuation once the handler is archived (cutex `stop_or_archive`): it does
 *  not continue, and restoring the agent does not bring this stretch back. Said only for an archived handler. */
function ApprovedArchived({ d, host }: { d: AskSummary; host: string }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const archived = useApp((s) => {
    const sidebar = sidebarOf(s, host);
    return !!sidebar && !sidebar.active.some((r) => r.cutexSessionId === d.target) && sidebar.retired.some((r) => r.cutexSessionId === d.target);
  });
  if (!archived) return null;
  return <p data-continuation-archived="" className="mb-1.5 text-xs text-warn-text">{t("delegation.cont.archivedAfterApproval", { name: d.targetName ?? nameOf(d.target) })}</p>;
}

function AllowContinue({ d, host, projectId }: { d: AskSummary; host: string; projectId: string | null }) {
  const { t } = useI18n();
  const access = useHostAccess(host);
  const nameOf = useAgentNames();
  // undefined: the roster is not loaded (not "offline").
  const row = useApp((s) => sidebarOf(s, host)?.active.find((r) => r.cutexSessionId === d.target));
  const runtime = row?.runtime;
  const pending = useSyncExternalStore(subscribePendingResume, () => pendingKey(host, projectId, d.askId));
  const [gate, setGate] = useState(0);
  // Re-read on what can change cutex's answer: the delegation, the handler's runtime (status, turn, generation), the
  // project's run control / continuation events, a settled operation, or 重新检查.
  const readKey = [host, d.askId, d.revision, runtime?.status, runtime?.activeTurnId ?? "", runtime?.runtimeGeneration, pending, gate].join("\u0000");
  const [read, setRead] = useState<{ key: string; value: ContinuationResumeRead | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MessageKey | null>(null);
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const shown = access.isOwner;
  useEffect(() => shown ? onContinuationGate(host, projectId, () => setGate((n) => n + 1)) : undefined, [shown, host, projectId]);
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    delegationApi(host).delegationContinuationResume(projectId, d.askId).then(
      (value) => { if (alive) setRead({ key: readKey, value }); },
      () => { if (alive) setRead({ key: readKey, value: null }); },
    );
    return () => { alive = false; };
  }, [shown, projectId, host, d.askId, readKey]);
  if (!shown) return null;
  const name = d.targetName ?? nameOf(d.target);
  const r = read?.key === readKey ? read.value : undefined;
  const tracked = pending ? pendingResume(host, projectId, d.askId) : null;
  const settle = (outcome: ResumeOutcome, waiting = false) => {
    // r296: approved while the handler cannot run yet: it continues once it can (「已允许，等 X 空闲后继续」).
    setNote(outcome === "allowed" && waiting ? "delegation.cont.allowedWaiting" : OUTCOME[outcome]);
    if (outcome !== "unknown") setDenying(false);
    void refreshDelegation(host, d.askId);
  };
  const decide = async (decision: ContinuationDecision) => {
    if (!r) return;
    const waiting = !!r.approval && !r.allowed;
    setBusy(true); setNote(null);
    try {
      const outcome = await submitContinuationResume(host, projectId, d.askId, r, decision, decision === "deny" ? denyReason.trim() : null);
      if (outcome === "allowed" && waiting) noteApprovedWaiting(host, d.askId);
      settle(outcome, waiting);
    }
    finally { setBusy(false); setGate((n) => n + 1); }
  };
  // The agent menu's own start action (owner check, start-in-progress fence, error notice); loaded on click because
  // lib/menus pulls in the whole menu graph.
  const bringOnline = async () => {
    if (!row) return;
    const { runtimeItem } = await import("../lib/menus");
    const item = runtimeItem(row, t, host);
    if (item && !item.disabled) await item.onSelect();
  };
  const check = async () => {
    if (!tracked) return;
    setBusy(true);
    try { settle(await checkContinuationResume(host, tracked)); } finally { setBusy(false); setGate((n) => n + 1); }
  };

  // Older hosts give no reason: what the desktop itself sees about the handler.
  const start = runtime ? runtimeStartView(host, d.target, runtime) : null;
  const offline = !!runtime && runtime.status !== "online" && runtime.status !== "starting" && !start;
  const handler: { text: string; hint?: string } | null = !runtime ? null
    : start?.phase === "unconfirmed" ? { text: t("runtime.startUnconfirmed") }
    : start || runtime.status === "starting" ? { text: t("delegation.cont.starting", { name }) }
    : offline ? { text: t("delegation.cont.needOnline", { name }), hint: t("delegation.cont.offlineHint") }
    : runtime.activeTurnId ? { text: t("delegation.cont.working", { name }) }
    : null;
  // r296: an approval card means this view decides now (its own allowedActions); otherwise the legacy permission and revision.
  const decidable = !!r && (r.approval ? r.approval.allowedActions.approve : r.allowed && r.expectedRevision !== null);
  const blocked = r?.blockedReason ? BLOCKED[r.blockedReason] : undefined;
  const reason: { text: string; hint?: string } | null = tracked ? null
    : r === null ? { text: t("delegation.cont.olderHost") }
    : !r || (r.allowed && decidable) ? null
    : blocked ? { text: t(blocked.text, { name }), hint: blocked.hint && t(blocked.hint) }
    : r.projectPaused ? { text: t("delegation.cont.projectPaused") }
    // Decidable without a cutex reason (a project-less card has none): what the desktop sees, as information.
    : decidable ? (r.blockedReason ? null : handler)
    : (!r.blockedReason && handler) || { text: t("delegation.cont.notNow"), hint: t("delegation.cont.notNowHint") };
  // 上线 only when cutex says the handler is offline (or, on a host without reasons, the desktop sees it offline).
  const offerOnline = !!row && !tracked && !r?.allowed && (r?.blockedReason ? r.blockedReason === "handlerOffline" && !start && runtime?.status !== "starting" : !decidable && offline);
  const canDecide = decidable && !tracked && !busy;
  const canDeny = !!r?.approval?.allowedActions.deny && !tracked;
  const allowTitle = !decidable ? reason?.text ?? t("delegation.cont.allowHint") : r?.approval && !r.allowed ? t("delegation.cont.allowWhenReady", { name }) : t("delegation.cont.allowHint");
  const limit = r?.limit ? (r.limit.reason === "rounds" ? t("delegation.cont.limitRounds", { n: r.limit.maxRounds }) : t("delegation.cont.limitElapsed", { hours: Math.round(r.limit.maxElapsedSeconds / 3600) })) : null;
  const trimmed = denyReason.trim();
  return (
    <div data-continuation-allow="" className="mb-1.5 flex flex-col gap-1 rounded-lg bg-attention-soft px-2.5 py-1.5 text-xs text-muted">
      <p className="flex items-center gap-1.5 font-medium text-warn-text"><CircleAlert size={12} className="shrink-0" aria-hidden />{t("delegation.status.continuationLimited")}</p>
      <p>{t("delegation.cont.hintLimited")}{limit && <span data-continuation-limit=""> · {limit}</span>}</p>
      <div className="flex flex-wrap items-center gap-2">
        {r !== null && (
          <button type="button" data-continuation-resume="allow" disabled={!canDecide} title={allowTitle} onClick={() => void decide("approve")} className={PRIMARY}>
            {t("delegation.cont.allow")}
          </button>
        )}
        {canDeny && !denying && (
          <button type="button" data-continuation-resume="deny" disabled={busy} title={t("delegation.cont.denyHint")} onClick={() => setDenying(true)}
            className={`${BUTTON} border border-border text-muted hover:text-danger`}>
            {t("delegation.cont.deny")}
          </button>
        )}
        {reason && <span data-continuation-resume-reason="" title={reason.hint}>{reason.text}</span>}
        {offerOnline && (
          <button type="button" data-continuation-resume="online" className={SECONDARY} title={t("delegation.cont.offlineHint")}
            onClick={() => void bringOnline()}>
            {t("delegation.cont.bringOnline")}
          </button>
        )}
        {tracked && (tracked.action.kind === "resumeContinuation" ? (
          <button type="button" data-continuation-resume="check" disabled={busy} className={SECONDARY} onClick={() => void check()}>
            {t("delegation.cont.checkResult")}
          </button>
        ) : <span data-continuation-resume-reason="">{t("delegation.cont.otherPending")}</span>)}
        {r !== undefined && !tracked && !decidable && (
          <button type="button" data-continuation-resume="recheck" disabled={busy} className={SECONDARY} onClick={() => setGate((n) => n + 1)}>
            {t("delegation.cont.recheck")}
          </button>
        )}
        {tracked && tracked.action.kind === "resumeContinuation" && !note && <span role="status" className="text-warn-text">{t("delegation.cont.allowUnknown")}</span>}
        {note && <span role="status" className={GOOD.has(note) ? "text-ok-text" : "text-warn-text"}>{t(note, { name })}</span>}
      </div>
      {denying && canDeny && (
        <div className="flex flex-col gap-1" data-continuation-deny="">
          <label className="text-subtle" htmlFor={`cont-deny-${d.askId}`}>{t("delegation.cont.denyReason")}</label>
          <textarea id={`cont-deny-${d.askId}`} value={denyReason} maxLength={200} rows={2} onChange={(e) => setDenyReason(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground" />
          <div className="flex items-center gap-2">
            <button type="button" data-continuation-resume="denyConfirm" disabled={busy || !trimmed} onClick={() => void decide("deny")}
              className={`${BUTTON} bg-danger-solid text-on-accent`}>{t("delegation.cont.denyConfirm")}</button>
            <button type="button" onClick={() => { setDenying(false); setDenyReason(""); }} className={`${BUTTON} text-muted`}>{t("delegation.cont.cancel")}</button>
            <span className="ml-auto text-subtle tabular-nums">{trimmed.length}/200</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** A stable snapshot for useSyncExternalStore: the fencing action id, or "". */
function pendingKey(host: string, projectId: string | null, askId: string): string {
  return pendingResume(host, projectId, askId)?.action.actionId ?? "";
}
