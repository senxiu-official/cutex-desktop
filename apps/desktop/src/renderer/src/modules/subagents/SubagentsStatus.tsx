// The 子 agent status category: the agent's working sub-agents (collab), then a 最近完成 fold of the
// last finished ones (lib/finishedSubagents). A row opens the sub-agent (a Claude task's row only when its
// adapter keeps transcripts: lib/claudeTasks). `/ps` hands over here when there is no background terminal
// (`ps` "agents").
//
// Nothing working: no capsule line and no status-row chip (useStatus is null, so the capsule has no
// section for it either). The finished ones are then reached through `/ps`: the Bar opens its own panel
// with just the 最近完成 group instead of saying nothing runs.
import { useState } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { StatusChip } from "../../components/StatusChip";
import { useI18n } from "../../i18n";
import { formatElapsed } from "../../lib/agentAttention";
import { canOpenSubAgent } from "../../lib/claudeTasks";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import type { FinishedOutcome, FinishedSubAgent } from "../../lib/finishedSubagents";
import { subAgentTooltip, type SubAgentInfo } from "../../lib/subagents";
import { useUiSignal } from "../../lib/uiSignal";
import { useApp } from "../../store";
import type { StatusBarProps } from "../slots";
import { useActiveSubAgents, useFinishedSpanReads, useFinishedSubAgents, useFinishedSubAgentsNow } from "./useSubagentsStatus";
import { openSubagentThread } from "../../lib/sideOpen";
import { CAPSULE_DOT, CAPSULE_LINE, CAPSULE_ROW, CAPSULE_ROW_ICON, CAPSULE_ROW_META_STATIC } from "../../lib/capsuleRows";

/** One row per sub-agent (lib/capsuleRows): status dot · name · what it does now (else its task) ·
 *  the status word. */
function SubAgentRows({ sessionId, agents }: { sessionId: string; agents: SubAgentInfo[] }) {
  const { t } = useI18n();
  const features = useAgentFeatures(sessionId);
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
              {(a.message || a.task) && <span className="ml-1.5 text-subtle">{a.message || a.task}</span>}
            </span>
            <span className={CAPSULE_ROW_META_STATIC}>{t(starting ? "subagents.starting" : "subagents.working")}</span>
          </>
        );
        const tip = [a.task, a.message].filter(Boolean).join("\n");
        // A Claude task of an adapter without transcripts: status only, nothing to open.
        return !canOpenSubAgent(a.threadId, features) ? (
          <div key={a.threadId} data-capsule-row="" title={[t("sub.claudeTask"), tip].filter(Boolean).join("\n")} className={CAPSULE_ROW}>
            {body}
          </div>
        ) : (
          <button key={a.threadId} data-capsule-row="" title={subAgentTooltip(a.threadId, a)} onClick={() => void openSubagentThread(a.threadId, sessionId)} className={`${CAPSULE_ROW} w-full text-left hover:bg-hover`}>
            {body}
          </button>
        );
      })}
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
              {a.background && <span className="ml-1.5 text-subtle">{t("subagents.recent.background")}</span>}
            </span>
            <span className={CAPSULE_ROW_META_STATIC}>
              {a.durationMs !== null && `${formatElapsed(a.durationMs)} · `}
              {t(`subagents.outcome.${a.outcome}`)}
            </span>
          </>
        );
        const openable = !!a.threadId && !a.background && canOpenSubAgent(a.threadId, features);
        if (openable)
          return (
            <button key={a.key} data-capsule-row="" data-finished-subagent="" title={[subAgentTooltip(a.threadId!), a.task].filter(Boolean).join("\n")} onClick={() => void openSubagentThread(a.threadId!, sessionId)} className={`${CAPSULE_ROW} w-full text-left hover:bg-hover`}>
              {body}
            </button>
          );
        const why = a.background ? t("subagents.recent.background") : a.threadId ? t("sub.claudeTask") : t("subagents.recent.noTranscript");
        return (
          <div key={a.key} data-capsule-row="" data-finished-subagent="" title={[why, a.task].filter(Boolean).join("\n")} className={CAPSULE_ROW}>
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
  const rows = useFinishedSubAgents(sessionId);
  const [open, setOpen] = useState(initiallyOpen);
  if (rows.length === 0) return null;
  return (
    <>
      <button onClick={() => setOpen(!open)} aria-expanded={open} data-capsule-line="" className={`${CAPSULE_LINE} gap-1 hover:bg-hover hover:text-foreground`}>
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
  const agents = useActiveSubAgents(sessionId);
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
