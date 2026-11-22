// Main's one-click owner notices of a tab (shared/browser BrowserTabView.ownerNotices): an untrusted LAN / loopback
// certificate (仍然打开), a page download or popup without a fresh owner click (下载… / 打开). The renderer only shows
// them and hands back the id; main keeps the exact target and decides whether the click may run.
import type { BrowserOwnerNoticeKind, BrowserOwnerNoticeView, BrowserTabView } from "../../../../shared/browser";
import { MAX_BROWSER_INPUT } from "./browserState";

export type BrowserOwnerNotice = Readonly<BrowserOwnerNoticeView>;
const KINDS: readonly BrowserOwnerNoticeKind[] = ["certificate", "download", "popup"];
const MAX_ID = 200, MAX_DETAIL = 260;
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "");

/** Bounded copies of main's values (one per kind, in a fixed order); malformed entries are dropped. */
export function sanitizeOwnerNotices(raw: BrowserTabView["ownerNotices"]): BrowserOwnerNotice[] {
  if (!Array.isArray(raw)) return [];
  const out: BrowserOwnerNotice[] = [];
  for (const kind of KINDS) {
    const item = raw.find(value => value && typeof value === "object" && value.kind === kind);
    if (!item) continue;
    const { id, url, detail } = item;
    if (typeof id !== "string" || !id || id.length > MAX_ID || typeof url !== "string" || !url || url.length > MAX_BROWSER_INPUT) continue;
    out.push(Object.freeze({ id, kind, url: clean(url), ...(typeof detail === "string" && detail && detail.length <= MAX_DETAIL ? { detail: clean(detail) } : {}) }));
  }
  return out;
}

/** A `changed` event: null clears, a value replaces, absent keeps the previous ones for the same guest. */
export function nextOwnerNotices(previous: Readonly<BrowserTabView> | undefined, view: BrowserTabView): BrowserOwnerNotice[] | undefined {
  if (view.ownerNotices === null) return undefined;
  if (view.ownerNotices !== undefined) { const next = sanitizeOwnerNotices(view.ownerNotices); return next.length ? next : undefined; }
  return previous?.guestId === view.guestId ? (previous.ownerNotices ?? undefined) : undefined;
}

/** The host shown in a notice (the full URL is the hover text). */
export function ownerNoticeHost(url: string): string {
  try {
    const host = new URL(url).host;
    if (host) return host;
  } catch { /* shown as given below */ }
  return url.length > 80 ? `${url.slice(0, 79)}…` : url;
}
