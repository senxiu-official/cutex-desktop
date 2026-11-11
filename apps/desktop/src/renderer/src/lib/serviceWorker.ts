// Background services (cutex services-workers-v1, docs/design/portless-services-v1.md in the persistent-services
// study): `runtime: "worker"` is a program cutex supervises with no port and no web page. The desktop shows it as
// 「后台应用」, never offers 打开 / a browser tab, and its main actions are start / stop / restart and the logs.
// Opening one from anywhere (a pin, a link, quick switch, the header list) shows it on the 服务 page instead.
// Older hosts never send a worker, so nothing changes without the capability.
import type { ServiceView } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { services } from "../modules/app";
import { useApp } from "../store";
import { hostData } from "./hostScope";

export const SERVICES_PAGE = "services.page";

export function isWorker(s: Pick<ServiceView, "runtime"> | null | undefined): boolean {
  return s?.runtime === "worker";
}

/** cutex runs it (start / stop / restart / logs): managed web services and workers. */
export function isSupervised(s: Pick<ServiceView, "runtime">): boolean {
  return s.runtime === "managed" || s.runtime === "worker";
}

/** The host's record of a service, when its list is loaded (else null). */
export function serviceOn(hostId: string, slug: string): ServiceView | null {
  return hostData(useApp.getState(), hostId)?.services?.find((s) => s.slug === slug) ?? null;
}

/** A known worker on that host (a service the list does not have yet is treated as a web service). */
export function isWorkerOn(hostId: string, slug: string): boolean {
  return isWorker(serviceOn(hostId, slug));
}

/** Show a background service where it can be controlled: the 服务 page, searched to it. */
export function showWorker(slug: string): void {
  services.ui.openPage(SERVICES_PAGE, { q: slug });
}

/**
 * The health word. A worker's `reachable` only means its process is alive, and `unreachable` means it is waiting
 * to restart (there is no probe), so those two read differently from a web service's.
 */
export function serviceHealthKey(s: Pick<ServiceView, "runtime" | "health">): MessageKey {
  if (isWorker(s) && s.health === "unreachable") return "services.worker.health.restarting";
  return `services.health.${s.health}` as MessageKey;
}
