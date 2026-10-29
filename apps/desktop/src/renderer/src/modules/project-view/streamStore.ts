// Project 「动态」 data (design 022): one feed per project + filter, shared by every view showing it
// (ref-counted). A feed reads the newest page, then follows the live stream from that page's cursor
// (main `watchProjectEvents`: resumes, catches up after `lagged`); scrolling down reads older pages.
// 409 (cursor expired / journal recreated) reads the newest page again; 503 retries; the host
// reconnecting starts over. The running-now list (正在进行) is polled while a view shows it.
import { create } from "zustand";
import type { DaemonApi } from "../../../../shared/ipc";
import { projectNextCursor, type ProjectBackground, type ProjectEvent, type ProjectEventsMessage } from "../../../../shared/projectEvents";
import { bridge } from "../../bridge";
import { services } from "../app";
import { feedKey, mergeRows, type StopCall } from "./stream";

/** Rows per page. */
export const PAGE_SIZE = 50;
/** Retry a 503 / a failed read after this long. */
export const RETRY_MS = 10_000;
/**
 * Pages one older read goes through while they come back empty (r252+: cutex stops a page after a bounded
 * scan, so for a narrow filter it can hold no rows yet say `hasMore`) before it stops and marks the feed
 * `stalled` (the view then offers to keep looking).
 */
export const EMPTY_HOPS = 5;

export type FeedPhase = "loading" | "ready" | "unavailable" | "gone" | "unsupported" | "error";
export type LiveState = "connecting" | "live" | "retrying" | "off";

export interface Feed {
  rows: ProjectEvent[];
  phase: FeedPhase;
  live: LiveState;
  /** `before=` for the next older page (cutex's `nextCursor`; before r252 the oldest row's cursor). */
  older: string | null;
  hasMore: boolean;
  /** The last older read went through {@link EMPTY_HOPS} empty pages and there is still more. */
  stalled: boolean;
  loadingMore: boolean;
  streamId: string | null;
  /** Bumped when a 409 made the feed start over (the view shows 「动态已刷新」 once). */
  reloads: number;
  error: string | null;
}

export const EMPTY_FEED: Feed = { rows: [], phase: "loading", live: "off", older: null, hasMore: false, stalled: false, loadingMore: false, streamId: null, reloads: 0, error: null };

export const useProjectStream = create<{ feeds: Record<string, Feed> }>(() => ({ feeds: {} }));

interface Controller {
  key: string;
  hostId: string;
  projectId: string;
  kinds: string[] | undefined;
  sessionId: string | null;
  refs: number;
  watchId: string | null;
  /** Bumped on every (re)load: answers of an older load are dropped. */
  epoch: number;
  retry: ReturnType<typeof setTimeout> | null;
}

const controllers = new Map<string, Controller>();
const byWatch = new Map<string, Controller>();
let offEvents: (() => void) | null = null;
let offState: (() => void) | null = null;

/** Tests: a fake daemon per host. */
let daemonOf: (hostId: string) => DaemonApi = (hostId) => services.daemonFor(hostId);
export function setStreamDaemon(f: ((hostId: string) => DaemonApi) | null): void {
  daemonOf = f ?? ((hostId) => services.daemonFor(hostId));
}

const patch = (key: string, f: (feed: Feed) => Partial<Feed>) =>
  useProjectStream.setState((s) => {
    const feed = s.feeds[key];
    return feed ? { feeds: { ...s.feeds, [key]: { ...feed, ...f(feed) } } } : s;
  });

function phaseOf(code: string): FeedPhase {
  if (code === "project_events_unavailable") return "unavailable";
  if (code === "project_not_found") return "gone";
  if (code === "unsupported") return "unsupported";
  return "error";
}

function unwatch(c: Controller): void {
  if (!c.watchId) return;
  byWatch.delete(c.watchId);
  void daemonOf(c.hostId).unwatchProjectEvents(c.watchId).catch(() => undefined);
  c.watchId = null;
}

function scheduleRetry(c: Controller): void {
  if (c.retry) clearTimeout(c.retry);
  c.retry = setTimeout(() => {
    c.retry = null;
    if (controllers.get(c.key) === c) void load(c);
  }, RETRY_MS);
}

