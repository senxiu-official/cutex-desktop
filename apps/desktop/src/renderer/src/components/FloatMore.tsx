// 「还有 N 个」 (design 040 §2.1): a float's scrolling list says how many rows sit below what it shows, in a footer
// sticky at its bottom; a press scrolls down a page. Nothing at all when everything fits (no extra child).
// Counted from scroll metrics (offsetTop / clientHeight, layout that a scroll does not dirty) on render and on
// the list's own scroll — no rect reads, no ResizeObserver: an open popover must stay cheap while it scrolls.
import { useLayoutEffect, useState, type RefObject } from "react";
// translate, not useI18n: menus are drawn in tests and desks without the provider; a float lives briefly.
import { translate } from "../i18n";

const FOOTER = 26;

/** How many rows start at or under `bottom` (scroll coordinates). Pure. */
export function rowsBelow(tops: readonly number[], bottom: number): number {
  return tops.filter((top) => top >= bottom - 1).length;
}

/** The count for `list` (its rows: `rows`, a selector from the list). Re-counted on each render and on scroll. */
export function useRowsBelow(list: RefObject<HTMLElement | null>, rows = ":scope > :not([data-float-more])"): number {
  const [n, setN] = useState(0);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const count = () => {
      // Not laid out (hidden, or a test without layout), or it all fits: nothing to count.
      if (el.clientHeight <= 0 || el.scrollHeight <= el.clientHeight + 1) return setN(0);
      const tops = [...el.querySelectorAll<HTMLElement>(rows)].map((r) => r.offsetTop);
      setN(rowsBelow(tops, el.scrollTop + el.clientHeight - FOOTER));
    };
    count();
    el.addEventListener("scroll", count, { passive: true });
    return () => el.removeEventListener("scroll", count);
  });
  return n;
}

export function FloatMore({ n, list }: { n: number; list: RefObject<HTMLElement | null> }) {
  if (n <= 0) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      data-float-more=""
      onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: "smooth" })}
      style={{ height: FOOTER }}
      className="sticky bottom-0 z-[2] -mb-1 block w-full bg-float px-2.5 text-left text-caption text-muted hover:text-foreground"
    >
      {translate("float.more", { n })}
    </button>
  );
}
