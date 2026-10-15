// React to `useApp.signal(target, arg)` open requests (slash commands, composer tools, chips).
import { useEffect, useRef } from "react";
import { useApp } from "../store";

/** Calls `handler(arg)` once per new signal for `target` (signals from before mount are ignored). */
export function useUiSignal(target: string, handler: (arg: string | undefined) => void): void {
  const signal = useApp((s) => s.uiSignal);
  const last = useRef(signal?.nonce ?? 0);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (signal?.target !== target || signal.nonce === last.current) return;
    last.current = signal.nonce;
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
