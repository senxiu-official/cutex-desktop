import type { ImageCacheBridge, ImageCacheState } from "../../../shared/imageCache";
/** main/imageCache.ts in the preview: limits and a made-up size, kept in memory. */
export function mockImageCache(): ImageCacheBridge {
  let state: ImageCacheState = { days: 7, maxBytes: 5 * 1024 ** 3, bytes: 1_342_177_280, entries: 1284 };
  return {
    state: async () => ({ ...state }),
    configure: async (settings) => { state = { ...state, ...settings }; },
    clear: async () => { state = { ...state, bytes: 0, entries: 0 }; },
  };
}
