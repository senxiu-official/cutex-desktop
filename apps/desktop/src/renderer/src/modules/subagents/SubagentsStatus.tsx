// The 子 agent status category: the agent's working sub-agents (collab). A row opens the sub-agent
// (a Claude task's row only when its adapter keeps transcripts: lib/claudeTasks). `/ps` hands over here when there is no
// background terminal (`ps` "agents").
import { useState } from "react";
import { Bot } from "lucide-react";
import { StatusChip } from "../../components/StatusChip";
import { useI18n } from "../../i18n";
import { canOpenSubAgent } from "../../lib/claudeTasks";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import { subAgentTooltip, type SubAgentInfo } from "../../lib/subagents";
import { useUiSignal } from "../../lib/uiSignal";
import { useApp } from "../../store";
import type { StatusBarProps } from "../slots";
import { useActiveSubAgents } from "./useSubagentsStatus";
import { openSubagentThread } from "../../lib/sideOpen";
import { CAPSULE_DOT, CAPSULE_ROW, CAPSULE_ROW_ICON, CAPSULE_ROW_META_STATIC } from "../../lib/capsuleRows";

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

export function SubagentsMeta({ data }: { sessionId: string; data: SubAgentInfo[] }) {
  return <span>{data.length}</span>;
}

export function SubagentsBody({ sessionId, data }: { sessionId: string; data: SubAgentInfo[] }) {
  return <SubAgentRows sessionId={sessionId} agents={data} />;
}

/** Status-row chip「N 子代理」+ the `/ps` hand-over. */
export function SubagentsStatusBar({ sessionId, inline, reveal }: StatusBarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const agents = useActiveSubAgents(sessionId);
  useUiSignal("ps", (arg) => {
    if (arg !== "agents") return;
    if (agents.length === 0) useApp.getState().notify(t("subagents.none"));
    else reveal("view", () => setOpen(true));
  });
  if (agents.length === 0 || (!inline && !open)) return null;
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
    </StatusChip>
  );
}
