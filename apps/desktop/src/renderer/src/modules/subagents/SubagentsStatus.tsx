// The 子 agent status category: the agent's working sub-agents (collab), then a 最近完成 fold of the
// last finished ones (lib/finishedSubagents). A row opens the sub-agent (a Claude task's row only when its
// adapter keeps transcripts: lib/claudeTasks). A running Claude background subagent (claude-r23) also has
// 停止 (`claude/tasks/stop`, click twice), which stops only it, never the agent's turn. `/ps` hands over
// here when there is no background terminal (`ps` "agents").
//
// With the agent offline (disconnected), the sub-agents last heard working read 结果未确认 with a local 结束跟进
// (state surfaces S12). After 停止 on a Claude background subagent the row says what came of it — 已请求停止 /
// 停止被拒绝（原因） / 停止结果未确认 (N13, lib/claudeTaskStop) — and keeps running until the task's update ends it.
//
// Nothing working: no capsule line and no status-row chip (useStatus is null, so the capsule has no
// section for it either). The finished ones are then reached through `/ps`: the Bar opens its own panel
// with just the 最近完成 group instead of saying nothing runs.
import { useState, type ReactNode } from "react";
import { LocalEndFollowUp } from "../../components/LocalEndFollowUp";
import { useAgentOnline } from "../../lib/background";
import { claudeStopOutcome, recordStopOutcome, stopOutcomeOf, useStopOutcomes, type StopOutcome } from "../../lib/claudeTaskStop";
import { endLocalFollowUp, subagentFollowUpKey } from "../../lib/localFollowUp";
import { Bot, ChevronDown, ChevronRight, Square } from "lucide-react";
import { StatusChip } from "../../components/StatusChip";
import { useI18n } from "../../i18n";
import { formatElapsed } from "../../lib/agentAttention";
import { canOpenSubAgent, claudeTaskIdOf } from "../../lib/claudeTasks";
import { stopsClaudeTasks } from "../../lib/agentFeatures";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import { ARMED_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { backgroundClaudeRefs, type FinishedOutcome, type FinishedSubAgent } from "../../lib/finishedSubagents";
import { useSessionTimeline } from "../../lib/statusItemsView";
import { subAgentTooltip, type SubAgentInfo } from "../../lib/subagents";
import { useUiSignal } from "../../lib/uiSignal";
import { useApp } from "../../store";
import type { StatusBarProps } from "../slots";
import { useFinishedSpanReads, useFinishedSubAgents, useFinishedSubAgentsNow, useShownSubAgents } from "./useSubagentsStatus";
import { openSubagentThread } from "../../lib/sideOpen";
import { convApi, convFeaturesOf, convNotify, useConvScope, useConvViewHost } from "../../lib/conversationScope";
import { CAPSULE_DOT, CAPSULE_LINE, CAPSULE_ROW, CAPSULE_ROW_ACTION, CAPSULE_ROW_ICON, CAPSULE_ROW_MAIN, CAPSULE_ROW_META, CAPSULE_ROW_META_STATIC, capsuleRowActions } from "../../lib/capsuleRows";
import { useUserLayoutToggle } from "../../lib/userLayoutToggle";
import { claudeTaskApprovalKey, useClaudeTaskApprovals } from "../../lib/claudeTaskApprovals";

/** A running Claude background subagent's row: opens it (main button) and stops it (停止, click twice:
 *  lib/armedConfirm). Stopping ends only this subagent; the agent hears of it from cutex ("Claude Task"). */
function BackgroundSubAgentRow({ a, body, tip, onOpen, onStop, outcome }: { a: SubAgentInfo; body: ReactNode; tip: string; onOpen(): void; onStop(): Promise<void>; outcome: StopOutcome | null }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  const said = outcome ? t(`subagents.stopOutcome.${outcome.outcome}`, { reason: outcome.reason ?? t("subagents.stopOutcome.noReason") }) : null;
  return (
    <div data-capsule-row="" data-background-subagent="" data-stop-outcome={outcome?.outcome} data-tip={outcome ? `${said}\n${t(`subagents.stopOutcome.${outcome.outcome}Hint`)}\n${tip}` : tip} className={`${CAPSULE_ROW} border transition-colors ${armed ? ARMED_FRAME : "border-transparent hover:bg-hover"}`}>
      <button onClick={onOpen} className={CAPSULE_ROW_MAIN}>
        {body}
      </button>
      {armed ? <span className="shrink-0 text-caption/[inherit] text-danger">{t("subagents.stopAgain")}</span> : <span className={`${CAPSULE_ROW_META} ${outcome && outcome.outcome !== "accepted" ? "text-warn-text" : ""}`}>{said ?? t("subagents.background")}</span>}
      <span className={capsuleRowActions(armed)}>
        <button
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            void onStop();
          }}
          data-tip={t("subagents.stop.title", { name: a.name })}
          aria-label={t("subagents.stop")}
          className={armed ? `${ARMED_BUTTON} shrink-0` : `${CAPSULE_ROW_ACTION} hover:text-danger`}
        >
          {armed ? t("subagents.stop") : <Square size={12} />}
        </button>
      </span>
    </div>
  );
}

