// Pure selection shared by rows, grouping and the live activity line. Never consult a second registry.
import { CODEX_FEATURES, lacks, type AgentFeatures } from "./agentFeatures";
import type { RawItem } from "./timeline";
import type { AppSlotEntry } from "../modules/slots";

export function toolRendererFor(item: RawItem, entries: readonly AppSlotEntry<"timeline.tool">[], agent: AgentFeatures = CODEX_FEATURES): AppSlotEntry<"timeline.tool"> | undefined {
  // The host already sorted entries; the first available matching renderer wins for all three uses.
  return entries.find((entry) => entry.mode === "show" && (!entry.item.agentFeature || !lacks(agent, entry.item.agentFeature)) && entry.item.match(item));
}
