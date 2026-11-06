// React hooks for sidebar v2 status and the 需要你 strip (kept out of components/*.tsx for Fast Refresh).
import { isFoldedConversation } from "./foldedTest";
import { keyFocus } from "./hostKeys";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n";
import { useApp } from "../store";
import { subscribeTick } from "./ticker";
import { sessionsMetaOf, viewsOfHost } from "./sessionsMeta";
import { taskTag } from "./tasks";
import { agentSignal, needsYouByAgent, type AgentSignal, type NeedsYou } from "./agentAttention";
import { ASKS_FEATURE } from "./delegations";
import { useFocusDelegations } from "./delegationStore";
import { useOwnerNotify } from "./ownerNotifyStore";
import { OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import { pendingByAgent, type AgentRow } from "./sidebar";
import { useSidebarModel } from "./sidebarView";
import { getTurnMarks, markSeen, markSeenOn, pruneTurnMarks, settleStartedTurnsOn, subscribeTurnMarks, turnMarksOn, useTurnMarks, type TurnMarks } from "./turnUnread";
import { onEveryAppWindow } from "./appWindowSet";

export interface Attention {
  /** Every agent row of the sidebar (groups + quick chats). */
  rows: AgentRow[];
  signals: Map<string, AgentSignal>;
  needs: Map<string, NeedsYou>;
  marks: TurnMarks;
}

/**
 * The sidebar's attention as a stable source (perf §9): the value changes with any agent's status, and a context
 * value that changes re-renders every row. Each row selects its own signal / needs-you (useRowSignal) and only
 * re-renders when those change.
 */
export interface AttentionSource {
  get(): Attention;
  subscribe(listener: () => void): () => void;
}

/** Provided by the sidebar so its rows share one computation; rows elsewhere fall back to their own. */
export const AttentionContext = createContext<AttentionSource | null>(null);

/** A stable AttentionSource for `attention` (null = none); its rows are told in the commit that changed it. */
export function useAttentionSource(attention: Attention | null): AttentionSource | null {
  const [holder] = useState(() => {
    const listeners = new Set<() => void>();
    const box: { current: Attention | null } = { current: null };
    const source: AttentionSource = {
      get: () => box.current!,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return { box, listeners, source };
  });
  // Written during render: rows rendered in the same pass read the new value (no second render for them).
  holder.box.current = attention;
  useLayoutEffect(() => {
    for (const l of [...holder.listeners]) l();
  }, [attention, holder]);
  return attention ? holder.source : null;
}

const noSubscribe = () => () => {};

/** One row's signal + needs-you: from the sidebar's context, else from its status and turn mark. */
export function useRowSignal(row: AgentRow): { signal: AgentSignal; needs: NeedsYou | undefined } {
  const source = useContext(AttentionContext);
  const mark = useSyncExternalStore(subscribeTurnMarks, () => getTurnMarks()[row.id]);
  // Rows of the multi-host sidebar carry host keys (its context is keyed by them); others their id.
  const key = row.key ?? row.id;
  // The row's own entries; the same object while they read the same (needs-you records are rebuilt per change).
  const last = useRef<{ key: string; signal: AgentSignal | undefined; needsKey: string; picked: { signal: AgentSignal | undefined; needs: NeedsYou | undefined } } | null>(null);
  const picked = useSyncExternalStore(source?.subscribe ?? noSubscribe, () => {
    if (!source) return null;
    const attention = source.get();
    const signal = attention.signals.get(key);
    const needs = attention.needs.get(key);
    const needsKey = needs ? JSON.stringify(needs) : "";
    const l = last.current;
    if (l && l.key === key && l.signal === signal && l.needsKey === needsKey) return l.picked;
    const next = { signal, needs };
    last.current = { key, signal, needsKey, picked: next };
    return next;
  });
  if (picked) return { signal: picked.signal ?? agentSignal(row, undefined, mark), needs: picked.needs };
  return { signal: agentSignal(row, undefined, mark), needs: undefined };
}

/** Signals / needs-you of every agent in the sidebar. */
export function useAttention(): Attention {
  const model = useSidebarModel();
  // What rows show of the agent views only, not every streamed token (lib/sessionsMeta).
  const allSessions = useApp((s) => sessionsMetaOf(s.sessions));
  const focus = useApp((s) => s.hosts?.active ?? "local");
  // The focus host's agents (`sessions` may also hold an open agent of another host).
  const sessions = useMemo(() => viewsOfHost(allSessions, focus), [focus, allSessions]);
  const approvals = useApp((s) => s.approvals);
  // Requests seen on the host feed: agents not open here wait for the owner too.
  const hostWaiting = useApp((s) => s.hostWaiting);
  const asks = useApp((s) => s.features.has(ASKS_FEATURE));
  // The focus host's records (the store may also hold the open agent's host's).
  const byId = useFocusDelegations();
  const ownerNotify = useApp((s) => s.features.has(OWNER_NOTIFY_FEATURE));
  const notes = useOwnerNotify((s) => s.byId);
  const marks = useTurnMarks();
  const rows = useMemo(() => [...model.groups.flatMap((g) => [...g.online, ...g.offline]), ...model.chats], [model]);
  const needs = useMemo(() => {
    const pending = pendingByAgent(sessions, hostWaiting);
    return needsYouByAgent({ pending, approvals, delegations: asks ? Object.values(byId) : null, ownerNotes: ownerNotify ? Object.values(notes) : null });
  }, [sessions, hostWaiting, approvals, asks, byId, ownerNotify, notes]);
  const signals = useMemo(() => new Map(rows.map((r) => [r.id, agentSignal(r, needs.get(r.id), marks[r.id])])), [rows, needs, marks]);
  return useMemo(() => ({ rows, signals, needs, marks }), [rows, signals, needs, marks]);
}

/**
 * App-level upkeep: the open agents' marks (the focused conversation and every other one on screen) clear when the window gets focus again (it ended while
 * the window was in the background), and marks of agents that no longer exist are dropped.
 */
export function useTurnMarkUpkeep(): void {
  useEffect(() => {
    const onFocus = () => {
      const s = useApp.getState();
      if (s.view.kind !== "conversation") return;
      // A folded one (strip / 只看 Shelf, docs/design/002) is not looked at: its mark stays.
      if (s.selectedId && getTurnMarks()[s.selectedId] && !isFoldedConversation(s.selectedHost ?? s.hosts?.active ?? "local", s.selectedId)) markSeen(s.selectedId);
      // Every conversation on screen is looked at (panes step 2: the other column too).
      for (const v of Object.values(s.views)) if (v.visible && turnMarksOn(v.hostId)[v.sessionId] && !isFoldedConversation(v.hostId, v.sessionId)) markSeenOn(v.hostId, v.sessionId);
    };
    // Any app window getting the focus (a desk window too, multi-window).
    return onEveryAppWindow((win) => {
      win.addEventListener("focus", onFocus);
      return () => win.removeEventListener("focus", onFocus);
    });
  }, []);
  // Not a render subscription (perf §9): App would re-render, with the whole tree under it, on every sidebar refresh.
  useEffect(() => {
    let last: ReturnType<typeof useApp.getState>["sidebar"] | undefined;
    const seen = new Map<string, unknown>();
    const prune = (state: ReturnType<typeof useApp.getState>) => {
      // Marks restored after a restart whose agent already runs a later turn (every host's snapshot).
      for (const [hostId, slice] of Object.entries(state.byHost)) {
        if (!slice.sidebar || seen.get(hostId) === slice.sidebar) continue;
        seen.set(hostId, slice.sidebar);
        settleStartedTurnsOn(hostId, slice.sidebar.active);
      }
      const sidebar = state.sidebar;
      if (sidebar === last) return;
      last = sidebar;
      if (sidebar) {
        settleStartedTurnsOn(keyFocus(), sidebar.active);
        pruneTurnMarks(new Set(sidebar.active.map((s) => s.cutexSessionId)));
      }
    };
    prune(useApp.getState());
    return useApp.subscribe(prune);
  }, []);
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
    return subscribeTick(ms, setNow);
  }, [ms, active]);
  return now;
}
