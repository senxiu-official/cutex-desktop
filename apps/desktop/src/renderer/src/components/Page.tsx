// Shared page chrome so every non-conversation page has the same gutters and width. The page
// title lives in the title bar (breadcrumb), never repeated inside the page.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useSizeFlags, widthAtLeast } from "../lib/sizeFlags";

/** Scrolling content column: same width and padding on Tasks, Services, Projects, Settings….
 *  Scrollbars are overlays (lib/overlayScrollbarManager.ts) and take no width, so content never
 *  shifts sideways when a page grows past the viewport height. */
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
  return (
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
