// 升级运行时 for a Claude agent (cutex `claude-runtime-repin`, shared/claudeRepin.ts). The agent menu is
// built synchronously. With cutex `session-claude-runtime` it decides from the agent list alone: the
// agent's pin (`runtime.claudeRuntime`) against the host's selected release (`GET /v2/sessions`
// `claudeRuntime`), both reloaded on `cutex/sessions/changed`, so even an agent never opened shows the
// item on the first right-click. Older cutex: the agent's runtime view is cached per (host, agent),
// memory only, loaded while the agent is open (Composer) and on every menu build for the next open. The
// click reloads the view, confirms current → new (or shows cutex's refusal), calls the repin and, for a
// running agent (the change waits for its next start), offers the runtime restart.
import { useEffect } from "react";
import { create } from "zustand";
import type { HostClaudeRuntime, SessionResource } from "@cutex-desktop/protocol";
import { CLAUDE_REPIN_FEATURE, repinOffer, sessionRepinOffer, type ClaudeRepinOffer, type ClaudeRuntimeView } from "../../../shared/claudeRepin";
import type { DaemonApi } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { isOwnerFeatures } from "../../../shared/users";
import { runtimeOf } from "./agentList";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface RepinCache {
  /** `${hostId}|${sessionId}` → view (absent = not loaded). */
  byKey: Record<string, ClaudeRuntimeView>;
}

export const useRepinCache = create<RepinCache>(() => ({ byKey: {} }));

const keyOf = (hostId: string, sessionId: string) => `${hostId}|${sessionId}`;

export function putClaudeRuntime(hostId: string, view: ClaudeRuntimeView): void {
  useRepinCache.setState((s) => ({ byKey: { ...s.byKey, [keyOf(hostId, view.cutexSessionId)]: view } }));
}

export function cachedClaudeRuntime(hostId: string, sessionId: string): ClaudeRuntimeView | null {
  return useRepinCache.getState().byKey[keyOf(hostId, sessionId)] ?? null;
}

/** The host offers the action (owner, capability) and the agent is an active Claude agent. */
export function repinApplies(features: ReadonlySet<string>, session: SessionResource | null | undefined): boolean {
  return !!session && session.lifecycle !== "retired" && features.has(CLAUDE_REPIN_FEATURE) && isOwnerFeatures(features) && runtimeOf(session) === "claude";
}

const inflight = new Map<string, Promise<ClaudeRuntimeView | null>>();

