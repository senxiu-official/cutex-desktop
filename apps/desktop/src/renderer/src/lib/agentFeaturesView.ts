// Store-backed access to an agent's features (pure helpers in agentFeatures.ts).
import { useMemo } from "react";
import { agentHost, useApp } from "../store";
import { agentFeaturesOf, type AgentFeatures } from "./agentFeatures";
import { convViewHostOf, useConvScope } from "./conversationScope";
import { viewRow } from "./viewHost";

type State = ReturnType<typeof useApp.getState>;

/** `hostId`: the agent's host (default: the selected agent's host — the open agent may live on another host than the focus host). */
function resourceOf(state: State, sessionId: string | null, hostId?: string) {
  return sessionId ? viewRow(state, hostId ?? agentHost(state), sessionId) : undefined;
}

/** Features of `sessionId` (on `hostId`, default the selected agent's host) right now (menus built on demand). */
export function agentFeaturesFor(sessionId: string | null, hostId?: string): AgentFeatures {
  return agentFeaturesOf(resourceOf(useApp.getState(), sessionId, hostId));
}

/** Features of `sessionId` (on its host as seen from the enclosing conversation), re-rendering when its resource changes. */
export function useAgentFeatures(sessionId: string | null): AgentFeatures {
  const scope = useConvScope();
  const resource = useApp((s) => resourceOf(s, sessionId, scope && sessionId ? convViewHostOf(scope, s, sessionId) : undefined));
  return useMemo(() => agentFeaturesOf(resource), [resource]);
}
