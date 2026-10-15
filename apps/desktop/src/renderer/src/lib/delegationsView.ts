// React hooks for the delegation components (kept out of components/*.tsx for Fast Refresh).
import { useEffect, useMemo } from "react";
import type { AskSummary } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { agentHost, selectedFeatures, selectedSidebar, useApp } from "../store";
import { useViewRows, viewRow } from "./viewHost";
import { agentDelegations, ASKS_FEATURE, fallbackSummary, inferDelegations, needsYouCount, ownerSteeredOf, pendingForAgent, type ContextOf, type DelegateCall, type DelegationStatus } from "./delegations";
import { loadDelegationDetail, useDelegation, useDelegations, useFocusDelegations, useHostRecords } from "./delegationStore";
import { currentDelegationTurn, type DelegationTurn } from "./delegationTurn";
import { hostKey } from "./hostKeys";
import { findById, isShortId, resolveId, sameId } from "./shortIds";
import { orderedEntries, type TimelineState } from "./timeline";

/** The status word with `{name}` / `{n}` filled in. */
export function useStatusWord(): (status: DelegationStatus, name: string) => string {
  const { t } = useI18n();
  return (status, name) => t(`delegation.status.${status.key}` as MessageKey, { name, n: status.n ?? "" });
}

/** Display name of an agent id (sidebar), else the id. */
export function useAgentNames(): (id: string) => string {
  const rows = useViewRows();
  return useMemo(() => {
    const names = new Map(rows.map((s) => [s.cutexSessionId, s.displayName]));
    return (id: string) => names.get(id) ?? id;
  }, [rows]);
}

/**
 * The status derivations' context of a delegation (lib/delegations `DelegationContext`): whether
 * the sidebar knows its target and that target's runtime is not online (archived ones included).
 * An unknown target counts as online: the record alone decides.
 */
export function useDelegationContext(): ContextOf {
  const rows = useViewRows();
  return useMemo(() => {
    const status = new Map<string, string>();
    for (const s of rows) status.set(s.cutexSessionId, s.runtime?.status ?? "offline");
    return (d) => {
      const st = status.get(d.target);
      return st !== undefined && st !== "online" ? { targetOffline: true } : {};
    };
  }, [rows]);
}

/** The target's profile (model fallback when the attempt has no model snapshot). */
export function useAgentProfile(id: string | null): string | null {
  return useApp((s) => (id ? (viewRow(s, id)?.profile ?? null) : null));
}

/** The host of the open agent (its timeline, composer, queue): delegation lookups of those views use its records. */
export const useAgentHost = (): string => useApp(agentHost);

/**
 * A requester card's delegation: the live record (store; the open agent's host's), else what this
 * agent's transcript says (the call, later waits and closes). `live` false = transcript only.
 */
export function useCardDelegation(askId: string, call: DelegateCall, sessionId: string): { d: AskSummary; live: boolean } {
  const record = useDelegation(useAgentHost(), askId);
  // Only scanned while there is no record (purged > 30 days, or before the first load).
  const version = useApp((s) => (record ? 0 : (s.sessions[sessionId]?.version ?? 0)));
  const timeline = useApp((s) => (record ? null : (s.sessions[sessionId]?.timeline ?? null)));
  // A short target from the call result (`cutex.…3f9a1c`): the sidebar's full id, else no link.
  const targetId = useResolvedSessionId(record ? null : call.targetId);
  const fallback = useMemo(() => {
    if (record) return null;
    const inferred = timeline ? findById(inferDelegations(orderedEntries(timeline)), askId) : undefined;
    const summary = fallbackSummary(askId, call, inferred, sessionId);
    if (!isShortId(summary.target)) return summary;
    const full = targetId && sameId(targetId, summary.target) ? targetId : null;
    return { ...summary, target: full ?? "", targetName: summary.targetName ?? (full ? null : summary.target) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, askId, call, sessionId, timeline, version, targetId]);
  return record ? { d: record, live: true } : { d: fallback!, live: false };
}

/**
 * The delegation store's full id for an id from agent-facing tool text, which since cutex task 06
 * is short (`ask-123456`); the input itself when it is full, unknown or ambiguous. Resolved against
 * `hostId`'s records (default: the open agent's host).
 */
export function useResolvedAskId(ref: string, hostId?: string): string {
  const agentHostId = useAgentHost();
  const records = useHostRecords(hostId ?? agentHostId);
  return records[ref] || !isShortId(ref) ? ref : (resolveId(ref, Object.keys(records)) ?? ref);
}

/** The sidebar's full session id for a (possibly short) session reference; null when unknown or ambiguous. */
export function useResolvedSessionId(ref: string | null | undefined): string | null {
  return useApp((s) => {
    if (!ref) return null;
    const ids = [...new Set([s.sidebar, selectedSidebar(s)].flatMap((sb) => [...(sb?.active ?? []), ...(sb?.retired ?? [])].map((x) => x.cutexSessionId)))];
    return resolveId(ref, ids);
  });
}

/** Sidebar 委托 badge: delegations that need the owner; null without cutex asks (no badge). */
export function useNeedsYouCount(): number | null {
  const enabled = useApp((s) => s.features.has(ASKS_FEATURE));
  const focusRecords = useFocusDelegations();
  const count = useMemo(() => needsYouCount(Object.values(focusRecords)), [focusRecords]);
  return enabled ? count : null;
}

/** An agent's unfinished delegations by direction + finished count (capsule / status row). */
export function useAgentDelegations(sessionId: string) {
  const enabled = useApp((s) => selectedFeatures(s).has(ASKS_FEATURE));
  const byId = useHostRecords(useAgentHost());
  const ctxOf = useDelegationContext();
  return useMemo(() => (enabled ? agentDelegations(byId, sessionId, undefined, ctxOf) : { mine: [], toMe: [], done: [], finished: 0 }), [enabled, byId, sessionId, ctxOf]);
}

/** The queue panel's 待处理委托 of an agent. */
export function usePendingDelegations(sessionId: string) {
  const enabled = useApp((s) => selectedFeatures(s).has(ASKS_FEATURE));
  const byId = useHostRecords(useAgentHost());
  return useMemo(() => (enabled ? pendingForAgent(byId, sessionId) : []), [enabled, byId, sessionId]);
}

/**
 * 主人插话过: whether the owner steered into a delegation's turn. Only the full record says so, so
 * with `load` (an answer exists) the record is fetched once (the same fetch the card body and
 * 查看完整 use).
 */
export function useOwnerSteered(askId: string, load: boolean): boolean {
  const enabled = useApp((s) => selectedFeatures(s).has(ASKS_FEATURE));
  const hostId = useAgentHost();
  const detail = useDelegations((s) => s.details[hostKey(hostId, askId)]);
  useEffect(() => {
    if (enabled && load && detail === undefined) void loadDelegationDetail(hostId, askId);
  }, [enabled, load, detail, hostId, askId]);
  return enabled && ownerSteeredOf(detail);
}

/**
 * The delegation this agent's running turn handles (composer), or null. Not memoized: the timeline
 * is updated in place; the scan covers only the running turn's entries.
 */
export function useDelegationTurn(timeline: TimelineState | null): DelegationTurn | null {
  const features = useApp(selectedFeatures);
  const byId = useHostRecords(useAgentHost());
  return currentDelegationTurn(timeline, byId, features);
}