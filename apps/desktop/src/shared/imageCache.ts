/** Images above this require the existing explicit open-anyway action and are not cached. */
export const IMAGE_PREVIEW_PROMPT_BYTES = 512 * 1024 * 1024;
export const IMAGE_CACHE_CHANNEL = "cutex-desktop:image-cache";
export interface ImageCacheSettings { days: number; maxBytes: number }
export interface ImageCacheState extends ImageCacheSettings { bytes: number; entries: number }
export interface ImageCacheBridge {
  state(): Promise<ImageCacheState>;
  configure(settings: ImageCacheSettings): Promise<void>;
  clear(): Promise<void>;
}
