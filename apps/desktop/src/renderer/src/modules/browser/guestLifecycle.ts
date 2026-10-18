// StrictMode / LRU remounts may overlap asynchronous IPC. Serialize only guest lifecycles, per
// host and instance; never let a late open callback attach a removed view or close its replacement.
import type { BrowserTabMount, HostBrowserBridge, BrowserMountIdentity } from "../../../../shared/browser";
import { browserCacheKey } from "./browserCache";

type GuestApi = Pick<HostBrowserBridge, "open" | "close">;
export function createGuestLifecycle() {
  const tails = new Map<string, Promise<void>>();
  const retired = new Set<string>();
  // A carrier switch (background carrier <-> card webview) remounts the card's mount effect, but
  // main keeps (and hands over) the page: that one release must not close or unmount the tab.
  const kept = new Set<string>();
  function enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    tails.set(key, run);
    void run.then(() => { if (tails.get(key) === run) tails.delete(key); }, () => { if (tails.get(key) === run) tails.delete(key); });
    return run;
  }
  return {
    /** The next release of this tab's mount keeps main's page (a carrier switch remount). */
    keepNext(hostId: string, tabKey: string): void { kept.add(browserCacheKey(hostId, tabKey)); },
    mount(hostId: string, tabKey: string, url: string, api: GuestApi, attach: (mount: BrowserTabMount, confirm: (webContentsId: number) => Promise<void>) => void, failed: (error: unknown) => void, isCurrent: () => boolean = () => true, identity?: BrowserMountIdentity): () => void {
      const key = browserCacheKey(hostId, tabKey);
      let active = true;
      void enqueue(key, async () => {
        if (!active || retired.has(key) || !isCurrent()) return;
        const mount = identity ? await api.open(tabKey, url, undefined, identity) : await api.open(tabKey, url);
        if (active && !retired.has(key) && isCurrent()) {
          let confirmed = false;
          // Main's background carrier has no webview and needs no receipt.
          if (mount.carrier === "background") { attach(mount, () => Promise.resolve()); return; }
          attach(mount, (webContentsId) => {
            if (confirmed || !active || retired.has(key) || !isCurrent()) return Promise.resolve();
            confirmed = true;
            if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) {
              failed(new Error("Invalid browser mount receipt"));
              return Promise.resolve();
            }
            return enqueue(key, async () => {
              if (!active || retired.has(key) || !isCurrent()) return;
              // Electron's did-attach event does not identify the will-attach reservation. Only this
              // owner-UI receipt lets main correlate its consumed ticket with the actual blank guest.
              if (identity) await api.open(tabKey, url, { src: mount.src, webContentsId }, identity);
              else await api.open(tabKey, url, { src: mount.src, webContentsId });
            }).catch((error: unknown) => { if (active && !retired.has(key) && isCurrent()) failed(error); });
          });
        }
      }).catch((error: unknown) => { if (active && isCurrent()) failed(error); });
      return () => {
        if (!active) return;
        active = false;
        if (kept.delete(key)) return;
        void enqueue(key, () => api.close(tabKey, { unmount: true })).catch(() => {});
      };
    },
    close(hostId: string, tabKey: string, api: GuestApi): Promise<void> {
      const key = browserCacheKey(hostId, tabKey);
      retired.add(key);
      return enqueue(key, () => api.close(tabKey));
    },
  };
}

export const guestLifecycle = createGuestLifecycle();
