// `ref.target` kind `service` (docs/desktop-modules.md §19.6): `cutex:service/<slug>[/path]` links in
// agent replies open the service in the in-app browser tab on the right (lib/services.ts openInApp,
// the same path as 服务 page → 打开), path kept. The side only shows the open agent's host, so a link of
// another host is unavailable; with the browser module off it falls back to the system browser like
// the 服务 page does.
import { Globe } from "lucide-react";
import { openInApp, openServiceExternal } from "../../lib/services";
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
  if (!sideShowsHost(ref.hostId)) return { status: "unavailable", reason: "host-offline" };
  if (openInApp(target.slug, ref.hostId, target.path)) return { status: "opened", where: "card" };
  try {
    await openServiceExternal({ slug: target.slug }, ref.hostId, target.path);
    return { status: "opened", where: "page" };
  } catch {
    return { status: "unavailable", reason: "gone" };
  }
}

export function useServiceLink(ref: CutexRef): RefLinkView | null {
  const target = parseServiceRefKey(ref.key);
  if (!target) return { tone: "muted", tooltip: ref.key };
  return { icon: Globe, tooltip: `${target.slug}${target.path === "/" ? "" : target.path}` };
}
