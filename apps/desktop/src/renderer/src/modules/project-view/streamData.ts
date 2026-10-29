// Project 「动态」 hooks: the shared feed of a project + filter (streamStore) and the running-now list,
// polled every BACKGROUND_POLL_MS while shown (and again on the host's `cutex/projectEvents/appended`).
import { useCallback, useEffect, useMemo, useState } from "react";
import { PROJECT_EVENTS_FEATURE } from "../../../../shared/projectEvents";
import { featuresOf, useApp } from "../../store";
import { useProjectAppended } from "./live";
import { feedKey } from "./stream";
import { acquireFeed, BACKGROUND_POLL_MS, EMPTY_FEED, readBackground, useProjectStream, type BackgroundState, type Feed } from "./streamStore";

/** The host offers the project log (cutex `project-events`); false hides 「动态」 (today's list stays). */
export function useHasProjectEvents(hostId: string | null): boolean {
  return useApp((s) => !!hostId && featuresOf(s, hostId).has(PROJECT_EVENTS_FEATURE));
}

export function useProjectFeed(hostId: string, projectId: string, kinds: string[] | undefined, sessionId: string | null): { key: string; feed: Feed } {
  const kindsKey = kinds?.join(",") ?? "";
  const key = feedKey(hostId, projectId, kinds, sessionId);
  useEffect(() => acquireFeed(hostId, projectId, kindsKey ? kindsKey.split(",") : undefined, sessionId), [hostId, projectId, kindsKey, sessionId]);
  const feed = useProjectStream((s) => s.feeds[key]) ?? EMPTY_FEED;
  return useMemo(() => ({ key, feed }), [key, feed]);
}

const EMPTY_BG: BackgroundState = { data: null, error: null, loaded: false };

/** 正在进行: polled while mounted and the window is visible; `refresh` after a stop. */
export function useRunningNow(hostId: string, projectId: string): BackgroundState & { refresh(): void } {
  const [state, setState] = useState<{ key: string; bg: BackgroundState }>({ key: "", bg: EMPTY_BG });
  const [tick, setTick] = useState(0);
  const key = `${hostId}\n${projectId}`;
  const appended = useProjectAppended((s) => s.epochs[key] ?? 0);
  useEffect(() => {
    let live = true;
    void readBackground(hostId, projectId).then((bg) => {
      // A failed re-read keeps the last list (the error shows beside it).
      if (live) setState((old) => ({ key, bg: bg.data || old.key !== key ? bg : { ...old.bg, error: bg.error } }));
    });
    return () => {
      live = false;
    };
  }, [hostId, projectId, key, tick, appended]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) setTick((n) => n + 1);
    }, BACKGROUND_POLL_MS);
    return () => clearInterval(timer);
  }, [key]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const bg = state.key === key ? state.bg : EMPTY_BG;
  return useMemo(() => ({ ...bg, refresh }), [bg, refresh]);
}
