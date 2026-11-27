// Sidebar session search (harness C3, cutex r295 session-search-v1; handoff .claude/reports/r295-session-search-sidebar.md):
// the 工作目录 filter (`sessions` mode: the session ids under a directory of one connection) and 查找旧任务 (`tasks`
// mode over the connected capable hosts). Memory only, per window.
// - One request in flight per host: the filter and the old-task search share one lane per host (hosts side by side);
//   a queued request is checked again just before it is sent and dropped when it is no longer wanted.
// - Only hosts the sidebar says are in scope, online and capable are asked (setSearchHosts).
// - A search belongs to its key (scope, connections, directory, text, 已归档; the sidebar's): a changed key drops it,
//   and replies of a dropped search are discarded. A rejected cursor restarts that host from the first page (once).
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { apiFor } from "../bridge";
import { hasV2Filter, isCursorRejected, type SearchV2Filters, type SessionSearchQuery, type SessionSearchResponse, type TaskSearchRow } from "../../../shared/sessionSearch";
import type { FocusTurnResult } from "../modules/slots";
import { jumpToTurn } from "./jump";
import { NO_FILTERS, type SearchFilterChoice } from "./sessionSearchView";

/** Pages one 查找旧任务 / 继续查找 reads per host by itself (a task page is one session). */
export const TASK_AUTO_PAGES = 8;
/** Stop reading more pages of a host early once this many new results came in. */
const TASK_ENOUGH = 12;
/** Pages of session ids the directory filter reads (30 each); beyond that the filter says it is incomplete. */
export const DIR_MAX_PAGES = 20;

type SearchApi = (hostId: string) => { sessionSearch(query: SessionSearchQuery): Promise<SessionSearchResponse> };
let searchApi: SearchApi = (hostId) => apiFor(hostId);
/** Tests: the daemon calls (null = the real per-host api). */
export function setSessionSearchApi(fn: SearchApi | null): void {
  searchApi = fn ?? ((hostId) => apiFor(hostId));
}

/** A host to search: its connection id and routing epoch (part of the default search key). */
export interface SearchTarget {
  hostId: string;
  epoch: string | null;
  /** cutex session-search-v2: asked with version=2, order=newest and the run's filters. */
  v2?: boolean;
}

export interface TaskHit extends TaskSearchRow {
  /** The desktop's connection id (the row's `hostId` is the host's own name). */
  connectionId: string;
  key: string;
}

export interface HostRun {
  cursor: string | null;
  /** No more pages (the last reply had no cursor). */
  done: boolean;
  pending: boolean;
  partial: boolean;
  error: string | null;
  restarted: boolean;
  /** Asked as session-search-v2 (order=newest, the run's filters). */
  v2: boolean;
}

export interface TaskRun {
  id: number;
  /** The searched text. */
  q: string;
  cwd: string | null;
  retired: boolean;
  /** One agent only (the search page's agent filter). */
  sessionId: string | null;
  /** session-search-v2 filters (time, project, kind, sender); sent to v2 hosts only. */
  filters: SearchV2Filters | null;
  /** Hosts of the search that cannot apply its v2 filters, so were not asked. */
  skipped: string[];
  key: string;
}

export interface DirFilter {
  hostId: string;
  path: string;
}

export interface DirResult {
  key: string;
  /** Session ids under the directory; null while the first read runs. */
  ids: ReadonlySet<string> | null;
  /** More pages than DIR_MAX_PAGES, or partial: the filter may miss some agents. */
  incomplete: boolean;
  error: string | null;
}

interface SessionSearchState {
  run: TaskRun | null;
  hosts: Record<string, HostRun>;
  hits: TaskHit[];
  dir: DirFilter | null;
  dirResult: DirResult | null;
  /** 已归档: the next 查找旧任务 searches the archived agents (owner connections). Part of the search key. */
  archived: boolean;
  /** The sidebar's session-search-v2 filters (发送方 / 类型 / 时间); applied by v2 hosts only. */
  choice: SearchFilterChoice;
}

export const useSessionSearch = create<SessionSearchState>(() => ({ run: null, hosts: {}, hits: [], dir: null, dirResult: null, archived: false, choice: NO_FILTERS }));

export const hitKey = (connectionId: string, sessionId: string, turnId: string) => JSON.stringify([connectionId, sessionId, turnId]);

/** What a search depends on besides its text: a change makes the shown results stale. */
export function searchKey(targets: readonly SearchTarget[], cwd: string | null, retired: boolean): string {
  return JSON.stringify([[...targets].sort((a, b) => a.hostId.localeCompare(b.hostId)).map((t) => [t.hostId, t.epoch]), cwd, retired]);
}

