// Delegation (委托) state for the delegation cards and overviews, kept in its own zustand store
// instead of the app store. Refresh-based: on connect and after any `cutex/ask/*` host event
// (coalesced with a bounded interval) it reloads the open delegations (`GET /v2/asks?state=open`); events are applied
// optimistically first (lib/delegations applyAskEvent) and the refresh corrects them. Events are
// taken from the host feed only (it carries every session's stream: each event arrives twice, once
// per party, and applying is idempotent). Selecting an agent loads its delegations once (open and
// closed); closed ones for the overview load on demand.
//
// Hosts (multi-host P1): cutex keeps delegations per daemon. The store follows the focus host and,
// while the open agent lives on another host, that host too. Every record is keyed by
// `hostKey(hostId, askId)` (lib/hostKeys): a cross-host (peers) delegation has the same ask id on both
// hosts — the requester host's outgoing mirror and the handler host's record (`requester.kind: "peer"`)
// — and each host's view shows its own record (merging them is later P1 work). Readers name the host
// of their context (the open agent's, a list's, the focus host's): `useDelegation(hostId, askId)`,
// `useHostRecords(hostId)` / `hostDelegations` (one host's records by ask id, the shape the pure
// helpers of lib/delegations take), and details / answers / commands go to that host's daemon. The
// overview and the badge show the focus host's records (`useFocusDelegations`); a page of another
// host (project page under TargetHostContext) follows that host while it is shown
// (`useHostDelegations`). A host the store stops following drops its records; the app store resets
// everything when the focus host changes (resetForHostSwitch).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { AskCommandMethod, AskDetail, AskQuestion, AskSummary, DaemonApi, MutationResult } from "../../../shared/ipc";
import { hostEpoch, type HostsState } from "../../../shared/hosts";
import { api, apiFor, bridge } from "../bridge";
import { translate } from "../i18n";
import { applyAskEvent, ASKS_FEATURE, DELEGATION_VIEWS_FEATURE, mergeSummaries, summaryFromRecord, type DelegationRecords, type ProgressNote } from "./delegations";
import { delegationRefresh } from "./delegationRefresh";
import { focusHostId, hostKey, parseHostKey, type HostKey } from "./hostKeys";
import { onEveryAppWindow } from "./appWindowSet";

export interface DelegationsState {
  /** Delegations by `hostKey(hostId, askId)`: open ones, those of agents opened, closed ones loaded. */
  byKey: Record<HostKey, AskSummary>;
  /** Progress notes (`cutex/ask/progress`) seen live, by host key. */
  progress: Record<HostKey, ProgressNote[]>;
  /** Questions (`cutex/ask/question`) seen live, by host key. */
  questions: Record<HostKey, AskQuestion[]>;
  /** When the focus host's open delegations were last loaded (Date.now()); null until the first load. */
  loadedAt: number | null;
  /** The same for the other hosts followed (by host id). */
  hostLoadedAt: Record<string, number>;
  /** The focus host's closed ones (ask ids) for the overview's 已结束 bucket: null until requested. */
  closedIds: string[] | null;
  closedLoading: boolean;
  /** Full records fetched on demand (`GET /v2/asks/{id}`), by host key; null = cutex no longer has it (not asked again). */
  details: Record<HostKey, AskDetail | null>;
  /** Forget everything (host switch). */
  reset(): void;
}

const EMPTY = { byKey: {}, progress: {}, questions: {}, loadedAt: null, hostLoadedAt: {}, closedIds: null, closedLoading: false, details: {} };

export const useDelegations = create<DelegationsState>((set) => ({
  ...EMPTY,
  reset: () => {
    sessionsLoaded.clear();
    detailInFlight.clear();
    closedRequest = null;
    closedRequested = null;
    connectionReady.clear();
    for (const hostId of generations.keys()) invalidateHost(hostId);
    lastResync.clear();
    set({ ...EMPTY });
  },
}));

interface AppView {
  hosts?: HostsState | null;
  features: ReadonlySet<string>;
  selectedId: string | null;
  selectedHost: string | null;
  byHost: Record<string, { features: ReadonlySet<string> }>;
}

/** The bits of the app store this module reads (passed in by store.ts: no import cycle). */
export interface AppHandle {
  getState(): AppView & { notify(text: string, tone?: "info" | "error"): void };
  subscribe(listener: (state: AppView, prev: AppView) => void): () => void;
}

