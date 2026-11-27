// The right-side delegation detail (`delegations.detail`, opened by a `delegation` ref): a header
// with #tag · title, requester → target, model and status, then the timeline card's body
// (DelegationDetailBody: brief, progress, questions, result, actions, ⋯ with 跳到委托卡片). The record
// comes from the host-keyed store (live); one the store has not loaded comes from the detail.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Loader2 } from "lucide-react";
import type { AskAttemptView, AskDetail, AskSummary } from "../../../../shared/ipc";
import { DelegationDetailBody } from "../../components/DelegationCard";
import { DelegationHops, DelegationStatusMark, DelegationTag } from "../../components/DelegationParts";
import { EndingBy, mayHaveEnding, useDelegationEnding } from "../../components/DelegationEnding";
import { Who } from "../../components/Parties";
import { PeerParty } from "../../components/PeerParty";
import { useI18n } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { delegationMenu } from "../../lib/delegationMenu";
import { approvalCardInDetail, reviewCardInDetail, takeDetailFocus, useDetailFocus, type DetailFocusRequest } from "../../lib/activityOpen";
import { attemptRowKey, attemptSeconds, delegationStatus, openContinuationWait, formatSpan, isOwnerRequest, peerSideOf, requesterName, requesterSession } from "../../lib/delegations";
import { hasDelegationViews, loadDelegationDetail, useDelegation, useDelegations } from "../../lib/delegationStore";
import { useAgentNames, useAgentProfile, useDelegationContext } from "../../lib/delegationsView";
import { STATUS_TIP_WORD } from "../../lib/statusTip";
import { hostKey } from "../../lib/hostKeys";
import { rawIdTitle, useModelName } from "../../lib/modelDisplay";
import { taskTag } from "../../lib/tasks";
import { formatAbsolute, formatWhen, useNow } from "../../lib/time";
import { featuresOf, useApp } from "../../store";
import type { SideBodyProps, SideTabInfo, SideTabProps } from "../slots";
import { detailTabTitle, summaryFromDetail, type DetailState } from "./detail";
import { services } from "../app";

/** 「委托 #3 · title」 (the store's title once known, else the one it was opened with). */
export function useDetailTab({ instance, hostId }: SideTabProps<DetailState>): SideTabInfo {
  const { t } = useI18n();
  const { askId } = instance.state;
  const record = useDelegation(hostId ?? "", askId);
  const title = record?.title ?? instance.state.title ?? null;
  return { title: detailTabTitle(t("delegation.label"), taskTag(askId).label, title), tooltip: title ? `${title}\n${askId}` : askId };
}

/** The detail of `askId` on `hostId`: the store's when loaded (refreshed with the record), else fetched here. */
function useAskDetail(hostId: string, askId: string, revision: number | null): AskDetail | null | undefined {
  const stored = useDelegations((s) => s.details[hostKey(hostId, askId)]);
  const [fetched, setFetched] = useState<AskDetail | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setFetched(undefined);
    void loadDelegationDetail(hostId, askId).then((d) => live && setFetched(d));
    return () => {
      live = false;
    };
  }, [hostId, askId, revision]);
  return stored !== undefined ? stored : fetched;
}

function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" }) {
  return <p className={`flex items-center gap-1.5 p-3 text-xs ${tone === "danger" ? "text-danger" : "text-subtle"}`}>{children}</p>;
}

export function DetailBody({ instance, hostId, close }: SideBodyProps<DetailState>) {
  const { t } = useI18n();
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 border-b border-border/60 px-3 py-2">
      <button type="button" data-delegation-back="" className="flex items-center gap-1 text-xs text-muted hover:text-foreground" onClick={() => {
        const returnTo = instance.state.returnTo;
        if (returnTo && returnTo !== instance.id) services.side.reveal({ instanceId: returnTo });
        close();
      }}><ArrowLeft size={13} aria-hidden />{t("settings.back")}</button>
    </div>
    <div className="min-h-0 flex-1">{hostId ? <Detail hostId={hostId} askId={instance.state.askId} /> : <Note tone="danger">{t("gutter.reason.bad-ref")}</Note>}</div>
  </div>;
}

