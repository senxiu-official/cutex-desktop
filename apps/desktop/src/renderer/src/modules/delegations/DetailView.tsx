// The right-side delegation detail (`delegations.detail`, opened by a `delegation` ref): a header
// with #tag · title, requester → target, model and status, then the timeline card's body
// (DelegationDetailBody: brief, progress, questions, result, actions, ⋯ with 跳到委托卡片). The record
// comes from the host-keyed store (live); one the store has not loaded comes from the detail.
import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, Loader2 } from "lucide-react";
import type { AskDetail } from "../../../../shared/ipc";
import { DelegationDetailBody } from "../../components/DelegationCard";
import { DelegationHops, DelegationStatusMark, DelegationTag } from "../../components/DelegationParts";
import { Who } from "../../components/Parties";
import { PeerParty } from "../../components/PeerParty";
import { useI18n } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { delegationMenu } from "../../lib/delegationMenu";
import { attemptSeconds, delegationStatus, formatSpan, isOwnerRequest, peerSideOf, requesterName, requesterSession } from "../../lib/delegations";
import { hasDelegationViews, loadDelegationDetail, useDelegation, useDelegations } from "../../lib/delegationStore";
import { useAgentNames, useAgentProfile, useDelegationContext } from "../../lib/delegationsView";
import { hostKey } from "../../lib/hostKeys";
import { rawIdTitle, useModelName } from "../../lib/modelDisplay";
import { taskTag } from "../../lib/tasks";
import { formatAbsolute, formatWhen, useNow } from "../../lib/time";
import { featuresOf, useApp } from "../../store";
import type { SideBodyProps, SideTabInfo, SideTabProps } from "../slots";
import { detailTabTitle, summaryFromDetail, type DetailState } from "./detail";

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

export function DetailBody({ instance, hostId }: SideBodyProps<DetailState>) {
  const { t } = useI18n();
  if (!hostId) return <Note tone="danger">{t("gutter.reason.bad-ref")}</Note>;
  return <Detail hostId={hostId} askId={instance.state.askId} />;
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
      <PeerParty text={peer.name} label={peer.label} size={16} />
    ) : isOwnerRequest(d.requester) ? (
      <span className="shrink-0 font-medium text-foreground">{t("delegation.you")}</span>
    ) : (
      <Who id={requester} name={requesterName(d.requester) ?? (requester ? nameOf(requester) : null)} size={16} />
    );
  const to = peer?.side === "target" ? <PeerParty text={peer.name} label={peer.label} size={16} /> : <Who id={d.target || null} name={targetName} size={16} />;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="delegation-detail" data-ask-id={askId}>
      <div className="shrink-0 border-b border-border/60 px-3 py-2" onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host: hostId, views }))}>
        <div className="flex items-start gap-1.5 text-sm">
          <ArrowLeftRight size={14} className="mt-0.5 shrink-0 text-accent" />
          <DelegationTag askId={askId} />
          <span className="min-w-0 flex-1 font-medium break-words">{d.title || askId}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {from}
          <ArrowRight size={11} className="shrink-0 text-subtle" />
          {to}
          {model && (
            <span className="shrink-0 text-subtle" title={d.attempt?.model ? rawIdTitle(d.attempt.model, model) : undefined}>
              · {model}
            </span>
          )}
          <DelegationHops hops={d.hops} />
          <DelegationStatusMark status={status} name={targetName} trailing={took !== null ? formatSpan(took) : null} error={d.attempt?.lastError ?? d.remote?.lastError} className="ml-auto shrink-0" />
        </div>
        <div className="mt-0.5 text-[11px] text-subtle">
          {Number.isFinite(created) && <span title={formatAbsolute(created)}>{t("delegations.detail.created", { when: formatWhen(created, Date.now(), locale) })}</span>}
          {d.attempts > 0 && <span> · {t("delegations.detail.attempts", { n: d.attempts })}</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <DelegationDetailBody d={d} brief={detail?.body?.text ?? null} here={null} host={hostId} layout="side" />
      </div>
    </div>
  );
}