let app: AppHandle | null = null;
type HostGeneration = { epoch: string | null; changed: Promise<void>; invalidate(): void; refresh: ReturnType<typeof delegationRefresh> };
const generations = new Map<string, HostGeneration>();
const epochOf = (hostId: string) => hostEpoch(app?.getState().hosts ?? null, hostId);
function generation(hostId: string): HostGeneration {
  let current = generations.get(hostId);
  if (current && current.epoch !== epochOf(hostId)) {
    invalidateHost(hostId);
    current = undefined;
  }
  if (!current) {
    let invalidate!: () => void;
    const changed = new Promise<void>(resolve => { invalidate = resolve; });
    const created: HostGeneration = { epoch: epochOf(hostId), changed, invalidate, refresh: delegationRefresh(() => readOpenDelegations(hostId, created)) };
    generations.set(hostId, current = created);
  }
  return current;
}
const currentRead = (hostId: string, token: HostGeneration) => generations.get(hostId) === token && token.epoch === epochOf(hostId) && followed(hostId);
function invalidateHost(hostId: string) {
  generations.get(hostId)?.invalidate();
  generations.get(hostId)?.refresh.dispose();
  generations.delete(hostId);
  lastResync.delete(hostId);
  for (const key of sessionsLoaded) if (key.startsWith(`${hostId}\n`)) sessionsLoaded.delete(key);
}
/** `${hostId}\n${sessionId}` of agents whose delegations were loaded. */
const sessionsLoaded = new Set<string>();
const detailInFlight = new Map<HostKey, { promise: Promise<AskDetail | null> }>();
let closedRequested: string | null = null;
let closedRequest: { hostId: string; promise: Promise<void> } | null = null;
const connectionReady = new Map<string, boolean>();
const connectionKind = (hostId: string, hosts = app?.getState().hosts) => hosts?.hosts.find(h => h.id === hostId)?.conn?.daemon?.kind;
const ready = (hostId: string) => {
  const hosts = app?.getState().hosts;
  // hostsState can advertise a new, still-connecting epoch before daemonState resets the old
  // readiness flag. Only the current connection can admit the retry; mocks without hosts fall back.
  return supported(hostId) && connectionReady.get(hostId) !== false && (!hosts || connectionKind(hostId, hosts) === "connected");
};

/** Invalidation wakes consumers immediately; a superseded request's later rejection is handled. */
function readInGeneration<T>(token: HostGeneration, read: () => Promise<T>) {
  const result = (async () => {
    try { return { kind: "value" as const, value: await read() }; }
    catch { return { kind: "error" as const }; }
  })();
  return Promise.race([result, token.changed.then(() => ({ kind: "changed" as const }))]);
}

function freshDetails(details: DelegationsState["details"], byKey: DelegationsState["byKey"]) {
  let next = details;
  for (const [key, detail] of Object.entries(details)) {
    const row = byKey[key];
    if (row && (detail === null || row.revision > (detail?.revision ?? -Infinity))) {
      if (next === details) next = { ...details };
      delete next[key];
    }
  }
  return next;
}

const focus = () => focusHostId();
const daemonOf = (hostId: string): DaemonApi => (hostId === focus() ? api : apiFor(hostId));
function featuresOf(hostId: string): ReadonlySet<string> | undefined {
  const s = app?.getState();
  if (!s) return undefined;
  return hostId === focus() ? s.features : s.byHost[hostId]?.features;
}
const supported = (hostId: string = focus()) => !!featuresOf(hostId)?.has(ASKS_FEATURE);
/** The other host the store follows: the open agent's, when it is not the focus host. */
function viewHost(s: Pick<AppView, "selectedId" | "selectedHost"> | undefined = app?.getState()): string | null {
  return s?.selectedId && s.selectedHost && s.selectedHost !== focus() ? s.selectedHost : null;
}
/** Hosts followed for a page of that host (`useHostDelegations`), with their watcher counts. */
const watched = new Map<string, number>();
const followed = (hostId: string) => hostId === focus() || hostId === viewHost() || watched.has(hostId);
export const hasDelegationViews = (features: ReadonlySet<string>) => features.has(DELEGATION_VIEWS_FEATURE);

// ---------- host-keyed records (pure) ----------

/** The host of a host key (null for a malformed key). */
export function hostOfKey(key: string): string | null {
  return parseHostKey(key)?.[0] ?? null;
}

