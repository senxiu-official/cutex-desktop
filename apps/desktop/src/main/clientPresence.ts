// Desktop presence on every connected host (cutex `client-remote-close`, docs/research/remote-close-desktop-20261019.md):
// on each connect of a host that has the capability, `POST /v2/clients/presence` and again every
// `heartbeatSeconds` (the host forgets a desktop after 3 minutes without one); a reconnect registers
// again, a disconnect stops the heartbeat. `installId` is kept in userData (client-install.json),
// `instanceId` is new for every launch. A `cutex/client/closeRequested` for this instance starts the
// countdown (shared/remoteClose.ts RemoteCloseCountdown, wired in main/index.ts): only the desktop app
// quits — nothing here or on the quit path stops cutex, its agents or services.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { ClientCloseRequested, ClientClosingOutcome, ClientPresence as PresenceBody } from "@cutex-desktop/cutex-client";
import type { DaemonState } from "../shared/ipc";
import { closeRequestFor, presenceDelayMs, presenceRetryable, REMOTE_CLOSE_FEATURE } from "../shared/remoteClose";
import type { DaemonService } from "./daemon";

// Kept local (not the cutex-client constants): main/index.ts builds the identity at startup, and tests
// of index.ts replace that package with a partial mock.
const INSTALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const APP_NAME = "cutex-desktop";

/** This launch's client instance (new at every start; daemon.ts marks its own row in `GET /v2/clients`). */
export const CLIENT_INSTANCE = randomUUID();

