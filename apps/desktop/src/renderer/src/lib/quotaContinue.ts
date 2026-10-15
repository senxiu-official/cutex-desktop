// Claude quota auto-continue (cutex `claude-quota-auto-continue`, shared/quotaContinue.ts): cache per
// (host, agent), memory only. Loaded for the open Claude agent (composer strip) and read by the agent
// menu's switch; `cutex/quotaAutoContinue/changed` on a host's feed replaces the cached view, so the
// strip follows a schedule / cancel / fire without polling.
import { useEffect } from "react";
import { create } from "zustand";
import type { SessionResource } from "@cutex-desktop/protocol";
import { QUOTA_CONTINUE_FEATURE, quotaContinueChangeOf, type QuotaContinueResult, type QuotaContinueView } from "../../../shared/quotaContinue";
export { continueClock } from "../../../shared/quotaContinue";
import { bridge } from "../bridge";
import { translate } from "../i18n";
import { featuresOf, hostApi, useApp } from "../store";
import { runtimeOf } from "./agentList";

interface QuotaCache {
  /** `${hostId}|${sessionId}` → view (absent = not loaded). */
  byKey: Record<string, QuotaContinueView>;
}

export const useQuotaCache = create<QuotaCache>(() => ({ byKey: {} }));

const keyOf = (hostId: string, sessionId: string) => `${hostId}|${sessionId}`;

/** The switch as cutex reports it before anything is stored: on. */
export const DEFAULT_VIEW = (sessionId: string): QuotaContinueView => ({ cutexSessionId: sessionId, enabled: true, pending: null, last: null });

/**
 * Per-key write sequence: every event and PATCH / DELETE answer bumps it; a GET applies its answer
 * only when nothing was written since it started (an older read must not overwrite a newer write).
 */
const seqs = new Map<string, number>();
const seqOf = (key: string) => seqs.get(key) ?? 0;

function put(hostId: string, view: QuotaContinueView): void {
  const key = keyOf(hostId, view.cutexSessionId);
  seqs.set(key, seqOf(key) + 1);
  useQuotaCache.setState((s) => ({ byKey: { ...s.byKey, [keyOf(hostId, view.cutexSessionId)]: view } }));
}

let following = false;
/** Follow the host feeds once (first use). */
function follow(): void {
  if (following || typeof bridge?.on !== "function") return;
  following = true;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    const change = quotaContinueChangeOf(envelope);
    if (change) put(hostId, change.quotaAutoContinue);
  });
}

const inflight = new Map<string, Promise<void>>();

export function loadQuotaContinue(hostId: string, sessionId: string): Promise<void> {
  follow();
  const key = keyOf(hostId, sessionId);
  const running = inflight.get(key);
  if (running) return running;
  const started = seqOf(key);
  const run = (async () => {
    try {
      const view = await hostApi(hostId).quotaAutoContinue(sessionId);
      if (view && seqOf(key) === started) put(hostId, view);
    } catch {
      // Keep the last view (the strip just stays as it was).
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** That host runs a cutex with quota auto-continue and the agent is a Claude agent. */
export function quotaContinueApplies(hostId: string, session: Pick<SessionResource, "runtime" | "effectiveNextLaunch" | "native"> | null | undefined): boolean {
  return !!session && runtimeOf(session as SessionResource) === "claude" && featuresOf(useApp.getState(), hostId).has(QUOTA_CONTINUE_FEATURE);
}

/** The cached view (default on until loaded) where it applies; null otherwise. */
export function quotaContinueNow(hostId: string, session: SessionResource): QuotaContinueView | null {
  if (!quotaContinueApplies(hostId, session)) return null;
  return useQuotaCache.getState().byKey[keyOf(hostId, session.cutexSessionId)] ?? DEFAULT_VIEW(session.cutexSessionId);
}

/** The agent's view for the composer strip, loaded while mounted (null: not a Claude agent / older cutex / not loaded). */
export function useQuotaContinue(hostId: string, sessionId: string, applies: boolean): QuotaContinueView | null {
  const view = useQuotaCache((s) => (applies ? (s.byKey[keyOf(hostId, sessionId)] ?? null) : null));
  useEffect(() => {
    if (applies) void loadQuotaContinue(hostId, sessionId);
  }, [applies, hostId, sessionId]);
  return view;
}

function settle(hostId: string, result: QuotaContinueResult): void {
  if (result.ok) put(hostId, result.view);
  else useApp.getState().notify(translate("quotaContinue.failed", { error: result.error.message }), "error");
}

/** 额度用完后自动继续 on / off for the agent. */
export async function setQuotaContinue(hostId: string, sessionId: string, enabled: boolean): Promise<void> {
  settle(hostId, await hostApi(hostId).setQuotaAutoContinue(sessionId, enabled));
}

/** 取消 the pending continuation (the switch stays on). */
export async function cancelQuotaContinue(hostId: string, sessionId: string): Promise<void> {
  settle(hostId, await hostApi(hostId).cancelQuotaAutoContinue(sessionId));
}