function Detail({ hostId, askId }: { hostId: string; askId: string }) {
  const { t, locale } = useI18n();
  const record = useDelegation(hostId, askId);
  const detail = useAskDetail(hostId, askId, record?.revision ?? null);
  const d = record ?? (detail ? summaryFromDetail(detail) : null);
  const nameOf = useAgentNames();
  const views = useApp((s) => hasDelegationViews(featuresOf(s, hostId)));
  const ctxOf = useDelegationContext();
  const profile = useAgentProfile(d?.target || null);
  const modelName = useModelName();
  const status = d ? delegationStatus(d, ctxOf(d)) : null;
  const running = status?.key === "running" || status?.key === "question";
  const now = useNow(running);
  // A next step opened this detail (lib/activityOpen, r295 Z3): scroll to its part once the record is here.
  const [focus, setFocus] = useState<DetailFocusRequest | null>(null);
  const pendingFocus = useDetailFocus((s) => s.request);
  const loaded = !!d;
  useEffect(() => {
    if (!loaded) return;
    const r = takeDetailFocus(hostId, askId);
    if (r) setFocus(r);
  }, [pendingFocus, loaded, hostId, askId]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const body = bodyRef.current;
    const el = focus.section === "result" ? body?.querySelector("[data-delegation-result-section]") : null;
    if (el) el.scrollIntoView?.({ block: "start" });
    else body?.scrollTo?.({ top: 0 });
  }, [focus]);
  if (!d || !status) {
    if (detail === undefined)
      return (
        <Note>
          <Loader2 size={12} className="animate-spin" />
          {t("delegations.loading")}
        </Note>
      );
    return <Note tone="danger">{t("delegations.detail.gone")}</Note>;
  }
  const targetName = d.targetName ?? nameOf(d.target);
  const requester = requesterSession(d.requester);
  const peer = peerSideOf(d);
  const model = d.attempt?.model ? modelName(d.attempt.model, null, profile) : profile;
  const took = running ? attemptSeconds(d.attempt, now) : null;
  const created = Date.parse(d.createdAt) / 1000;
  const from =
    peer?.side === "requester" ? (
      <PeerParty text={peer.name} label={peer.label} size={16} instanceId={peer.instanceId} hostId={hostId} />
    ) : isOwnerRequest(d.requester) ? (
      <span className="shrink-0 font-medium text-foreground">{t("delegation.you")}</span>
    ) : (
      <Who id={requester} name={requesterName(d.requester) ?? (requester ? nameOf(requester) : null)} size={16} />
    );
  const to = peer?.side === "target" ? <PeerParty text={peer.name} label={peer.label} size={16} instanceId={peer.instanceId} hostId={hostId} /> : <Who id={d.target || null} name={targetName} size={16} />;
  return (
    <div className="message-body flex h-full min-h-0 min-w-0 max-w-full flex-col" data-testid="delegation-detail" data-ask-id={askId}>
      <div className="shrink-0 border-b border-border/60 px-3 py-2" onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host: hostId, views }))}>
        <div className="flex items-start gap-1.5 text-sm">
          <ArrowLeftRight size={14} className="mt-0.5 shrink-0 text-accent" />
          <DelegationTag askId={askId} />
          <span className="min-w-0 flex-1 font-medium">{d.title || askId}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {from}
          <ArrowRight size={11} className="shrink-0 text-subtle" />
          {to}
          {model && (
            <span className="min-w-0 max-w-[50%] truncate text-subtle" title={d.attempt?.model ? rawIdTitle(d.attempt.model, model) : undefined}>
              · {model}
            </span>
          )}
          <DelegationHops hops={d.hops} />
          <DelegationStatusMark status={status} name={targetName} trailing={took !== null ? formatSpan(took) : null} error={d.attempt?.lastError ?? d.remote?.lastError} className="ml-auto min-w-0 max-w-full" />
          {mayHaveEnding(d) && <DetailEndingBy d={d} host={hostId} targetName={targetName} />}
        </div>
        <div className="mt-0.5 text-caption/[inherit] text-subtle">
          {Number.isFinite(created) && <span title={formatAbsolute(created)}>{t("delegations.detail.created", { when: formatWhen(created, Date.now(), locale) })}</span>}
          {d.attempts > 0 && <span> · {t("delegations.detail.attempts", { n: d.attempts })}</span>}
        </div>
      </div>
      <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
        {focus && <FocusNote focus={focus} hostId={hostId} answerId={d.answerId ?? null} hasResult={!!(d.answerId || d.answerPreview)} reviewOpen={focus.approval ? approvalCardInDetail(d, focus.approval) : reviewCardInDetail(d)} />}
        <DelegationDetailBody d={d} brief={detail?.body?.text ?? null} here={null} host={hostId} layout="side" />
        <AttemptTable attempts={detail?.attempts ?? []} closed={!!d.closed} limited={openContinuationWait(d)?.state === "limited"} />
      </div>
    </div>
  );
}

