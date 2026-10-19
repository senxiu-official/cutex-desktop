// The 委托 status category of one agent (capsule section / status-row chip): its unfinished
// delegations in two groups, 我发出的 and 发给我的. A row is one full-width button (opens the
// delegation's detail on the right side; 跳到委托卡片 / 跳到处理轮次 in its right-click menu) with a sibling 停止; 已结束 · N expands to
// the recent finished ones (same rows, time = when it ended), then a link to the 委托 page.
import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { AskSummary } from "../../../../shared/ipc";
import { DelegationStatusMark, DelegationTag } from "../../components/DelegationParts";
import { FinishedFold } from "../../components/FinishedFold";
import { StatusChip } from "../../components/StatusChip";
import { useI18n, type Locale } from "../../i18n";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { contextMenu } from "../../lib/contextMenu";
import { delegationMenu, runDelegationCommand } from "../../lib/delegationMenu";
import { useP2Access } from "../../lib/p2Access";
import { attemptSeconds, delegationActions, delegationStatus, formatSpan, isDelegationRunning, isOwnerRequest, isUnfinished, requesterName, requesterSession, waitSeconds, type DelegationContext } from "../../lib/delegations";
import { hasDelegationViews } from "../../lib/delegationStore";
import { useAgentDelegations, useAgentHost, useAgentNames, useDelegationContext, useStatusWord } from "../../lib/delegationsView";
import { formatWhen, useNow } from "../../lib/time";
import { useApp } from "../../store";
import { convFeaturesOf, useConvScope } from "../../lib/conversationScope";
import { services } from "../app";
import type { StatusBarProps } from "../slots";
import { CAPSULE_LINE, CAPSULE_ROW, CAPSULE_ROW_ACTION, CAPSULE_ROW_MAIN, capsuleRowActions } from "../../lib/capsuleRows";
import type { AgentDelegations } from "./useDelegationsStatus";
import { openDelegationDetailHere } from "./refTarget";

/** Time after a row's status: run time while running, else how long it has waited. */
function rowTime(d: AskSummary, ctx: DelegationContext, now: number, locale?: Locale): string | null {
  if (locale && !isUnfinished(d)) {
    const at = d.closedAt ?? d.updatedAt;
    return at ? formatWhen(Date.parse(at) / 1000, now, locale) : null;
  }
  if (isDelegationRunning(d, ctx)) {
    const s = attemptSeconds(d.attempt, now);
    return s === null ? null : formatSpan(s);
  }
  return d.createdAt ? formatSpan(waitSeconds(d, now)) : null;
}

