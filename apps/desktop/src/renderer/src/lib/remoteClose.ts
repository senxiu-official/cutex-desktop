// Remote close in the renderer (cutex `client-remote-close`, docs/research/remote-close-desktop-20261019.md):
// - the countdown main runs when a host asks this desktop to close (event `remoteClose`, shell ops
//   `remoteClose` / `answerRemoteClose`; components/RemoteCloseDialog.tsx shows it);
// - per host, the desktops registered there (`GET /v2/clients`), kept live by `cutex/client/stateChanged`
//   (and a close request marks its row at once); 「关闭」 = `POST /v2/clients/{id}/close`. A host with
//   `client-presence-lifecycle` removes an exiting desktop itself (`stateChanged` exited drops the row,
//   cancelled shows it as online again); older hosts keep the relaunch-leftover rule (dropRelaunchLeftovers).
// Pure parts: shared/remoteClose.ts.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  anyCloseRequestOf,
  applyClientState,
  clientStateChangeOf,
  closeGate,
  dropRelaunchLeftovers,
  PRESENCE_LIFECYCLE_FEATURE,
  REMOTE_CLOSE_FEATURE,
  sortOnlineClients,
  type CloseGate,
  type ClientState,
  type OnlineClientView,
  type RemoteCloseAction,
  type RemoteCloseRefusal,
  type RemoteCloseResult,
  type RemoteCloseView,
} from "../../../shared/remoteClose";
import { deviceScopeOf } from "../../../shared/users";
import { apiFor, bridge } from "../bridge";
import { useHostAccess } from "./hostAccess";
import { onHostReset } from "./hostSwitch";
import { useHostData, useHostLook } from "./useHostScope";

// ---------- the countdown ----------

const useCountdown = create<{ view: RemoteCloseView | null }>(() => ({ view: null }));

// Follow main's countdown from the start (guarded: unit tests import this with a bridge stub), and
// pick up one that began before this page loaded.
if (typeof bridge.on === "function") {
  bridge.on("remoteClose", ({ view }) => useCountdown.setState({ view }));
  bridge.shell?.remoteClose?.().then(
    (view) => {
      if (view) useCountdown.setState({ view });
    },
    () => {},
  );
}

/** The running countdown (null: none). */
export function useRemoteCloseCountdown(): RemoteCloseView | null {
  return useCountdown((s) => s.view);
}

/** Non-React: the running countdown now. */
export function remoteCloseCountdownNow(): RemoteCloseView | null {
  return useCountdown.getState().view;
}

/** 取消 / 立即关闭. Cancel hides the dialog at once (main confirms with the event). */
export function answerRemoteClose(action: RemoteCloseAction): void {
  const view = useCountdown.getState().view;
  if (!view) return;
  useCountdown.setState({ view: action === "cancel" ? null : { ...view, closing: true } });
  void bridge.shell?.answerRemoteClose?.(action).catch(() => {});
}

// ---------- 在线的桌面 ----------

/** The section's anchor (settings search; module remote-access). */
export const ONLINE_DESKTOPS_ANCHOR = "online-desktops";

export interface OnlineClientsEntry {
  rows: OnlineClientView[];
  loading: boolean;
  error: RemoteCloseRefusal | null;
  /** Connection epoch of the last read. */
  epoch: string | null;
  read: boolean;
}

const EMPTY: OnlineClientsEntry = Object.freeze({ rows: [], loading: false, error: null, epoch: null, read: false }) as OnlineClientsEntry;
const useEntries = create<Record<string, OnlineClientsEntry>>(() => ({}));
const inFlight = new Map<string, Promise<void>>();

