// Remote close in the renderer (cutex `client-remote-close`, docs/research/remote-close-desktop-20261019.md):
// - the countdown main runs when a host asks this desktop to close (event `remoteClose`, shell ops
//   `remoteClose` / `answerRemoteClose`; components/RemoteCloseDialog.tsx shows it);
// - per host, the desktops registered there (`GET /v2/clients`), kept live by `cutex/client/stateChanged`
//   (and a close request marks its row at once); 「关闭」 = `POST /v2/clients/{id}/close`.
// Pure parts: shared/remoteClose.ts.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  anyCloseRequestOf,
  applyClientState,
  clientStateChangeOf,
  closeGate,
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

onHostReset((hostId) => {
  inFlight.delete(hostId);
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

/** Read a host's online desktops; concurrent calls share one read. */
export function loadOnlineClients(hostId: string, epoch: string | null = null): Promise<void> {
  const running = inFlight.get(hostId);
  if (running) return running;
  const host = apiFor(hostId);
  if (typeof host.onlineClients !== "function") return Promise.resolve();
  patchEntry(hostId, { loading: true });
  const run = host.onlineClients().then(
    (r) => {
      if (inFlight.get(hostId) !== run) return;
      if (r.ok) patchEntry(hostId, { rows: sortOnlineClients(r.value), loading: false, error: null, epoch, read: true });
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

/** 「关闭」: ask that desktop to close; its row shows the request at once, refusals come back as values. */
export async function closeOnlineClient(hostId: string, instanceId: string): Promise<RemoteCloseResult<{ instanceId: string; state: ClientState }>> {
  let r: RemoteCloseResult<{ instanceId: string; state: ClientState }>;
  try {
    r = await apiFor(hostId).closeOnlineClient(instanceId);
  } catch (error) {
    return { ok: false, error: refusalFromError(error) };
  }
  if (r.ok) setRowState(hostId, instanceId, r.value.state);
  // Gone, or the switch changed meanwhile: the list is stale.
  else if (r.error.code === "client_not_found" || r.error.code === "remote_close_disabled") void loadOnlineClients(hostId, useEntries.getState()[hostId]?.epoch ?? null);
  return r;
}

// Live updates for every connected host whose list was read (guarded: unit tests import this with a bridge stub).
if (typeof bridge.on === "function") {
  bridge.on("hostEvent", ({ hostId, envelope }) => {
    if (!useEntries.getState()[hostId]) return;
    const change = clientStateChangeOf(envelope);
    if (change) {
      setRowState(hostId, change.instanceId, change.state);
      return;
    }
    const request = anyCloseRequestOf(envelope);
    if (request) setRowState(hostId, request.instanceId, "closeRequested");
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
  useEffect(() => {
    if (!available) return;
    void loadOnlineClients(hostId, epoch);
    const id = setInterval(() => void loadOnlineClients(hostId, epoch), ONLINE_CLIENTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [hostId, epoch, available]);
  const scope = deviceScopeOf(access);
  return useMemo(() => {
    const who = { isOwner: access.isOwner, userId: access.userId, scope };
    return {
      ...entry,
      available,
      rows: available ? entry.rows.map((r) => ({ ...r, gate: closeGate(r, who) })) : [],
      reload: () => void loadOnlineClients(hostId, epoch),
      close: (instanceId: string) => closeOnlineClient(hostId, instanceId),
    };
  }, [entry, available, access.isOwner, access.userId, scope, hostId, epoch]);
}
