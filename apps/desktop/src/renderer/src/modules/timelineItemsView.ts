import { createContext, useContext, useMemo } from "react";
import { lacks, type AgentFeatures } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { agentHost, useApp } from "../store";
import type { AppSlotEntry } from "./slots";
import { useSlot } from "./react";

/**
 * What every row of one timeline needs from the host and the store, computed once per TimelineBody
 * (not per mounted row): the agent's host, the agent's features, and the timeline renderers.
 */
export interface TimelineView {
  sessionId: string;
  hostId: string;
  agent: AgentFeatures;
  /** timeline.tool entries shown for this agent (the same gates feed rows, work groups and activity). */
  tools: readonly AppSlotEntry<"timeline.tool">[];
  received: readonly AppSlotEntry<"timeline.received">[];
}

export const TimelineViewContext = createContext<TimelineView | null>(null);

export function useTimelineView(sessionId: string): TimelineView {
  // The open agent's host (an agent of another host in the scope opens in place).
  const hostId = useApp(agentHost);
  const agent = useAgentFeatures(sessionId);
  const allTools = useSlot("timeline.tool");
  const received = useSlot("timeline.received");
  const tools = useMemo(() => allTools.filter((entry) => entry.mode === "show" && (!entry.item.agentFeature || !lacks(agent, entry.item.agentFeature))), [allTools, agent]);
  return useMemo(() => ({ sessionId, hostId, agent, tools, received }), [sessionId, hostId, agent, tools, received]);
}

/** The enclosing TimelineBody's view (rows rendered by TimelineBody only). */
export function useTimelineContext(): TimelineView {
  const view = useContext(TimelineViewContext);
  if (!view) throw new Error("timeline row rendered outside TimelineBody");
  return view;
}
