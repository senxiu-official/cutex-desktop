// Shared page chrome so every non-conversation page has the same gutters and width. The page
// title lives in the title bar (breadcrumb), never repeated inside the page.
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Scrolling content column: same width and padding on Tasks, Services, Projects, Settings….
 *  Scrollbars are overlays (lib/overlayScrollbarManager.ts) and take no width, so content never
 *  shifts sideways when a page grows past the viewport height. */
export function PageBody({ children, scrollKey }: { children: ReactNode; scrollKey?: string }) {
  // A new `scrollKey` (another settings page / profile / host in the same column) starts at the top.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [scrollKey]);
  return (
    <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-5">{children}</div>
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
