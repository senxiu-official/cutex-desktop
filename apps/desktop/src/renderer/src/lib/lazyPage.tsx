// Rarely used pages out of the entry chunk (owner 2026-10-23, perf audit §5): the Settings pages and sections,
// 关于, a few seldom opened `main.page` items and (2026-10-24, 0.2.0 beta audit) seldom opened pane bodies load on
// first open. A module keeps its item (id, title, search keywords, order) eager; only the component is
// `lazyPage(() => import("./X").then((m) => m.X))`.
// Once loaded the component renders synchronously (no empty frame on later opens). No Suspense: React holds a
// boundary's content back for 300 ms after its fallback showed (FALLBACK_THROTTLE_MS), which made a first open
// ~290 ms slower than the chunk load itself; the page is set from an effect instead (empty until then).
// preloadLazyPages loads them all ahead, one per idle period; preloadOnIntent does it once, the first time the
// owner heads for such a page (Settings opens, the Shelf ＋ launcher or ⌘K), so later first opens are instant.
// A chunk that fails to load (the app was updated under the open window, a dev server restarted: "Failed to fetch
// dynamically imported module") is tried again once, then the page says so with 重试 / 重新加载窗口 instead of
// failing as a module error.
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { loadEnglish, useI18n } from "../i18n";

type Loader = () => Promise<unknown>;
const loaders: Loader[] = [];

/** The automatic second try after a failed chunk load. */
export const LAZY_RETRY_MS = 400;

export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => ReactNode {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const once = () =>
    (pending ??= load().then(
      (C) => (loaded = C),
      (err) => {
        // A failed chunk load may be retried (the next open, 重试, the automatic second try).
        pending = null;
        throw err;
      },
    ));
  loaders.push(once);
  function LazyPage(props: P) {
    const [state, setState] = useState<{ C: ComponentType<P> | null; failed?: boolean; attempt: number }>(() => ({ C: loaded, attempt: 0 }));
    useEffect(() => {
      if (state.C || state.failed) return;
      let live = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      once().then(
        (C) => live && setState({ C, attempt: state.attempt }),
        () => {
          if (!live) return;
          // The first failure of this open: once more after a moment (a file being replaced, a busy disk).
          if (state.attempt === 0) timer = setTimeout(() => live && setState({ C: null, attempt: 1 }), LAZY_RETRY_MS);
          else setState({ C: null, failed: true, attempt: state.attempt });
        },
      );
      return () => {
        live = false;
        if (timer) clearTimeout(timer);
      };
    }, [state]);
    if (state.failed) return <LazyLoadFailed onRetry={() => setState({ C: null, attempt: 1 })} />;
    return state.C ? <state.C {...props} /> : null;
  }
  return LazyPage;
}

/** What a page whose chunk did not load shows: try again, or reload the window (the app's current files). */
function LazyLoadFailed({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  const button = "shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground";
  return (
    <p role="alert" data-testid="lazy-load-failed" className="my-2 flex flex-wrap items-center gap-2 text-xs text-danger">
      <span className="min-w-0">{t("modules.chunkFailed")}</span>
      <button type="button" onClick={onRetry} className={button}>
        {t("modules.retry")}
      </button>
      <button type="button" onClick={() => location.reload()} className={button}>
        {t("modules.reloadWindow")}
      </button>
    </p>
  );
}

/** How many lazy pages are registered (tests, the perf report). */
export function lazyPageCount(): number {
  return loaders.length;
}

/**
 * Load every lazy page, one per idle period, so none of it competes with start-up or typing. Resolves when all
 * are loaded (failures are skipped: the page tries again when opened). `idle` is swappable for tests.
 */
export async function preloadLazyPages(idle: () => Promise<void> = nextIdle): Promise<void> {
  for (const load of loaders.slice()) {
    await idle();
    await load().catch(() => undefined);
  }
}

let intent: Promise<void> | null = null;
/**
 * The owner heads for a lazily loaded page (Settings opened, the Shelf ＋ launcher hovered, ⌘K opened): preload them
 * all once, in idle periods (as 流畅优先 does after start), after the en search aliases. Later calls do nothing.
 */
export function preloadOnIntent(): Promise<void> {
  // The en catalog too (i18n: on demand): Settings search and ⌘K match English names from their first keystroke.
  return (intent ??= loadEnglish().then(() => preloadLazyPages()));
}

/** Tests: forget that preloadOnIntent ran. */
export function resetPreloadIntent(): void {
  intent = null;
}

function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 50);
  });
}