/** The entries of one host of a host-keyed map, by bare id. */
export function hostSlice<T>(byKey: Record<HostKey, T>, hostId: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(byKey)) {
    const parsed = parseHostKey(key);
    if (parsed && parsed[0] === hostId) out[parsed[1]] = value;
  }
  return out;
}

// One projection per (records object, host), shared by every reader (stable references for memos).
const projections = new WeakMap<Record<HostKey, AskSummary>, Map<string, Record<string, AskSummary>>>();

/** The records of one host, by ask id (the shape lib/delegations' helpers take). */
export function hostDelegations(byKey: Record<HostKey, AskSummary>, hostId: string): Record<string, AskSummary> {
  let perHost = projections.get(byKey);
  if (!perHost) projections.set(byKey, (perHost = new Map()));
  let out = perHost.get(hostId);
  if (!out) perHost.set(hostId, (out = hostSlice(byKey, hostId)));
  return out;
}

/** One host's record of a delegation. */
export function delegationOn(byKey: Record<HostKey, AskSummary>, hostId: string, askId: string): AskSummary | undefined {
  return byKey[hostKey(hostId, askId)];
}

type HostRecords = Pick<DelegationsState, "byKey" | "progress" | "questions">;

/** Merge a fresh list of `hostId` (newer revisions win; other hosts' records are untouched). */
export function mergeHostRows(byKey: Record<HostKey, AskSummary>, hostId: string, rows: readonly AskSummary[]): Record<HostKey, AskSummary> {
  if (!rows.length) return byKey;
  const before = hostDelegations(byKey, hostId);
  const after = mergeSummaries(before, rows);
  return after === before ? byKey : liftChanges(byKey, hostId, before, after);
}

/** Apply a `cutex/ask/*` event of `hostId` to that host's records only (lib/delegations applyAskEvent). */
export function applyHostAskEvent(records: HostRecords, hostId: string, method: string, params: unknown): Partial<HostRecords> | null {
  const slice: DelegationRecords = { byId: hostDelegations(records.byKey, hostId), progress: hostSlice(records.progress, hostId), questions: hostSlice(records.questions, hostId) };
  const patch = applyAskEvent(slice, method, params);
  if (!patch) return null;
  const out: Partial<HostRecords> = {};
  if (patch.byId) out.byKey = liftChanges(records.byKey, hostId, slice.byId, patch.byId);
  if (patch.progress) out.progress = liftChanges(records.progress, hostId, slice.progress, patch.progress);
  if (patch.questions) out.questions = liftChanges(records.questions, hostId, slice.questions, patch.questions);
  return out;
}

/** Write the entries of a host slice that changed (`before` → `after`, by bare id) back under host keys. */
function liftChanges<T>(byKey: Record<HostKey, T>, hostId: string, before: Record<string, T>, after: Record<string, T>): Record<HostKey, T> {
  let next: Record<HostKey, T> | null = null;
  for (const [id, value] of Object.entries(after)) if (before[id] !== value) (next ??= { ...byKey })[hostKey(hostId, id)] = value;
  return next ?? byKey;
}

/** Merge rows of `hostId` into the store. */
function mergeRows(hostId: string, rows: AskSummary[], extra: Partial<DelegationsState> = {}): void {
  useDelegations.setState((s) => {
    const byKey = mergeHostRows(s.byKey, hostId, rows);
    return { byKey, details: freshDetails(s.details, byKey), ...extra };
  });
}

/** Daemon calls of a host's delegations (answers, artifacts of its cards). */
export function delegationApi(hostId: string): DaemonApi {
  return daemonOf(hostId);
}

/**
 * Follow `hostId`'s delegations while a page of that host shows them (refcounted); the returned
 * function stops. The focus host and the open agent's host are followed anyway.
 */
export function watchDelegationHost(hostId: string): () => void {
  watched.set(hostId, (watched.get(hostId) ?? 0) + 1);
  if (hostId !== focus()) void refreshOpenDelegations(hostId);
  return () => {
    const n = (watched.get(hostId) ?? 1) - 1;
    if (n > 0) return void watched.set(hostId, n);
    watched.delete(hostId);
    if (!followed(hostId)) dropHost(hostId);
  };
}