// A request acknowledgment is not the target desktop's closing acknowledgment.
export const CLOSE_REQUEST_TIMEOUT_MS = 15_000;
// Preserve the target's 15-second cancel countdown, then allow 15 seconds for its report.
export const CLOSE_CONFIRM_TIMEOUT_MS = 30_000;
export const CLOSE_POLL_MS = 1_000;
type CloseResult = RemoteCloseResult<{ instanceId: string; state: ClientState }>;
interface PendingClose {
  accepted: boolean;
  result: Promise<CloseResult>;
  resolve(result: CloseResult): void;
  timer: ReturnType<typeof setTimeout>;
  poll: ReturnType<typeof setInterval>;
}
const pendingCloses = new Map<string, Map<string, PendingClose>>();
// A timed-out request must remain retryable even if an old server keeps closeRequested.
const retryable = new Map<string, Set<string>>();
const closed = new Map<string, Set<string>>();
function markClosed(hostId: string, instanceId: string): void {
  const ids = closed.get(hostId) ?? new Set<string>();
  ids.add(instanceId);
  closed.set(hostId, ids);
}
/** Hosts with `client-presence-lifecycle` (set by whoever reads the list: useOnlineClients knows the features). */
const lifecycleHosts = new Set<string>();
const failure = (code: string): CloseResult => ({ ok: false, error: { code, message: code } });

function bounded<T>(run: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([run, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("remote_close_timeout: No reply from the host")), CLOSE_REQUEST_TIMEOUT_MS);
  })]).finally(() => clearTimeout(timer));
}

function finishClose(hostId: string, instanceId: string, result: CloseResult): void {
  const pending = pendingCloses.get(hostId)?.get(instanceId);
  if (!pending) return;
  pendingCloses.get(hostId)!.delete(instanceId);
  if (!pendingCloses.get(hostId)!.size) pendingCloses.delete(hostId);
  clearTimeout(pending.timer);
  clearInterval(pending.poll);
  if (!result.ok) {
    const ids = retryable.get(hostId) ?? new Set<string>();
    ids.add(instanceId);
    retryable.set(hostId, ids);
    setRowState(hostId, instanceId, "online");
  } else {
    markClosed(hostId, instanceId);
    const entry = useEntries.getState()[hostId];
    if (entry) patchEntry(hostId, { rows: entry.rows.filter(row => row.instanceId !== instanceId) });
  }
  pending.resolve(result);
}

function acceptRows(hostId: string, rows: OnlineClientView[]): OnlineClientView[] {
  for (const [id, pending] of pendingCloses.get(hostId) ?? []) {
    if (!pending.accepted) continue;
    const row = rows.find(row => row.instanceId === id);
    if (!row || row.state === "closing") finishClose(hostId, id, { ok: true, value: { instanceId: id, state: "closing" } });
    else if (row.state === "cancelled") finishClose(hostId, id, failure("remote_close_cancelled"));
  }
  // cutex retains closing registrations until their heartbeat expires. A closing report
  // is terminal for this list; later polls must not bring the row back.
  for (const row of rows) if (row.state === "closing") markClosed(hostId, row.instanceId);
  for (const id of closed.get(hostId) ?? []) if (!rows.some(row => row.instanceId === id)) closed.get(hostId)!.delete(id);
  for (const id of retryable.get(hostId) ?? []) if (!rows.some(row => row.instanceId === id)) retryable.get(hostId)!.delete(id);
  // Lifecycle hosts drop exited / replaced rows themselves, and a cancelled exit is a running desktop again.
  const shown = lifecycleHosts.has(hostId) ? rows.map(row => (row.state === "cancelled" ? { ...row, state: "online" as const } : row)) : dropRelaunchLeftovers(rows);
  return sortOnlineClients(shown.filter(row => !closed.get(hostId)?.has(row.instanceId)).map(row => {
    if (pendingCloses.get(hostId)?.has(row.instanceId)) return { ...row, state: "closeRequested" as const };
    if (retryable.get(hostId)?.has(row.instanceId) && row.state === "closeRequested") return { ...row, state: "online" as const };
    return row;
  }));
}

onHostReset((hostId) => {
  inFlight.delete(hostId);
  for (const [id] of pendingCloses.get(hostId) ?? []) finishClose(hostId, id, failure("remote_close_disconnected"));
  retryable.delete(hostId);
  closed.delete(hostId);
  lifecycleHosts.delete(hostId);
  useEntries.setState((s) => (s[hostId] ? Object.fromEntries(Object.entries(s).filter(([id]) => id !== hostId)) : s), true);
});

