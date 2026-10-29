// What the sidebar (and the other attention readers: 需要你 strip, desktop card, chip tray) need from
// the store's agent views (`sessions`), without the rest of them (perf baseline 2026-10-20, H1 / fix 2).
// A streamed token bumps one view's `version` and replaces `sessions`; a list subscribed to all of
// `sessions` re-built every row per token. These readers use `sessionsMetaOf(s.sessions)` instead: a
// projection of the fields they read (pending requests, connection, turn in progress), the same object
// until one of those changes (compared by a fingerprint string), so a token changes nothing here.
// Timelines are mutated in place (store `SessionView.version`): the projection copies what it keeps.
import type { ViewKey } from "./viewKey";
import { isViewOf, viewKeyParts } from "./viewKey";

/** The parts of an agent view the sidebar reads (structurally a lib/sidebar `LiveViewLike` / `MethodViews` entry). */
export interface ViewMeta {
  loading: boolean;
  connection: "connecting" | "live" | "retrying";
  historySource: "live" | "offline" | "archived";
  timeline: { pending: ReadonlyMap<string, { method: string }>; activeTurnId: string | null };
}

/** The store's views as the sidebar sees them, by view key (`<host>\n<session id>`). */
export type SessionsMeta = Readonly<Record<ViewKey, ViewMeta>>;

/** What `sessionsMetaOf` reads from a store view (`SessionView`). */
export interface ViewLike {
  loading: boolean;
  connection: ViewMeta["connection"];
  historySource: ViewMeta["historySource"];
  timeline: { pending: ReadonlyMap<string, { method: string }>; activeTurnId: string | null };
}

/** One string per relevant state of the views: equal strings = nothing the sidebar shows changed. */
export function sessionsFingerprint(sessions: Readonly<Record<string, ViewLike>>): string {
  let out = "";
  for (const [key, v] of Object.entries(sessions)) {
    out += `${key}\t${v.loading ? 1 : 0}${v.connection[0]}${v.historySource[0]}\t${v.timeline.activeTurnId ?? ""}\t`;
    for (const [id, p] of v.timeline.pending) out += `${id}=${p.method},`;
    out += "\n";
  }
  return out;
}

function project(sessions: Readonly<Record<string, ViewLike>>): SessionsMeta {
  const out: Record<ViewKey, ViewMeta> = {};
  for (const [key, v] of Object.entries(sessions)) {
    const pending = new Map<string, { method: string }>();
    for (const [id, p] of v.timeline.pending) pending.set(id, { method: p.method });
    out[key] = { loading: v.loading, connection: v.connection, historySource: v.historySource, timeline: { pending, activeTurnId: v.timeline.activeTurnId } };
  }
  return out;
}

let lastSessions: unknown = null;
let lastPrint = "";
let lastMeta: SessionsMeta = {};

/**
 * The sidebar's projection of `sessions`: the previous object while nothing it holds changed (a store
 * selector: `useApp((s) => sessionsMetaOf(s.sessions))` re-renders only on a real change).
 */
export function sessionsMetaOf(sessions: Readonly<Record<string, ViewLike>>): SessionsMeta {
  if (sessions === lastSessions) return lastMeta;
  lastSessions = sessions;
  const print = sessionsFingerprint(sessions);
  if (print === lastPrint) return lastMeta;
  lastPrint = print;
  lastMeta = project(sessions);
  return lastMeta;
}

/** One host's entries of a record keyed by view key, by session id (store `hostSessionViews` for any value). */
export function viewsOfHost<V>(record: Readonly<Record<ViewKey, V>>, hostId: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) if (isViewOf(key, hostId)) out[viewKeyParts(key).sessionId] = value;
  return out;
}

/**
 * Last activity time per agent for the sidebar layout (idle fold after 30 min, offline order, ±1 min is
 * plenty): the previous object until an agent appears / goes or its time moves into another minute.
 * Streaming refreshes `activity[id].at` every frame; the layout then stays put.
 */
const AT_STEP = 60_000;
let lastActivity: unknown = null;
let lastTimes: Readonly<Record<string, number>> = {};
export function activityTimesOf(activity: Readonly<Record<string, { at: number }>>): Readonly<Record<string, number>> {
  if (activity === lastActivity) return lastTimes;
  lastActivity = activity;
  const ids = Object.keys(activity);
  const same = ids.length === Object.keys(lastTimes).length && ids.every((id) => id in lastTimes && Math.floor(lastTimes[id]! / AT_STEP) === Math.floor(activity[id]!.at / AT_STEP));
  if (same) return lastTimes;
  const next: Record<string, number> = {};
  for (const id of ids) next[id] = activity[id]!.at;
  lastTimes = next;
  return next;
}

const rowTimes = new WeakMap<readonly string[], Readonly<Record<string, number>>>();
/**
 * `times` (activityTimesOf) of `ids` only, the same object while those are unchanged: a list of rows (the offline
 * section) re-renders for its own rows' activity, not for every agent's (0.2.0 beta perf audit, 2026-10-24).
 */
export function activityTimesFor(times: Readonly<Record<string, number>>, ids: readonly string[]): Readonly<Record<string, number>> {
  const last = rowTimes.get(ids);
  if (last && ids.every((id) => last[id] === times[id])) return last;
  const next: Record<string, number> = {};
  for (const id of ids) if (times[id] !== undefined) next[id] = times[id]!;
  rowTimes.set(ids, next);
  return next;
}
