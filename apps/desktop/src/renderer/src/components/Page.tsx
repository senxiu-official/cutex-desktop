// Shared page chrome so every non-conversation page has the same gutters and width. The page
// title lives in the title bar (breadcrumb), never repeated inside the page.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSizeFlags, widthAtLeast } from "../lib/sizeFlags";

/** Scrolling content column: same width and padding on Tasks, Services, Projects, Settings….
 *  Scrollbars are overlays (lib/overlayScrollbarManager.ts) and take no width, so content never
 *  shifts sideways when a page grows past the viewport height. */
// ---- hold the old page until the new one is ready (owner 2026-10-19) ----

/** The longest the old page is held while the new one loads (ms). */
const HOLD_MAX = 800;
let holdBody: ((from: Element | null) => void) | null = null;

/**
 * Call right before switching what the page column shows (another settings page, another Settings host):
 * a still copy of the column stays on screen until the new content has no `[data-settings-loading]` left
 * (or HOLD_MAX), so it replaces the old one at once instead of building up. `from`: the control used, when
 * it sits in a card (`section[id]`) — that card is kept where it was once the new page shows.
 */
export function holdPageBody(from: Element | null = null): void {
  holdBody?.(from);
}

/** The column is wide enough for the page (48rem) and an aside (20rem) side by side, with gaps and padding. */
const BODY_FLAGS = { wide: widthAtLeast(73) };

/**
 * A page's scrolling column. `aside` (a live preview, settings 左侧栏): beside the page while the column is
 * wide enough, sticky as the page scrolls; after the page otherwise (owner 2026-10-18). Width measured with
 * lib/sizeFlags (no CSS size containers, see there).
 */
export function PageBody({ children, scrollKey, aside }: { children: ReactNode; scrollKey?: string; aside?: ReactNode }) {
  // A new `scrollKey` (another settings page / profile / host in the same column) starts at the top.
  const scroller = useRef<HTMLDivElement | null>(null);
  const [sizeRef, flags] = useSizeFlags(BODY_FLAGS);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [scrollKey]);
  const wide = !!aside && flags.wide;
  const veil = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const take = (from: Element | null) => {
      const box = scroller.current;
      const cover = veil.current;
      if (!box || !cover || !box.firstElementChild) return;
      const card = from?.closest<HTMLElement>("section[id]") ?? null;
      const anchor = card ? { id: card.id, top: card.getBoundingClientRect().top } : null;
      const copy = box.firstElementChild.cloneNode(true) as HTMLElement;
      copy.style.transform = `translateY(${-box.scrollTop}px)`;
      cover.replaceChildren(copy);
      cover.hidden = false;
      const started = performance.now();
      let calm = 0;
      const check = () => {
        const loading = !!scroller.current?.querySelector("[data-settings-loading]");
        calm = loading ? 0 : calm + 1;
        if (calm < 2 && performance.now() - started < HOLD_MAX) return void requestAnimationFrame(check);
        const el = anchor && document.getElementById(anchor.id);
        const now = scroller.current;
        if (el && now) now.scrollTop += el.getBoundingClientRect().top - anchor.top;
        cover.hidden = true;
        cover.replaceChildren();
      };
      // Wait for the switch to render first.
      requestAnimationFrame(() => requestAnimationFrame(check));
    };
    holdBody = take;
    return () => {
      if (holdBody === take) holdBody = null;
    };
  }, []);
  return (
    <div className="relative flex min-w-0 flex-1">
    <div
      ref={(el) => {
        scroller.current = el;
        return sizeRef(el);
      }}
      className="min-w-0 flex-1 overflow-y-auto"
    >
      <div className={`mx-auto px-6 py-5 ${wide ? "grid max-w-[71rem] grid-cols-[minmax(0,1fr)_20rem] items-start gap-x-6" : "max-w-3xl"}`}>
        <div className="min-w-0">{children}</div>
        {aside && <aside className={wide ? "sticky top-2" : "mt-2"}>{aside}</aside>}
      </div>
    </div>
      {/* The held still copy (holdPageBody): over the column, not interactive, gone once the new page is ready. */}
      <div ref={veil} hidden aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-background" />
    </div>
  );
}

/** The row under the title bar for filters / search / page actions (right-aligned). */
export function PageToolbar({ children }: { children?: ReactNode }) {
  return <div className="mb-4 flex min-h-7 items-center justify-end gap-2">{children}</div>;
}

/** Secondary list on the left of a page (Settings tabs, project list). */
export function SubNav({ children }: { children: ReactNode }) {
  return <nav className="w-52 shrink-0 overflow-y-auto border-r border-border p-2">{children}</nav>;
}

export const SUBNAV_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]";
export const SUBNAV_ON = "bg-surface-2 text-foreground";
export const SUBNAV_OFF = "text-muted hover:bg-surface-2/60 hover:text-foreground";