export function setSearchChoice(choice: SearchFilterChoice): void {
  useSessionSearch.setState({ choice });
}

export function setArchivedSearch(on: boolean): void {
  if (useSessionSearch.getState().archived !== on) useSessionSearch.setState({ archived: on });
}

// ---- which hosts may be asked; one lane per host ----

let allowed: ReadonlySet<string> | null = null;
/** The hosts in scope, online and capable of session search (the sidebar keeps this current; null = no restriction, tests). */
export function setSearchHosts(ids: readonly string[] | null): void {
  allowed = ids ? new Set(ids) : null;
}
const mayAsk = (hostId: string) => !allowed || allowed.has(hostId);

const STALE = Symbol("stale");
const lanes = new Map<string, Promise<void>>();
/**
 * Sends `send` on `hostId`'s lane after the requests queued before it have settled; `wanted` is checked right before
 * sending (a search dropped or a host gone meanwhile: nothing is sent, STALE). The lane is shared; whether the host may be
 * asked is the caller's (session search: setSearchHosts).
 */
function inLane<T>(hostId: string, wanted: () => boolean, send: () => Promise<T>): Promise<T | typeof STALE> {
  const before = lanes.get(hostId) ?? Promise.resolve();
  const result = before.then((): Promise<T | typeof STALE> | typeof STALE => (wanted() ? send() : STALE));
  const tail = result.then(() => {}, () => {});
  lanes.set(hostId, tail);
  void tail.then(() => {
    if (lanes.get(hostId) === tail) lanes.delete(hostId);
  });
  return result;
}

/**
 * Another sidebar lookup on the host's lane (lib/delegationIdSearch): sent after the requests queued before it, only while
 * `wanted` (which also says whether the host may still be asked for that feature); null when it was not sent.
 */
export async function inSearchLane<T>(hostId: string, wanted: () => boolean, send: () => Promise<T>): Promise<{ value: T } | null> {
  const r = await inLane(hostId, wanted, send);
  return r === STALE ? null : { value: r as T };
}

