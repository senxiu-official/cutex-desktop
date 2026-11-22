// Background terminals of an agent's thread (lib/background polls them) and the category's useStatus. With the agent
// offline (disconnected) the last rows read can't be confirmed: `unconfirmed`, each with a local 结束跟进 that hides
// it here (state surfaces S12, lib/localFollowUp).
import type { BackgroundTerminal } from "../../../../shared/ipc";
import { SquareTerminal } from "lucide-react";
import { StatusMore } from "../../components/StatusChip";
import { useAgentOnline, useAgentRuntimeGeneration, useBackgroundTerminals } from "../../lib/background";
import { useConvViewHost } from "../../lib/conversationScope";
import { terminalFollowUpKey, useLocalFollowUpEnded } from "../../lib/localFollowUp";
import { useSessionTimeline } from "../../lib/statusItemsView";
import type { StatusLine } from "../slots";
import { useAgentFeatures } from "../../lib/agentFeaturesView";

export interface TerminalsData {
  threadId: string | null;
  terminals: BackgroundTerminal[];
  refresh(): void;
  claude?: boolean;
  startedAt?: Record<string, number>;
  /** The agent is offline: these rows are what was read before, not confirmed now. */
  unconfirmed?: boolean;
  /** The local 结束跟进 key of a terminal (lib/localFollowUp). */
  followUpKey?(processId: string): string;
}

export function useTerminals(sessionId: string): TerminalsData {
  const timeline = useSessionTimeline(sessionId);
  const threadId = timeline?.threadId ?? null;
  const { terminals: read, refresh } = useBackgroundTerminals(sessionId, threadId, timeline);
  const claude = useAgentFeatures(sessionId).runtime === "claude";
  const online = useAgentOnline(sessionId);
  const hostId = useConvViewHost(sessionId);
  const generation = useAgentRuntimeGeneration(sessionId);
  const ended = useLocalFollowUpEnded();
  const followUpKey = (processId: string) => terminalFollowUpKey(hostId, sessionId, generation, processId);
  const terminals = read.filter((term) => !ended[followUpKey(term.processId)]);
  const startedAt: Record<string, number> = {};
  for (const term of terminals) {
    const entry = timeline?.entries.get(term.itemId);
    if (entry?.kind === "tool" && typeof entry.item.startedAtMs === "number") startedAt[term.processId] = entry.item.startedAtMs;
  }
  return { threadId, terminals, refresh, claude, startedAt, unconfirmed: !online, followUpKey };
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