/** One host's records, followed while the caller is mounted (the focus host: `useFocusDelegations`). */
export function useHostDelegations(hostId: string): Record<string, AskSummary> {
  const focusId = useFocusHostSubscription();
  useEffect(() => (hostId === focusId ? undefined : watchDelegationHost(hostId)), [hostId, focusId]);
  return useHostRecords(hostId);
}

/** One host's records (by ask id) without following it: for views of a host the store follows anyway (the open agent's). */
export function useHostRecords(hostId: string): Record<string, AskSummary> {
  const byKey = useDelegations((s) => s.byKey);
  return useMemo(() => hostDelegations(byKey, hostId), [byKey, hostId]);
}

/** One host's record of a delegation. */
export function useDelegation(hostId: string, askId: string | null | undefined): AskSummary | undefined {
  return useDelegations((s) => (askId ? s.byKey[hostKey(hostId, askId)] : undefined));
}

/** The focus host id, re-rendering when it changes (the app store is not imported here). */
function useFocusHostSubscription(): string {
  return useSyncExternalStore(
    (l) => app?.subscribe(() => l()) ?? (() => {}),
    () => focus(),
  );
}

/** The focus host's records (the 委托 overview and badge). */
export function useFocusDelegations(): Record<string, AskSummary> {
  return useHostRecords(useFocusHostSubscription());
}

function scheduleRefresh(hostId: string) {
  if (supported(hostId) && followed(hostId)) void generation(hostId).refresh.request();
}

/** All callers share a host's read and at most one pending refresh. */
export function refreshOpenDelegations(hostId: string = focus()): Promise<void> {
  if (!supported(hostId) || !followed(hostId)) return Promise.resolve();
  return generation(hostId).refresh.request(true);
}

async function readOpenDelegations(hostId: string, token: HostGeneration): Promise<void> {
  if (!currentRead(hostId, token)) return;
  try {
    const daemon = daemonOf(hostId);
    const rows = await daemon.asks({ state: "open", background: true });
    if (!rows || !currentRead(hostId, token)) return;
    const open = new Set(rows.map((r) => r.askId));
    const vanished = Object.values(hostDelegations(useDelegations.getState().byKey, hostId)).some(
      (d) => !d.closed && !open.has(d.askId),
    );
    mergeRows(hostId, rows, hostId === focus() ? { loadedAt: Date.now() } : { hostLoadedAt: { ...useDelegations.getState().hostLoadedAt, [hostId]: Date.now() } });
    if (!vanished) return;
    // The list contract has no cursor. Fetch once at its supported maximum; absence from a capped
    // list (or a missing route) is not evidence of closure or deletion. Keep unresolved results.
    // Backend follow-up: expose a stable cursor for GET /v2/asks (and carry it through AskFilter /
    // DaemonApi / cutex-client). Until then, closures outside this 1000-row window cannot be fully
    // reconciled by list reads; retain them rather than infer cancellation/deletion from absence.
    const closed = await daemon.asks({ state: "closed", limit: 1000, background: true });
    if (closed && currentRead(hostId, token)) mergeRows(hostId, closed);
  } catch {
    // Transient: retain known rows; a subsequent event or panel resync retries.
  }
}

/** When each host was last re-synced by resyncDelegations. */
const lastResync = new Map<string, number>();
export const RESYNC_MIN_MS = 15_000;

/**
 * Catch up with `hostId` (owner 2026-10-23: delegations the host closed still showed 待验收 for days): the
 * open list (vanished ones reconciled with the closed list) and, with `sessionId`, that agent's delegations. Events are the fast
 * path; this covers the ones a feed restart skipped. Called when the 委托 panel opens and when the window
 * comes back to the front; at most once per RESYNC_MIN_MS per host.
 */
export function resyncDelegations(hostId: string, sessionId?: string, now = Date.now()): boolean {
  if (!supported(hostId) || now - (lastResync.get(hostId) ?? -Infinity) < RESYNC_MIN_MS) return false;
  lastResync.set(hostId, now);
  void refreshOpenDelegations(hostId);
  if (sessionId) void loadSessionDelegations(sessionId, true, hostId);
  return true;
}

