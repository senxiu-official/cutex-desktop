// Queue panel section 待处理委托 (slot 1 of QueuePanel `sections`): delegations to this agent that
// have not started yet (owner review, queued, admitted). Row: ↙ Lead · #3 title · 排队第 1 位. The tag
// opens its detail on the right side; right click = the delegation menu (跳到委托卡片). With cutex admission-order the
// rows of delegations in the admission list are rendered in the merged queue list (QueuePanel
// `ordered`, DelegationRow); this section keeps only the pending ones that list does not have.
import { ArrowDownLeft, Hourglass } from "lucide-react";
import { HoverActions, Rail, RailRow } from "./QueueRail";
import type { AskSummary } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { delegationMenu } from "../lib/delegationMenu";
import { delegationStatus, isOwnerRequest, peerSideOf, requesterName, requesterSession } from "../lib/delegations";
import { hasDelegationViews } from "../lib/delegationStore";
import { useAgentHost, useAgentNames } from "../lib/delegationsView";
import { openDelegationDetail } from "../lib/delegationOpen";
import { selectedFeatures, useApp } from "../store";
import { ASKS_PAUSE_FEATURE, asksPauseAction } from "../lib/asksPause";
import { asksPausedKeys, STOP_HOLD_FEATURE } from "../lib/stopHold";
import { DelegationStatusMark, DelegationTag } from "./DelegationParts";
import { Who } from "./Parties";
import { PeerParty } from "./PeerParty";

export function DelegationRow({ d, sessionId, dense = false, children }: { d: AskSummary; sessionId: string; /** 24px row (turn cards). */ dense?: boolean; /** Extra parts before the status mark (e.g. the included-tells chip). */ children?: React.ReactNode }) {
  const { t } = useI18n();
  const nameOf = useAgentNames();
  const views = useApp((s) => hasDelegationViews(selectedFeatures(s)));
  // The open agent's queue: `d` is its host's record.
  const host = useAgentHost();
  const requester = requesterSession(d.requester);
  // #tag: the detail on the right side; 跳到委托卡片 is in the right-click menu.
  const show = () => openDelegationDetail(host, d.askId, { title: d.title });
  const peer = peerSideOf(d);
  return (
    <div className={`flex ${dense ? "h-6 pr-1 pl-0.5" : "h-7 px-2"} min-w-0 flex-1 items-center gap-1.5 rounded-lg text-xs text-muted hover:bg-surface-2/60`} onContextMenu={contextMenu(() => delegationMenu(d, t, nameOf, { host, here: sessionId, views }))} data-testid="queue-delegation">
      <ArrowDownLeft size={13} className="shrink-0 text-accent" />
      {peer?.side === "requester" ? <PeerParty text={peer.name} label={peer.label} size={16} /> : isOwnerRequest(d.requester) ? <span className="shrink-0 font-medium text-foreground">{t("delegation.you")}</span> : <Who id={requester} name={requesterName(d.requester) ?? (requester ? nameOf(requester) : null)} size={16} />}
      <span className="shrink-0 text-subtle">·</span>
      <DelegationTag askId={d.askId} onJump={show} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={d.title}>
        {d.title}
      </span>
      {children}
      <DelegationStatusMark status={delegationStatus(d)} name={d.targetName ?? nameOf(d.target)} className="shrink-0" />
    </div>
  );
}

