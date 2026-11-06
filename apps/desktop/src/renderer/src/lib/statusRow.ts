// The status row above the input (components/StatusBar). How it gives way when narrow (owner 2026-11-05: it may take
// two lines rather than hide items, and the composer must not jump as items come and go):
//   1. below STATUS_ROW_TIGHT_REM the right-side chips drop their word: 「委托 20 ›」 → 「⇆ 20 ›」 (StatusChipWords; the
//      full words stay as the button's title and accessible name);
//   2. what still does not fit wraps onto a second line;
//   3. the row never gets shorter while its width stays the same (useStickyHeight): a chip that goes, or the 需要你
//      bell when nothing waits any more, leaves its line in place, so the input under it stays put. A new width
//      (window or pane resize) or another agent (the row is keyed by agent) starts over.
import { useCallback, useRef } from "react";
import { sharedResizeObserver } from "./resizeHub";
import { widthBelow } from "./sizeFlags";

/** Content width (rem) under which the right-side status chips show icon + count only. */
export const STATUS_ROW_TIGHT_REM = 30;

/** lib/sizeFlags tests of the status row: `data-tight` on the row (group/status). */
export const STATUS_ROW_FLAGS = { tight: widthBelow(STATUS_ROW_TIGHT_REM) } as const;

/** A callback ref that keeps the element's `min-height` at the tallest it has been at its current width. */
export function useStickyHeight(): (el: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!el) return;
    let width = el.clientWidth;
    let floor = 0;
    const measure = () => {
      if (Math.abs(el.clientWidth - width) > 1) {
        width = el.clientWidth;
        floor = 0;
        el.style.minHeight = "";
      }
      const height = el.offsetHeight;
      if (height > floor) {
        floor = height;
        el.style.minHeight = `${height}px`;
      }
    };
    measure();
    const observer = sharedResizeObserver(measure);
    observer.observe(el);
    stop.current = () => observer.disconnect();
  }, []);
}
