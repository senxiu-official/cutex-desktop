// Gallery thumbnails of the 文件 explorer (docs/design/019 §6). cutex has no thumbnail route yet (API gap A2,
// docs/design/020), so a tile reads the whole image through fs/file — only tiles on screen, at most
// THUMB_CONCURRENCY at a time, images up to THUMB_MAX_BYTES (bigger ones show their icon), the last
// THUMB_CACHE data URLs kept in memory (keyed by host, root, path and modification time).
import type { DaemonApi, WorkspaceScope } from "../../../../../shared/ipc";
import { thumbnailSrc } from "../../../lib/fileKinds";

export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const THUMB_CONCURRENCY = 4;
export const THUMB_CACHE = 200;

const cache = new Map<string, string | null>();
const waiting: (() => void)[] = [];
let running = 0;

function remember(key: string, src: string | null): void {
  cache.delete(key);
  cache.set(key, src);
  while (cache.size > THUMB_CACHE) cache.delete(cache.keys().next().value as string);
}

export function cachedThumb(key: string): string | null | undefined {
  return cache.get(key);
}

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= THUMB_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await run();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** The tile's image (data URL), or null when it cannot be shown (too big, not an image, read failed). */
export function loadThumb(api: DaemonApi, scope: WorkspaceScope, path: string, key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return slot(async () => {
    try {
      const file = await api.fsFile(scope, path, THUMB_MAX_BYTES);
      const src = thumbnailSrc(file, path);
      remember(key, src);
      return src;
    } catch {
      remember(key, null);
      return null;
    }
  });
}

/** Tests. */
export function clearThumbs(): void {
  cache.clear();
}
