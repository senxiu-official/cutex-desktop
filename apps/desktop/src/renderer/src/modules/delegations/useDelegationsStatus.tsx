// useStatus of the 委托 category: present while the agent has unfinished delegations (either side).
import { ArrowLeftRight } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { useAgentDelegations } from "../../lib/delegationsView";
import type { StatusLine } from "../slots";
import { DelegationLine } from "./DelegationStatus";

/** Unfinished delegations by direction + the recent finished ones (newest first, capped) and their count. */
export type AgentDelegations = ReturnType<typeof useAgentDelegations>;

export function useDelegationsStatus(sessionId: string): { data: AgentDelegations; line: StatusLine } | null {
  const data = useAgentDelegations(sessionId);
  const n = data.mine.length + data.toMe.length;
  if (n === 0) return null;
  return {
    data,
    line: {
      icon: <ArrowLeftRight size={14} className="shrink-0 text-subtle" />,
      text: <DelegationLine data={data} />,
      title: [...data.mine, ...data.toMe].map((d) => d.title).join("\n"),
      trailing: <StatusMore n={n} />,
    },
  };
}
