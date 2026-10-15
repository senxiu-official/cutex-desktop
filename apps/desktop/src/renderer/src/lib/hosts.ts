// Host status helpers for the switcher and Settings → 主机 (pure; test/hosts.test.ts). Per-host
// views for the whole host list (scope, colors, versions): lib/hostScope.ts.
import { LOCAL_HOST_ID, REMOTE_FEATURES, type HostsState, type HostView, type SshErrorCode, type TunnelView } from "../../../shared/hosts";
import type { DaemonState } from "../../../shared/ipc";
import type { SettingsSource } from "./settingsNav";

export function activeHost(hosts: HostsState | null): HostView | null {
  return hosts?.hosts.find((h) => h.id === hosts.active) ?? null;
}

/**
 * No host at all: this machine is not one (macOS without a local cutex, main/localHost.ts) and no
 * remote host was added yet. The empty main area guides to adding an SSH host (no 「重连」 banner).
 */
export function hasNoHost(hosts: HostsState | null): boolean {
  return !!hosts && hosts.hosts.length === 0;
}

/** This machine is listed as a host (false: macOS without a local cutex). */
export function hasLocalHost(hosts: HostsState | null): boolean {
  return !hosts || hosts.hosts.some((h) => h.id === LOCAL_HOST_ID);
}

/**
 * The source tag a settings page / section shows: none for 「本机」 when this machine is not a host
 * (macOS without a local cutex), so no settings page names a 「本机」 that is not in the host list.
 */
export function shownSettingsSource(source: SettingsSource | undefined, hosts: HostsState | null): SettingsSource | undefined {
  return source === "local" && !hasLocalHost(hosts) ? undefined : source;
}

/** The app is connected (or connecting) to another machine's daemon. */
export function isRemote(hosts: HostsState | null): boolean {
  return !!hosts && hosts.active !== LOCAL_HOST_ID;
}

/** `disconnected`: the host has no connection (⏻ off, or not auto-connected and outside the scope). */
export type HostStatus = "online" | "connecting" | "retrying" | "offline" | "error" | "disconnected";
/** Why the host is not online: an ssh failure, or the daemon behind a working tunnel. */
export type HostProblem = SshErrorCode | "remoteDaemon" | "daemon";

export interface HostIndicator {
  status: HostStatus;
  problem: HostProblem | null;
  /** ssh stderr tail / daemon message. */
  detail: string | null;
  /** Epoch ms of the next automatic tunnel retry. */
  retryAt: number | null;
}

/**
 * One status for a host connection from its kind, SSH tunnel (null for local / dev-direct hosts) and
 * daemon connection. `conn: false` = the host has no connection at all.
 */
export function connIndicator(kind: HostView["kind"], tunnel: TunnelView | null, daemon: DaemonState, conn = true): HostIndicator {
  if (!conn) return { status: "disconnected", problem: null, detail: null, retryAt: null };
  const fromDaemon = (problemOnFailure: HostProblem): HostIndicator => {
    switch (daemon.kind) {
      case "connected":
        return { status: "online", problem: null, detail: null, retryAt: null };
      case "connecting":
        return { status: "connecting", problem: null, detail: null, retryAt: null };
      case "unreachable":
        return { status: "offline", problem: problemOnFailure, detail: daemon.message, retryAt: null };
      case "error":
        return daemon.status === 401 || daemon.status === 403
          ? { status: "error", problem: "tokenRejected", detail: daemon.message, retryAt: null }
          : { status: "error", problem: "daemon", detail: daemon.message, retryAt: null };
    }
  };
  if (kind === "local") return fromDaemon("daemon");
  // DEV ONLY direct loopback host (main/devHosts.ts): no tunnel, the daemon connection is the status.
  if (kind === "dev-direct") return fromDaemon("remoteDaemon");
  if (!tunnel || tunnel.status === "idle" || tunnel.status === "starting") return { status: "connecting", problem: null, detail: null, retryAt: null };
  if (tunnel.status === "error") return { status: "error", problem: tunnel.error?.code ?? "exited", detail: tunnel.error?.detail || null, retryAt: null };
  if (tunnel.status === "retrying") return { status: "retrying", problem: tunnel.error?.code ?? "exited", detail: tunnel.error?.detail || null, retryAt: tunnel.retryAt };
  return fromDaemon("remoteDaemon");
}

/** One status for the active (focus) host from the tunnel (SSH hosts) and the daemon connection. */
export function hostIndicator(hosts: HostsState | null, daemon: DaemonState): HostIndicator {
  if (!isRemote(hosts)) return connIndicator("local", null, daemon);
  return connIndicator(activeHost(hosts)?.kind ?? "ssh", hosts!.tunnel, daemon);
}

/** Dot colour class for a status. */
export function statusDot(status: HostStatus): string {
  return status === "online" ? "bg-ok" : status === "connecting" || status === "retrying" ? "bg-warn animate-pulse" : status === "disconnected" ? "bg-subtle/40" : "bg-danger";
}

/** Remote-mode features the connected cutex lacks (empty on the local host). */
export function missingRemoteFeatures(hosts: HostsState | null, features: ReadonlySet<string>): string[] {
  if (!isRemote(hosts) || features.size === 0) return [];
  return Object.values(REMOTE_FEATURES).filter((f) => !features.has(f));
}
