// Working and recently finished sub-agents of an agent, and the category's useStatus.
import { useEffect } from "react";
import { Bot } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { activeSubAgents, useAgentOnline, useSubAgentLive } from "../../lib/background";
import { useAgentFeatures } from "../../lib/agentFeaturesView";
import { canOpenSubAgent } from "../../lib/claudeTasks";
import { finishedSubAgents, subAgentSpanFromThreadRead, type FinishedSubAgent } from "../../lib/finishedSubagents";
import { useSessionTimeline } from "../../lib/statusItemsView";
import { subAgentMetaFromThreadRead, type SubAgentInfo } from "../../lib/subagents";
import { recordSubAgentMeta, recordSubAgentSpan, useSubAgentMeta, useSubAgentSpans } from "../../lib/subagentMetaStore";
import { useApp } from "../../store";
import { convApi, convViewOf, useConvScope } from "../../lib/conversationScope";
import type { StatusLine } from "../slots";

export function useActiveSubAgents(sessionId: string): SubAgentInfo[] {
  const timeline = useSessionTimeline(sessionId);
  const online = useAgentOnline(sessionId);
  const live = useSubAgentLive(sessionId);
  const meta = useSubAgentMeta();
  return activeSubAgents(timeline, online, live, meta);
}

/** The 最近完成 group: the agent's last finished sub-agents, newest first (lib/finishedSubagents). */
export function useFinishedSubAgents(sessionId: string): FinishedSubAgent[] {
  const timeline = useSessionTimeline(sessionId);
  const live = useSubAgentLive(sessionId);
  const meta = useSubAgentMeta();
  const spans = useSubAgentSpans();
  return finishedSubAgents(timeline, { live, meta, spans });
}

/** The same list on demand (a `/ps` request), without deriving it on every timeline change. */
export function useFinishedSubAgentsNow(sessionId: string): () => FinishedSubAgent[] {
  const live = useSubAgentLive(sessionId);
  const meta = useSubAgentMeta();
  const conv = useConvScope();
  return () => finishedSubAgents(convViewOf(conv, useApp.getState(), sessionId)?.timeline ?? null, { live, meta });
}

/** Span reads asked for in this app session, by `sessionId:threadId`. */
const spanReads = new Set<string>();

/**
 * While the 最近完成 group shows: one light read (no turns) of each listed sub-agent whose duration is
 * not known yet (a Codex child read while it still worked, or never), for its span. Once per app
 * session; only what could be opened, and only while the parent is online (like the settle reads).
 */
export function useFinishedSpanReads(sessionId: string, rows: FinishedSubAgent[]): void {
  const online = useAgentOnline(sessionId);
  const features = useAgentFeatures(sessionId);
  const due = rows.flatMap((r) => (r.threadId && r.durationMs === null && !r.background && canOpenSubAgent(r.threadId, features) && !spanReads.has(`${sessionId}:${r.threadId}`) ? [r.threadId] : []));
  const key = due.join("\n");
  const conv = useConvScope();
  useEffect(() => {
    if (!online) return;
    for (const threadId of due) {
      spanReads.add(`${sessionId}:${threadId}`);
      convApi(conv, sessionId).subAgentThread(sessionId, threadId, { includeTurns: false }).then(
        (result) => {
          recordSubAgentMeta(threadId, subAgentMetaFromThreadRead(result));
          recordSubAgentSpan(threadId, subAgentSpanFromThreadRead(result));
        },
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` summarises `due`
  }, [sessionId, online, key]);
}

export function useSubagentsStatus(sessionId: string): { data: SubAgentInfo[]; line: StatusLine } | null {
  const agents = useActiveSubAgents(sessionId);
  const [first] = agents;
  if (!first) return null;
  const doing = first.message ?? first.task;
  return {
    data: agents,
    line: {
      icon: <Bot size={14} className="shrink-0 text-subtle" />,
      text: (
        <>
          <span className="font-medium">{first.name}</span>
          {doing && <span className="ml-1.5 text-subtle">{doing}</span>}
        </>
      ),
      title: agents.map((a) => a.name).join(", "),
      trailing: <StatusMore n={agents.length} />,
    },
  };
}
