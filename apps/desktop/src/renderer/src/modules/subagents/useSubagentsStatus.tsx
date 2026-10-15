// Working sub-agents of an agent and the category's useStatus.
import { Bot } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { activeSubAgents, useAgentOnline, useSubAgentLive } from "../../lib/background";
import { useSessionTimeline } from "../../lib/statusItemsView";
import type { SubAgentInfo } from "../../lib/subagents";
import { useSubAgentMeta } from "../../lib/subagentMetaStore";
import type { StatusLine } from "../slots";

export function useActiveSubAgents(sessionId: string): SubAgentInfo[] {
  const timeline = useSessionTimeline(sessionId);
  const online = useAgentOnline(sessionId);
  const live = useSubAgentLive(sessionId);
  const meta = useSubAgentMeta();
  return activeSubAgents(timeline, online, live, meta);
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
