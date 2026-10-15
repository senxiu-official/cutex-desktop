// `timeline.codeBlockAction` items for one conversation (docs/desktop-modules.md §22): shown, not lacking
// the agent's features, and offered by the conversation's host (module ∪ item capabilities, like the
// gutter items, lib/gutterItems.ts). `match` (lib/codeBlockScope.ts) then picks the blocks.
import { useMemo } from "react";
import type { HostPlatform } from "../../../shared/hosts";
import { useSlot } from "../modules/react";
import { useApp } from "../store";
import { lacks } from "./agentFeatures";
import { useAgentFeatures } from "./agentFeaturesView";
import { useHostEntryGate } from "./hostGatingView";

import type { CodeBlockActionEntry } from "./codeBlockScope";

/** A host's OS as the host list knows it (null: unknown / never connected). */
export function useHostPlatform(hostId: string): HostPlatform | null {
  return useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.platform ?? null);
}

/** The items that may act in this conversation (before `match`). */
export function useCodeBlockActionItems(sessionId: string, hostId: string): CodeBlockActionEntry[] {
  const entries = useSlot("timeline.codeBlockAction");
  const agent = useAgentFeatures(sessionId);
  const onHost = useHostEntryGate(hostId);
  return useMemo(() => entries.filter((e) => e.mode === "show" && !(agent && e.item.agentFeature && lacks(agent, e.item.agentFeature)) && onHost(e)), [entries, agent, onHost]);
}