/** An agent's delegations, both directions, once per agent (cards in its timeline, capsule); `hostId`: its host. */
export async function loadSessionDelegations(sessionId: string, force = false, hostId: string = focus()): Promise<void> {
  const key = `${hostId}\n${sessionId}`;
  if (!supported(hostId)) return;
  const token = generation(hostId);
  if (!force && sessionsLoaded.has(key)) return;
  sessionsLoaded.add(key);
  try {
    const daemon = daemonOf(hostId);
    const lists = hasDelegationViews(featuresOf(hostId)!)
      ? [await daemon.asks({ involving: sessionId })]
      : await Promise.all([daemon.asks({ requester: sessionId }), daemon.asks({ target: sessionId })]);
    const rows = lists.flatMap((l) => l ?? []);
    if (rows.length && currentRead(hostId, token)) mergeRows(hostId, rows);
  } catch {
    if (currentRead(hostId, token)) sessionsLoaded.delete(key);
  }
}

/** The overview remembers demand because an expanded bucket does not re-run a React effect on reconnect. */
export function loadClosedDelegations(force = false): Promise<void> {
  const hostId = focus();
  closedRequested = hostId;
  if (closedRequest?.hostId === hostId) return closedRequest.promise;
  if (!supported(hostId) || (!force && useDelegations.getState().closedIds)) return Promise.resolve();
  const owner = app;
  const request = { hostId, promise: Promise.resolve() };
  closedRequest = request;
  const alive = () => app === owner && closedRequest === request && focus() === hostId;
  request.promise = (async () => {
    useDelegations.setState({ closedLoading: true });
    while (alive()) {
      const token = generation(hostId);
      if (!ready(hostId)) { await token.changed; continue; }
      const result = await readInGeneration(token, () => daemonOf(hostId).asks({ state: "closed", limit: 200 }));
      if (!alive()) return;
      if (!currentRead(hostId, token) || result.kind === "changed") continue;
      if (result.kind === "value" && result.value) {
        mergeRows(hostId, result.value, { closedIds: result.value.map(r => r.askId) });
      }
      return; // transient error / missing route retains rows and can retry on next demand or reconnect
    }
  })().finally(() => {
    if (closedRequest === request) {
      closedRequest = null;
      useDelegations.setState({ closedLoading: false });
    }
  });
  return request.promise;
}

/** Shared on-demand detail. Reconnect continues the caller's promise; only a current 404 is cached. */
export function loadDelegationDetail(hostId: string, askId: string): Promise<AskDetail | null> {
  generation(hostId); // retire a changed epoch before consulting inflight/cached data
  const key = hostKey(hostId, askId);
  const pending = detailInFlight.get(key);
  if (pending) return pending.promise;
  const s = useDelegations.getState();
  const known = s.details[key];
  const revision = s.byKey[key]?.revision;
  if (key in s.details && (known === null || revision === undefined || (known?.revision ?? -Infinity) >= revision)) return Promise.resolve(known ?? null);
  const owner = app;
  const request = { promise: Promise.resolve<AskDetail | null>(null) };
  detailInFlight.set(key, request);
  const alive = () => app === owner && detailInFlight.get(key) === request && followed(hostId);
  request.promise = (async () => {
    while (alive()) {
      const token = generation(hostId);
      if (!ready(hostId)) { await token.changed; continue; }
      const revisionAtStart = useDelegations.getState().byKey[key]?.revision;
      const result = await readInGeneration(token, () => daemonOf(hostId).ask(askId));
      if (!alive()) return null;
      if (!currentRead(hostId, token) || result.kind === "changed") continue;
      if (result.kind === "error") return null; // transient failures are not cached
      if ((useDelegations.getState().byKey[key]?.revision ?? -Infinity) > (revisionAtStart ?? -Infinity)) continue;
      // A newer record than the row (an event or the capped lists missed it) updates the row too, so
      // every view of it (the project card, the overview) agrees with the detail.
      useDelegations.setState(s => {
        const row = s.byKey[key];
        const next = row && result.value ? withDetailState(row, result.value) : row;
        return { details: { ...s.details, [key]: result.value }, ...(next !== row ? { byKey: { ...s.byKey, [key]: next! } } : {}) };
      });
      return result.value;
    }
    return null;
  })().finally(() => {
    if (detailInFlight.get(key) === request) detailInFlight.delete(key);
  });
  return request.promise;
}

/**
 * A row with the state of a newer full record (`GET /v2/asks/{id}`); the same row when the record is
 * not newer. Only what the daemon says changes: execution, hold, review, closed, attempt, answer.
 */