function Row({ d, sessionId, mine }: { d: AskSummary; sessionId: string; mine: boolean }) {
  const { t, locale } = useI18n();
  const nameOf = useAgentNames();
  const conv = useConvScope();
  const views = useApp((s) => hasDelegationViews(convFeaturesOf(conv, s)));
  const now = useNow(true);
  const ctx = useDelegationContext()(d);
  const [armed, setArmed] = useArmed();
  const requester = requesterSession(d.requester);
  const other = mine ? (d.targetName ?? nameOf(d.target)) : isOwnerRequest(d.requester) ? t("delegation.you") : (requesterName(d.requester) ?? (requester ? nameOf(requester) : ""));
  // The open agent's status: `d` is its host's record.
  const host = useAgentHost();
  // users-p2-access: a non-owner stops a delegation only with send (lib/p2Access).
  const can = useP2Access(host).delegations ? delegationActions(d) : { stop: false };
  // The detail on the right side (owner 2026-10-13: no jump into old history); the menu keeps the
  // jumps (跳到委托卡片 also for this agent's own card: the row no longer goes there).
  const show = () => void openDelegationDetailHere(host, d.askId, d.title);
  // lib/capsuleRows: the other party and the status are the meta; 停止 takes their place on hover / focus.
  const swap = can.stop && !armed ? "group-hover/row:hidden group-focus-within/row:hidden" : "";
  return (
    <li data-capsule-row="" className={`${CAPSULE_ROW} gap-1 hover:bg-hover`}>
      <button
        onClick={show}
        onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host, views }))}
        title={[d.title, other].filter(Boolean).join("\n")}
        className={`${CAPSULE_ROW_MAIN} gap-1.5`}
      >
        <DelegationTag askId={d.askId} />
        <span className="min-w-0 flex-1 truncate">{d.title}</span>
        <span className={`max-w-[5rem] shrink-0 truncate text-[11px] text-subtle ${swap}`}>{other}</span>
        <DelegationStatusMark status={delegationStatus(d, ctx)} name={d.targetName ?? nameOf(d.target)} trailing={rowTime(d, ctx, now, locale)} className={`max-w-[40%] shrink-0 text-[11px] tabular-nums ${swap}`} />
      </button>
      {can.stop && (
        <span className={capsuleRowActions(armed)}>
          {armed ? (
            <button className={`${ARMED_BUTTON} shrink-0`} onClick={() => (setArmed(false), void runDelegationCommand(host, d, "cutex/ask/stop", t))}>
              {t("delegation.stop")}
            </button>
          ) : (
            <button onClick={() => setArmed(true)} title={t("delegation.stopConfirm")} className={`${CAPSULE_ROW_ACTION} hover:text-danger`}>
              {t("delegation.stop")}
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** The two groups + the 已结束 fold (recent finished ones inline, then the page). */
export function DelegationsBody({ sessionId, data }: { sessionId: string; data: AgentDelegations }) {
  const { t } = useI18n();
  const group = (key: "mine" | "toMe", rows: AskSummary[]) =>
    rows.length > 0 && (
      <div key={key}>
        <div data-capsule-line="" className={`${CAPSULE_LINE} h-6`}>
          {t(`delegations.${key}`)} <span className="tabular-nums">{rows.length}</span>
        </div>
        <ul>
          {rows.map((d) => (
            <Row key={d.askId} d={d} sessionId={sessionId} mine={key === "mine"} />
          ))}
        </ul>
      </div>
    );
  return (
    <div>
      {group("mine", data.mine)}
      {group("toMe", data.toMe)}
      <FinishedFold label={t("delegations.closed", { n: data.finished })} viewAll={t("delegations.viewAll")} onViewAll={() => services.ui.openPage("delegations.page", { agent: sessionId })}>
        {data.done.length > 0 && (
          <ul>
            {data.done.map((d) => (
              <Row key={d.askId} d={d} sessionId={sessionId} mine={requesterSession(d.requester) === sessionId} />
            ))}
          </ul>
        )}
      </FinishedFold>
    </div>
  );
}

/** Header meta: 最久 12m · 2 运行中. */
export function DelegationsMeta({ data }: { sessionId?: string; data: AgentDelegations }) {
  const { t } = useI18n();
  const now = useNow(true);
  const ctxOf = useDelegationContext();
  const all = [...data.mine, ...data.toMe];
  const running = all.filter((d) => isDelegationRunning(d, ctxOf(d))).length;
  const waiting = all.filter((d) => !isDelegationRunning(d, ctxOf(d)) && d.createdAt);
  const oldest = waiting.length ? Math.max(...waiting.map((d) => waitSeconds(d, now))) : null;
  return (
    <>
      {oldest !== null && <span>{t("delegations.oldest", { t: formatSpan(oldest) })}</span>}
      {oldest !== null && running > 0 && <span>·</span>}
      {running > 0 && <span>{t("delegations.running", { n: running })}</span>}
    </>
  );
}

/**
 * The collapsed line: requester side 委托 · Helper 运行中 12s +1 (the first in display order);
 * handler side only: 承接 · Lead 的委托 #3.
 */
export function DelegationLine({ data }: { data: AgentDelegations }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const word = useStatusWord();
  const ctxOf = useDelegationContext();
  const [first] = data.mine;
  const now = useNow(!!first);
  if (first) {
    const name = first.targetName ?? nameOf(first.target);
    const ctx = ctxOf(first);
    const time = rowTime(first, ctx, now);
    return (
      <>
        <span className="text-subtle">{t("delegations.statusTitle")} ·</span> <span className="font-medium">{name}</span>{" "}
        <span className="text-subtle">
          {word(delegationStatus(first, ctx), name)}
          {time && ` ${time}`}
        </span>
      </>
    );
  }
  const [handled] = data.toMe;
  if (!handled) return null;
  const requester = requesterSession(handled.requester);
  const name = isOwnerRequest(handled.requester) ? t("delegation.you") : (requesterName(handled.requester) ?? (requester ? nameOf(requester) : ""));
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{t("delegations.handling", { name })}</span>
      <DelegationTag askId={handled.askId} />
    </span>
  );
}

/** Status-row chip (委托 N ▸) with the groups in a panel floating up (placement 输入栏). */
export function DelegationsStatusBar({ sessionId, inline }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const data = useAgentDelegations(sessionId);
  const ctxOf = useDelegationContext();
  const n = data.mine.length + data.toMe.length;
  if (!inline || n === 0) return null;
  const running = [...data.mine, ...data.toMe].some((d) => isDelegationRunning(d, ctxOf(d)));
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      className={running ? "text-accent" : "text-muted"}
      label={
        <>
          <ArrowLeftRight size={13} />
          {t("delegations.count", { n })}
        </>
      }
    >
      <div className="flex h-6 items-center gap-1.5 px-2 text-[11px] text-subtle tabular-nums">
        <DelegationsMeta data={data} />
      </div>
      <DelegationsBody sessionId={sessionId} data={data} />
    </StatusChip>
  );
}
