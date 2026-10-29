// 暂停智能体 / 继续 (cutex agent-pause, shared/agentPause): what the sidebar row, the conversation header, the
// agent menus and the composer show, and the two owner actions. Not 暂停新委托 (lib/asksPause: delegations only);
// this one holds everything that would start a turn, after the running turn ends.
// The state is the session resource's `agentPause` (the sidebar snapshot). A pause / resume answer and the
// `cutex/agent/pauseChanged` event are newer than that resource: they are kept here, for that resource object only —
// the next snapshot of the session (lib/sidebarShare keeps unchanged ones) carries cutex's own value again.
// Hosts without the capability (r258): no state, no actions, nothing drawn.
import { create } from "zustand";
import { AGENT_PAUSE_FEATURE, agentPauseOf, type AgentPause } from "../../../shared/agentPause";
import { featuresOf, hostApi, sidebarOf, useApp } from "../store";

type Entry = { pause: AgentPause | null; base: unknown };
export const useAgentPauses = create<{ byKey: Readonly<Record<string, Entry>> }>(() => ({ byKey: {} }));

const keyOf = (hostId: string, sessionId: string) => `${hostId}\n${sessionId}`;
type App = ReturnType<typeof useApp.getState>;

function resourceOf(app: App, hostId: string, sessionId: string): unknown {
  return sidebarOf(app, hostId)?.active.find((r) => r.cutexSessionId === sessionId);
}

/** A newer state than the session resource (an answer, an event). */
export function noteAgentPause(hostId: string, sessionId: string, pause: AgentPause | null): void {
  const base = resourceOf(useApp.getState(), hostId, sessionId);
  useAgentPauses.setState((s) => ({ byKey: { ...s.byKey, [keyOf(hostId, sessionId)]: { pause, base } } }));
}

/** The shown state from a resource and the kept newer one (pure; tests). */
export function shownAgentPause(resource: unknown, kept: Entry | undefined): AgentPause | null {
  return kept && kept.base === resource ? kept.pause : agentPauseOf(resource);
}

export function agentPauseSupported(app: App, hostId: string | null | undefined): boolean {
  return !!hostId && featuresOf(app, hostId).has(AGENT_PAUSE_FEATURE);
}

/** The agent's pause now (outside React: menus). */
export function agentPauseNow(hostId: string, sessionId: string): AgentPause | null {
  const app = useApp.getState();
  if (!agentPauseSupported(app, hostId)) return null;
  return shownAgentPause(resourceOf(app, hostId, sessionId), useAgentPauses.getState().byKey[keyOf(hostId, sessionId)]);
}

export function useAgentPauseSupported(hostId: string | null | undefined): boolean {
  return useApp((s) => agentPauseSupported(s, hostId));
}

/** The agent's pause (null: running, or the host lacks agent-pause). */
export function useAgentPause(hostId: string | null | undefined, sessionId: string | null | undefined): AgentPause | null {
  const supported = useAgentPauseSupported(hostId);
  const resource = useApp((s) => (hostId && sessionId ? resourceOf(s, hostId, sessionId) : undefined));
  const kept = useAgentPauses((s) => (hostId && sessionId ? s.byKey[keyOf(hostId, sessionId)] : undefined));
  return supported ? shownAgentPause(resource, kept) : null;
}

async function act(hostId: string, sessionId: string, resume: boolean): Promise<boolean> {
  try {
    const api = hostApi(hostId);
    const { agentPause } = await (resume ? api.agentResume(sessionId) : api.agentPause(sessionId));
    noteAgentPause(hostId, sessionId, agentPause ?? null);
    return true;
  } catch (e) {
    useApp.getState().notify(e instanceof Error ? e.message : String(e), "error", { hostId, sessionId });
    return false;
  }
}

/** 暂停智能体: its running turn may finish (暂停中…), then nothing new starts until 继续. */
export function pauseAgent(hostId: string, sessionId: string): Promise<boolean> {
  return act(hostId, sessionId, false);
}

/** 继续: lifts the pause; what waited goes on in its usual order. True when it worked. */
export function resumeAgent(hostId: string, sessionId: string): Promise<boolean> {
  return act(hostId, sessionId, true);
}

/**
 * 继续并发送 (the contract's two explicit steps): resume, and only once that succeeded send the message.
 * `send` is the composer's own send. Nothing is sent when resuming failed (the draft stays).
 */
export async function resumeAndSend(hostId: string, sessionId: string, send: () => Promise<void>): Promise<boolean> {
  if (!(await resumeAgent(hostId, sessionId))) return false;
  await send();
  return true;
}