/** 暂停委托 (asks-pause-v2): offered while nothing is paused; the paused section has 继续. */
export function PauseAsksButton({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const canPause = useApp((s) => selectedFeatures(s).has(ASKS_PAUSE_FEATURE) && !s.sessions[sessionId]?.asksPaused);
  const stopHolds = useApp((s) => selectedFeatures(s).has(STOP_HOLD_FEATURE));
  if (!canPause) return null;
  return (
    <button onClick={() => void asksPauseAction(() => useApp.getState().pauseAsks(sessionId))} title={t(stopHolds ? "asksPause.pauseHintStop" : "asksPause.pauseHint")} className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-warn" data-testid="asks-pause">
      {t("asksPause.pause")}
    </button>
  );
}

export function DelegationQueueSection({ rows, sessionId, pauseButton = true, railed = false }: { rows: AskSummary[]; sessionId: string; /** false: the merged queue list has 暂停委托. */ pauseButton?: boolean; /** Turn cards: no header row; ⏳ in the rail, the title as its tooltip. */ railed?: boolean }) {
  const { t } = useI18n();
  if (railed) {
    const title = t("delegation.queueTitle", { n: rows.length });
    return (
      <div role="group" aria-label={title} data-testid="pending-review-section">
        {rows.map((d, i) => (
          <RailRow key={d.askId} rail={<Rail label={title} strip={{ text: t("queue.turn.stripReview"), tone: "muted" }}>{i === 0 && <Hourglass size={12} />}</Rail>}>
            <DelegationRow d={d} sessionId={sessionId} dense />
            {i === 0 && pauseButton && (
              <HoverActions>
                <PauseAsksButton sessionId={sessionId} />
              </HoverActions>
            )}
          </RailRow>
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="flex h-6 items-center gap-2 px-2 text-[11px] text-subtle">
        <span className="flex-1">{t("delegation.queueTitle", { n: rows.length })}</span>
        {pauseButton && <PauseAsksButton sessionId={sessionId} />}
      </div>
      {rows.map((d) => (
        <DelegationRow key={d.askId} d={d} sessionId={sessionId} />
      ))}
    </>
  );
}

/**
 * Section 委托已暂停 · 继续 (asks-pause-v2): the owner paused new delegations to this agent (暂停委托).
 * Delegations stay queued until 继续 or the owner's next message. With stop-holds-ridealongs a stop
 * holds them too (`origin: "ownerStop"`, lib/stopHold): 「委托已随停止暂停 · 继续发送」, the same
 * 继续发送 as the paused queue (queue resume releases the whole stop hold).
 */
export function AsksPausedSection({ sessionId, railed = false }: { sessionId: string; /** Turn cards: ❚❚ in the queue rail column, like the paused divider. */ railed?: boolean }) {
  const { t } = useI18n();
  const pause = useApp((s) => s.sessions[sessionId]?.asksPaused ?? null);
  if (!pause) return null;
  const keys = asksPausedKeys(pause);
  const resume = keys.resume === "queue" ? () => useApp.getState().resumePaused(sessionId) : () => useApp.getState().resumeAsks(sessionId);
  // On the queue's grid: the glyph in the rail column (22px, turn cards) or the heading glyph cell
  // (16px, as QueuePanel's paused heading), the title where every other section's text starts.
  const body = (
    <div className={`flex h-6 min-w-0 flex-1 items-center gap-1.5 pr-1 ${railed ? "pl-0.5" : ""} text-[11px] text-warn-text`}>
      {!railed && (
        <span className="flex w-4 shrink-0 items-center justify-center self-stretch text-[8px] leading-none" aria-hidden>
          ❚❚
        </span>
      )}
      <span className="min-w-0 flex-1 truncate" title={t(keys.hint)}>
        {t(keys.title)}
      </span>
      <button onClick={() => void asksPauseAction(resume)} title={t(keys.buttonHint)} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent" data-testid="asks-resume">
        {t(keys.button)}
      </button>
    </div>
  );
  return railed ? (
    <RailRow rail={<Rail label={t(keys.title)} className="text-warn-text"><span className="text-[8px] leading-none" aria-hidden>❚❚</span></Rail>} testId="asks-paused" data-origin={pause.origin}>
      {body}
    </RailRow>
  ) : (
    <div className="flex min-w-0 pl-0.5" data-testid="asks-paused" data-origin={pause.origin}>
      {body}
    </div>
  );
}
