// Main's refused top-level navigation into a private origin (shared/browser BrowserTabView.blockedNavigation). The
// renderer only displays it and hands back its id: main keeps the exact URL and decides whether 仍然打开 may run.
import type { BrowserTabView } from "../../../../shared/browser";
import { MAX_BROWSER_INPUT } from "./browserState";

/** desktopLoopback: an SSH host's page linked to localhost; 仍然打开 opens it on this desktop, not on that host. */
export type BrowserBlockedNavigation = { id: string; url: string; canOpen: boolean; desktopLoopback?: true };

const MAX_ID = 200;

/** A bounded copy of main's value; null for none or anything malformed. */
export function sanitizeBlockedNavigation(raw: BrowserTabView["blockedNavigation"]): BrowserBlockedNavigation | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, url, canOpen, desktopLoopback } = raw;
  if (typeof id !== "string" || !id || id.length > MAX_ID || typeof url !== "string" || !url || url.length > MAX_BROWSER_INPUT) return null;
  return Object.freeze({ id, url: url.replace(/[\u0000-\u001f\u007f]/g, ""), canOpen: canOpen === true, ...(desktopLoopback === true ? { desktopLoopback: true as const } : {}) });
}

/**
 * What a `changed` event leaves: an explicit null clears, a value replaces, an absent field keeps the previous one for
 * the same guest (a new guest starts with none).
 */
export function nextBlockedNavigation(previous: Readonly<BrowserTabView> | undefined, view: BrowserTabView): BrowserBlockedNavigation | undefined {
  if (view.blockedNavigation === null) return undefined;
  if (view.blockedNavigation !== undefined) return sanitizeBlockedNavigation(view.blockedNavigation) ?? undefined;
  return previous?.guestId === view.guestId ? (previous.blockedNavigation ?? undefined) : undefined;
}

/** The host shown in the notice (the full URL is the hover text). */
export function blockedNavigationHost(url: string): string {
  try {
    const host = new URL(url).host;
    if (host) return host;
  } catch { /* shown as given below */ }
  return url.length > 80 ? `${url.slice(0, 79)}…` : url;
}