function patchEntry(hostId: string, patch: Partial<OnlineClientsEntry>): void {
  useEntries.setState((s) => ({ ...s, [hostId]: { ...(s[hostId] ?? EMPTY), ...patch } }));
}

/** A thrown call's `code: message` (IPC keeps only the message) as a refusal value. */
function refusalFromError(error: unknown): RemoteCloseRefusal {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const m = /\b([a-z][a-z0-9_]{2,63}): (.*)$/s.exec(text);
  return m ? { code: m[1]!, message: m[2]! } : { code: "error", message: text };
}

/** Read a host's online desktops; concurrent calls share one read. `lifecycle`: the host has `client-presence-lifecycle` (omitted: as last said). */
export function loadOnlineClients(hostId: string, epoch: string | null = null, lifecycle?: boolean): Promise<void> {
  if (lifecycle === true) lifecycleHosts.add(hostId);
  else if (lifecycle === false) lifecycleHosts.delete(hostId);
  const running = inFlight.get(hostId);
  if (running) return running;
  const host = apiFor(hostId);
  if (typeof host.onlineClients !== "function") return Promise.resolve();
  patchEntry(hostId, { loading: true });
  const run = bounded(host.onlineClients()).then(
    (r) => {
      if (inFlight.get(hostId) !== run) return;
      if (r.ok) patchEntry(hostId, { rows: acceptRows(hostId, r.value), loading: false, error: null, epoch, read: true });
      else patchEntry(hostId, { loading: false, error: r.error, epoch, read: true });
    },
    (error) => {
      if (inFlight.get(hostId) === run) patchEntry(hostId, { loading: false, error: refusalFromError(error), epoch, read: true });
    },
  ).finally(() => {
    if (inFlight.get(hostId) === run) inFlight.delete(hostId);
  });
  inFlight.set(hostId, run);
  return run;
}

/** Non-React: a host's online desktops now (an empty entry when never read). */
export function onlineClientsNow(hostId: string): OnlineClientsEntry {
  return useEntries.getState()[hostId] ?? EMPTY;
}

function setRowState(hostId: string, instanceId: string, state: ClientState): void {
  const entry = useEntries.getState()[hostId];
  if (!entry) return;
  const rows = applyClientState(entry.rows, { instanceId, state });
  if (rows !== entry.rows) patchEntry(hostId, { rows });
}

/** Wait for the target's report, cancellation, disappearance, or a bounded failure. */
export function closeOnlineClient(hostId: string, instanceId: string): Promise<CloseResult> {
  const existing = pendingCloses.get(hostId)?.get(instanceId);
  if (existing) return existing.result;
  retryable.get(hostId)?.delete(instanceId);
  let resolve!: PendingClose["resolve"];
  const result = new Promise<CloseResult>(done => { resolve = done; });
  const timer = setTimeout(() => finishClose(hostId, instanceId, failure("remote_close_timeout")), CLOSE_CONFIRM_TIMEOUT_MS);
  const poll = setInterval(() => void loadOnlineClients(hostId, onlineClientsNow(hostId).epoch), CLOSE_POLL_MS);
  timer.unref?.();
  poll.unref?.();
  const pending: PendingClose = { accepted: false, result, resolve, timer, poll };
  const hostPending = pendingCloses.get(hostId) ?? new Map<string, PendingClose>();
  hostPending.set(instanceId, pending);
  pendingCloses.set(hostId, hostPending);
  setRowState(hostId, instanceId, "closeRequested");
  void (async () => {
    let reply: CloseResult;
    try { reply = await bounded(apiFor(hostId).closeOnlineClient(instanceId)); }
    catch (error) { reply = { ok: false, error: refusalFromError(error) }; }
    if (pendingCloses.get(hostId)?.get(instanceId) !== pending) return;
    pending.accepted = reply.ok;
    if (!reply.ok) {
      finishClose(hostId, instanceId, reply);
      if (["client_not_found", "remote_close_disabled"].includes(reply.error.code)) void loadOnlineClients(hostId, onlineClientsNow(hostId).epoch);
    } else if (reply.value.state === "closing") finishClose(hostId, instanceId, reply);
    else if (reply.value.state === "cancelled") finishClose(hostId, instanceId, failure("remote_close_cancelled"));
  })();
  return result;
}