export function withDetailState(row: AskSummary, detail: AskDetail): AskSummary {
  const fresh = summaryFromRecord({ ...detail, answerId: typeof detail.answerId === "string" ? detail.answerId : (detail.answer?.answerId ?? null) });
  if (!fresh || fresh.askId !== row.askId || fresh.revision <= row.revision) return row;
  const { execution, hold, holdSince, review, closed, closedAt, revision, updatedAt, attempt, attempts } = fresh;
  return { ...row, execution, hold, holdSince, review, closed, closedAt, revision, updatedAt, attempt: attempt ?? row.attempt, attempts, answerId: fresh.answerId ?? row.answerId };
}

/**
 * Re-read one delegation (its full record) and take its state: after an owner command on it, so the
 * row follows even when the events were missed and it is outside the capped open / closed lists.
 */
export function refreshDelegation(hostId: string, askId: string): Promise<AskDetail | null> {
  const key = hostKey(hostId, askId);
  useDelegations.setState((s) => {
    if (!(key in s.details)) return s;
    const details = { ...s.details };
    delete details[key];
    return { details };
  });
  return loadDelegationDetail(hostId, askId);
}

/**
 * Owner command on a delegation, sent on the target agent's session (also for owner-made ones) on
 * `hostId` (the host whose record the owner acts on). A refusal comes back as the result; that
 * delegation is re-read and the open list refreshed either way (owner 2026-10-28: after 放弃 the
 * project card kept the row — the host's closed list is capped and the events had not arrived).
 */
export async function delegationCommand(hostId: string, d: Pick<AskSummary, "askId" | "target">, method: AskCommandMethod, outcome?: "accepted" | "abandoned"): Promise<MutationResult> {
  try {
    return await daemonOf(hostId).askCommand(d.target, method, outcome ? { askId: d.askId, outcome } : { askId: d.askId });
  } finally {
    if (supported(hostId) && followed(hostId)) void refreshDelegation(hostId, d.askId);
    scheduleRefresh(hostId);
  }
}

/**
 * `cutex/ask/deliveryFailed` (published once, on the host feed): cutex could not fit a delegation or
 * its results into a message the agent can take (input overflow). cutex also leaves the owner a
 * message (needs-you); this is the immediate notice.
 */
function deliveryFailedText(raw: unknown): string {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const asks = Array.isArray(p.askIds) ? p.askIds.filter((x): x is string => typeof x === "string") : [];
  const agent = typeof p.targetName === "string" && p.targetName ? p.targetName : typeof p.target === "string" ? p.target : "";
  const vars = { agent, asks: asks.join(", "), detail: typeof p.detail === "string" ? p.detail : "" };
  return translate(p.kind === "results" ? "delegation.resultsUndelivered" : "delegation.deliveryFailed", vars);
}

/** Drop the records of a host the store no longer follows. */
function dropHost(hostId: string): void {
  for (const key of detailInFlight.keys()) if (hostOfKey(key) === hostId) detailInFlight.delete(key);
  invalidateHost(hostId);
  useDelegations.setState((s) => {
    const hostLoadedAt = Object.fromEntries(Object.entries(s.hostLoadedAt).filter(([id]) => id !== hostId));
    return { ...withoutHost(s, hostId), hostLoadedAt };
  });
}

/** The records without `hostId`'s (pure). */
export function withoutHost(s: HostRecords & Pick<DelegationsState, "details">, hostId: string): HostRecords & Pick<DelegationsState, "details"> {
  const keep = <T>(r: Record<HostKey, T>): Record<HostKey, T> => {
    const entries = Object.entries(r);
    const kept = entries.filter(([key]) => hostOfKey(key) !== hostId);
    return kept.length === entries.length ? r : Object.fromEntries(kept);
  };
  return { byKey: keep(s.byKey), progress: keep(s.progress), questions: keep(s.questions), details: keep(s.details) };
}