/** Tests: forget queued lanes (a test that stopped mid-request leaves none behind). */
export function resetSearchLanes(): void {
  lanes.clear();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ---- 查找旧任务 ----
// One search per instance: the sidebar's (useSessionSearch, the functions below) and each search page's own
// (createTaskSearch). They share the host lanes and setSearchHosts.

interface TaskState {
  run: TaskRun | null;
  hosts: Record<string, HostRun>;
  hits: TaskHit[];
}

interface TaskStore {
  get(): TaskState;
  set(patch: Partial<TaskState> | ((s: TaskState) => Partial<TaskState>)): void;
}

export interface TaskSearchInput {
  q: string;
  targets: readonly SearchTarget[];
  cwd?: string | null;
  retired?: boolean;
  /** One agent (cutex `sessionId`; only its host is asked). */
  sessionId?: string | null;
  /** session-search-v2 filters: a set one leaves out the hosts without v2 (TaskRun.skipped). */
  filters?: SearchV2Filters | null;
  key?: string;
}

export interface TaskSearchControl {
  start(input: TaskSearchInput): void;
  /** 继续查找: from each host's last cursor (also after an empty page with a cursor). */
  more(): void;
  clear(): void;
  /** The results are of another scope / filter / connection / text / 已归档: drop them (late replies too). */
  dropStale(key: string): void;
}

/** The run's v2 filters as query fields (a sender of all is the default and not sent). */
function v2Params(f: SearchV2Filters | null): Partial<SessionSearchQuery> {
  if (!f) return {};
  return { ...(f.since ? { since: f.since } : {}), ...(f.until ? { until: f.until } : {}), ...(f.projectId ? { projectId: f.projectId } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.sender && f.sender !== "all" ? { sender: f.sender } : {}) };
}

function taskSearchOn(store: TaskStore): TaskSearchControl {
  let gen = 0;
  /** The current search's result keys (no rebuild per page). */
  let seen = new Set<string>();
  const live = (id: number) => store.get().run?.id === id;
  const patchHost = (hostId: string, patch: Partial<HostRun>) => store.set((s) => (s.hosts[hostId] ? { hosts: { ...s.hosts, [hostId]: { ...s.hosts[hostId]!, ...patch } } } : {}));

  async function pump(id: number, hostId: string, budget: number): Promise<void> {
    let found = 0;
    while (budget > 0 && found < TASK_ENOUGH && live(id)) {
      const { run, hosts } = store.get();
      const host = hosts[hostId];
      if (!run || !host || host.done || host.error) return;
      patchHost(hostId, { pending: true });
      let page: SessionSearchResponse | typeof STALE;
      try {
        page = await inLane(hostId, () => live(id) && mayAsk(hostId), () =>
          searchApi(hostId).sessionSearch({ mode: "tasks", q: run.q, ...(run.cwd ? { cwd: run.cwd } : {}), ...(run.retired ? { lifecycle: "retired" } : {}), ...(run.sessionId ? { sessionId: run.sessionId } : {}), ...(host.v2 ? { version: 2 as const, order: "newest" as const, ...v2Params(run.filters) } : {}), ...(host.cursor ? { cursor: host.cursor } : {}) }),
        );
      } catch (e) {
        if (!live(id)) return;
        if (host.cursor && !host.restarted && isCursorRejected(e)) {
          patchHost(hostId, { cursor: null, restarted: true, pending: false });
          continue;
        }
        patchHost(hostId, { pending: false, error: errorText(e) });
        return;
      }
      if (!live(id)) return;
      if (page === STALE) {
        // The host left the scope / went offline while this page waited: stop here (继续查找 stays possible).
        patchHost(hostId, { pending: false });
        return;
      }
      if (page.mode !== "tasks") return;
      const reply = page;
      budget -= 1;
      const fresh: TaskHit[] = [];
      for (const row of reply.items) {
        const key = hitKey(hostId, row.cutexSessionId, row.turnId);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push({ ...row, connectionId: hostId, key });
      }
      found += fresh.length;
      store.set((s) => {
        const prev = s.hosts[hostId]!;
        return { hits: fresh.length ? [...s.hits, ...fresh] : s.hits, hosts: { ...s.hosts, [hostId]: { ...prev, cursor: reply.nextCursor, done: reply.nextCursor === null, partial: prev.partial || reply.partial, pending: false } } };
      });
      if (reply.nextCursor === null) return;
    }
    if (live(id)) patchHost(hostId, { pending: false });
  }

  const clear = () => {
    gen += 1;
    seen = new Set();
    store.set({ run: null, hits: [], hosts: {} });
  };

  return {
    start(input) {
      const q = input.q.trim();
      const asked = input.targets.filter((t) => mayAsk(t.hostId));
      const filters = input.filters ?? null;
      // A v2 filter (time, project, kind, sender) only means something on hosts that apply it; the others are named.
      const strict = hasV2Filter(filters);
      const targets = strict ? asked.filter((t) => t.v2) : asked;
      const skipped = strict ? asked.filter((t) => !t.v2).map((t) => t.hostId) : [];
      if (!q || (targets.length === 0 && skipped.length === 0)) return;
      const id = ++gen;
      seen = new Set();
      const cwd = input.cwd ?? null;
      const retired = input.retired ?? false;
      const sessionId = input.sessionId ?? null;
      const fresh = (v2: boolean): HostRun => ({ cursor: null, done: false, pending: false, partial: false, error: null, restarted: false, v2 });
      store.set({ run: { id, q, cwd, retired, sessionId, filters, skipped, key: input.key ?? searchKey(targets, cwd, retired) }, hits: [], hosts: Object.fromEntries(targets.map((t) => [t.hostId, fresh(!!t.v2)])) });
      for (const t of targets) void pump(id, t.hostId, TASK_AUTO_PAGES);
    },
    more() {
      const { run, hosts } = store.get();
      if (!run) return;
      for (const [hostId, h] of Object.entries(hosts)) if (!h.done && !h.pending && !h.error && mayAsk(hostId)) void pump(run.id, hostId, TASK_AUTO_PAGES);
    },
    clear,
    dropStale(key) {
      const run = store.get().run;
      if (run && run.key !== key) clear();
    },
  };
}

const sidebarTasks = taskSearchOn({ get: () => useSessionSearch.getState(), set: (patch) => useSessionSearch.setState(patch) });

/** 查找旧任务: `q` on each target that may be asked (or only the directory filter's host, with its path). */
export const startTaskSearch = (input: TaskSearchInput): void => sidebarTasks.start(input);
/** 继续查找: from each host's last cursor (also after an empty page with a cursor). */
export const continueTaskSearch = (): void => sidebarTasks.more();
export const clearTaskSearch = (): void => sidebarTasks.clear();
/** The results are of another scope / filter / connection / text / 已归档: drop them (late replies too). */
export const dropStaleTaskSearch = (key: string): void => sidebarTasks.dropStale(key);

/** A search of its own (the search page): its state hook and controls; the sidebar's search is not touched. */
export function createTaskSearch(): TaskSearchControl & { useStore: UseBoundStore<StoreApi<TaskState>> } {
  const useStore = create<TaskState>(() => ({ run: null, hosts: {}, hits: [] }));
  return { useStore, ...taskSearchOn({ get: () => useStore.getState(), set: (patch) => useStore.setState(patch) }) };
}

export interface TaskSearchStatus {
  pending: boolean;
  /** A host has a cursor left (继续查找). */
  more: boolean;
  /** Every host has no cursor left (or failed). */
  complete: boolean;
  partial: boolean;
  /** Hosts whose search failed. */
  failed: string[];
}

export function taskSearchStatus(hosts: Record<string, HostRun>): TaskSearchStatus {
  const list = Object.values(hosts);
  return {
    pending: list.some((h) => h.pending),
    more: list.some((h) => !h.done && !h.pending && !h.error),
    complete: list.every((h) => h.done || !!h.error),
    partial: list.some((h) => h.partial),
    failed: Object.entries(hosts).filter(([, h]) => h.error).map(([id]) => id),
  };
}

// ---- 工作目录 filter (`sessions` mode) ----

let dirGen = 0;
/** The read in progress (its generation), 0 = none. */
let dirReading = 0;
export const dirKey = (filter: DirFilter, epoch: string | null) => JSON.stringify([filter.hostId, epoch, filter.path]);

/** Sets (or clears, null) the directory filter and reads its session ids. A host that may not be asked is refused. */
export async function setDirFilter(filter: DirFilter | null, epoch: string | null = null): Promise<void> {
  const path = filter?.path.trim() ?? "";
  if (filter && path && !mayAsk(filter.hostId)) return;
  const id = ++dirGen;
  if (!filter || !path) {
    useSessionSearch.setState({ dir: null, dirResult: null });
    return;
  }
  const dir = { hostId: filter.hostId, path };
  const key = dirKey(dir, epoch);
  useSessionSearch.setState({ dir, dirResult: { key, ids: null, incomplete: false, error: null } });
  dirReading = id;
  try {
    await readDir(id, dir, key);
  } finally {
    if (dirReading === id) dirReading = 0;
  }
}

async function readDir(id: number, dir: DirFilter, key: string): Promise<void> {
  const path = dir.path;
  const ids = new Set<string>();
  let cursor: string | null = null;
  let partial = false;
  let restarted = false;
  for (let pages = 0; pages < DIR_MAX_PAGES; ) {
    let page: SessionSearchResponse | typeof STALE;
    const from: string | null = cursor;
    try {
      page = await inLane(dir.hostId, () => id === dirGen && mayAsk(dir.hostId), () => searchApi(dir.hostId).sessionSearch({ mode: "sessions", cwd: path, ...(from ? { cursor: from } : {}) }));
    } catch (e) {
      if (id !== dirGen) return;
      if (cursor && !restarted && isCursorRejected(e)) {
        restarted = true;
        cursor = null;
        ids.clear();
        pages = 0;
        continue;
      }
      useSessionSearch.setState({ dirResult: { key, ids: null, incomplete: false, error: errorText(e) } });
      return;
    }
    // A newer filter, or the host left: this read stops (the host's return reads again, refreshDirFilter).
    if (id !== dirGen || page === STALE) return;
    pages += 1;
    for (const row of page.items) ids.add(row.cutexSessionId);
    partial ||= page.partial;
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  useSessionSearch.setState({ dirResult: { key, ids, incomplete: partial || cursor !== null, error: null } });
}

/** Read the filter again when its connection changed (a new epoch, or back after leaving mid-read): ids of another connection are not trusted. */
export function refreshDirFilter(epoch: string | null): void {
  const { dir, dirResult } = useSessionSearch.getState();
  if (dir && mayAsk(dir.hostId) && (!dirResult || dirResult.key !== dirKey(dir, epoch) || (dirResult.ids === null && !dirResult.error && dirReading === 0))) void setDirFilter(dir, epoch);
}

// ---- opening a result ----

/**
 * A task result: the turn through lib/jump, which opens another host's agent of the scope itself and notes the reading
 * position before that switch (so 「回到」 leads back across hosts; a missing turn shows its chip).
 */
/**
 * Opens the hit's agent at that turn. `beside` (Ctrl/⌘ + click, middle click; owner 2026-11-27): the agent goes beside the
 * focused one first, as a sidebar row's Ctrl/⌘ + click does (lib/workspaceEffects agentEffect), then the jump lands there.
 */
export async function openTaskHit(hit: Pick<TaskHit, "connectionId" | "cutexSessionId" | "turnId">, opts: { beside?: boolean } = {}): Promise<FocusTurnResult> {
  if (opts.beside) {
    // Loaded when used: workspaceEffects reaches the pane and window stores this module does not need otherwise.
    const { agentEffect } = await import("./workspaceEffects");
    agentEffect({ hostId: hit.connectionId, key: hit.cutexSessionId }, "beside").run();
  }
  return jumpToTurn(hit.connectionId, hit.cutexSessionId, hit.turnId);
}
