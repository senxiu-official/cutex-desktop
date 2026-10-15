// Passive, host-scoped metadata only. Reading a tab never opens a guest or starts a poll.
import type { BrowserTabView } from "../../../../shared/browser";
import { browserError, browserTitle, MAX_BROWSER_INPUT, safeBrowserFavicon, safeBrowserUrl } from "./browserState";

export function browserCacheKey(hostId: string, tabKey: string): string {
  return JSON.stringify([hostId, tabKey]);
}

export function createBrowserCache() {
  const views = new Map<string, Readonly<BrowserTabView>>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(hostId: string, tabKey: string) { return views.get(browserCacheKey(hostId, tabKey)); },
    update(view: BrowserTabView): boolean {
      const key = browserCacheKey(view.hostId, view.tabKey);
      const previous = views.get(key);
      if (previous?.guestId === view.guestId && previous.pageGeneration > view.pageGeneration) return false;
      views.set(key, Object.freeze({
        hostId: view.hostId, tabKey: view.tabKey, guestId: view.guestId,
        pageGeneration: view.pageGeneration, status: view.status,
        loading: view.loading, canGoBack: view.canGoBack, canGoForward: view.canGoForward,
        url: safeBrowserUrl(view.url, MAX_BROWSER_INPUT) ?? "about:blank", title: browserTitle(view.title),
        favicon: safeBrowserFavicon(view.favicon), error: view.error ? browserError(view.error) : undefined,
        pool: view.pool === "agent" ? "agent" : "owner",
        lease: view.lease ? Object.freeze({ ...view.lease }) : undefined,
        confirmedOpen: view.confirmedOpen,
        control: view.control ? Object.freeze({ grantee: view.control.grantee, state: view.control.state, operating: view.control.operating }) : undefined,
      }));
      notify();
      return true;
    },
    remove(hostId: string, tabKey: string) { if (views.delete(browserCacheKey(hostId, tabKey))) notify(); },
    removeHost(hostId: string) {
      let changed = false;
      for (const [key, view] of views) if (view.hostId === hostId) { views.delete(key); changed = true; }
      if (changed) notify();
    },
    clear() { if (views.size) { views.clear(); notify(); } },
  };
}

export const browserCache = createBrowserCache();
