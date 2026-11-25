// A clicked service notification (main → `serviceNotificationOpen`, main already resolved and checked the
// target and showed the window): a service with its own opener on this desktop (lib/serviceOpeners: WhatsApp's
// owner tab while the `whatsapp` module is on) opens through it; otherwise like 服务 → 打开 does (lib/services). Only ids, slug and a validated path arrive here — never the notification's text.
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { SERVICE_SLUG } from "../../../../shared/serviceNotificationQueries";
import type { ServiceNotificationOpen } from "../../../../shared/serviceNotifications";
import { openOnItsHost, openService } from "../../lib/services";
import { serviceOpener } from "../../lib/serviceOpeners";
import { sideShowsHost } from "../../lib/sideServices";
import type { ModuleServices } from "../slots";

const PATH = /^\/(?!\/)[A-Za-z0-9/._~-]{0,511}$/;

/** The path main sent, if it is one a service tab accepts (no `.` / `..` segments); else the service root. */
export function safeServicePath(path: string | undefined): string {
  if (!path || !PATH.test(path) || path.split("/").some((s) => s === "." || s === "..")) return "/";
  return path;
}

export type OpenOutcome = "opener" | "service" | "other-host" | "refused";

export async function openServiceNotification(target: ServiceNotificationOpen, side: Pick<ModuleServices["side"], "open">): Promise<OpenOutcome> {
  if (!target || typeof target.hostId !== "string" || !SERVICE_SLUG.test(target.slug)) return "refused";
  const path = safeServicePath(target.path);
  const opener = target.hostId === LOCAL_HOST_ID ? serviceOpener(target.slug) : null;
  if (opener && (await opener(side))) return "opener";
  if (!sideShowsHost(target.hostId)) {
    await openOnItsHost(target.slug, target.hostId, path);
    return "other-host";
  }
  await openService({ slug: target.slug }, target.hostId, path);
  return "service";
}