/** Read the newest page (replacing the rows) and follow live from its cursor. */
async function load(c: Controller): Promise<void> {
  const epoch = ++c.epoch;
  unwatch(c);
  patch(c.key, (f) => ({ phase: f.rows.length ? f.phase : "loading", live: "off", error: null }));
  let r;
  try {
    r = await daemonOf(c.hostId).projectEvents(c.projectId, { limit: PAGE_SIZE, kinds: c.kinds, sessionId: c.sessionId });
  } catch (e) {
    r = { ok: false as const, code: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (c.epoch !== epoch || controllers.get(c.key) !== c) return;
  if (!r.ok) {
    const phase = phaseOf(r.code);
    patch(c.key, () => ({ phase, error: r.message }));
    if (phase === "unavailable" || phase === "error") scheduleRetry(c);
    return;
  }
  const page = r.value;
  const older = projectNextCursor(page, null);
  useProjectStream.setState((s) => ({
    feeds: {
      ...s.feeds,
      [c.key]: { ...(s.feeds[c.key] ?? EMPTY_FEED), rows: page.events, phase: "ready", live: "connecting", older, hasMore: older !== null, stalled: false, loadingMore: false, streamId: page.streamId, error: null },
    },
  }));
  ensureListeners();
  let watchId: string;
  try {
    watchId = await daemonOf(c.hostId).watchProjectEvents(c.projectId, { after: page.cursor, streamId: page.streamId, kinds: c.kinds, sessionId: c.sessionId });
  } catch {
    if (c.epoch === epoch) {
      patch(c.key, () => ({ live: "retrying" }));
      scheduleRetry(c);
    }
    return;
  }
  if (c.epoch !== epoch || controllers.get(c.key) !== c) {
    void daemonOf(c.hostId).unwatchProjectEvents(watchId).catch(() => undefined);
    return;
  }
  c.watchId = watchId;
  byWatch.set(watchId, c);
}

function onMessage(hostId: string, m: ProjectEventsMessage): void {
  const c = byWatch.get(m.watchId);
  if (!c || c.hostId !== hostId) return;
  switch (m.kind) {
    case "event":
      return patch(c.key, (f) => ({ rows: mergeRows(f.rows, [m.event]) }));
    case "status":
      return patch(c.key, () => ({ live: m.status }));
    case "reset":
      byWatch.delete(m.watchId);
      c.watchId = null;
      patch(c.key, (f) => ({ reloads: f.reloads + 1 }));
      return void load(c);
    case "failed":
      byWatch.delete(m.watchId);
      c.watchId = null;
      return patch(c.key, (f) => ({ live: "off", phase: phaseOf(m.code) === "gone" ? "gone" : f.phase, error: m.message }));
  }
}

function ensureListeners(): void {
  if (typeof bridge?.on !== "function") return;
  offEvents ??= bridge.on("projectEvents", ({ hostId, ...m }) => onMessage(hostId, m as ProjectEventsMessage)) ?? null;
  // The host's connection went away and came back: main closed its watches, start over.
  offState ??=
    bridge.on("daemonState", ({ hostId, state }) => {
      for (const c of controllers.values()) {
        if (c.hostId !== hostId) continue;
        if (state.kind !== "connected") {
          unwatch(c);
          patch(c.key, () => ({ live: "off" }));
        } else if (!c.watchId) void load(c);
      }
    }) ?? null;
}

/** Start (or share) the feed for a project + filter; the returned function releases it. */
export function acquireFeed(hostId: string, projectId: string, kinds: string[] | undefined, sessionId: string | null): () => void {
  const key = feedKey(hostId, projectId, kinds, sessionId);
  let c = controllers.get(key);
  if (!c) {
    c = { key, hostId, projectId, kinds, sessionId, refs: 0, watchId: null, epoch: 0, retry: null };
    controllers.set(key, c);
    useProjectStream.setState((s) => ({ feeds: { ...s.feeds, [key]: s.feeds[key] ?? EMPTY_FEED } }));
    void load(c);
  }
  c.refs++;
  const held = c;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--held.refs > 0) return;
    held.epoch++;
    if (held.retry) clearTimeout(held.retry);
    unwatch(held);
    controllers.delete(key);
    useProjectStream.setState((s) => {
      const { [key]: _gone, ...feeds } = s.feeds;
      return { feeds };
    });
  };
}

