// Finished / failed turns the owner hasn't looked at yet (sidebar 「完成」 / 「出错」 pills, the 需要你
// strip). cutex's session resource has no "last completed turn" (id / status / time), so the desktop
// records the `turn/completed` events it sees on the host feed while the owner isn't looking at that
// agent, persisted in localStorage; opening the agent clears its mark. Turns that end while the
// desktop isn't running are not known (cutex gap, see PROGRESS.md). Persisted per host (host keys,
// lib/hostKeys); readers see the focus host's marks by agent id.
import { useSyncExternalStore } from "react";
import { hostKey, keyFocus, onKeyFocus, parseHostKey, projectRecord, registerHostKeyed } from "./hostKeys";

export interface TurnMark {
  /** When the turn ended (ms). */
  at: number;
  /** The turn failed (red 「出错」) rather than completed (blue 「完成」). */
  failed: boolean;
  turnId: string | null;
}

export type TurnMarks = Readonly<Record<string, TurnMark>>;

export interface TurnEnd {
  turnId: string | null;
  status: string;
}

/** The turn id / status of a native `turn/completed` notification's params; null otherwise. */
export function turnEndOf(method: string | undefined, params: unknown): TurnEnd | null {
  if (method !== "turn/completed") return null;
  const turn = (params as { turn?: { id?: unknown; status?: unknown } } | null)?.turn;
  return { turnId: typeof turn?.id === "string" ? turn.id : null, status: typeof turn?.status === "string" ? turn.status : "completed" };
}

/**
 * Marks after a turn of `id` ended. Seen while it ended (`viewing`: the window has focus and shows
 * this agent): no mark (an older one goes too). Interrupted turns (the owner's stop) leave the marks
 * as they were.
 */
export function applyTurnEnd(marks: TurnMarks, id: string, end: TurnEnd, at: number, viewing: boolean): TurnMarks {
  if (viewing) return clearMark(marks, id);
  if (end.status === "interrupted") return marks;
  return { ...marks, [id]: { at, failed: end.status === "failed", turnId: end.turnId } };
}

/** Without `id`'s mark (the same object when there is none). */
export function clearMark(marks: TurnMarks, id: string): TurnMarks {
  if (!(id in marks)) return marks;
  const next = { ...marks };
  delete next[id];
  return next;
}

/** Only the marks of agents that still exist (retired / deleted ones are dropped). */
export function pruneMarks(marks: TurnMarks, alive: ReadonlySet<string>): TurnMarks {
  const dead = Object.keys(marks).filter((id) => !alive.has(id));
  if (dead.length === 0) return marks;
  const next = { ...marks };
  for (const id of dead) delete next[id];
  return next;
}

// ---------- persisted store ----------

const KEY = "cutex-desktop.turnMarks";
const listeners = new Set<() => void>();
/** Persisted marks by host key (legacy bare agent ids until claimed); `current`: the focus host's by agent id. */
let stored: TurnMarks = load();
let current: TurnMarks = projectRecord(stored);

function load(): TurnMarks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<TurnMark>>;
    const out: Record<string, TurnMark> = {};
    for (const [id, m] of Object.entries(raw)) if (m && typeof m.at === "number") out[id] = { at: m.at, failed: !!m.failed, turnId: m.turnId ?? null };
    return out;
  } catch {
    return {};
  }
}

function save(next: TurnMarks): void {
  if (next === stored) return;
  stored = next;
  current = projectRecord(stored);
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

/**
 * Apply a change to one host's marks (by agent id). `touched`: agents of that host this change is
 * about — their legacy bare entries are that host's (claimed: replaced or dropped with the change).
 */
function updateHost(hostId: string, change: (marks: TurnMarks) => TurnMarks, touched: readonly string[] = []): void {
  const mine: Record<string, TurnMark> = {};
  const rest: Record<string, TurnMark> = {};
  for (const [entry, mark] of Object.entries(stored)) {
    const key = parseHostKey(entry);
    if (key && key[0] === hostId) mine[key[1]] = mark;
    else rest[entry] = mark;
  }
  const next = change(mine);
  const legacy = touched.filter((id) => id in rest && !parseHostKey(id));
  if (next === mine && !legacy.length) return;
  for (const id of legacy) delete rest[id];
  const out: Record<string, TurnMark> = { ...rest };
  for (const [id, mark] of Object.entries(next)) out[hostKey(hostId, id)] = mark;
  save(out);
}

registerHostKeyed({
  claim(hostId, ids) {
    const legacy = Object.keys(stored).filter((entry) => !parseHostKey(entry) && ids.has(entry));
    if (!legacy.length) return;
    const out = { ...stored };
    for (const id of legacy) {
      const key = hostKey(hostId, id);
      if (!(key in out)) out[key] = out[id]!;
      delete out[id];
    }
    save(out);
  },
  dropLegacy() {
    if (Object.keys(stored).every((entry) => parseHostKey(entry))) return;
    save(Object.fromEntries(Object.entries(stored).filter(([entry]) => parseHostKey(entry))));
  },
});
onKeyFocus(() => {
  current = projectRecord(stored);
  for (const l of listeners) l();
});

/** The focus host's marks by agent id. */
export function getTurnMarks(): TurnMarks {
  return current;
}

/** A turn of the focus host's agent `id` ended. */
export function recordTurnEnd(id: string, end: TurnEnd, viewing: boolean, at = Date.now()): void {
  recordTurnEndOn(keyFocus(), id, end, viewing, at);
}

/** A turn of `hostId`'s agent `id` ended (hosts outside the scope keep their marks too). */
export function recordTurnEndOn(hostId: string, id: string, end: TurnEnd, viewing: boolean, at = Date.now()): void {
  if (!viewing && end.status === "interrupted") return; // marks stay as they were
  updateHost(hostId, (marks) => applyTurnEnd(marks, id, end, at, viewing), [id]);
}

/** The owner opened / is looking at the focus host's agent. */
export function markSeen(id: string): void {
  if (!(id in current)) return;
  updateHost(keyFocus(), (marks) => clearMark(marks, id), [id]);
}

/** The owner opened / is looking at `hostId`'s agent (multi-host: an agent of another host in the scope). */
export function markSeenOn(hostId: string, id: string): void {
  if (hostId === keyFocus()) return markSeen(id);
  if (!(hostKey(hostId, id) in stored)) return;
  updateHost(hostId, (marks) => clearMark(marks, id), [id]);
}

/** `hostId`'s marks by agent id (the focus host's = getTurnMarks; legacy entries only for the focus). */
export function turnMarksOn(hostId: string): TurnMarks {
  return hostId === keyFocus() ? current : projectRecord(Object.fromEntries(Object.entries(stored).filter(([entry]) => parseHostKey(entry) !== null)), hostId);
}

/** Only the focus host's agents that still exist keep marks (other hosts' and unclaimed legacy marks stay). */
export function pruneTurnMarks(alive: ReadonlySet<string>): void {
  updateHost(keyFocus(), (marks) => pruneMarks(marks, alive));
}

export function useTurnMarks(): TurnMarks {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
