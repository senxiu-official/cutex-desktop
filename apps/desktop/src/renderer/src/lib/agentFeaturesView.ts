// Store-backed access to an agent's features (pure helpers in agentFeatures.ts).
import { useMemo } from "react";
import { useApp } from "../store";
import { agentFeaturesOf, type AgentFeatures } from "./agentFeatures";
import { viewRow } from "./viewHost";

type State = ReturnType<typeof useApp.getState>;

function resourceOf(state: State, sessionId: string | null) {
  // The open agent may live on another host than the focus host (its host's sidebar first).
  return sessionId ? viewRow(state, sessionId) : undefined;
}

/** Features of `sessionId` right now (menus built on demand). */
export function agentFeaturesFor(sessionId: string | null): AgentFeatures {
  return agentFeaturesOf(resourceOf(useApp.getState(), sessionId));
}

/** Features of `sessionId`, re-rendering when its resource changes. */
export function useAgentFeatures(sessionId: string | null): AgentFeatures {
  const resource = useApp((s) => resourceOf(s, sessionId));
  return useMemo(() => agentFeaturesOf(resource), [resource]);
}
