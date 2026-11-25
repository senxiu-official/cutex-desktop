// Figures of archived agents (owner 2026-11-24: 已归档的智能体 statistics) — read from what cutex already keeps, never
// computed by the desktop (AGENTS.md rule 1):
// - size: GET /v2/storage/stores/light-homes/items (cutex `host-storage`): the agents' local copies, each item naming its
//   cutexSessionId and state; cutex reads its own measurement cache there (no walk on GET). Sum per agent.
// - tokens / turns: GET /v2/usage?groupBy=agent (cutex `usage-ledger`), in ≤ 366-day windows from the oldest agent.
// Archived agents don't change, so each agent's figures are kept by `${cutexSessionId}@${revision}` (a restore and a
// new archive move the revision) per host, in memory and localStorage: opening the page again reads nothing unless an
// agent is new here; 重新统计 reads again on purpose.
import { create } from "zustand";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { DaemonApi } from "../../../../shared/ipc";

export interface ArchivedFigures {
  /** Bytes of the agent's local copy; null = cutex lists none (no copy, or not measured yet). */
  bytes: number | null;
  files: number | null;
  /** Ledger tokens (input + output, all-time within the ledger); null = no usage ledger on the host. */
  tokens: number | null;
  turns: number | null;
}
export interface ArchivedStatsSupport { size: boolean; usage: boolean }

/** cutex usage ledger capability (GET /v2/usage). */
export const USAGE_LEDGER_FEATURE = "usage-ledger";
export const SIZE_STORE = "light-homes";
const STORAGE_KEY = "cutex-desktop.archivedStats.v1";
/** Pages of light-homes read at most (200 items each). */
const MAX_PAGES = 40;
const PAGE = 200;
/** cutex usage MAX_RANGE_DAYS; at most this many windows back. */
const WINDOW_DAYS = 366;
const MAX_WINDOWS = 4;
/** Archived agents read at once by a batch (restore / delete). */
export const figuresKey = (session: Pick<SessionResource, "cutexSessionId" | "revision">) => `${session.cutexSessionId}@${session.revision}`;

interface StatsState {
  /** host → key → figures */
  figures: Record<string, Record<string, ArchivedFigures>>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  /** When each host's figures were last read (ms). */
  readAt: Record<string, number>;
}

function loadSavedRaw(): Pick<StatsState, "figures" | "readAt"> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { figures?: StatsState["figures"]; readAt?: StatsState["readAt"] } | null;
    return { figures: raw?.figures ?? {}, readAt: raw?.readAt ?? {} };
  } catch {
    return { figures: {}, readAt: {} };
  }
}

/** Saved figures, shape-checked (a damaged entry is dropped, not trusted). */
function loadSaved(): Pick<StatsState, "figures" | "readAt"> {
  const raw = loadSavedRaw();
  const figures: StatsState["figures"] = {};
  for (const [host, entries] of Object.entries(raw.figures ?? {})) {
    if (!entries || typeof entries !== "object") continue;
    const ok: Record<string, ArchivedFigures> = {};
    for (const [key, f] of Object.entries(entries)) if (f && typeof f === "object" && "bytes" in f && "tokens" in f) ok[key] = f as ArchivedFigures;
    figures[host] = ok;
  }
  return { figures, readAt: typeof raw.readAt === "object" && raw.readAt ? raw.readAt : {} };
}

export const useArchivedStats = create<StatsState>(() => ({ ...loadSaved(), loading: {}, errors: {} }));

