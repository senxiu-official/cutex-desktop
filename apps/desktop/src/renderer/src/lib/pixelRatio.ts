import { useSyncExternalStore } from "react";
import { useOwnerWindow } from "./ownerContext";

interface RatioStore {
  get(): number;
  subscribe(listener: () => void): () => void;
}
const stores = new WeakMap<Window, RatioStore>();
const server: RatioStore = { get: () => 1, subscribe: () => () => {} };

/** One resolution listener per window, shared by all its prose (including desk portals). */
function storeFor(win: Window | undefined): RatioStore {
  if (!win) return server;
  const saved = stores.get(win);
  if (saved) return saved;
  const read = () => win.devicePixelRatio || 1;
  const listeners = new Set<() => void>();
  let ratio = read();
  let media: MediaQueryList | undefined;
  const changed = () => {
    const next = read();
    if (next === ratio) return;
    ratio = next;
    watchResolution();
    for (const listener of listeners) listener();
  };
  const watchResolution = () => {
    media?.removeEventListener("change", changed);
    media = win.matchMedia?.(`(resolution: ${ratio}dppx)`);
    media?.addEventListener("change", changed);
  };
  const store: RatioStore = {
    get: read,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        ratio = read();
        watchResolution();
        win.addEventListener("resize", changed);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          media?.removeEventListener("change", changed);
          media = undefined;
          win.removeEventListener("resize", changed);
        }
      };
    },
  };
  stores.set(win, store);
  return store;
}

/** Electron zoom and moving a window between displays both change its device pixel ratio. */
export function useDevicePixelRatio(): number {
  const store = storeFor(useOwnerWindow());
  return useSyncExternalStore(store.subscribe, store.get, server.get);
}