/** Start following `cutex/ask/*` events and the app's connection / selection (store.ts init). */
export function startDelegationSync(handle: AppHandle): () => void {
  if (app) return () => {};
  app = handle;
  const stopEvents = bridge.on("hostEvent", ({ hostId, epoch, envelope }) => {
    const current = epochOf(hostId);
    if (current && current !== epoch) return;
    // The focus host's delegations, and the open agent's host's (cutex keeps them per daemon).
    if (!followed(hostId)) return;
    const method = envelope.cutex?.method;
    if (!method?.startsWith("cutex/ask/") || !supported(hostId)) return;
    if (method === "cutex/ask/deliveryFailed") app?.getState().notify(deliveryFailedText(envelope.cutex?.params), "error");
    // The event's host's records only (the other side of a peers delegation has its own).
    const patch = applyHostAskEvent(useDelegations.getState(), hostId, method, envelope.cutex?.params);
    if (patch) useDelegations.setState(s => ({ ...patch, ...(patch.byKey ? { details: freshDetails(s.details, patch.byKey) } : {}) }));
    scheduleRefresh(hostId);
  });
  // The host feed restarted from its live tail: the events in between are lost, re-read the open list.
  const stopResync = bridge.on("hostResync", ({ hostId, epoch }) => {
    const current = epochOf(hostId);
    if (current && current !== epoch) return;
    scheduleRefresh(hostId);
  });
  const stopDaemon = bridge.on("daemonState", ({ hostId, epoch, state }) => {
    const current = epochOf(hostId);
    if (current && current !== epoch) return;
    connectionReady.set(hostId, state.kind === "connected");
    invalidateHost(hostId);
    if (state.kind === "connected") {
      scheduleRefresh(hostId);
      if (closedRequested === hostId && hostId === focus()) void loadClosedDelegations(true);
      const s = handle.getState();
      if (s.selectedId && (s.selectedHost ?? focus()) === hostId) void loadSessionDelegations(s.selectedId, true, hostId);
    }
  });
  const stopApp = handle.subscribe((state, prev) => {
    if (state.features !== prev.features) invalidateHost(focus());
    for (const hostId of generations.keys()) {
      if (state.byHost[hostId]?.features !== prev.byHost[hostId]?.features) invalidateHost(hostId);
    }
    if (state.hosts !== prev.hosts) {
      for (const hostId of [...generations.keys()]) {
        if (hostEpoch(state.hosts, hostId) !== hostEpoch(prev.hosts, hostId)
          || connectionKind(hostId, state.hosts) !== connectionKind(hostId, prev.hosts)) {
          invalidateHost(hostId);
          if (closedRequested === hostId && hostId === focus()) void loadClosedDelegations(true);
        }
      }
    }
    const before = viewHost(prev);
    const now = viewHost(state);
    if (before && before !== now && !watched.has(before)) dropHost(before);
    if (now && now !== before) void refreshOpenDelegations(now);
    if (state.features !== prev.features && state.features.has(ASKS_FEATURE)) {
      void refreshOpenDelegations();
      if (closedRequested === focus()) void loadClosedDelegations(true);
      if (state.selectedId && !now) void loadSessionDelegations(state.selectedId);
    }
    if (state.selectedId && (state.selectedId !== prev.selectedId || state.selectedHost !== prev.selectedHost)) void loadSessionDelegations(state.selectedId, false, now ?? focus());
  });
  // Back in front: catch up with what a feed restart may have skipped (resyncDelegations).
  const onFocus = () => {
    const s = handle.getState();
    const host = viewHost(s) ?? focus();
    resyncDelegations(host, s.selectedId ?? undefined);
    if (host !== focus()) resyncDelegations(focus());
    // Hosts followed for a page of theirs (a project view of another host) catch up too.
    for (const hostId of watched.keys()) if (hostId !== host && hostId !== focus()) resyncDelegations(hostId);
  };
  // Any app window getting the focus (a desk window too, multi-window).
  const stopFocus = typeof window !== "undefined" ? onEveryAppWindow((win) => {
    win.addEventListener("focus", onFocus);
    return () => win.removeEventListener("focus", onFocus);
  }) : () => {};
  if (supported()) void refreshOpenDelegations();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stopEvents();
    stopResync();
    stopDaemon();
    stopApp();
    stopFocus();
    app = null;
    useDelegations.getState().reset();
  };
}

// ---------- selectors ----------

/** Open delegations involving an agent, split by direction (capsule, queue panel). */
export function delegationsOf(byId: Record<string, AskSummary>, sessionId: string): { mine: AskSummary[]; toMe: AskSummary[] } {
  const mine: AskSummary[] = [];
  const toMe: AskSummary[] = [];
  for (const d of Object.values(byId)) {
    if (d.target === sessionId) toMe.push(d);
    else if (d.requester.kind === "agent" && (d.requester.cutexSessionId ?? d.requester.cutex_session_id) === sessionId) mine.push(d);
  }
  return { mine, toMe };
}
