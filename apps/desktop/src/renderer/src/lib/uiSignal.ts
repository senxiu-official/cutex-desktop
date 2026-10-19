// React to `useApp.signal(target, arg, agent)` open requests (slash commands, composer tools, chips).
// Panes step 2: several conversations can be on screen. A signal (and a notice, store `notify`) names
// the agent it is meant for: only the conversation showing that agent reacts. One that names none is
// for the focused conversation (and for whatever listens outside any conversation).
import { useEffect, useRef } from "react";
import { useConvScope } from "./conversationScope";
import { viewKey, type ViewKey } from "./viewKey";
import { useApp, type AgentAddress } from "../store";

/**
 * Whether a signal / notice addressed to `agent` (a view key; undefined = none in particular) is meant for
 * the conversation showing `here` (null: outside any conversation), which holds the focus or not.
 */
export function meantHere(agent: ViewKey | undefined, here: AgentAddress | null, focused: boolean): boolean {
  if (agent === undefined) return focused;
  return !!here && viewKey(here.hostId, here.sessionId) === agent;
}

/**
 * Calls `handler(arg)` once per new signal for `target` (signals from before mount are ignored) that is
 * meant for the enclosing conversation (`meantHere`; outside any conversation: those naming no agent).
 */
export function useUiSignal(target: string, handler: (arg: string | undefined) => void): void {
  const signal = useApp((s) => s.uiSignal);
  const scope = useConvScope();
  const last = useRef(signal?.nonce ?? 0);
  const ref = useRef(handler);
  ref.current = handler;
  const here = scope?.sessionId ? { hostId: scope.hostId, sessionId: scope.sessionId } : null;
  const focused = scope ? scope.focused : true;
  const meant = useRef({ here, focused });
  meant.current = { here, focused };
  useEffect(() => {
    if (signal?.target !== target || signal.nonce === last.current) return;
    last.current = signal.nonce;
    if (!meantHere(signal.agent, meant.current.here, meant.current.focused)) return;
    ref.current(signal.arg);
  }, [signal, target]);
}

export type GoalRequest = { mode: "view" | "edit" | "replace"; draft: string; nonce: number };

/** `signal("goal", arg)`: "" = show, "edit" = edit the objective, "replace:<text>" = confirm a new one. */
export function goalRequest(arg: string | undefined, objective: string | null): GoalRequest {
  const a = arg ?? "";
  const nonce = Date.now() + Math.random();
  if (a === "edit") return { mode: "edit", draft: objective ?? "", nonce };
  if (a.startsWith("replace:")) return { mode: "replace", draft: a.slice("replace:".length), nonce };
  return { mode: "view", draft: "", nonce };
}