/** Read the next older page (scrolling down). */
export async function loadOlder(key: string): Promise<void> {
  const c = controllers.get(key);
  const feed = useProjectStream.getState().feeds[key];
  if (!c || !feed || !feed.hasMore || feed.loadingMore || !feed.older || feed.phase !== "ready") return;
  const epoch = c.epoch;
  patch(key, () => ({ loadingMore: true }));
  let from = feed.older;
  for (let hop = 1; ; hop++) {
    let r;
    try {
      r = await daemonOf(c.hostId).projectEvents(c.projectId, { before: from, limit: PAGE_SIZE, kinds: c.kinds, sessionId: c.sessionId, streamId: feed.streamId });
    } catch (e) {
      r = { ok: false as const, code: "error", message: e instanceof Error ? e.message : String(e) };
    }
    if (c.epoch !== epoch || controllers.get(key) !== c) return;
    if (!r.ok) {
      if (r.code === "cursor_expired") {
        patch(key, (f) => ({ loadingMore: false, reloads: f.reloads + 1 }));
        return load(c);
      }
      // Pages skipped so far held no rows: retrying from the first cursor loses nothing.
      return patch(key, () => ({ loadingMore: false, error: r.message }));
    }
    const page = r.value;
    // r252+ nextCursor (a short / empty page can still have more); null when it would not move on.
    const next = projectNextCursor(page, from);
    if (page.events.length || !next || hop >= EMPTY_HOPS) {
      const stalled = !page.events.length && next !== null;
      return patch(key, (f) => ({ rows: mergeRows(f.rows, page.events), older: next ?? f.older, hasMore: next !== null, stalled, loadingMore: false, error: null }));
    }
    from = next;
  }
}

/** Tests: drop every feed and listener. */
export function resetProjectStreams(): void {
  for (const c of controllers.values()) if (c.retry) clearTimeout(c.retry);
  controllers.clear();
  byWatch.clear();
  offEvents?.();
  offState?.();
  offEvents = null;
  offState = null;
  useProjectStream.setState({ feeds: {} });
}

// ── 正在进行 ──────────────────────────────────────────────────────────────────────────────────────

/** Poll interval while a view shows the list (cutex reuses an answer for 5 s). */
export const BACKGROUND_POLL_MS = 5_000;

export interface BackgroundState {
  data: ProjectBackground | null;
  /** The last read failed with this code (data keeps the previous answer). */
  error: string | null;
  loaded: boolean;
}

export async function readBackground(hostId: string, projectId: string): Promise<BackgroundState> {
  try {
    const r = await daemonOf(hostId).projectBackground(projectId);
    return r.ok ? { data: r.value, error: null, loaded: true } : { data: null, error: r.code, loaded: true };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e), loaded: true };
  }
}

export type StopOutcome = { ok: true } | { ok: false; conflict: boolean; message: string };

/** Send one stop request (owner only: cutex gives `stop` to the owner alone). */
export async function sendStop(hostId: string, call: StopCall): Promise<StopOutcome> {
  const daemon = daemonOf(hostId);
  try {
    switch (call.kind) {
      case "claudeTask":
        await daemon.stopClaudeTask(call.sessionId, call.threadId, call.taskId);
        return { ok: true };
      case "terminal":
        await daemon.terminateBackgroundTerminal(call.sessionId, call.threadId, call.processId);
        return { ok: true };
      case "job": {
        const r = await daemon.cancelJob(call.jobId, call.expectedRevision);
        return r.ok ? { ok: true } : { ok: false, conflict: r.code === "job_conflict", message: r.message };
      }
    }
  } catch (e) {
    return { ok: false, conflict: false, message: e instanceof Error ? e.message : String(e) };
  }
}
