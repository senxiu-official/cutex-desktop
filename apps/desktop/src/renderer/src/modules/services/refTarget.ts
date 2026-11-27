// `ref.target` kind `service` (docs/desktop-modules.md §19.6): `cutex:service/<slug>[/path]` links in
// agent replies open the service in the in-app browser tab on the right, path kept — the same open as 服务 page →
// 打开 (lib/services.ts openServiceTab): a link of another host than the Shelf shows opens that host's agent first
// (Director 2026-11-24, auto-switch; this machine's services too since owner 2026-11-28); the system browser only with
// the browser module off. A host with no agent to open is unavailable (a toast says why).
import { Server } from "lucide-react";
import { openServiceTab } from "../../lib/services";
import { isWorkerOn, showWorker } from "../../lib/serviceWorker";
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
  // The same open as 服务 page → 打开 (lib/services openServiceTab): its host's agent first when the Shelf shows another,
  // the system browser only with the browser module off; what failed is said in a toast there.
  try {
    const how = await openServiceTab({ slug: target.slug }, ref.hostId, target.path);
    if (how === "opened") return { status: "opened", where: "card" };
    if (how === "system") return { status: "opened", where: "page" };
    return { status: "unavailable", reason: how === "browser-off" ? "module-off" : "host-offline" };
  } catch {
    return { status: "unavailable", reason: "gone" };
  }
}

export function useServiceLink(ref: CutexRef): RefLinkView | null {
  const target = parseServiceRefKey(ref.key);
  if (!target) return { tone: "muted", tooltip: ref.key };
  return { icon: Server, tooltip: `${target.slug}${target.path === "/" ? "" : target.path}` };
}
