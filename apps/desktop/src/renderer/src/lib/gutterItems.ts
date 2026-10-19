// `conversation.gutter` items of an agent (docs/desktop-modules.md §19.3), split by side, in order.
// Hidden for an agent that says it lacks an item's agentFeature (lacks()), and on a host whose cutex
// lacks the module's / item's capabilities (the module may be active for another host in the scope).
import { useMemo } from "react";
import { useSlot } from "../modules/react";
import type { AppSlotEntry } from "../modules/slots";
import { useConvHost } from "./conversationScope";
import { lacks } from "./agentFeatures";
import { useAgentFeatures } from "./agentFeaturesView";
import { useHostEntryGate } from "./hostGatingView";

export type GutterEntry = AppSlotEntry<"conversation.gutter">;

/** `hostId`: the conversation's host (the items' calls go there). */
export function useGutterItems(sessionId: string, hostId: string): { left: GutterEntry[]; right: GutterEntry[] } {
  const entries = useSlot("conversation.gutter");
  const agent = useAgentFeatures(sessionId);
  const onHost = useHostEntryGate(hostId);
  return useMemo(() => {
    const shown = entries.filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)) && onHost(e));
    const by = (side: "left" | "right") => shown.filter((e) => e.item.side === side).sort((a, b) => a.item.order - b.item.order);
    return { left: by("left"), right: by("right") };
  }, [entries, agent, onHost]);
}

/** `timeline.turnAttachment` items of an agent, in order (the outlet is modules/TurnAttachments.tsx). */
export function useTurnAttachmentItems(sessionId: string): AppSlotEntry<"timeline.turnAttachment">[] {
  const entries = useSlot("timeline.turnAttachment");
  const agent = useAgentFeatures(sessionId);
  // The outlet renders attachments with the conversation's host (modules/TurnAttachments.tsx).
  const onHost = useHostEntryGate(useConvHost());
  return useMemo(
    () => entries.filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)) && onHost(e)).sort((a, b) => (a.item.order ?? 500) - (b.item.order ?? 500)),
    [entries, agent, onHost],
  );
}
