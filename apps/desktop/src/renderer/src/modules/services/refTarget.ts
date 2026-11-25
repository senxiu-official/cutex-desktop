// `ref.target` kind `service` (docs/desktop-modules.md §19.6): `cutex:service/<slug>[/path]` links in
// agent replies open the service in the in-app browser tab on the right (lib/services.ts openInApp,
// the same path as 服务 page → 打开), path kept. The side only shows the open agent's host, so a link of
// another host switches the Shelf there; with the browser module off it falls back to the system browser like
// the 服务 page does. A link of another host than the Shelf shows opens that host's agent first (lib/services
// openOnItsHost; Director 2026-11-24, auto-switch); a host with no agent to open is unavailable.
import { Server } from "lucide-react";
import { openInApp, openOnItsHost, openServiceExternal, systemBrowserOpens } from "../../lib/services";
import { isWorkerOn, showWorker } from "../../lib/serviceWorker";
import { sideShowsHost } from "../../lib/sideServices";
import type { CutexRef, RefLinkView, RefOpenResult } from "../slots";
import { revealPath } from "./reveal";

export const SERVICE_REF_KIND = "service";
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A link key (`<slug>` or `<slug>/<path>`, decoded once by lib/cutexLinks) → slug and path, or null. */
export function parseServiceRefKey(key: string): { slug: string; path: string } | null {
  const slash = key.indexOf("/");
  const slug = slash < 0 ? key : key.slice(0, slash);
  if (!SLUG.test(slug)) return null;
  if (slash < 0) return { slug, path: "/" };
  const raw = key.slice(slash);
  // The key arrives decoded (`%20` → space): re-encode whitespace, which the browser tab's link rule refuses.
  const encoded = raw.replace(/\s/g, (c) => encodeURIComponent(c));
  return revealPath(encoded) === encoded ? { slug, path: encoded } : null;
}

export async function openServiceRef(ref: CutexRef, how: "auto" | "peek" | "page"): Promise<RefOpenResult> {
  void how; // a web page: every way opens the browser tab on the right
  const target = parseServiceRefKey(ref.key);
  if (!target) return { status: "unavailable", reason: "bad-ref" };
  // A background service (no page): shown on the 服务 page, where it is controlled.
  if (isWorkerOn(ref.hostId, target.slug)) { showWorker(target.slug); return { status: "opened", where: "page" }; }
  if (!sideShowsHost(ref.hostId)) return (await openOnItsHost(target.slug, ref.hostId, target.path)) === "opened" ? { status: "opened", where: "card" } : { status: "unavailable", reason: "host-offline" };
  if (openInApp(target.slug, ref.hostId, target.path)) return { status: "opened", where: "card" };
  // A remote host's service never goes to the system browser (lib/services systemBrowserOpens): the tab could not
  // open, so the browser module is off (the caller says why).
  if (!systemBrowserOpens(ref.hostId)) return { status: "unavailable", reason: "module-off" };
  try {
    return (await openServiceExternal({ slug: target.slug }, ref.hostId, target.path)) ? { status: "opened", where: "page" } : { status: "unavailable", reason: "module-off" };
  } catch {
    return { status: "unavailable", reason: "gone" };
  }
}

export function useServiceLink(ref: CutexRef): RefLinkView | null {
  const target = parseServiceRefKey(ref.key);
  if (!target) return { tone: "muted", tooltip: ref.key };
  return { icon: Server, tooltip: `${target.slug}${target.path === "/" ? "" : target.path}` };
}
