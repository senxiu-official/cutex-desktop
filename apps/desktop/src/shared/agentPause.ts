// Agent pause (cutex r259-A, docs/agent-pause.md on cutex feat/r259-agent-pause): the owner — or the project's
// Director — pauses a whole agent. A tool-gated runtime pauses before its next call, while the turn stays open;
// a runtime without the gate pauses when the turn finishes. `paused` therefore does not imply an idle turn.
// Either way every later turn-starting input (owner messages, delegations and their
// results / questions, tells, alarms, bus messages) waits in its queue; resume only lifts this gate and the
// queues go on in their usual order. Separate from the older 暂停新委托 (`cutex/asks/pause`, delegations only).
// Feature: `featureList` has `agent-pause`. The state is on the session resource (`agentPause`), changes come as
// `cutex/agent/pauseChanged` `{agentPause}` on the session's stream; pause / resume are session requests.

export const AGENT_PAUSE_FEATURE = "agent-pause";
export const AGENT_PAUSE_METHOD = "cutex/agent/pause";
export const AGENT_RESUME_METHOD = "cutex/agent/resume";
export const AGENT_PAUSE_CHANGED = "cutex/agent/pauseChanged";

export interface HeldToolCall {
  callId: string;
  tool: string;
  turnId?: string;
  agentId?: string;
  since: string;
}

export interface AgentPause {
  cutexSessionId: string;
  phase: "pausing" | "paused";
  requestedAt: string;
  /** Only once `paused`. */
  pausedAt?: string;
  by: "owner" | "director";
  /** The Director that paused it (`by: "director"`). */
  byCutexSessionId?: string;
  at?: "toolBoundary" | "turnEnd";
  toolGate?: boolean;
  /** Calls held before dispatch, oldest first (at most 64); the turn remains open. */
  held?: HeldToolCall[];
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
    ...(v.at === "toolBoundary" || v.at === "turnEnd" ? { at: v.at } : {}),
    ...(typeof v.toolGate === "boolean" ? { toolGate: v.toolGate } : {}),
    ...(Array.isArray(v.held) ? { held: v.held.slice(0, 64).flatMap(parseHeldToolCall) } : {}),
  };
}

/** The session resource's `agentPause` (the sidebar snapshot carries the resources as cutex sent them). */
export function agentPauseOf(resource: unknown): AgentPause | null {
  return resource && typeof resource === "object" ? parseAgentPause((resource as { agentPause?: unknown }).agentPause) : null;
}

function parseHeldToolCall(value: unknown): HeldToolCall[] {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
  if (!text(v.callId) || !text(v.tool) || !text(v.since) || !Number.isFinite(Date.parse(v.since))
    || (v.turnId !== undefined && !text(v.turnId)) || (v.agentId !== undefined && !text(v.agentId))) return [];
  return [{ callId: v.callId, tool: v.tool, since: v.since,
    ...(typeof v.turnId === "string" ? { turnId: v.turnId } : {}), ...(typeof v.agentId === "string" ? { agentId: v.agentId } : {}) }];
}