/**
 * What the step that opened the detail found (spec Z3 §1–2): the result it pointed at was replaced by a newer one, there
 * is no result to show (none yet, or not visible to this connection), or the approval was decided meanwhile (another
 * window) or is not on this delegation — then the host's 审批 page stays one click away.
 */
function FocusNote({ focus, hostId, answerId, hasResult, reviewOpen }: { focus: DetailFocusRequest; hostId: string; answerId: string | null; hasResult: boolean; reviewOpen: boolean }) {
  const { t } = useI18n();
  const box = "mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-2/50 px-2.5 py-1.5 text-xs text-muted";
  if (focus.section === "result") {
    if (!hasResult) return <p className={box} data-detail-focus-note="noResult">{t("delegations.detail.noResult")}</p>;
    if (focus.answerId && answerId && focus.answerId !== answerId) return <p className={box} data-detail-focus-note="newerResult">{t("delegations.detail.newerResult")}</p>;
    return null;
  }
  if (reviewOpen) return null;
  return (
    <p className={box} data-detail-focus-note="reviewDone">
      <span>{t("delegations.detail.reviewDone")}</span>
      <button type="button" className="text-accent hover:underline" onClick={() => useApp.getState().openApprovalsOn(hostId)}>
        {t("delegations.detail.openApprovals")}
      </button>
    </p>
  );
}

/** 每次运行 (state surfaces 4.2): one row per attempt, its own word; the buttons stay the delegation's. */
function AttemptTable({ attempts, closed, limited }: { attempts: readonly AskAttemptView[]; closed: boolean; limited: boolean }) {
  const { t, locale } = useI18n();
  if (attempts.length < 1) return null;
  const when = (iso: string | null | undefined) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? formatWhen(ms / 1000, Date.now(), locale) : "";
  };
  return (
    <section className="mt-2 px-1 text-xs" data-testid="delegation-attempts">
      <h3 className="mb-1 text-caption/[inherit] font-medium text-subtle">{t("delegation.attempts.title")}</h3>
      <ul className="flex flex-col gap-0.5">
        {[...attempts].reverse().map((a, i) => {
          const key = attemptRowKey(a.state, closed, i === 0, limited);
          const word = t(`delegation.attempt.${key}` as Parameters<typeof t>[0], { raw: a.state ?? "" });
          const error = a.lastError ?? null;
          return (
            <li key={a.n ?? i} className="flex min-w-0 items-baseline gap-2" data-attempt-state={key}>
              <span className="shrink-0 text-subtle tabular-nums">{t("delegation.attempts.n", { n: a.n ?? attempts.length - i })}</span>
              <span className={`min-w-0 truncate ${key === "failed" ? "text-danger" : key === "running" ? "text-accent" : "text-muted"} ${error ? STATUS_TIP_WORD : ""}`} data-tip={error ?? undefined}>{word}</span>
              <span className="ml-auto shrink-0 text-subtle tabular-nums" title={a.startedAt ?? undefined}>{when(a.startedAt)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** r295: 「由 X」 after the header's status word (the body lists the whole sequence). */
function DetailEndingBy({ d, host, targetName }: { d: AskSummary; host: string; targetName: string }) {
  const { notices, ending } = useDelegationEnding(host, d);
  return ending ? <EndingBy notice={ending} notices={notices} targetName={targetName} className="shrink-0" /> : null;
}
