// Hooks behind the Windows sandbox notes (shared/windowsSandbox.ts; cutex windows-sandbox-readiness):
// one agent's runtime (composer permission menu) and the host's shared Codex home (Settings → 新建默认).
import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonApi, WindowsSandboxReadiness } from "../../../shared/ipc";
import { windowsSandboxReadinessOf, windowsSandboxSetupOutcomeOf, type WindowsSandboxSetupOutcome } from "../../../shared/windowsSandbox";
import { sessionApi } from "../store";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type SetupPhase = { kind: "idle" } | { kind: "running" } | { kind: "started" } | { kind: "done" } | { kind: "pending" } | { kind: "failed"; message: string };

/**
 * One agent's runtime. `load()` asks (the menu calls it on open); `setup()` sends the unelevated setup.
 * `completed`: the session's native `windowsSandbox/setupCompleted` (timeline) — success or the
 * native error. Readiness keeps saying not ready until the agent is relaunched (native reports the
 * config its runtime started with), so a finished setup shows "relaunch to apply" instead.
 */
export function useSessionWindowsSandbox(sessionId: string, enabled: boolean, completed: WindowsSandboxSetupOutcome | null | undefined) {
  const [readiness, setReadiness] = useState<WindowsSandboxReadiness | null>(null);
  const [phase, setPhase] = useState<SetupPhase>({ kind: "idle" });
  const current = useRef(sessionId);
  current.current = sessionId;
  // A completion seen while this agent is open settles the phase (also one from another client).
  const seen = useRef(completed);
  useEffect(() => {
    setReadiness(null);
    setPhase({ kind: "idle" });
    seen.current = completed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    if (!completed || completed === seen.current) return;
    seen.current = completed;
    setPhase(completed.success ? { kind: "done" } : { kind: "failed", message: completed.error ?? "" });
  }, [completed]);
  const load = useCallback(() => {
    if (!enabled) return;
    const id = sessionId;
    void sessionApi(id)
      .windowsSandboxReadiness(id)
      .then((r) => current.current === id && setReadiness(r), () => current.current === id && setReadiness(null));
  }, [sessionId, enabled]);
  const setup = useCallback(async () => {
    const id = sessionId;
    setPhase({ kind: "running" });
    try {
      await sessionApi(id).setupWindowsSandbox(id);
      if (current.current === id) setPhase((p) => (p.kind === "running" ? { kind: "started" } : p));
    } catch (e) {
      if (current.current === id) setPhase({ kind: "failed", message: errorText(e) });
    }
  }, [sessionId]);
  return { readiness, phase, load, setup };
}

/** Host route result of `windowsSandbox/setupStart` (cutex waits for the completion: `completed`, null on timeout). */
export function hostSetupPhase(result: unknown): SetupPhase {
  const completed = windowsSandboxSetupOutcomeOf((result as { completed?: unknown } | null)?.completed);
  if (!completed) return { kind: "pending" };
  return completed.success ? { kind: "done" } : { kind: "failed", message: completed.error ?? "" };
}

/** The host's shared Codex home (POST /v2/codex/requests). `readiness` undefined = loading; null = could not be read. */
export function useHostWindowsSandbox(api: DaemonApi, enabled: boolean) {
  const [readiness, setReadiness] = useState<WindowsSandboxReadiness | null | undefined>(undefined);
  const [phase, setPhase] = useState<SetupPhase>({ kind: "idle" });
  const load = useCallback(() => {
    if (!enabled) return;
    setReadiness(undefined);
    api.codexRequest("windowsSandbox/readiness").then(
      (r) => setReadiness(windowsSandboxReadinessOf((r as { status?: unknown } | null)?.status)),
      () => setReadiness(null),
    );
  }, [api, enabled]);
  useEffect(load, [load]);
  const setup = useCallback(async () => {
    setPhase({ kind: "running" });
    try {
      const result = await api.codexRequest("windowsSandbox/setupStart", { mode: "unelevated" });
      setPhase(hostSetupPhase(result));
    } catch (e) {
      setPhase({ kind: "failed", message: errorText(e) });
    }
    load();
  }, [api, load]);
  return { readiness, phase, load, setup };
}