// Live updates for every connected host whose list was read (guarded: unit tests import this with a bridge stub).
if (typeof bridge.on === "function") {
  bridge.on("hostEvent", ({ hostId, epoch, envelope }) => {
    const current = useEntries.getState()[hostId];
    if (!current || (current.epoch && epoch && current.epoch !== epoch)) return;
    const change = clientStateChangeOf(envelope);
    if (change) {
      if (change.state === "exited") {
        // Lifecycle host: the desktop exited (or a newer launch of it replaced this row).
        markClosed(hostId, change.instanceId);
        finishClose(hostId, change.instanceId, { ok: true, value: { instanceId: change.instanceId, state: "closing" } });
        const entry = onlineClientsNow(hostId);
        patchEntry(hostId, { rows: applyClientState(entry.rows, change) });
      } else if (change.state === "closing") {
        markClosed(hostId, change.instanceId);
        finishClose(hostId, change.instanceId, { ok: true, value: { instanceId: change.instanceId, state: "closing" } });
        const entry = onlineClientsNow(hostId);
        patchEntry(hostId, { rows: entry.rows.filter(row => row.instanceId !== change.instanceId) });
      } else if (change.state === "cancelled") {
        finishClose(hostId, change.instanceId, failure("remote_close_cancelled"));
        setRowState(hostId, change.instanceId, lifecycleHosts.has(hostId) ? "online" : change.state);
      } else setRowState(hostId, change.instanceId, change.state);
      return;
    }
    const request = anyCloseRequestOf(envelope);
    if (request) {
      retryable.get(hostId)?.delete(request.instanceId);
      setRowState(hostId, request.instanceId, "closeRequested");
    }
  });
}

// ---------- hooks ----------

/** How often an open list re-reads (heartbeats move `lastSeen`; desktops come and go without events). */
export const ONLINE_CLIENTS_REFRESH_MS = 30_000;

export interface OnlineClientRowView extends OnlineClientView {
  gate: CloseGate;
}

export interface OnlineClientsView extends Omit<OnlineClientsEntry, "rows"> {
  /** The host has `client-remote-close` and is connected. */
  available: boolean;
  rows: OnlineClientRowView[];
  reload(): void;
  close(instanceId: string): Promise<RemoteCloseResult<{ instanceId: string; state: ClientState }>>;
}

/** The online desktops of one host (target-host pages pass their `useTargetHostId()`); re-read while shown. */
export function useOnlineClients(hostId: string): OnlineClientsView {
  const look = useHostLook(hostId);
  const data = useHostData(hostId);
  const access = useHostAccess(hostId);
  const entry = useEntries((s) => s[hostId]) ?? EMPTY;
  const epoch = look?.view.conn?.epoch ?? null;
  const available = data?.daemon.kind === "connected" && !!data.features.has(REMOTE_CLOSE_FEATURE) && !access.pending;
  const lifecycle = !!data?.features.has(PRESENCE_LIFECYCLE_FEATURE);
  useEffect(() => {
    if (!available) return;
    void loadOnlineClients(hostId, epoch, lifecycle);
    const id = setInterval(() => void loadOnlineClients(hostId, epoch, lifecycle), ONLINE_CLIENTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [hostId, epoch, available, lifecycle]);
  const scope = deviceScopeOf(access);
  return useMemo(() => {
    const who = { isOwner: access.isOwner, userId: access.userId, scope };
    return {
      ...entry,
      available,
      rows: available ? entry.rows.map((r) => ({ ...r, gate: closeGate(r, who) })) : [],
      reload: () => void loadOnlineClients(hostId, epoch, lifecycle),
      close: (instanceId: string) => closeOnlineClient(hostId, instanceId),
    };
  }, [entry, available, lifecycle, access.isOwner, access.userId, scope, hostId, epoch]);
}
