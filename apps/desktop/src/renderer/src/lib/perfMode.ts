// 性能 (Settings → 通用, owner 2026-10-23: 「要是有什么极致性能模式可以提供一下——在我设备性能够的时候我还是希望能用起来方便」):
//   节省资源 (default) — looping animations rest while the window is not in front (lib/loopPause) and rarely used pages
//                     load on first open (lib/lazyPage);
//   流畅优先         — the loops keep running when the window is not in front, and those pages load right after start,
//                     one per idle period, so a first open is as quick as a later one.
// Loading skeletons pulse 3 times in both (they are placeholders, not motion the owner wants to watch).
import { setLoopPauseEnabled } from "./loopPause";
import { preloadLazyPages } from "./lazyPage";
import { getUiPrefs, subscribeUiPrefs } from "./prefs";

/** After start: let the first rows, the timeline and the module packs settle before preloading. */
export const PRELOAD_AFTER_MS = 3000;

/**
 * Applies the 性能 pref now and on every change. Preloading starts once (the first time 流畅优先 is on, at least
 * PRELOAD_AFTER_MS after install); switching back to 节省资源 before it began cancels it, after keeps what is loaded.
 * Returns the uninstall.
 */
export function installPerfMode({ preload = preloadLazyPages, delay = PRELOAD_AFTER_MS }: { preload?: () => Promise<void>; delay?: number } = {}): () => void {
  const installedAt = Date.now();
  let preloading = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const apply = () => {
    const smooth = getUiPrefs().perfMode === "smooth";
    setLoopPauseEnabled(!smooth);
    if (!smooth && timer) {
      // Switched back before the preload began: it does not start.
      clearTimeout(timer);
      timer = null;
      preloading = false;
    }
    if (!smooth || preloading) return;
    preloading = true;
    timer = setTimeout(() => {
      timer = null;
      void preload();
    }, Math.max(0, installedAt + delay - Date.now()));
  };
  apply();
  const unsubscribe = subscribeUiPrefs(apply);
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
