// Presentation only: the store applies every delta immediately. A conversation's structure ignores
// agent/plan text, while the matching live row reads the latest entry at most every 50 ms. Finishing
// an item, approvals, history, queue changes and reasoning retain their immediate render path.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { useApp, viewOf, type SessionView } from "../store";
import type { TimelineEntry } from "./timeline";

export const STREAM_RENDER_MS = 50;

function rowStructure(view: SessionView | undefined): unknown[] {
  if (!view) return [];
  const turn = view.timeline.turns.find((turn) => turn.id === view.timeline.activeTurnId);
  return [view.timeline.entries.size, view.timeline.turns.length, view.timeline.activeTurnId, ...(turn?.entryIds ?? []).flatMap((id) => {
    const entry = view.timeline.entries.get(id);
    return entry?.kind === "reasoning" ? [id, entry] : [id];
  })];
}

/** Other view fields can change without moving version (connection, queue, history load, …). */
function textOnly(previous: SessionView | undefined, next: SessionView | undefined): boolean {
  if (!previous || !next || previous.timeline !== next.timeline) return false;
  const text = (next.textVersion ?? 0) - (previous.textVersion ?? 0);
  if (text <= 0 || next.version - previous.version !== text) return false;
  const keys = Object.keys(next) as (keyof SessionView)[];
  return keys.length === Object.keys(previous).length && keys.every((key) =>
    key === "version" || key === "textVersion" || Object.is(previous[key], next[key]));
}

export function conversationStructureSelector(): (view: SessionView | undefined) => SessionView | undefined {
  let last: SessionView | undefined;
  let shown: SessionView | undefined;
  let structure: unknown[] = [];
  return (next) => {
    if (next === last) return shown;
    const nextStructure = rowStructure(next);
    const onlyText = textOnly(last, next) && structure.length === nextStructure.length &&
      structure.every((entry, index) => entry === nextStructure[index]);
    last = next;
    structure = nextStructure;
    if (!onlyText) shown = next;
    return shown;
  };
}

export function useConversationStructure(hostId: string, sessionId: string | null): SessionView | undefined {
  const select = useMemo(conversationStructureSelector, [hostId, sessionId]);
  return useApp((state) => select(sessionId ? viewOf(state, hostId, sessionId) : undefined));
}

/** One clock per mounted timeline: all its live row subscribers publish in the same callback. */
export function createStreamRenderSource(
  read: () => SessionView | undefined,
  subscribeStore: (listener: () => void) => () => void,
) {
  const listeners = new Set<() => void>();
  let revision = 0;
  let previous: SessionView | undefined;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let publishedAt = -Infinity;
  const cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const publish = () => {
    cancel();
    publishedAt = performance.now();
    revision++;
    for (const listener of listeners) listener();
  };
  const changed = () => {
    const next = read();
    if (next === previous) return;
    const coalesce = textOnly(previous, next);
    previous = next;
    const remaining = STREAM_RENDER_MS - (performance.now() - publishedAt);
    if (!coalesce || remaining <= 0) publish();
    else timer ??= setTimeout(publish, remaining);
  };
  return {
    read,
    getRevision: () => revision,
    subscribe: (listener: () => void) => {
      if (!listeners.size) {
        previous = read();
        // A source reconnect (StrictMode / all live rows leaving) starts with the latest store.
        revision++;
        publishedAt = -Infinity;
        unsubscribe = subscribeStore(changed);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribe?.(); unsubscribe = null; cancel(); }
      };
    },
  };
}

export type StreamRenderSource = ReturnType<typeof createStreamRenderSource>;
export const StreamRenderContext = createContext<{ sessionId: string; source: StreamRenderSource } | null>(null);
const noSubscribe = () => () => {};

export function useStreamedEntry<T extends TimelineEntry>(sessionId: string, fallback: T): T {
  const context = useContext(StreamRenderContext);
  const source = context?.sessionId === sessionId &&
    (fallback.kind === "agent" || fallback.kind === "plan") && fallback.streaming ? context.source : null;
  const snapshot = useMemo(() => {
    let seen = -1;
    let entry = fallback;
    return () => {
      if (source && seen !== source.getRevision()) {
        seen = source.getRevision();
        const current = source.read()?.timeline.entries.get(fallback.id);
        entry = current?.kind === fallback.kind ? current as T : fallback;
      }
      return entry;
    };
  }, [source, fallback]);
  return useSyncExternalStore(source?.subscribe ?? noSubscribe, snapshot, snapshot);
}
