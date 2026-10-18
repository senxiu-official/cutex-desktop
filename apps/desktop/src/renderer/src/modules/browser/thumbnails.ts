// Live thumbnails of background agent tabs (main's offscreen carrier, ~1 frame per second while the
// app window is visible). Display only: a bounded JPEG data URL, never a guest, URL or credential.
import { useSyncExternalStore } from "react";
import { browserCacheKey } from "./browserCache";
import { safeBrowserThumbnail } from "./browserState";

export function createBrowserThumbnails() {
  const images = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(hostId: string, tabKey: string): string | undefined { return images.get(browserCacheKey(hostId, tabKey)); },
    set(hostId: string, tabKey: string, raw: unknown): boolean {
      const image = safeBrowserThumbnail(raw);
      if (!image) return false;
      images.set(browserCacheKey(hostId, tabKey), image);
      notify();
      return true;
    },
    remove(hostId: string, tabKey: string) { if (images.delete(browserCacheKey(hostId, tabKey))) notify(); },
    clear() { if (images.size) { images.clear(); notify(); } },
  };
}
export const browserThumbnails = createBrowserThumbnails();
/** Preview only (`?browserBackground`, modules/browser/mock.ts): the demo background tab's key. */
export const BROWSER_PREVIEW_BACKGROUND = { hostId: "preview", tabKey: "background" } as const;
// Dev preview only (dropped from production bundles): mock.ts draws the demo frames.
if (import.meta.env.DEV && typeof window !== "undefined")
  window.addEventListener("cutex-preview-browser-thumbnail", (event) => {
    browserThumbnails.set(BROWSER_PREVIEW_BACKGROUND.hostId, BROWSER_PREVIEW_BACKGROUND.tabKey, (event as CustomEvent<unknown>).detail);
  });

export function useBrowserThumbnail(hostId: string | null, tabKey: string): string | undefined {
  const snapshot = () => hostId ? browserThumbnails.get(hostId, tabKey) : undefined;
  return useSyncExternalStore(browserThumbnails.subscribe, snapshot, snapshot);
}
