// Freshly created agents (owner 2026-10-15): a new agent — made by the owner or by another agent —
// must not vanish into 「N 个空闲」 right after its first turn. While it is "fresh" it stays a full
// sidebar row (lib/sidebarLayout `isFresh`) with a small 「新」 marker:
//
//   fresh = created less than FRESH_MS ago (the session resource's `createdAt`; without one, the
//           first time this desktop saw it — never for agents already in a host's first snapshot)
//           AND the owner has not opened it since.
//
// Opening it clears freshness. The opened marks are a per-viewer convenience in localStorage (every
// read / write tolerates missing or throwing storage), pruned once older than FRESH_MS. The pure
// part (`freshSince`, `freshKeys`) is unit-tested (test/freshAgents.test.ts).
import { create } from "zustand";

export const FRESH_MS = 30 * 60_000;
/** Rows seen within this long after their host's first sighting count as that host's first snapshot. */
export const FIRST_SNAPSHOT_MS = 10_000;

export interface FreshCandidate {
  /** Row key (lib/sidebar rowKey). */
  key: string;
  /** Desktop host id (absent = the focus host). */
  hostId?: string;
  /** cutex SessionResource.createdAt (ISO); null / absent when the host does not say. */
  createdAt?: string | null;
}

export interface FreshContext {
  now: number;
  /** Row keys the owner opened (any time within FRESH_MS). */
  opened: ReadonlySet<string>;
  /** First time this desktop saw each row key (ms). */
  firstSeen: ReadonlyMap<string, number>;
  /** First time this desktop saw each host (ms), keyed by hostId ("" = absent). */
  hostSeen: ReadonlyMap<string, number>;
}

/**
 * When the agent became "new" (ms), or null when it cannot be fresh: its creation time, else the first
 * sighting this run — unless that was with its host's first snapshot (an existing agent).
 */
export function freshSince(row: FreshCandidate, ctx: Pick<FreshContext, "firstSeen" | "hostSeen">): number | null {
  const created = row.createdAt ? Date.parse(row.createdAt) : NaN;
  if (Number.isFinite(created)) return created;
  const seen = ctx.firstSeen.get(row.key);
  const host = ctx.hostSeen.get(row.hostId ?? "");
  if (seen === undefined || host === undefined) return null;
  return seen - host > FIRST_SNAPSHOT_MS ? seen : null;
}

/** The fresh row keys now, and when the set changes next by itself (the soonest expiry; null = never). */
export function freshKeys(rows: readonly FreshCandidate[], ctx: FreshContext): { keys: Set<string>; nextChange: number | null } {
  const keys = new Set<string>();
  let nextChange: number | null = null;
  for (const row of rows) {
    if (ctx.opened.has(row.key)) continue;
    const since = freshSince(row, ctx);
    if (since === null) continue;
    const until = since + FRESH_MS;
    if (until <= ctx.now) continue;
    keys.add(row.key);
    nextChange = nextChange === null ? until : Math.min(nextChange, until);
  }
  return { keys, nextChange };
}

// ---------- runtime state ----------

const OPENED_KEY = "cutex-desktop.freshOpened.v1";
let opened: Map<string, number> | null = null;
const firstSeen = new Map<string, number>();
const hostSeen = new Map<string, number>();

function loadOpened(): Map<string, number> {
  if (opened) return opened;
  opened = new Map();
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "number") opened.set(k, v);
  } catch {
    /* no storage: in memory only */
  }
  return opened;
}

function saveOpened(now: number): void {
  const map = loadOpened();
  for (const [k, at] of map) if (now - at > FRESH_MS) map.delete(k);
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* best effort */
  }
}

/** The fresh row keys (published by the sidebar, read by the rows' 「新」 marker). */
export const useFreshAgents = create<{ keys: ReadonlySet<string>; openedVersion: number }>(() => ({ keys: new Set(), openedVersion: 0 }));

/** The owner opened this agent: it is no longer fresh. */
export function markAgentOpened(key: string | null | undefined, now = Date.now()): void {
  if (!key) return;
  const map = loadOpened();
  if (map.has(key)) return;
  map.set(key, now);
  saveOpened(now);
  useFreshAgents.setState((s) => {
    if (!s.keys.has(key)) return { openedVersion: s.openedVersion + 1 };
    const keys = new Set(s.keys);
    keys.delete(key);
    return { keys, openedVersion: s.openedVersion + 1 };
  });
}

/** Note the rows seen now (first sightings) and compute the fresh set. */
export function computeFresh(rows: readonly FreshCandidate[], now = Date.now()): { keys: Set<string>; nextChange: number | null } {
  for (const row of rows) {
    const host = row.hostId ?? "";
    if (!hostSeen.has(host)) hostSeen.set(host, now);
    if (!firstSeen.has(row.key)) firstSeen.set(row.key, now);
  }
  return freshKeys(rows, { now, opened: new Set(loadOpened().keys()), firstSeen, hostSeen });
}

/** Publish a fresh set (same content → no store change). */
export function publishFresh(keys: ReadonlySet<string>): void {
  const current = useFreshAgents.getState().keys;
  if (current.size === keys.size && [...keys].every((k) => current.has(k))) return;
  useFreshAgents.setState({ keys });
}

/** Whether the row with this key shows the 「新」 marker. */
export const useIsFreshAgent = (key: string): boolean => useFreshAgents((s) => s.keys.has(key));