/** Load (and cache) the agent's view; null when cutex refused or the call failed (the cache keeps the last view). */
export function loadClaudeRuntime(api: Pick<DaemonApi, "claudeRuntime">, hostId: string, sessionId: string): Promise<ClaudeRuntimeView | null> {
  const key = keyOf(hostId, sessionId);
  const running = inflight.get(key);
  if (running) return running;
  const run = (async () => {
    try {
      const view = await api.claudeRuntime(sessionId);
      putClaudeRuntime(hostId, view);
      return view;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** What the menu offers now (from the cache): null = no item. */
export function repinOfferNow(hostId: string, sessionId: string): ClaudeRepinOffer | null {
  return repinOffer(cachedClaudeRuntime(hostId, sessionId));
}

/**
 * The menu's offer (from → to; null = no item). From the session resource and the host's selected
 * release when cutex reports them (`session-claude-runtime`); otherwise from the cached view, loading it
 * for the next open.
 */
export function repinMenuOffer(
  api: () => Pick<DaemonApi, "claudeRuntime">,
  hostId: string,
  session: Pick<SessionResource, "cutexSessionId" | "runtime">,
  hostClaude: HostClaudeRuntime | null | undefined,
): { from: string; to: string } | null {
  const known = sessionRepinOffer(session.runtime.claudeRuntime, hostClaude);
  if (known !== undefined) return known;
  void loadClaudeRuntime(api(), hostId, session.cutexSessionId);
  return repinOfferNow(hostId, session.cutexSessionId);
}

/** The agent list says the pin itself (`session-claude-runtime`): no per-agent view to preload. */
export function pinInSession(session: Pick<SessionResource, "runtime"> | null | undefined, hostClaude: HostClaudeRuntime | null | undefined): boolean {
  return !!session?.runtime.claudeRuntime && !!hostClaude;
}

/**
 * Keep the open agent's view loaded (Composer): again when its runtime status changes, since a restart
 * applies a pending change.
 */
export function useClaudeRuntimePreload(api: () => Pick<DaemonApi, "claudeRuntime">, hostId: string, sessionId: string, applies: boolean, runtimeStatus: string | undefined): void {
  useEffect(() => {
    if (applies) void loadClaudeRuntime(api(), hostId, sessionId);
    // `api` is a getter of the host's bridge; the host id covers its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applies, hostId, sessionId, runtimeStatus]);
}

export type RepinFlowResult = "none" | "refused" | "cancelled" | "unchanged" | "applied" | "deferred" | "restarted";

export interface RepinFlow {
  api: Pick<DaemonApi, "claudeRuntime" | "repinClaudeRuntime">;
  hostId: string;
  session: Pick<SessionResource, "cutexSessionId" | "displayName" | "runtime">;
  t: T;
  confirm(message: string, labels: { ok: string; cancel: string }, danger?: boolean): Promise<boolean>;
  notice(message: string): Promise<void>;
  notify(message: string): void;
  /** Stop and start the agent's runtime (the menu's 重启运行时). */
  restart(): Promise<void>;
}

/** The click: fresh view → confirm current → new → repin → result / refusal (→ restart offer when deferred). */
export async function runRepinFlow(flow: RepinFlow): Promise<RepinFlowResult> {
  const { api, hostId, session, t } = flow;
  const id = session.cutexSessionId;
  const name = session.displayName;
  const view = await api.claudeRuntime(id);
  putClaudeRuntime(hostId, view);
  const offer = repinOffer(view);
  if (!offer) {
    await flow.notice(t("menu.upgradeRuntimeNone", { name, release: view.current.release }));
    return "none";
  }
  const vars = { name, from: offer.from, to: offer.to };
  if (offer.refusal !== null) {
    await flow.notice(t("menu.upgradeRuntimeRefused", { ...vars, reason: offer.refusal }));
    return "refused";
  }
  const message = t(offer.restartRequired ? "menu.upgradeRuntimeConfirmOnline" : "menu.upgradeRuntimeConfirm", vars);
  if (!(await flow.confirm(message, { ok: t("menu.upgradeRuntimeOk"), cancel: t("dialog.cancel") }))) return "cancelled";
  const result = await api.repinClaudeRuntime(id, offer.to);
  if (!result.ok) {
    void loadClaudeRuntime(api, hostId, id);
    await flow.notice(t("menu.upgradeRuntimeRefused", { ...vars, reason: result.error.message }));
    return "refused";
  }
  putClaudeRuntime(hostId, result.done.runtime);
  const { outcome, target } = result.done.result;
  if (outcome === "unchanged") {
    flow.notify(t("menu.upgradeRuntimeNone", { name, release: target }));
    return "unchanged";
  }
  if (outcome === "applied") {
    flow.notify(t("menu.upgradeRuntimeApplied", { name, to: target }));
    return "applied";
  }
  const busy = !!session.runtime.activeTurnId;
  const restart = await flow.confirm(
    t(busy ? "menu.upgradeRuntimeDeferredBusy" : "menu.upgradeRuntimeDeferred", { name, to: target }),
    { ok: t("menu.upgradeRuntimeRestartNow"), cancel: t("menu.upgradeRuntimeLater") },
    busy,
  );
  if (!restart) return "deferred";
  await flow.restart();
  void loadClaudeRuntime(api, hostId, id);
  return "restarted";
}
