// Per-agent view state of the queue card above the composer (queue redesign 2026-10-15): the whole
// card collapsed to its header line, and 「还有 N 项」 expanded. A per-viewer convenience in
// localStorage; every read / write tolerates storage that is missing or throws (the card then
// starts open and folded).

const KEY = "cutex-desktop.queueView.v1";
/** Agents kept at most (oldest dropped), so the record stays small. */
const MAX_AGENTS = 200;

export interface QueueViewState {
  /** The card shows only its header line. */
  collapsed?: boolean;
  /** 「还有 N 项」 expanded: every row shows. */
  expanded?: boolean;
}

type Stored = Record<string, QueueViewState>;

/** In-memory copy (also the fallback without storage). */
let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  cache = {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const { collapsed, expanded } = v as QueueViewState;
        cache[id] = { ...(collapsed === true ? { collapsed } : {}), ...(expanded === true ? { expanded } : {}) };
      }
  } catch {
    // storage unavailable or unreadable: start empty
  }
  return cache;
}

export function queueViewOf(sessionId: string | undefined): QueueViewState {
  return (sessionId && load()[sessionId]) || {};
}

export function setQueueView(sessionId: string | undefined, patch: QueueViewState): void {
  if (!sessionId) return;
  const all = load();
  const next = { ...all[sessionId], ...patch };
  delete all[sessionId];
  if (next.collapsed || next.expanded) all[sessionId] = { ...(next.collapsed ? { collapsed: true } : {}), ...(next.expanded ? { expanded: true } : {}) };
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_AGENTS))) delete all[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: kept for this run only
  }
}

/** Tests: forget the in-memory copy. */
export function resetQueueViewCache(): void {
  cache = null;
}
