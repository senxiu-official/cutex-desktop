// Store-backed answering-model badge of the composer's model chip (pure parts in observedModel.ts).
import { useEffect, useState } from "react";
import { sessionApi } from "../store";
import { observesModel, type AgentFeatures } from "./agentFeatures";
import { observedModelOf, type ClaudeModelStatus } from "./observedModel";
import type { TimelineState } from "./timeline";

/**
 * The model that answered this Claude agent for the current selection: the live `claude/model/observed`
 * status when one arrived, else `claude/model/status` read once per thread while online. Null for Codex
 * agents, adapters without `modelObservation`, offline runtimes and selections not yet observed.
 */
export function useObservedModel(sessionId: string, agent: AgentFeatures, online: boolean, timeline: TimelineState | null | undefined, currentModel: string | null): string | null {
  const enabled = observesModel(agent) && online;
  const threadId = timeline?.threadId ?? null;
  const key = `${sessionId}\u0000${threadId ?? ""}`;
  const [fetched, setFetched] = useState<{ key: string; status: ClaudeModelStatus | null } | null>(null);
  useEffect(() => {
    if (!enabled || !threadId) return;
    let cancelled = false;
    sessionApi(sessionId)
      .claudeModelStatus(sessionId, threadId)
      .then(
        (status) => !cancelled && setFetched({ key, status: (status as ClaudeModelStatus | null) ?? null }),
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId, threadId, key]);
  if (!enabled) return null;
  const status = timeline?.modelObservation ?? (fetched?.key === key ? fetched.status : null);
  return observedModelOf(status, currentModel);
}
