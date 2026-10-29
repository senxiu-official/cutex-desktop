// Agent pause (cutex r259-A, docs/agent-pause.md on cutex feat/r259-agent-pause): the owner — or the project's
// Director — pauses a whole agent. While `phase` is `pausing` the native turn already running may finish; then
// `paused` (with `pausedAt`). Either way every later turn-starting input (owner messages, delegations and their
// results / questions, tells, alarms, bus messages) waits in its queue; resume only lifts this gate and the
// queues go on in their usual order. Separate from the older 暂停新委托 (`cutex/asks/pause`, delegations only).
// Feature: `featureList` has `agent-pause`. The state is on the session resource (`agentPause`), changes come as
// `cutex/agent/pauseChanged` `{agentPause}` on the session's stream; pause / resume are session requests.

export const AGENT_PAUSE_FEATURE = "agent-pause";
export const AGENT_PAUSE_METHOD = "cutex/agent/pause";
export const AGENT_RESUME_METHOD = "cutex/agent/resume";
export const AGENT_PAUSE_CHANGED = "cutex/agent/pauseChanged";

export interface AgentPause {
  cutexSessionId: string;
  phase: "pausing" | "paused";
  requestedAt: string;
  /** Only once `paused`. */
  pausedAt?: string;
  by: "owner" | "director";
  /** The Director that paused it (`by: "director"`). */
  byCutexSessionId?: string;
}

/** `cutex/agent/pause` / `cutex/agent/resume`. */
export interface AgentPauseResult {
  agentPause: AgentPause | null;
  changed: boolean;
}

/** A well-formed `agentPause` value, else null (absent on r258 hosts; anything malformed counts as not paused). */
export function parseAgentPause(value: unknown): AgentPause | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.phase !== "pausing" && v.phase !== "paused") return null;
  if (typeof v.cutexSessionId !== "string" || typeof v.requestedAt !== "string") return null;
  return {
    cutexSessionId: v.cutexSessionId,
    phase: v.phase,
    requestedAt: v.requestedAt,
    ...(typeof v.pausedAt === "string" ? { pausedAt: v.pausedAt } : {}),
    by: v.by === "director" ? "director" : "owner",
    ...(typeof v.byCutexSessionId === "string" ? { byCutexSessionId: v.byCutexSessionId } : {}),
  };
}

/** The session resource's `agentPause` (the sidebar snapshot carries the resources as cutex sent them). */
export function agentPauseOf(resource: unknown): AgentPause | null {
  return resource && typeof resource === "object" ? parseAgentPause((resource as { agentPause?: unknown }).agentPause) : null;
}
