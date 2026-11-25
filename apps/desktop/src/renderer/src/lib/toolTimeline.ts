// The timeline tool rows read their turn state from (PlainToolRow's liveness: running / interrupted /
// background). The desktop leaves it unset and rows read the agent's view in the store; a host that
// renders the shared rows without filling the store (the iPad conversation) provides its own.
import { createContext } from "react";
import type { TimelineState } from "./timeline";

export interface ToolTimeline {
  timeline: Pick<TimelineState, "entries" | "turns"> | null;
  /** Item ids still running in the background (shell sessions); none when omitted. */
  background?: readonly string[];
}

export const ToolTimelineContext = createContext<ToolTimeline | null>(null);

/** Whether the turn an item belongs to is still running (an item without a known turn counts as running). */
export function turnRunningOf(timeline: ToolTimeline["timeline"] | undefined, itemId: string): boolean {
  const entry = timeline?.entries.get(itemId);
  const turn = entry?.turnId ? timeline!.turns.find((x) => x.id === entry.turnId) : undefined;
  return !turn || turn.status === "inProgress";
}