/** The install id in `file` (created once; a garbled file is replaced). */
export function loadInstallId(file: string): string {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { installId?: unknown };
    if (typeof raw.installId === "string" && INSTALL_ID.test(raw.installId)) return raw.installId;
  } catch {
    // first start, or unreadable: a new one
  }
  const installId = randomUUID();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify({ installId }, null, 2)}\n`, "utf8");
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    console.warn("[cutex-desktop] saving the client install id failed", error);
  }
  return installId;
}

/** The device name a host shows for this desktop (the OS host name, as approvals report it). */
export function presenceDeviceName(): string {
  return hostname().trim() || "unknown";
}

/** This desktop's presence identity (everything but `allowRemoteClose`): install id from `installFile`, this launch's instance. */
export function presenceIdentity(installFile: string, appVersion: string, platform: string): Omit<PresenceBody, "allowRemoteClose"> {
  return { installId: loadInstallId(installFile), instanceId: CLIENT_INSTANCE, appName: APP_NAME, appVersion, deviceName: presenceDeviceName(), platform };
}

export interface ClientPresenceDeps {
  daemonFor(hostId: string): DaemonService | null;
  allowRemoteClose(): boolean;
  /** Everything of the presence body except `allowRemoteClose` (read once, at the first connect). */
  identity(): Omit<PresenceBody, "allowRemoteClose">;
  /** A close request for this instance arrived through `hostId` (remote close allowed here). */
  onCloseRequested(hostId: string, request: ClientCloseRequested): void;
}

interface HostPresence {
  gen: number;
  timer: NodeJS.Timeout | null;
  /** The host has the capability (null: not known yet for this connection). */
  supported: boolean | null;
  heartbeatSeconds: number | null;
  failures: number;
}

export class ClientPresenceService {
  private hosts = new Map<string, HostPresence>();
  private stopped = false;

  constructor(private readonly deps: ClientPresenceDeps) {}

  private me: Omit<PresenceBody, "allowRemoteClose"> | null = null;

  /** This desktop's identity; null when it cannot be read (no presence then). */
  private identity(): Omit<PresenceBody, "allowRemoteClose"> | null {
    if (!this.me) {
      try {
        this.me = this.deps.identity();
      } catch (error) {
        console.warn("[cutex-desktop] client presence: no identity", error);
        return null;
      }
    }
    return this.me;
  }

  /** Each connection state of a host (main/index.ts createDaemon): connected = (re)register; anything else pauses. */
  onDaemonState(hostId: string, state: DaemonState): void {
    if (this.stopped) return;
    const prev = this.hosts.get(hostId);
    if (prev?.timer) clearTimeout(prev.timer);
    const entry: HostPresence = { gen: (prev?.gen ?? 0) + 1, timer: null, supported: null, heartbeatSeconds: null, failures: 0 };
    this.hosts.set(hostId, entry);
    if (state.kind === "connected") void this.begin(hostId, entry.gen);
  }

  /** A host's connection ended (disconnected / replaced / removed): no more heartbeats to it. */
  forgetHost(hostId: string): void {
    const entry = this.hosts.get(hostId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.hosts.delete(hostId);
  }

  /** 允许远程关闭这个桌面 changed: every registered host hears it now. */
  resendAll(): void {
    for (const [hostId, entry] of this.hosts) {
      if (entry.supported !== true) continue;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      void this.send(hostId, entry.gen);
    }
  }

  /** A host feed event: a close request for this instance goes to the countdown (or is declined when switched off). */
  onHostEvent(hostId: string, envelope: EventEnvelope): void {
    if (this.stopped) return;
    // Before the first presence no host knows this instance: nothing can be addressed to it.
    const me = this.me;
    if (!me) return;
    const request = closeRequestFor(envelope, me.instanceId);
    if (!request) return;
    if (!this.deps.allowRemoteClose()) {
      // Turned off since the host last heard: decline at once.
      void this.report(hostId, request.instanceId, "cancelled").catch(() => {});
      return;
    }
    this.deps.onCloseRequested(hostId, request);
  }

  /** `POST /v2/clients/{instanceId}/closing` through that host's current connection. */
  async report(hostId: string, instanceId: string, outcome: ClientClosingOutcome): Promise<void> {
    const client = this.deps.daemonFor(hostId)?.activeClient();
    if (!client) return;
    await client.reportClientClosing(instanceId, outcome, { signal: AbortSignal.timeout(5000) });
  }

  /** App quit: no more calls. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.hosts.values()) if (entry.timer) clearTimeout(entry.timer);
    this.hosts.clear();
  }

  private current(hostId: string, gen: number): HostPresence | null {
    const entry = this.hosts.get(hostId);
    return !this.stopped && entry && entry.gen === gen ? entry : null;
  }

  private async begin(hostId: string, gen: number): Promise<void> {
    const daemon = this.deps.daemonFor(hostId);
    if (!daemon) return;
    let supported = false;
    try {
      const caps = await daemon.capabilities();
      supported = !!caps?.featureList?.includes(REMOTE_CLOSE_FEATURE);
    } catch {
      // unreachable meanwhile: the next connect tries again
      return;
    }
    const entry = this.current(hostId, gen);
    if (!entry) return;
    entry.supported = supported;
    if (supported) await this.send(hostId, gen);
  }

  private async send(hostId: string, gen: number): Promise<void> {
    const client = this.deps.daemonFor(hostId)?.activeClient();
    const me = this.identity();
    if (!client || !me || !this.current(hostId, gen)) return;
    let status: number | null = null;
    let ok = false;
    let heartbeat: number | null = null;
    try {
      const reply = await client.clientPresence({ ...me, allowRemoteClose: this.deps.allowRemoteClose() }, { signal: AbortSignal.timeout(15_000) });
      heartbeat = reply.heartbeatSeconds;
      ok = true;
    } catch (error) {
      // CutexApiError carries the HTTP status; unreachable / aborted calls have none.
      const code = (error as { status?: unknown } | null)?.status;
      status = typeof code === "number" ? code : null;
    }
    const entry = this.current(hostId, gen);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (ok) {
      entry.failures = 0;
      entry.heartbeatSeconds = heartbeat;
    } else entry.failures = presenceRetryable(status) ? entry.failures + 1 : 0;
    entry.timer = setTimeout(() => {
      const e = this.current(hostId, gen);
      if (!e) return;
      e.timer = null;
      void this.send(hostId, gen);
    }, presenceDelayMs(entry.heartbeatSeconds, entry.failures));
    entry.timer.unref?.();
  }
}
