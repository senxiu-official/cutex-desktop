// Remote close of a desktop client (cutex `client-remote-close`, docs/research/remote-close-desktop-20261019.md):
// the pure parts shared by main (presence + heartbeat per host, the countdown before quitting) and the
// renderer (the 「在线的桌面」 list, the countdown dialog). Only the desktop app quits: nothing here (or
// in main/clientPresence.ts) stops cutex, its agents or services.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import {
  CLIENT_CLOSE_REQUESTED_EVENT,
  CLIENT_REMOTE_CLOSE_FEATURE,
  CLIENT_STATE_CHANGED_EVENT,
  DEFAULT_HEARTBEAT_SECONDS,
  readClientCloseRequested,
  readClientStateChanged,
  type ClientCloseRequested,
  type ClientClosingOutcome,
  type ClientState,
  type ClientStateChanged,
  type OnlineClient,
} from "@cutex-desktop/cutex-client";
import type { DeviceScope } from "./users";

export { CLIENT_REMOTE_CLOSE_FEATURE as REMOTE_CLOSE_FEATURE, type ClientCloseRequested, type ClientClosingOutcome, type ClientState, type ClientStateChanged, type OnlineClient };

/** A `GET /v2/clients` row as the renderer gets it: `self` = this desktop instance (main knows its instance id). */
export interface OnlineClientView extends OnlineClient {
  self: boolean;
}

/** A refusal of the clients routes, as a value (the list explains each). */
export interface RemoteCloseRefusal {
  code: string;
  message: string;
}
export type RemoteCloseResult<T> = { ok: true; value: T } | { ok: false; error: RemoteCloseRefusal };

export const REMOTE_CLOSE_REFUSAL_CODES = ["client_close_forbidden", "remote_close_disabled", "client_not_found"] as const;
export type RemoteCloseRefusalCode = (typeof REMOTE_CLOSE_REFUSAL_CODES)[number];

export function isKnownRemoteCloseRefusal(code: string): code is RemoteCloseRefusalCode {
  return (REMOTE_CLOSE_REFUSAL_CODES as readonly string[]).includes(code);
}

// ---------- host events ----------

/** A `cutex/client/closeRequested` addressed to this instance (every subscriber gets every one); else null. */
export function closeRequestFor(envelope: EventEnvelope, instanceId: string): ClientCloseRequested | null {
  if (envelope.cutex?.method !== CLIENT_CLOSE_REQUESTED_EVENT) return null;
  const request = readClientCloseRequested(envelope.cutex.params);
  return request && request.instanceId === instanceId ? request : null;
}

/** A `cutex/client/stateChanged` (any instance); else null. */
export function clientStateChangeOf(envelope: EventEnvelope): ClientStateChanged | null {
  if (envelope.cutex?.method !== CLIENT_STATE_CHANGED_EVENT) return null;
  return readClientStateChanged(envelope.cutex.params);
}

/** A `cutex/client/closeRequested` for any instance (the list marks the row at once). */
export function anyCloseRequestOf(envelope: EventEnvelope): ClientCloseRequested | null {
  if (envelope.cutex?.method !== CLIENT_CLOSE_REQUESTED_EVENT) return null;
  return readClientCloseRequested(envelope.cutex.params);
}

// ---------- presence scheduling ----------

/** First retry after a failed presence call; doubles per failure, never beyond the heartbeat. */
export const PRESENCE_RETRY_MS = 5_000;

/**
 * Delay before the next presence call of one host: the host's heartbeat after a success, a backoff
 * (5 s, 10 s, 20 s …, capped at the heartbeat) after `failures` failed calls in a row.
 */
export function presenceDelayMs(heartbeatSeconds: number | null | undefined, failures: number): number {
  const beat = (typeof heartbeatSeconds === "number" && heartbeatSeconds > 0 ? heartbeatSeconds : DEFAULT_HEARTBEAT_SECONDS) * 1000;
  if (failures <= 0) return beat;
  return Math.min(beat, PRESENCE_RETRY_MS * 2 ** Math.min(failures - 1, 10));
}

