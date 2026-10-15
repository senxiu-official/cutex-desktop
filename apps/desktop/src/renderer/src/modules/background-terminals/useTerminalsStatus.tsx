// Background terminals of an agent's thread (lib/background polls them) and the category's useStatus.
import type { BackgroundTerminal } from "../../../../shared/ipc";
import { SquareTerminal } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { useBackgroundTerminals } from "../../lib/background";
import { useSessionTimeline } from "../../lib/statusItemsView";
import type { StatusLine } from "../slots";

export interface TerminalsData {
  threadId: string | null;
  terminals: BackgroundTerminal[];
  refresh(): void;
}

export function useTerminals(sessionId: string): TerminalsData {
  const timeline = useSessionTimeline(sessionId);
  const threadId = timeline?.threadId ?? null;
  const { terminals, refresh } = useBackgroundTerminals(sessionId, threadId, timeline);
  return { threadId, terminals, refresh };
}

export function useTerminalsStatus(sessionId: string): { data: TerminalsData; line: StatusLine } | null {
  const data = useTerminals(sessionId);
  const [first] = data.terminals;
  if (!first) return null;
  return {
    data,
    line: {
      icon: <SquareTerminal size={14} className="shrink-0 text-subtle" />,
      text: <span className="font-mono text-xs">{first.command}</span>,
      title: data.terminals.map((x) => x.command).join("\n"),
      trailing: <StatusMore n={data.terminals.length} />,
    },
  };
}