function save(): void {
  const { figures, readAt } = useArchivedStats.getState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ figures, readAt }));
  } catch {
    /* quota: the in-memory copy still serves this run */
  }
}

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Bytes / files per agent from cutex's light-homes items (an agent may own two: its copy and its native home). */
export async function readSizes(api: Pick<DaemonApi, "storageItems">, ids: ReadonlySet<string>, signal?: AbortSignal): Promise<Map<string, { bytes: number; files: number }>> {
  const out = new Map<string, { bytes: number; files: number }>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (aborted(signal)) throw new Error(ABORT);
    const result = await api.storageItems(SIZE_STORE, { sort: "bytes", limit: PAGE, ...(cursor ? { cursor } : {}) });
    for (const item of result.items) {
      const id = item.cutexSessionId;
      if (!id || !ids.has(id)) continue;
      const prev = out.get(id) ?? { bytes: 0, files: 0 };
      out.set(id, { bytes: prev.bytes + (item.bytes ?? 0), files: prev.files + (item.files ?? 0) });
    }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

/** Ledger tokens / turns per agent, from the oldest agent's creation (or archive) to today, in cutex's window size. */
export async function readUsage(api: Pick<DaemonApi, "usage">, sessions: readonly SessionResource[], now = Date.now(), signal?: AbortSignal): Promise<Map<string, { tokens: number; turns: number }>> {
  const out = new Map<string, { tokens: number; turns: number }>();
  const starts = sessions.map((s) => Date.parse((s as { createdAt?: string }).createdAt ?? s.retiredAt ?? "")).filter((ms) => Number.isFinite(ms));
  const oldest = starts.length ? Math.min(...starts) : now - WINDOW_DAYS * 86_400_000;
  const ids = new Set(sessions.map((s) => s.cutexSessionId));
  let to = now;
  for (let w = 0; w < MAX_WINDOWS && to >= oldest; w++) {
    const from = Math.max(oldest, to - (WINDOW_DAYS - 1) * 86_400_000);
    if (aborted(signal)) throw new Error(ABORT);
    const report = await api.usage({ from: day(from), to: day(to), groupBy: ["agent"] });
    if (!report) break;
    for (const row of report.rows) {
      const id = row.key.agent;
      if (!id || !ids.has(id)) continue;
      const prev = out.get(id) ?? { tokens: 0, turns: 0 };
      out.set(id, { tokens: prev.tokens + (row.total ?? 0), turns: prev.turns + (row.turns ?? 0) });
    }
    to = from - 86_400_000;
  }
  return out;
}

/** Kept figures: at most this many agents per host and in all (about 80 bytes each in localStorage). */
const MAX_PER_HOST = 3000;
const MAX_TOTAL = 6000;

/** `host` cut to `live` keys (in `live` order, capped); other hosts dropped oldest-read first past the total cap. */
function bounded(state: Pick<StatsState, "figures" | "readAt">, hostId: string, host: Record<string, ArchivedFigures>, live: readonly string[]): StatsState["figures"] {
  const mine: Record<string, ArchivedFigures> = {};
  let n = 0;
  for (const key of live) {
    if (n >= MAX_PER_HOST) break;
    if (key in host) { mine[key] = host[key]!; n++; }
  }
  const figures: StatsState["figures"] = { ...state.figures, [hostId]: mine };
  let total = Object.values(figures).reduce((sum, f) => sum + Object.keys(f).length, 0);
  const others = Object.keys(figures).filter((h) => h !== hostId).sort((a, b) => (state.readAt[a] ?? 0) - (state.readAt[b] ?? 0));
  for (const other of others) {
    if (total <= MAX_TOTAL) break;
    total -= Object.keys(figures[other]!).length;
    delete figures[other];
  }
  return figures;
}

/** Drop kept figures of agents no longer archived on `hostId` (restored, deleted, archived again under a new revision). */
export function pruneArchivedStats(hostId: string, sessions: readonly SessionResource[]): void {
  const host = useArchivedStats.getState().figures[hostId];
  if (!host) return;
  const live = sessions.map(figuresKey);
  const liveSet = new Set(live);
  const keys = Object.keys(host);
  if (keys.length <= MAX_PER_HOST && keys.every((key) => liveSet.has(key))) return;
  useArchivedStats.setState((s) => ({ figures: bounded(s, hostId, s.figures[hostId] ?? {}, live) }));
  save();
}

const aborted = (signal?: AbortSignal) => !!signal?.aborted;
const ABORT = "archived-stats-aborted";
/** Agents read per worker step (each step reads cutex's items / ledger once for them). */
const CHUNK = 500;

/**
 * One worker per host (review 3b35d8136: a design correct by construction instead of queued calls):
 * - `desired`: the archived agents the newest call reported (the newest call wins; nothing else ever sets it);
 * - `subscribers`: the pages waiting; each leaves when its signal aborts (or when the worker settles it);
 * - `stale`: agents 重新统计 asked to read again.
 * The worker loops while a page waits and figures of `desired` are missing (or stale): one chunk per step, re-reading
 * `desired` each step, committing only agents still desired and pruning the rest. It stops when nothing is missing or
 * no page waits (then its own controller aborts the read between requests). Every waiting page is settled when it stops.
 */
interface Subscriber { signal?: AbortSignal; resolve(): void }
interface Worker {
  desired: readonly SessionResource[];
  api: Pick<DaemonApi, "storageItems" | "usage">;
  support: ArchivedStatsSupport;
  subscribers: Set<Subscriber>;
  stale: Set<string>;
  running: boolean;
  controller: AbortController | null;
}
const workers = new Map<string, Worker>();

export interface LoadOptions {
  /** Read every desired agent again (重新统计). */
  force?: boolean;
  /** This page left or switched host: it stops waiting; the worker stops once no page waits. */
  signal?: AbortSignal;
}

function missing(hostId: string, w: Worker): SessionResource[] {
  if (!w.support.size && !w.support.usage) return [];
  const kept = useArchivedStats.getState().figures[hostId] ?? {};
  // Only what the cache can keep (MAX_PER_HOST, in list order): the rest would be read and dropped again forever.
  return w.desired.slice(0, MAX_PER_HOST).filter((s) => w.stale.has(figuresKey(s)) || !(figuresKey(s) in kept));
}

/**
 * Figures for `sessions` (the host's archived agents now) on `hostId`: resolves when they are all kept (or the worker
 * could not read them), or when this caller's `signal` aborts. Pruning to `sessions` happens at once.
 */
export function loadArchivedStats(hostId: string, api: Pick<DaemonApi, "storageItems" | "usage">, sessions: readonly SessionResource[], support: ArchivedStatsSupport, options: LoadOptions = {}): Promise<void> {
  if (aborted(options.signal)) return Promise.resolve();
  let w = workers.get(hostId);
  if (!w) {
    w = { desired: sessions, api, support, subscribers: new Set(), stale: new Set(), running: false, controller: null };
    workers.set(hostId, w);
  }
  const worker = w;
  worker.desired = sessions;
  worker.api = api;
  worker.support = support;
  if (options.force) for (const s of sessions) worker.stale.add(figuresKey(s));
  pruneArchivedStats(hostId, sessions);
  return new Promise<void>((resolve) => {
    const sub: Subscriber = { signal: options.signal, resolve };
    worker.subscribers.add(sub);
    options.signal?.addEventListener("abort", () => {
      if (!worker.subscribers.delete(sub)) return;
      resolve();
      if (worker.subscribers.size === 0) worker.controller?.abort();
    }, { once: true });
    if (!worker.running) void run(hostId, worker);
  });
}

async function run(hostId: string, w: Worker): Promise<void> {
  w.running = true;
  useArchivedStats.setState((s) => ({ loading: { ...s.loading, [hostId]: true }, errors: { ...s.errors, [hostId]: null } }));
  try {
    for (let todo = missing(hostId, w); w.subscribers.size > 0 && todo.length > 0; todo = missing(hostId, w)) {
      const chunk = todo.slice(0, CHUNK);
      const controller = new AbortController();
      w.controller = controller;
      // Read again only on purpose: a refresh asked during this step marks them again; a stopped step gives the marks back.
      const wasStale = chunk.map(figuresKey).filter((key) => w.stale.has(key));
      for (const s of chunk) w.stale.delete(figuresKey(s));
      const stopped = () => { for (const key of wasStale) w.stale.add(key); };
      // Every exit from this step (a read failed, the step is done, every page left) stops both reads: the one still
      // running sees the abort before its next request and is abandoned, not awaited (review 3b2ddd136).
      try {
        const { api, support } = w;
        let sizes: Map<string, { bytes: number; files: number }> | null, usage: Map<string, { tokens: number; turns: number }> | null;
        try {
          const ids = new Set(chunk.map((s) => s.cutexSessionId));
          [sizes, usage] = await Promise.all([support.size ? readSizes(api, ids, controller.signal) : null, support.usage ? readUsage(api, chunk, Date.now(), controller.signal) : null]);
        } catch (e) {
          // Every page left (a page that joins since starts the next step with a new controller; else the loop ends).
          if (controller.signal.aborted || (e instanceof Error && e.message === ABORT)) { stopped(); continue; }
          useArchivedStats.setState((s) => ({ errors: { ...s.errors, [hostId]: e instanceof Error ? e.message : String(e) } }));
          break;
        }
        if (controller.signal.aborted) { stopped(); continue; }
        // Commit against what is desired now: agents dropped meanwhile are not written back, the rest is pruned.
        const live = w.desired.map(figuresKey);
        const liveSet = new Set(live);
        useArchivedStats.setState((s) => {
          const next: Record<string, ArchivedFigures> = { ...(s.figures[hostId] ?? {}) };
          for (const session of chunk) {
            const key = figuresKey(session);
            if (!liveSet.has(key)) continue;
            const size = sizes?.get(session.cutexSessionId);
            const use = usage?.get(session.cutexSessionId);
            next[key] = { bytes: sizes ? (size?.bytes ?? null) : null, files: sizes ? (size?.files ?? null) : null, tokens: usage ? (use?.tokens ?? 0) : null, turns: usage ? (use?.turns ?? 0) : null };
          }
          return { figures: bounded(s, hostId, next, live), readAt: { ...s.readAt, [hostId]: Date.now() } };
        });
        save();
      } finally {
        controller.abort();
      }
    }
  } finally {
    w.controller?.abort();
    w.running = false;
    w.controller = null;
    useArchivedStats.setState((s) => ({ loading: { ...s.loading, [hostId]: false } }));
    // Settle every page still waiting: covered, or the read failed (the error shows), or nothing can be read here.
    for (const sub of [...w.subscribers]) {
      w.subscribers.delete(sub);
      sub.resolve();
    }
  }
}

/** Tests. */
export function resetArchivedStats(): void {
  for (const w of workers.values()) { w.controller?.abort(); w.subscribers.clear(); }
  workers.clear();
  useArchivedStats.setState({ figures: {}, loading: {}, errors: {}, readAt: {} });
}

// The batch runner lives in lib/runBounded (shared with the 项目 table); re-exported for this module's callers.
export { BATCH_CONCURRENCY, runBounded } from "../../lib/runBounded";

export function formatSize(bytes: number, locale: string): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}