/** A failed presence call that will not succeed by retrying soon (older host, refused): wait a full heartbeat. */
export function presenceRetryable(status: number | null): boolean {
  return status === null || status >= 500 || status === 429;
}

// ---------- the countdown (main) ----------

/** What the renderer shows while this desktop is about to close (main → renderer, event `remoteClose`). */
export interface RemoteCloseView {
  /** Changes with each new countdown (the dialog re-mounts). */
  id: string;
  /** The requesting device (cutex `requestedBy.deviceName`); null when the host did not say. */
  deviceName: string | null;
  /** The request came from the host itself (its root credential). */
  requesterLocal: boolean;
  /** The app's host id the request came through (its label is the renderer's). */
  hostId: string;
  graceSeconds: number;
  /** When the app quits (ms since the epoch, this machine's clock). */
  deadline: number;
  /** 立即关闭 / the deadline passed: reporting and quitting now (buttons off). */
  closing: boolean;
}

export type RemoteCloseAction = "cancel" | "now";

export interface CountdownDeps {
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** POST closing {outcome} to the host that asked (errors are ignored by the caller). */
  report(hostId: string, instanceId: string, outcome: ClientClosingOutcome): Promise<void>;
  /** Quit the desktop app (only the app). */
  quit(): void;
  onChange(view: RemoteCloseView | null): void;
}

/** How long a closing / cancelled report may take before the app quits regardless. */
export const REPORT_TIMEOUT_MS = 2_500;

/**
 * One countdown at a time. A second request (another host, or the same one again) joins the running
 * countdown: its deadline is the earlier one and every requesting host gets the outcome. Cancel → each
 * host gets `cancelled`; 立即关闭 / the deadline → each gets `closing`, then the app quits (also when
 * the reports fail or hang: after REPORT_TIMEOUT_MS).
 */
export class RemoteCloseCountdown {
  private current: { view: RemoteCloseView; sources: { hostId: string; instanceId: string }[]; timer: unknown } | null = null;
  private seq = 0;
  private quitting = false;

  constructor(private readonly deps: CountdownDeps) {}

  view(): RemoteCloseView | null {
    return this.current ? { ...this.current.view } : null;
  }

  /** A close request for this instance through `hostId`. False when it was ignored (already quitting). */
  request(hostId: string, request: ClientCloseRequested): boolean {
    if (this.quitting) return false;
    const deadline = this.deps.now() + request.graceSeconds * 1000;
    const cur = this.current;
    if (cur) {
      if (!cur.sources.some((s) => s.hostId === hostId && s.instanceId === request.instanceId)) cur.sources.push({ hostId, instanceId: request.instanceId });
      if (deadline < cur.view.deadline && !cur.view.closing) {
        this.deps.clearTimer(cur.timer);
        cur.view = { ...cur.view, deadline, graceSeconds: request.graceSeconds };
        cur.timer = this.deps.setTimer(() => void this.closeNow(), Math.max(0, deadline - this.deps.now()));
        this.deps.onChange(this.view());
      }
      return true;
    }
    const view: RemoteCloseView = {
      id: `rc-${++this.seq}`,
      deviceName: request.requestedBy.deviceName,
      requesterLocal: request.requestedBy.local,
      hostId,
      graceSeconds: request.graceSeconds,
      deadline,
      closing: false,
    };
    this.current = { view, sources: [{ hostId, instanceId: request.instanceId }], timer: this.deps.setTimer(() => void this.closeNow(), request.graceSeconds * 1000) };
    this.deps.onChange(this.view());
    return true;
  }

  /** The renderer's answer. */
  answer(action: RemoteCloseAction): Promise<void> {
    return action === "cancel" ? this.cancel() : this.closeNow();
  }

