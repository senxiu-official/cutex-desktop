// Pure schema dispatch. Registrations own schemas; missing/disabled entries always use the core row.
import { CODEX_FEATURES, lacks, type AgentFeatures } from "./agentFeatures";
import type { ExternalMessage } from "./timeline";
import type { AppSlotEntry } from "../modules/slots";

export function receivedRendererFor(message: ExternalMessage, entries: readonly AppSlotEntry<"timeline.received">[], agent: AgentFeatures = CODEX_FEATURES): AppSlotEntry<"timeline.received"> | undefined {
  return entries.find((entry) => entry.mode === "show" && (!entry.item.agentFeature || !lacks(agent, entry.item.agentFeature)) && entry.item.schemas.includes(message.schema ?? ""));
}
