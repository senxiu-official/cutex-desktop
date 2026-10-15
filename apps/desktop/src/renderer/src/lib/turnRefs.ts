// App wiring of the turn lookup (lib/turnFetch.ts): the reference cache, the lookups in flight and
// their results, and the hook the reference card reads. A turn in the agent's loaded timeline is
// shown live (it keeps updating while it runs); anything else is read once from history pages.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { SessionHistory } from "@cutex-desktop/protocol";
import { agentHost, hostApi, useApp, viewHostOf, type SessionView } from "../store";
import { findTurn, LOOKUP_PAGE_TURNS, PageCache, singleTurn, type PageReader, type TurnLookup } from "./turnFetch";

export type TurnRefResult = TurnLookup | { status: "loading" } | { status: "host-offline" } | { status: "error"; message: string };

export interface TurnTarget {
  hostId: string;
  sessionId: string;
  turnId: string;
  threadId?: string | null;
  ordinal?: number | null;
}

/** Per agent, in memory: the last pages read for references (and reused by jumps). */
export const referenceCache = new PageCache();

const useTurnRefs = create<{ results: Record<string, TurnRefResult> }>(() => ({ results: {} }));
const inFlight = new Map<string, Promise<TurnRefResult>>();

const activeHost = () => useApp.getState().hosts?.active ?? "local";
/** Hosts whose turns can be looked up: the focus host and the open agent's host (multi-host P1). */
const shownHost = (hostId: string) => hostId === activeHost() || hostId === agentHost(useApp.getState());
const resultKey = (t: TurnTarget) => `${t.hostId}\n${t.sessionId}\n${t.turnId}`;
export const agentKey = (hostId: string, sessionId: string) => `${hostId}\n${sessionId}`;

let watching = false;
function watchHost(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if ((s.hosts?.active ?? "local") === (prev.hosts?.active ?? "local")) return;
    referenceCache.clear();
    inFlight.clear();
    useTurnRefs.setState({ results: {} });
  });
}

/** A history page reader for one agent that answers from the reference cache first (jumps reuse pages). */
export function cachedReader(hostId: string, sessionId: string): (cursor: string | null) => Promise<SessionHistory | null> {
  const agent = agentKey(hostId, sessionId);
  return async (cursor) => {
    const hit = referenceCache.get(agent, cursor);
    if (hit) return hit;
    const page = await hostApi(hostId).history(sessionId, cursor, LOOKUP_PAGE_TURNS);
    if (page) referenceCache.put(agent, cursor, page);
    return page;
  };
}

/** The loaded view as the lookup sees it; null while not loaded (or loading / failed). */
function loadedOf(view: SessionView | undefined): { timeline: SessionView["timeline"]; olderCursor: string | null; complete: boolean } | null {
  if (!view || view.loading || view.error) return null;
  return { timeline: view.timeline, olderCursor: view.older?.cursor ?? null, complete: !view.older || view.older.cursor === null };
}

/** Looks a turn up (once per target until the host changes or `retry`). */
export function lookupTurn(target: TurnTarget, retry = false): Promise<TurnRefResult> {
  watchHost();
  const key = resultKey(target);
  const running = inFlight.get(key);
  if (running && !retry) return running;
  const set = (r: TurnRefResult) => {
    useTurnRefs.setState((s) => ({ results: { ...s.results, [key]: r } }));
    return r;
  };
  if (!shownHost(target.hostId)) return Promise.resolve(set({ status: "host-offline" }));
  set({ status: "loading" });
  const read: PageReader = (cursor) => hostApi(target.hostId).history(target.sessionId, cursor, LOOKUP_PAGE_TURNS);
  const job = findTurn({
    agent: agentKey(target.hostId, target.sessionId),
    turnId: target.turnId,
    threadId: target.threadId,
    ordinal: target.ordinal,
    loaded: viewHostOf(target.sessionId) === target.hostId ? loadedOf(useApp.getState().sessions[target.sessionId]) : null,
    cache: referenceCache,
    read,
  }).then(
    (r) => set(r),
    (e: unknown) => set({ status: "error", message: e instanceof Error ? e.message : String(e) }),
  );
  inFlight.set(key, job);
  void job.finally(() => inFlight.get(key) === job && inFlight.delete(key));
  return job;
}

/** The reference card's turn: live from the loaded timeline when it is there, else looked up. */
export function useTurnRef(target: TurnTarget): TurnRefResult {
  const view = useApp((s) => s.sessions[target.sessionId]);
  // The loaded view is used only when it is that host's agent (views of two hosts may share an id).
  const host = useApp((s) => (s.sessions[target.sessionId] ? viewHostOf(target.sessionId) : null));
  const version = view?.version;
  const live = useMemo<TurnRefResult | null>(() => {
    if (target.hostId !== host || !view || view.loading || view.error) return null;
    const hit = singleTurn(view.timeline, target.turnId);
    if (!hit) return null;
    const complete = !view.older || view.older.cursor === null;
    return { status: "found", found: { timeline: hit.timeline, turn: hit.turn, ordinal: complete ? hit.index + 1 : (target.ordinal ?? null), from: "loaded" } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, view, version, target.hostId, target.turnId, target.ordinal]);
  const key = resultKey(target);
  const fetched = useTurnRefs((s) => s.results[key]);
  const waiting = !!view?.loading && target.hostId === host;
  useEffect(() => {
    if (!live && !fetched && !waiting) void lookupTurn(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live === null, fetched === undefined, waiting, key]);
  return live ?? fetched ?? { status: "loading" };
}