/** One row per sub-agent (lib/capsuleRows): status dot · name · what it does now (else its task) ·
 *  the status word. */
function SubAgentRows({ sessionId, agents }: { sessionId: string; agents: SubAgentInfo[] }) {
  const { t } = useI18n();
  const features = useAgentFeatures(sessionId);
  const timeline = useSessionTimeline(sessionId);
  const conv = useConvScope();
  const hostId = useConvViewHost(sessionId);
  const online = useAgentOnline(sessionId);
  useStopOutcomes();
  const canStop = useApp((s) => stopsClaudeTasks(features, convFeaturesOf(conv, s)));
  const background = canStop ? backgroundClaudeRefs(timeline) : null;
  // r295: a background Claude subagent's tool approval was declined unattended (no button: nothing to approve now).
  const approvals = useClaudeTaskApprovals((s) => s.byKey);
  const denied = (threadId: string) => !!approvals[claudeTaskApprovalKey(hostId, threadId)];
  const stop = async (ref: string) => {
    const taskId = claudeTaskIdOf(ref);
    if (!taskId || !timeline?.threadId) return;
    try {
      // The bridge passes no answer on yet (outcome `unknown` then): see lib/claudeTaskStop.
      const answer: unknown = await convApi(conv, sessionId).stopClaudeTask(sessionId, timeline.threadId, taskId);
      recordStopOutcome(sessionId, ref, claudeStopOutcome(answer));
    } catch (e) {
      convNotify(conv, e instanceof Error ? e.message : String(e), "error");
    }
  };
  if (!online) return <UnconfirmedRows sessionId={sessionId} hostId={hostId} agents={agents} />;
  return (
    <div>
      {agents.map((a) => {
        const starting = a.status === "pendingInit";
        const body = (
          <>
            <span className={CAPSULE_ROW_ICON}>
              <span aria-hidden className={`${CAPSULE_DOT} ${starting ? "bg-subtle" : "bg-accent"}`} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">{a.name}</span>
              {denied(a.threadId) ? (
                <span data-approval-denied="" className="ml-1.5 text-warn-text">{t("subagents.deniedUnattended")}</span>
              ) : (a.message || a.task) && <span className="ml-1.5 text-subtle">{a.message || a.task}</span>}
            </span>
            <span className={CAPSULE_ROW_META_STATIC}>{t(starting ? "subagents.starting" : "subagents.working")}</span>
          </>
        );
        const deniedHint = denied(a.threadId) ? t("subagents.deniedUnattendedHint") : null;
        const tip = [deniedHint, a.task, a.message].filter(Boolean).join("\n");
        if (background?.has(a.threadId) && !starting)
          return <BackgroundSubAgentRow key={a.threadId} a={a} body={body} tip={[deniedHint, subAgentTooltip(a.threadId, a)].filter(Boolean).join("\n")} outcome={stopOutcomeOf(sessionId, a.threadId)} onOpen={() => void openSubagentThread(a.threadId, sessionId)} onStop={() => stop(a.threadId)} />;
        // A Claude task of an adapter without transcripts: status only, nothing to open.
        return !canOpenSubAgent(a.threadId, features) ? (
          <div key={a.threadId} data-capsule-row="" data-tip={[t("sub.claudeTask"), tip].filter(Boolean).join("\n")} className={CAPSULE_ROW}>
            {body}
          </div>
        ) : (
          <button key={a.threadId} data-capsule-row="" data-tip={subAgentTooltip(a.threadId, a)} onClick={() => void openSubagentThread(a.threadId, sessionId)} className={`${CAPSULE_ROW} w-full text-left hover:bg-hover`}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** The agent is offline: its sub-agents last heard working can't be confirmed (结果未确认); 结束跟进 hides one here. */
function UnconfirmedRows({ sessionId, hostId, agents }: { sessionId: string; hostId: string; agents: SubAgentInfo[] }) {
  const { t } = useI18n();
  return (
    <div>
      {agents.map((a) => (
        <div key={a.threadId} data-capsule-row="" data-subagent-unconfirmed="" data-tip={[t("subagents.unconfirmedHint"), a.task].filter(Boolean).join("\n")} className={CAPSULE_ROW}>
          <span className={CAPSULE_ROW_ICON}>
            <span aria-hidden className={`${CAPSULE_DOT} bg-warn`} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">{a.name}</span>
            {(a.message || a.task) && <span className="ml-1.5 text-subtle">{a.message || a.task}</span>}
          </span>
          <span className={`${CAPSULE_ROW_META} text-warn-text`}>{t("subagents.unconfirmed")}</span>
          <span className={capsuleRowActions(false)}>
            <LocalEndFollowUp onEnd={() => endLocalFollowUp([subagentFollowUpKey(hostId, sessionId, a.threadId)])} />
          </span>
        </div>
      ))}
    </div>
  );
}

const OUTCOME_DOT: Record<FinishedOutcome, string> = { completed: "bg-ok", failed: "bg-danger", stopped: "bg-subtle" };

/** One row per finished sub-agent: outcome dot · name · type · duration · outcome word. Opens like a
 *  running row; a background Claude subagent or one without a transcript is plain text with the reason. */
function FinishedRows({ sessionId, rows }: { sessionId: string; rows: FinishedSubAgent[] }) {
  const { t } = useI18n();
  const features = useAgentFeatures(sessionId);
  useFinishedSpanReads(sessionId, rows);
  return (
    <>
      {rows.map((a) => {
        const name = a.name ?? t("subagents.claude.agent");
        const type = a.type && !name.endsWith(` · ${a.type}`) ? a.type : null;
        const body = (
          <>
            <span className={CAPSULE_ROW_ICON}>
              <span aria-hidden className={`${CAPSULE_DOT} ${OUTCOME_DOT[a.outcome]}`} />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground">{name}</span>
              {type && <span className="ml-1.5 text-subtle">{type}</span>}
              {a.background && <span className="ml-1.5 text-subtle">{t(a.noTranscript ? "subagents.recent.background" : "subagents.background")}</span>}
            </span>
            <span className={CAPSULE_ROW_META_STATIC}>
              {a.durationMs !== null && `${formatElapsed(a.durationMs)} · `}
              {t(`subagents.outcome.${a.outcome}`)}
            </span>
          </>
        );
        const openable = !!a.threadId && !a.noTranscript && canOpenSubAgent(a.threadId, features);
        if (openable)
          return (
            <button key={a.key} data-capsule-row="" data-finished-subagent="" data-tip={[subAgentTooltip(a.threadId!), a.task].filter(Boolean).join("\n")} onClick={() => void openSubagentThread(a.threadId!, sessionId)} className={`${CAPSULE_ROW} w-full text-left hover:bg-hover`}>
              {body}
            </button>
          );
        const why = a.noTranscript ? t("subagents.recent.background") : a.threadId ? t("sub.claudeTask") : t("subagents.recent.noTranscript");
        return (
          <div key={a.key} data-capsule-row="" data-finished-subagent="" data-tip={[why, a.task].filter(Boolean).join("\n")} className={CAPSULE_ROW}>
            {body}
          </div>
        );
      })}
    </>
  );
}

/** 「最近完成 · N」: folded under working sub-agents, open when it is all there is. */
export function FinishedGroup({ sessionId, initiallyOpen }: { sessionId: string; initiallyOpen: boolean }) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  const rows = useFinishedSubAgents(sessionId);
  const [open, setOpen] = useState(initiallyOpen);
  if (rows.length === 0) return null;
  return (
    <>
      <button onClick={() => userToggle(() => setOpen(!open))} aria-expanded={open} data-capsule-line="" className={`${CAPSULE_LINE} gap-1 hover:bg-hover hover:text-foreground`}>
        {t("subagents.recent", { n: rows.length })}
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
      </button>
      {open && <FinishedRows sessionId={sessionId} rows={rows} />}
    </>
  );
}

export function SubagentsMeta({ data }: { sessionId: string; data: SubAgentInfo[] }) {
  return <span>{data.length}</span>;
}

export function SubagentsBody({ sessionId, data }: { sessionId: string; data: SubAgentInfo[] }) {
  return (
    <>
      <SubAgentRows sessionId={sessionId} agents={data} />
      <FinishedGroup sessionId={sessionId} initiallyOpen={false} />
    </>
  );
}

/** Status-row chip「N 子代理」+ the `/ps` hand-over (with nothing working: a panel of the 最近完成 group). */
export function SubagentsStatusBar({ sessionId, inline, reveal }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const agents = useShownSubAgents(sessionId);
  const finishedNow = useFinishedSubAgentsNow(sessionId);
  useUiSignal("ps", (arg) => {
    if (arg !== "agents") return;
    if (agents.length > 0) reveal("view", () => setOpen(true));
    else if (finishedNow().length > 0) setOpen(true);
    else useApp.getState().notify(t("subagents.none"));
  });
  if (agents.length === 0 && !open) return null;
  if (agents.length === 0)
    return (
      <StatusChip open={open} onOpenChange={setOpen} panelClassName="right-6 w-[28rem]" label={<><Bot size={13} />{t("subagents.recentTitle")}</>}>
        <FinishedGroup sessionId={sessionId} initiallyOpen />
      </StatusChip>
    );
  if (!inline && !open) return null;
  return (
    <StatusChip
      open={open}
      onOpenChange={setOpen}
      panelClassName="right-6 w-[28rem]"
      label={
        <>
          <Bot size={13} />
          {t("subagents.count", { n: agents.length })}
        </>
      }
    >
      <SubAgentRows sessionId={sessionId} agents={agents} />
      <FinishedGroup sessionId={sessionId} initiallyOpen={false} />
    </StatusChip>
  );
}
