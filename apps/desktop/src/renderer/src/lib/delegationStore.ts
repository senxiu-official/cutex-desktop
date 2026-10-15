// Delegation (委托) state for the delegation cards and overviews, kept in its own zustand store
// instead of the app store. Refresh-based: on connect and after any `cutex/ask/*` host event
// (debounced) it reloads the open delegations (`GET /v2/asks?state=open`); events are applied
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
import { api, apiFor, bridge } from "../bridge";
import { translate } from "../i18n";
import { applyAskEvent, ASKS_FEATURE, DELEGATION_VIEWS_FEATURE, mergeSummaries, summaryFromRecord, type DelegationRecords, type ProgressNote } from "./delegations";
import { focusHostId, hostKey, parseHostKey, type HostKey } from "./hostKeys";

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
    for (const timer of refreshTimers.values()) clearTimeout(timer);
    refreshTimers.clear();
    set({ ...EMPTY });
  },
}));

interface AppView {
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
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** `${hostId}\n${sessionId}` of agents whose delegations were loaded. */
const sessionsLoaded = new Set<string>();
const detailInFlight = new Set<string>();
const REFRESH_DEBOUNCE_MS = 300;

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
  useDelegations.setState((s) => ({ byKey: mergeHostRows(s.byKey, hostId, rows), ...extra }));
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
  const timer = refreshTimers.get(hostId);
  if (timer) clearTimeout(timer);
  refreshTimers.set(
    hostId,
    setTimeout(() => {
      refreshTimers.delete(hostId);
      void refreshOpenDelegations(hostId);
    }, REFRESH_DEBOUNCE_MS),
  );
}

/** Reload a host's open delegations. Ones that dropped out of the list (closed meanwhile) are re-read. */
export async function refreshOpenDelegations(hostId: string = focus()): Promise<void> {
  if (!supported(hostId)) return;
  let rows: AskSummary[] | null;
  try {
    rows = await daemonOf(hostId).asks({ state: "open" });
  } catch {
    return; // transient; the next event retries
  }
  if (!rows || !followed(hostId)) return;
  const open = new Set(rows.map((r) => r.askId));
  const vanished = Object.values(hostDelegations(useDelegations.getState().byKey, hostId)).filter(
    (d) => !d.closed && !open.has(d.askId) && d.execution !== "failed" && d.execution !== "rejected" && d.execution !== "cancelled",
  );
  mergeRows(hostId, rows, hostId === focus() ? { loadedAt: Date.now() } : { hostLoadedAt: { ...useDelegations.getState().hostLoadedAt, [hostId]: Date.now() } });
  for (const d of vanished.slice(0, 20)) void reloadOne(hostId, d.askId);
}

/** Re-read one delegation (it left the open list). */
async function reloadOne(hostId: string, askId: string) {
  try {
    const detail = await daemonOf(hostId).ask(askId);
    const row = detail ? summaryFromRecord(detail) : null;
    if (row && followed(hostId)) mergeRows(hostId, [row], { details: { ...useDelegations.getState().details, [hostKey(hostId, askId)]: detail } });
  } catch {
    // keep what we have
  }
}

/** An agent's delegations, both directions, once per agent (cards in its timeline, capsule); `hostId`: its host. */
export async function loadSessionDelegations(sessionId: string, force = false, hostId: string = focus()): Promise<void> {
  const key = `${hostId}\n${sessionId}`;
  if (!supported(hostId) || (!force && sessionsLoaded.has(key))) return;
  sessionsLoaded.add(key);
  try {
    const daemon = daemonOf(hostId);
    const lists = hasDelegationViews(featuresOf(hostId)!)
      ? [await daemon.asks({ involving: sessionId })]
      : await Promise.all([daemon.asks({ requester: sessionId }), daemon.asks({ target: sessionId })]);
    const rows = lists.flatMap((l) => l ?? []);
    if (rows.length && followed(hostId)) mergeRows(hostId, rows);
  } catch {
    sessionsLoaded.delete(key);
  }
}

/** The overview's 已结束 bucket (on first open; the focus host's). */
export async function loadClosedDelegations(): Promise<void> {
  const s = useDelegations.getState();
  const hostId = focus();
  if (!supported(hostId) || s.closedLoading || s.closedIds) return;
  useDelegations.setState({ closedLoading: true });
  try {
    const rows = (await api.asks({ state: "closed", limit: 200 })) ?? [];
    if (hostId === focus()) mergeRows(hostId, rows, { closedIds: rows.map((r) => r.askId), closedLoading: false });
  } catch {
    useDelegations.setState({ closedLoading: false });
  }
}

/** The full record (brief artifact, attempts' turn ids without delegation-views), from `hostId`. Fetched once; a 404 is remembered. */
export async function loadDelegationDetail(hostId: string, askId: string): Promise<AskDetail | null> {
  const key = hostKey(hostId, askId);
  const known = useDelegations.getState().details;
  if (key in known) return known[key] ?? null;
  if (detailInFlight.has(key)) return null;
  detailInFlight.add(key);
  try {
    const detail = await daemonOf(hostId).ask(askId);
    if (followed(hostId)) useDelegations.setState((s) => ({ details: { ...s.details, [key]: detail } }));
    return detail;
  } catch {
    return null;
  } finally {
    detailInFlight.delete(key);
  }
}

/**
 * Owner command on a delegation, sent on the target agent's session (also for owner-made ones) on
 * `hostId` (the host whose record the owner acts on). A refusal comes back as the result; a refresh
 * follows either way.
 */
export async function delegationCommand(hostId: string, d: Pick<AskSummary, "askId" | "target">, method: AskCommandMethod, outcome?: "accepted" | "abandoned"): Promise<MutationResult> {
  try {
    return await daemonOf(hostId).askCommand(d.target, method, outcome ? { askId: d.askId, outcome } : { askId: d.askId });
  } finally {
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
  for (const key of [...sessionsLoaded]) if (key.startsWith(`${hostId}\n`)) sessionsLoaded.delete(key);
  const timer = refreshTimers.get(hostId);
  if (timer) clearTimeout(timer);
  refreshTimers.delete(hostId);
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
export function startDelegationSync(handle: AppHandle): void {
  if (app) return;
  app = handle;
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    // The focus host's delegations, and the open agent's host's (cutex keeps them per daemon).
    if (!followed(hostId)) return;
    const method = envelope.cutex?.method;
    if (!method?.startsWith("cutex/ask/") || !supported(hostId)) return;
    if (method === "cutex/ask/deliveryFailed") app?.getState().notify(deliveryFailedText(envelope.cutex?.params), "error");
    // The event's host's records only (the other side of a peers delegation has its own).
    const patch = applyHostAskEvent(useDelegations.getState(), hostId, method, envelope.cutex?.params);
    if (patch) useDelegations.setState(patch);
    scheduleRefresh(hostId);
  });
  handle.subscribe((state, prev) => {
    const before = viewHost(prev);
    const now = viewHost(state);
    if (before && before !== now && !watched.has(before)) dropHost(before);
    if (now && now !== before) void refreshOpenDelegations(now);
    if (state.features !== prev.features && state.features.has(ASKS_FEATURE)) {
      void refreshOpenDelegations();
      if (state.selectedId && !now) void loadSessionDelegations(state.selectedId);
    }
    if (state.selectedId && (state.selectedId !== prev.selectedId || state.selectedHost !== prev.selectedHost)) void loadSessionDelegations(state.selectedId, false, now ?? focus());
  });
  if (supported()) void refreshOpenDelegations();
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
