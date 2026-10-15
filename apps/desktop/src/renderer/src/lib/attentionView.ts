// React hooks for sidebar v2 status and the 需要你 strip (kept out of components/*.tsx for Fast Refresh).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { MessageKey } from "../i18n";
import { focusSessionViews, useApp } from "../store";
import { taskTag } from "./tasks";
import { agentSignal, needsYouByAgent, type AgentSignal, type NeedsYou } from "./agentAttention";
import { ASKS_FEATURE } from "./delegations";
import { useFocusDelegations } from "./delegationStore";
import { useOwnerNotify } from "./ownerNotifyStore";
import { OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import type { AgentRow } from "./sidebar";
import { useSidebarModel } from "./sidebarView";
import { getTurnMarks, markSeen, pruneTurnMarks, useTurnMarks, type TurnMarks } from "./turnUnread";

export interface Attention {
  /** Every agent row of the sidebar (groups + quick chats). */
  rows: AgentRow[];
  signals: Map<string, AgentSignal>;
  needs: Map<string, NeedsYou>;
  marks: TurnMarks;
}

/** Provided by the sidebar so its rows share one computation; rows elsewhere fall back to their own. */
export const AttentionContext = createContext<Attention | null>(null);

/** One row's signal + needs-you: from the sidebar's context, else from its status and turn mark. */
export function useRowSignal(row: AgentRow): { signal: AgentSignal; needs: NeedsYou | undefined } {
  const ctx = useContext(AttentionContext);
  const mark = useTurnMarks()[row.id];
  // Rows of the multi-host sidebar carry host keys (its context is keyed by them); others their id.
  const key = row.key ?? row.id;
  if (ctx) return { signal: ctx.signals.get(key) ?? agentSignal(row, undefined, mark), needs: ctx.needs.get(key) };
  return { signal: agentSignal(row, undefined, mark), needs: undefined };
}

/** Signals / needs-you of every agent in the sidebar. */
export function useAttention(): Attention {
  const model = useSidebarModel();
  const allSessions = useApp((s) => s.sessions);
  const hosts = useApp((s) => s.hosts);
  // The focus host's agents (`sessions` may also hold an open agent of another host).
  const sessions = useMemo(() => focusSessionViews({ hosts, sessions: allSessions }), [hosts, allSessions]);
  const approvals = useApp((s) => s.approvals);
  const asks = useApp((s) => s.features.has(ASKS_FEATURE));
  // The focus host's records (the store may also hold the open agent's host's).
  const byId = useFocusDelegations();
  const ownerNotify = useApp((s) => s.features.has(OWNER_NOTIFY_FEATURE));
  const notes = useOwnerNotify((s) => s.byId);
  const marks = useTurnMarks();
  const rows = useMemo(() => [...model.groups.flatMap((g) => [...g.online, ...g.offline]), ...model.chats], [model]);
  const needs = useMemo(() => {
    const pending: Record<string, string[]> = {};
    for (const [id, v] of Object.entries(sessions)) if (v.timeline.pending.size > 0) pending[id] = [...v.timeline.pending.values()].map((p) => p.method);
    return needsYouByAgent({ pending, approvals, delegations: asks ? Object.values(byId) : null, ownerNotes: ownerNotify ? Object.values(notes) : null });
  }, [sessions, approvals, asks, byId, ownerNotify, notes]);
  const signals = useMemo(() => new Map(rows.map((r) => [r.id, agentSignal(r, needs.get(r.id), marks[r.id])])), [rows, needs, marks]);
  return { rows, signals, needs, marks };
}

/**
 * App-level upkeep: the open agent's mark clears when the window gets focus again (it ended while
 * the window was in the background), and marks of agents that no longer exist are dropped.
 */
export function useTurnMarkUpkeep(): void {
  const sidebar = useApp((s) => s.sidebar);
  useEffect(() => {
    const onFocus = () => {
      const s = useApp.getState();
      if (s.selectedId && s.view.kind === "conversation" && getTurnMarks()[s.selectedId]) markSeen(s.selectedId);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (sidebar) pruneTurnMarks(new Set(sidebar.active.map((s) => s.cutexSessionId)));
  }, [sidebar]);
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Pill text for a row / chip: 「完成」, 「出错」, a needs-you reason (+ #N of its delegation), 「需要你 ×N」. */
export function signalLabel(t: Translate, signal: AgentSignal, needs: NeedsYou | undefined): string | null {
  if (signal === "done") return t("agentStatus.done");
  if (signal === "error") return t("agentStatus.error");
  if (signal !== "needsYou") return null;
  if (!needs) return t("agentStatus.reason.confirm");
  if (needs.count > 1) return t("agentStatus.needsYouN", { n: needs.count });
  const reason = needs.reasons[0] ?? "confirm";
  const tag = needs.askIds[0] ? ` ${taskTag(needs.askIds[0]).label}` : "";
  return `${t(`agentStatus.reason.${reason}` as MessageKey)}${tag}`;
}

/** Current time, re-rendered every `ms` while `active` (running elapsed times). */
export function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, active]);
  return now;
}
