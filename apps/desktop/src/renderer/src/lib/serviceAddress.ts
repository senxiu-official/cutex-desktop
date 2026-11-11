// What 复制地址 / 复制端口 copy for a service (owner report 2026-11-09). cutex's `url` carries the daemon
// machine's host name (http://host-02:24421/): services usually listen on loopback only, so that address often
// does not open. The copy is the loopback address `localUrl`. It works as-is when the service runs on this
// desktop's machine. A service on another host has no forwarded port here (the in-app tab goes through the
// management connection), so its loopback address is labelled as that host's own address and never presented
// as one this PC can open.
import type { ServiceView } from "../../../shared/ipc";
import { LOCAL_HOST_ID, type HostView } from "../../../shared/hosts";
import type { MessageKey } from "../i18n";
import type { MenuEntry } from "./contextMenu";

export interface ServiceAddress {
  /** `http://127.0.0.1:<port>/…` on the service's own machine; null = nothing to copy (static files, no port). */
  address: string | null;
  port: number | null;
  /** Another machine's service: that host's name (the address opens only there). Null = this machine. */
  remoteHost: string | null;
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Same machine: the local daemon, or a dev-only loopback host. */
export function sameMachine(hostId: string, host: Pick<HostView, "kind"> | null | undefined): boolean {
  return hostId === LOCAL_HOST_ID || host?.kind === "local" || host?.kind === "dev-direct";
}

/** The service's loopback address; `tabPath` = the page open in a service tab (`/…` at the service origin). */
export function serviceAddressOf(s: Pick<ServiceView, "localUrl" | "port">, hostId: string, host: Pick<HostView, "kind" | "label"> | null | undefined, tabPath?: string): ServiceAddress {
  const port = typeof s.port === "number" && s.port > 0 ? s.port : null;
  let address: string | null = null;
  try {
    if (s.localUrl) address = tabPath ? new URL(s.localUrl).origin + tabPath : s.localUrl;
  } catch { address = null; }
  return { address, port, remoteHost: sameMachine(hostId, host) ? null : host?.label || hostId };
}

/** `cutex:service/<slug>/<path>` → `/<path>` (as the tab shows it), else null. */
export function serviceTabPath(url: string): string | null {
  // Same form as lib/serviceLink serviceSlugOf (not imported: that module pulls in the app's module host).
  const m = /^cutex:service\/[a-z0-9][a-z0-9-]{0,62}(?=[/?]|$)/.exec(url);
  if (!m) return null;
  const rest = url.slice(m[0].length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** The copy rows (a menu row is a user gesture: nothing is copied otherwise). */
export function serviceCopyEntries(a: ServiceAddress, t: T, copy: (text: string) => void): MenuEntry[] {
  const remote = a.remoteHost;
  return [
    a.address !== null && {
      label: remote ? t("services.copyHostLocalUrl", { host: remote }) : t("services.copyUrl"),
      hint: a.address.replace(/^http:\/\//, "").replace(/\/$/, ""),
      info: remote ? t("services.copyHostLocalUrl.info", { host: remote }) : undefined,
      onSelect: () => copy(a.address!),
    },
    a.port !== null && {
      label: t("services.copyPort"),
      hint: String(a.port),
      info: remote ? t("services.copyPort.info", { host: remote }) : undefined,
      onSelect: () => copy(String(a.port)),
    },
  ].filter(Boolean) as MenuEntry[];
}