  /** 取消: the app stays; every requesting host hears `cancelled`. */
  async cancel(): Promise<void> {
    const cur = this.current;
    if (!cur || cur.view.closing) return;
    this.deps.clearTimer(cur.timer);
    this.current = null;
    this.deps.onChange(null);
    await this.reportAll(cur.sources, "cancelled");
  }

  /** 立即关闭 / the deadline: report `closing`, then quit the app. */
  async closeNow(): Promise<void> {
    const cur = this.current;
    if (!cur || cur.view.closing) return;
    this.deps.clearTimer(cur.timer);
    cur.view = { ...cur.view, closing: true };
    this.quitting = true;
    this.deps.onChange(this.view());
    await this.reportAll(cur.sources, "closing");
    this.deps.quit();
  }

  /** A host's connection ended: it is no longer told the outcome (the countdown itself runs on). */
  forgetHost(hostId: string): void {
    if (this.current) this.current.sources = this.current.sources.filter((s) => s.hostId !== hostId);
  }

  dispose(): void {
    if (this.current) this.deps.clearTimer(this.current.timer);
    this.current = null;
  }

  private async reportAll(sources: readonly { hostId: string; instanceId: string }[], outcome: ClientClosingOutcome): Promise<void> {
    const all = Promise.allSettled(sources.map((s) => this.deps.report(s.hostId, s.instanceId, outcome)));
    let handle: unknown;
    const timeout = new Promise<void>((resolve) => (handle = this.deps.setTimer(resolve, REPORT_TIMEOUT_MS)));
    await Promise.race([all, timeout]);
    this.deps.clearTimer(handle);
  }
}

/** Whole seconds left of a countdown (never negative). */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

// ---------- the 「在线的桌面」 list (renderer) ----------

/** Who this connection is on the host, as far as closing goes. */
export interface CloseAccess {
  isOwner: boolean;
  userId: string | null;
  /** This connection's device scope (null: unknown / older host = full). */
  scope: DeviceScope | null;
}

/**
 * What a row's 「关闭」 may do: `self` (this desktop: no button), `ok`, `busy` (a close is already under
 * way), `disabled` (that desktop turned remote close off), `forbidden` (not the owner and not the same
 * user, or this device's scope is narrower than full) — the same rules cutex applies.
 */
export type CloseGate = "self" | "ok" | "busy" | "disabled" | "forbidden";

export function closeGate(row: OnlineClientView, access: CloseAccess): CloseGate {
  if (row.self) return "self";
  if ((access.scope ?? "full") !== "full") return "forbidden";
  if (!access.isOwner && (!access.userId || row.userId !== access.userId)) return "forbidden";
  if (!row.allowRemoteClose) return "disabled";
  if (row.state === "closeRequested" || row.state === "closing") return "busy";
  return "ok";
}

/** This desktop first, then the most recent heartbeat first. */
export function sortOnlineClients(rows: readonly OnlineClientView[]): OnlineClientView[] {
  const seen = (r: OnlineClientView) => (r.lastSeen ? Date.parse(r.lastSeen) || 0 : 0);
  return [...rows].sort((a, b) => Number(b.self) - Number(a.self) || seen(b) - seen(a) || a.deviceName.localeCompare(b.deviceName));
}

/** Apply a `stateChanged` to a list (unknown instance: unchanged). */
export function applyClientState(rows: readonly OnlineClientView[], change: ClientStateChanged): OnlineClientView[] {
  return rows.some((r) => r.instanceId === change.instanceId && r.state !== change.state) ? rows.map((r) => (r.instanceId === change.instanceId ? { ...r, state: change.state } : r)) : (rows as OnlineClientView[]);
}

/** Display name of a client platform (`process.platform` values; anything else as given). */
export function clientPlatformLabel(platform: string): string {
  switch (platform) {
    case "win32":
    case "windows":
      return "Windows";
    case "darwin":
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}
